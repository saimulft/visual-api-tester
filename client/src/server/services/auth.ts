import {
  ChangeEmailSchema,
  ChangePasswordSchema,
  DeleteAccountSchema,
  EmailOnlySchema,
  LogInSchema,
  ResetSchema,
  SignUpSchema,
  TokenSchema,
  workspaceFromEmail,
  type Me,
} from '@/contracts/auth';
import { ApiError } from '@/contracts/common';
import { consumeEmailToken, createEmailToken } from '../auth/email-tokens';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { createSession, deleteSession, deleteUserSessions } from '../auth/sessions';
import { appUrl } from '../auth/tokens';
import { db, newId, now, transaction } from '../db';
import { checkBody } from '../http/inputs';
import { assertUnderLimit, clearHits, MINUTE, rateLimit, recordHit } from '../http/rate-limit';
import { validTimeZone } from '../jobs/time';
import {
  checkEmailMail,
  emailChangedNotice,
  emailChangeMail,
  passwordChangedNotice,
  resetMail,
  trySend,
} from '../mail';
import { toMe, type Ctx } from './context';
import { freeHandle } from './users';

/**
 * Accounts: sign up, log in and out, the email check, resets, and changing the password or email. Route
 * handlers pass the request's IP and user agent as `meta` for rate limits and the sessions list.
 */
export type Meta = { ip: string | null; userAgent: string | null };
export type SignedIn = { user: Me; token: string; expiresAt: number };

const HOUR = 60 * MINUTE;

export function signupsOpen() {
  return (process.env.SIGNUPS ?? 'open').trim().toLowerCase() !== 'closed';
}

export const SIGNUPS_CLOSED_MESSAGE =
  'Sign-ups are closed on this Dialed for now. If you already have an account, log in. Dialed is open source, so you can also run your own.';

const ipKey = (scope: string, meta: Meta) => `${scope}:ip:${meta.ip ?? 'unknown'}`;

async function sendCheck(userId: string, email: string) {
  const token = await createEmailToken(userId, 'check');
  await trySend(checkEmailMail({ to: email, url: appUrl(`/check-email/${token}`) }));
}

async function userByEmail(email: string) {
  return db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
}

async function userById(id: string) {
  const row = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new ApiError('not_found', 'That account no longer exists.', 404);
  return row;
}

/** Creates an account, logs it in and sends the email check. The workspace is named from the email domain. */
export async function signUp(input: unknown, meta: Meta): Promise<SignedIn> {
  if (!signupsOpen()) throw new ApiError('signups_closed', SIGNUPS_CLOSED_MESSAGE, 403);
  const { email, password, timezone } = checkBody(SignUpSchema, input);
  rateLimit(ipKey('signup', meta), 10, HOUR);
  rateLimit(`signup:email:${email}`, 3, HOUR);
  if (await userByEmail(email))
    throw new ApiError('email_taken', 'That email already has an account. Log in, or reset your password.', 409, [
      { path: 'email', message: 'That email already has an account.' },
    ]);
  const at = now();
  const id = newId();
  const passwordHash = await hashPassword(password);
  await db
    .insertInto('users')
    .values({
      id,
      email,
      name: '',
      password_hash: passwordHash,
      email_checked_at: null,
      workspace: workspaceFromEmail(email),
      timezone: validTimeZone(timezone) ?? 'UTC',
      mcp_handle: await freeHandle(),
      alert_email: null,
      alerts_muted: false,
      created_at: at,
      updated_at: at,
    })
    .execute();
  await sendCheck(id, email);
  const session = await createSession(id, meta.userAgent, meta.ip);
  return { user: toMe(await userById(id)), ...session };
}

/** Logs in. Only failures count toward the limit: 5 per email and 20 per address in 15 minutes. */
export async function logIn(input: unknown, meta: Meta): Promise<SignedIn> {
  const { email, password } = checkBody(LogInSchema, input);
  const emailKey = `login:email:${email}`;
  const addressKey = ipKey('login', meta);
  assertUnderLimit(emailKey, 5, 15 * MINUTE);
  assertUnderLimit(addressKey, 20, 15 * MINUTE);
  const row = await userByEmail(email);
  if (!(await verifyPassword(password, row?.password_hash ?? null)) || !row) {
    recordHit(emailKey);
    recordHit(addressKey);
    throw new ApiError('bad_login', 'That email and password don’t match. Try again, or reset your password.', 401);
  }
  const session = await createSession(row.id, meta.userAgent, meta.ip);
  return { user: toMe(row), ...session };
}

export async function logOut(token: string | null) {
  await deleteSession(token);
}

/** The link from the check email. Marks the email checked; works whether or not the browser is logged in. */
export async function checkEmail(input: unknown): Promise<Me> {
  const { token } = checkBody(TokenSchema, input);
  const { userId } = await consumeEmailToken(token, 'check');
  const row = await userById(userId);
  if (row.email_checked_at === null)
    await db
      .updateTable('users')
      .set({ email_checked_at: now(), updated_at: now() })
      .where('id', '=', userId)
      .execute();
  return toMe(await userById(userId));
}

