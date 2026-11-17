import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { workspaceFromEmail } from '@/contracts/auth';
import { loadSession } from '../auth/sessions';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import { resetRateLimits } from '../http/rate-limit';
import { sentMail } from '../mail';
import * as auth from './auth';
import { ctxFor, requireCheckedEmail } from './context';

const t = await createTestDb();
afterAll(() => t.close());
beforeEach(() => {
  resetRateLimits();
  sentMail.length = 0;
});

const meta = { ip: '203.0.113.9', userAgent: 'vitest' };
const password = 'field-notes-2026!';
const linkToken = (path: string) => {
  const mail = sentMail[sentMail.length - 1];
  const match = new RegExp(`${path}/([A-Za-z0-9_-]+)`).exec(mail.text);
  if (!match) throw new Error(`no ${path} link in: ${mail.text}`);
  return match[1];
};
const ctxOf = async (id: string) =>
  ctxFor(await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow());

describe('sign up and the email check', () => {
  it('names the workspace from the email domain', () => {
    expect(workspaceFromEmail('nadia@brightfield.com.au')).toBe('Brightfield');
    expect(workspaceFromEmail('a@tidepool-analytics.io')).toBe('Tidepool Analytics');
    expect(workspaceFromEmail('a@mail.kestrel.co.uk')).toBe('Kestrel');
    expect(workspaceFromEmail('a@gmail.com')).toBe('My workspace');
  });

  it('signs up, logs in at once and checks the email from the link', async () => {
    const result = await auth.signUp(
      { email: 'Nadia@Brightfield.com.au', password, timezone: 'Australia/Sydney' },
      meta,
    );
    expect(result.user.email).toBe('nadia@brightfield.com.au');
    expect(result.user.workspace).toBe('Brightfield');
    expect(result.user.timezone).toBe('Australia/Sydney');
    expect(result.user.emailChecked).toBe(false);
    expect((await loadSession(result.token))?.user.id).toBe(result.user.id);

    expect(sentMail).toHaveLength(1);
    const token = linkToken('/check-email');
    const checked = await auth.checkEmail({ token });
    expect(checked.emailChecked).toBe(true);
    expect(() => requireCheckedEmail({ user: checked, now: Date.now() })).not.toThrow();
    await expect(auth.checkEmail({ token })).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('refuses a short password, a taken email and closed sign-ups', async () => {
    await expect(auth.signUp({ email: 'short@dialed.test', password: 'short' }, meta)).rejects.toMatchObject({
      status: 422,
    });
    await expect(auth.signUp({ email: 'nadia@brightfield.com.au', password }, meta)).rejects.toMatchObject({
      code: 'email_taken',
    });
    process.env.SIGNUPS = 'closed';
    try {
      await expect(auth.signUp({ email: 'later@dialed.test', password }, meta)).rejects.toMatchObject({
        code: 'signups_closed',
        status: 403,
      });
    } finally {
      process.env.SIGNUPS = 'open';
    }
  });

  it('resends the check, but not forever', async () => {
    const { user } = await auth.signUp({ email: 'resend@dialed.test', password }, meta);
    const ctx = await ctxOf(user.id);
    for (let i = 0; i < 3; i++) expect((await auth.resendCheck(ctx, meta)).sentTo).toBe('resend@dialed.test');
    await expect(auth.resendCheck(ctx, meta)).rejects.toMatchObject({ status: 429 });
  });
});

describe('log in, log out and the limit', () => {
  it('logs in and out', async () => {
    const result = await auth.logIn({ email: 'nadia@brightfield.com.au', password }, meta);
    expect(result.user.workspace).toBe('Brightfield');
    await auth.logOut(result.token);
    expect(await loadSession(result.token)).toBeNull();
  });

  it('stops after 5 wrong passwords for an email', async () => {
    for (let i = 0; i < 5; i++)
      await expect(
        auth.logIn({ email: 'nadia@brightfield.com.au', password: 'wrong-password-123' }, meta),
      ).rejects.toMatchObject({ code: 'bad_login' });
    await expect(auth.logIn({ email: 'nadia@brightfield.com.au', password }, meta)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
  });

  it('answers the same for an unknown email', async () => {
    await expect(auth.logIn({ email: 'nobody@dialed.test', password }, meta)).rejects.toMatchObject({
      code: 'bad_login',
    });
  });
});

describe('resets and changes', () => {
  it('resets the password from the link and logs out other sessions', async () => {
    const before = await auth.logIn({ email: 'nadia@brightfield.com.au', password }, meta);
    expect((await auth.requestReset({ email: 'nadia@brightfield.com.au' }, meta)).sentTo).toBe(
      'nadia@brightfield.com.au',
    );
    const token = linkToken('/reset-password');
    const after = await auth.resetPassword({ token, password: 'a-brand-new-password-1' }, meta);
    expect(await loadSession(before.token)).toBeNull();
    expect(await loadSession(after.token)).not.toBeNull();
    await expect(auth.resetPassword({ token, password: 'another-new-password-2' }, meta)).rejects.toMatchObject({
      code: 'invalid_token',
    });
    await expect(auth.logIn({ email: 'nadia@brightfield.com.au', password }, meta)).rejects.toMatchObject({
      code: 'bad_login',
    });
    await auth.logIn({ email: 'nadia@brightfield.com.au', password: 'a-brand-new-password-1' }, meta);
  });

  it('clears the failed log-ins once the password is reset', async () => {
    resetRateLimits();
    for (let i = 0; i < 5; i++)
      await expect(
        auth.logIn({ email: 'nadia@brightfield.com.au', password: 'wrong-password-123' }, meta),
      ).rejects.toMatchObject({ code: 'bad_login' });
    await auth.requestReset({ email: 'nadia@brightfield.com.au' }, meta);
    await auth.resetPassword({ token: linkToken('/reset-password'), password: 'a-third-password-123' }, meta);
    await auth.logIn({ email: 'nadia@brightfield.com.au', password: 'a-third-password-123' }, meta);
  });

  it('asks for a reset without telling whether the email exists', async () => {
    sentMail.length = 0;
    expect((await auth.requestReset({ email: 'ghost@dialed.test' }, meta)).sentTo).toBe('ghost@dialed.test');
    expect(sentMail).toHaveLength(0);
  });

  it('changes the password and the email, then deletes the account', async () => {
    const { user, token } = await auth.signUp({ email: 'mover@dialed.test', password }, meta);
    const other = await auth.logIn({ email: 'mover@dialed.test', password }, meta);
    const ctx = await ctxOf(user.id);
    await expect(
      auth.changePassword(ctx, { current: 'nope', password: 'newer-password-123' }, token),
    ).rejects.toMatchObject({ code: 'bad_password' });
    await auth.changePassword(ctx, { current: password, password: 'newer-password-123' }, token);
    expect(await loadSession(token)).not.toBeNull();
    expect(await loadSession(other.token)).toBeNull();

    await auth.requestEmailChange(ctx, { email: 'moved@dialed.test', password: 'newer-password-123' });
    const changed = await auth.confirmEmailChange({ token: linkToken('/check-email') });
    expect(changed.email).toBe('moved@dialed.test');
    expect(changed.emailChecked).toBe(true);

    await expect(auth.deleteAccount(ctx, { password: 'wrong' })).rejects.toMatchObject({ code: 'bad_password' });
    await auth.deleteAccount(ctx, { password: 'newer-password-123' });
    expect(await db.selectFrom('users').select('id').where('id', '=', user.id).executeTakeFirst()).toBeUndefined();
    expect(
      await db.selectFrom('sessions').select('id').where('user_id', '=', user.id).executeTakeFirst(),
    ).toBeUndefined();
  });
});
