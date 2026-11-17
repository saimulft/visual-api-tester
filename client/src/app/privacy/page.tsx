import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Dialed stores, how keys are sealed, and how to delete your account.',
};

/** A short, plain privacy page for an open-source app where people bring their own keys. */
export default function PrivacyPage() {
  return (
    <main className="legal">
      <Logo href="/" />
      <h1>Privacy</h1>
      <p className="muted">Last updated 17 November 2026</p>

      <p>
        Dialed is open source. You can run your own copy, and whoever runs this copy is responsible for it. This page
        says what this copy keeps and why, in plain words.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your account: your email, a scrambled (hashed) password, your workspace name and time zone.</li>
        <li>Your projects: the API you set up, the controls your AI built, your presets and schedules.</li>
        <li>Your data: the rows your runs bring back, so you can see, download and share them.</li>
        <li>Your keys: the API keys and AI keys you paste in, sealed as described below.</li>
        <li>A log of runs and AI calls, so you can see what happened and what it cost.</li>
      </ul>

      <h2>Your keys are sealed</h2>
      <p>
        Keys are encrypted with AES-256-GCM before they’re stored, and only the server opens them, only to make a call
        you asked for. A saved API key is only ever sent to the host you saved it for. The app never shows a full key
        again: you’ll see its last four characters.
      </p>

      <h2>Who your data goes to</h2>
      <p>
        When you run a project, Dialed calls that API for you. When your AI sets up a project, Dialed sends the API’s
        docs and your instruction to the AI you connected (your own key, or your own AI client over MCP). Nothing else
        leaves the app. We don’t sell your data, and there are no ads or trackers.
      </p>

      <h2>Email</h2>
      <p>
        We email you to check your address, reset your password and, if you turn them on, tell you when a schedule
        fails.
      </p>

      <h2>Deleting your account</h2>
      <p>
        You can delete your account in <Link href="/settings/account">Settings</Link>. That removes your projects, keys,
        runs, saved data and schedules straight away.
      </p>

      <h2>Questions</h2>
      <p>Ask whoever runs this copy of Dialed, or open an issue on the project’s GitHub page.</p>
    </main>
  );
}