/** Sends the check email again: 3 per person and 10 per address in 15 minutes. */
export async function resendCheck(ctx: Ctx, meta: Meta): Promise<{ sentTo: string | null }> {
  if (ctx.user.emailChecked) return { sentTo: null };
  rateLimit(`resend:user:${ctx.user.id}`, 3, 15 * MINUTE);
  rateLimit(ipKey('resend', meta), 10, 15 * MINUTE);
  await sendCheck(ctx.user.id, ctx.user.email);
  return { sentTo: ctx.user.email };
}

/**
 * Asks for a reset link. Always answers the same, so it never tells whether an email has an account:
 * 3 per email an hour and 10 per address in 15 minutes.
 */
export async function requestReset(input: unknown, meta: Meta): Promise<{ sentTo: string }> {
  const { email } = checkBody(EmailOnlySchema, input);
  rateLimit(ipKey('reset', meta), 10, 15 * MINUTE);
  rateLimit(`reset:email:${email}`, 3, HOUR);
  const row = await userByEmail(email);
  if (row) {
    const token = await createEmailToken(row.id, 'reset');
    await trySend(resetMail({ to: email, url: appUrl(`/reset-password/${token}`) }));
  }
  return { sentTo: email };
}

/** Sets a new password from a reset link, logs out everywhere, and logs this browser in. */
export async function resetPassword(input: unknown, meta: Meta): Promise<SignedIn> {
  const { token, password } = checkBody(ResetSchema, input);
  rateLimit(ipKey('reset-use', meta), 20, 15 * MINUTE);
  const { userId } = await consumeEmailToken(token, 'reset');
  const row = await userById(userId);
  const at = now();
  await transaction(async () => {
    await db
      .updateTable('users')
      // The link came to their inbox, so the email is theirs.
      .set({
        password_hash: await hashPassword(password),
        email_checked_at: row.email_checked_at ?? at,
        updated_at: at,
      })
      .where('id', '=', userId)
      .execute();
    await deleteUserSessions(userId);
  });
  // The new password works straight away, even after failed log-ins.
  clearHits(`login:email:${row.email}`);
  const session = await createSession(userId, meta.userAgent, meta.ip);
  return { user: toMe(await userById(userId)), ...session };
}

async function assertPassword(userId: string, password: string, path = 'password') {
  rateLimit(`password-check:user:${userId}`, 10, 15 * MINUTE);
  const row = await userById(userId);
  if (!(await verifyPassword(password, row.password_hash)))
    throw new ApiError('bad_password', 'That password isn’t right.', 401, [
      { path, message: 'That password isn’t right.' },
    ]);
  return row;
}

/** Changes the password and logs out every other device. */
export async function changePassword(ctx: Ctx, input: unknown, keepToken: string | null) {
  const { current, password } = checkBody(ChangePasswordSchema, input);
  await assertPassword(ctx.user.id, current, 'current');
  await db
    .updateTable('users')
    .set({ password_hash: await hashPassword(password), updated_at: now() })
    .where('id', '=', ctx.user.id)
    .execute();
  await deleteUserSessions(ctx.user.id, keepToken ?? undefined);
  await trySend(passwordChangedNotice({ to: ctx.user.email, url: appUrl('/reset-password') }));
}

/** Starts an email change: a link goes to the new address, and the change happens when it's opened. */
export async function requestEmailChange(ctx: Ctx, input: unknown): Promise<{ sentTo: string }> {
  const { email, password } = checkBody(ChangeEmailSchema, input);
  await assertPassword(ctx.user.id, password);
  if (email === ctx.user.email)
    throw new ApiError('same_email', 'That’s already your email.', 422, [
      { path: 'email', message: 'That’s already your email.' },
    ]);
  rateLimit(`email-change:user:${ctx.user.id}`, 3, HOUR);
  if (await userByEmail(email))
    throw new ApiError('email_taken', 'That email already has an account.', 409, [
      { path: 'email', message: 'That email already has an account.' },
    ]);
  const token = await createEmailToken(ctx.user.id, 'email-change', email);
  await trySend(emailChangeMail({ to: email, url: appUrl(`/check-email/${token}?change=1`) }));
  return { sentTo: email };
}

/** The link from the email-change mail: switches the account to the new address. */
export async function confirmEmailChange(input: unknown): Promise<Me> {
  const { token } = checkBody(TokenSchema, input);
  const { userId, newEmail } = await consumeEmailToken(token, 'email-change');
  if (!newEmail) throw new ApiError('invalid_token', 'This link isn’t valid any more.', 400);
  const before = await userById(userId);
  if (await userByEmail(newEmail)) throw new ApiError('email_taken', 'That email already has an account.', 409);
  const at = now();
  await db
    .updateTable('users')
    .set({ email: newEmail, email_checked_at: at, updated_at: at })
    .where('id', '=', userId)
    .execute();
  await trySend(emailChangedNotice({ to: before.email, newEmail }));
  return toMe(await userById(userId));
}

/** Deletes the account and everything in it: projects, keys, runs, data, schedules and sessions cascade. */
export async function deleteAccount(ctx: Ctx, input: unknown) {
  const { password } = checkBody(DeleteAccountSchema, input);
  await assertPassword(ctx.user.id, password);
  await db.deleteFrom('users').where('id', '=', ctx.user.id).execute();
}
