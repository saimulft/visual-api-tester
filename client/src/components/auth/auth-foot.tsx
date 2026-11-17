import Link from 'next/link';
import { GithubIcon } from './icons';

/** Under the form: the GitHub link (NEXT_PUBLIC_REPO_URL), Privacy and Terms. */
export function AuthFoot() {
  const repo = process.env.NEXT_PUBLIC_REPO_URL;
  return (
    <nav className="auth-foot" aria-label="About Dialed">
      {repo && (
        <a href={repo} target="_blank" rel="noreferrer">
          <GithubIcon />
          Open source on GitHub
        </a>
      )}
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
    </nav>
  );
}
