import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The short terms for using Dialed with your own AI and API keys.',
};

/** Short, plain terms for an open-source app where people bring their own keys. */
export default function TermsPage() {
  return (
    <main className="legal">
      <Logo href="/" />
      <h1>Terms</h1>
      <p className="muted">Last updated 17 November 2026</p>

      <p>
        Dialed is free, open-source software under the MIT licence. These terms cover using this copy of it. By creating
        an account you agree to them.
      </p>

      <h2>You bring your own keys</h2>
      <p>
        You use your own API keys and your own AI. Each API and AI provider has its own terms, prices and limits, and
        you’re responsible for following them and for any credits or charges your runs and schedules use. Dialed shows
        the cost before a run spends credits and stops at the limit you set, but the provider’s bill is yours.
      </p>

      <h2>Use it fairly</h2>
      <ul>
        <li>Only call APIs you’re allowed to use, with keys that are yours to use.</li>
        <li>Don’t use Dialed to attack, overload or get around the limits of any service.</li>
        <li>Don’t store data you have no right to keep.</li>
      </ul>

      <h2>No warranty</h2>
      <p>
        Dialed comes as is, without any warranty. The AI can make mistakes when it reads docs: check what it built
        before you rely on it, and read its notes on what an API can’t do. We’re not liable for losses from using the
        app, as far as the law allows.
      </p>

      <h2>Your account</h2>
      <p>
        You can stop using Dialed and delete your account at any time in <Link href="/settings/account">Settings</Link>.
        Whoever runs this copy may close accounts that break these terms.
      </p>

      <p>
        See also the <Link href="/privacy">privacy page</Link>.
      </p>
    </main>
  );
}
