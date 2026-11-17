// Adapted from dl-cms/cms/src/server/auth/mail.ts (one SMTP sender from the env, console without one)
import fs from 'node:fs';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Outgoing email: email checks, resets, schedule alerts. One SMTP sender from the env (SMTP_HOST and
 * friends). Without SMTP_HOST, each mail goes to the console and to a file in ./.dev-mail/, links as plain
 * text, so local runs need no mail server. Tests never send: they read sentMail.
 */
export type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string };

const DEFAULT_FROM = 'Dialed <no-reply@localhost>';

const globals = globalThis as unknown as { __dialedMailer?: Transporter | null; __dialedSentMail?: Mail[] };

/** Mails sent while testing, newest last. */
export const sentMail: Mail[] = (globals.__dialedSentMail ??= []);

function transporter(): Transporter | null {
  if (globals.__dialedMailer !== undefined) return globals.__dialedMailer;
  const host = process.env.SMTP_HOST;
  globals.__dialedMailer = host
    ? nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
    : null;
  return globals.__dialedMailer;
}

/** Where mail goes without SMTP. */
export const DEV_MAIL_DIR = './.dev-mail';

function writeDevMail(mail: Mail) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = mail.subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const file = path.join(DEV_MAIL_DIR, `${stamp}-${slug || 'mail'}.txt`);
  fs.mkdirSync(DEV_MAIL_DIR, { recursive: true });
  fs.writeFileSync(file, `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
  return file;
}

/** Sends a mail. Throws when the SMTP server refuses it. */
export async function send(mail: Mail): Promise<void> {
  if (process.env.VITEST) {
    sentMail.push(mail);
    return;
  }
  const smtp = transporter();
  if (!smtp) {
    const file = writeDevMail(mail);
    console.log(`[mail] to ${mail.to}: ${mail.subject} (no SMTP set, saved to ${file})\n${mail.text}`);
    return;
  }
  await smtp.sendMail({ from: process.env.MAIL_FROM || DEFAULT_FROM, ...mail });
}

/** Sends, logging a failure instead of throwing (the request that triggered it still succeeds). */
export async function trySend(mail: Mail): Promise<boolean> {
  try {
    await send(mail);
    return true;
  } catch (error) {
    console.error('[mail] sending failed', error instanceof Error ? error.message : error);
    return false;
  }
}

export const mail = { send, trySend };
export * from './templates';
