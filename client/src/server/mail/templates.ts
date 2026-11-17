import type { Mail } from './index';

/** Plain, short emails. The text part has the links as plain text; the HTML part is a simple card. */

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(input: { title: string; lines: string[]; button?: { label: string; url: string }; foot?: string }) {
  const p = (t: string) =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#0b1f1c">${escapeHtml(t)}</p>`;
  const button = input.button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(input.button.url)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#0c8577;color:#ffffff;font-weight:600;text-decoration:none">${escapeHtml(input.button.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;color:#55625f">Or paste this link: ${escapeHtml(input.button.url)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f5;font-family:'Plus Jakarta Sans',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:28px;border-radius:20px;background:#ffffff;border:1px solid #e1e6e4">
<p style="margin:0 0 18px;font-weight:700;font-size:18px;color:#0b1f1c">dialed</p>
<h1 style="margin:0 0 14px;font-size:22px;color:#0b1f1c">${escapeHtml(input.title)}</h1>
${input.lines.map(p).join('\n')}${button}
${input.foot ? `<p style="margin:18px 0 0;font-size:13px;color:#55625f">${escapeHtml(input.foot)}</p>` : ''}
</div></body></html>`;
}

function text(input: { title: string; lines: string[]; button?: { label: string; url: string }; foot?: string }) {
  return [
    input.title,
    '',
    ...input.lines,
    ...(input.button ? ['', `${input.button.label}: ${input.button.url}`] : []),
    ...(input.foot ? ['', input.foot] : []),
  ].join('\n');
}

function build(to: string, subject: string, body: Parameters<typeof layout>[0]): Mail {
  return { to, subject, text: text(body), html: layout(body) };
}

export function checkEmailMail(input: { to: string; url: string }): Mail {
  return build(input.to, 'Check your email to start using Dialed', {
    title: 'Check your email',
    lines: ['Open this link to confirm it’s you. Then connect your AI and set up your first API.'],
    button: { label: 'Confirm my email', url: input.url },
    foot: 'The link works for 24 hours. If you didn’t sign up for Dialed, ignore this email.',
  });
}

export function resetMail(input: { to: string; url: string }): Mail {
  return build(input.to, 'Reset your Dialed password', {
    title: 'Reset your password',
    lines: ['Someone asked to reset the password for this email. Open the link to choose a new one.'],
    button: { label: 'Choose a new password', url: input.url },
    foot: 'The link works for 1 hour. If you didn’t ask for this, ignore this email: your password stays as it is.',
  });
}

export function emailChangeMail(input: { to: string; url: string }): Mail {
  return build(input.to, 'Confirm your new Dialed email', {
    title: 'Confirm your new email',
    lines: ['Open this link to use this address for your Dialed account.'],
    button: { label: 'Use this email', url: input.url },
    foot: 'The link works for 24 hours. If you didn’t ask for this, ignore this email.',
  });
}

export function emailChangedNotice(input: { to: string; newEmail: string }): Mail {
  return build(input.to, 'Your Dialed email changed', {
    title: 'Your email changed',
    lines: [
      `Your Dialed account now uses ${input.newEmail}. If you didn’t do this, reset your password straight away.`,
    ],
  });
}

export function passwordChangedNotice(input: { to: string; url: string }): Mail {
  return build(input.to, 'Your Dialed password changed', {
    title: 'Your password changed',
    lines: ['Your Dialed password was just changed, and other devices were logged out.'],
    button: { label: 'Not you? Reset it', url: input.url },
  });
}
