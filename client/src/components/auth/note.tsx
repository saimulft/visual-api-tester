import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';

/** A note above or inside an account form: what happened, in a sentence. */
export function AuthNote({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'err'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'err' ? AlertCircle : Info;
  return (
    <div className={`auth-note${tone === 'info' ? '' : ` is-${tone}`}`} role={tone === 'err' ? 'alert' : 'status'}>
      <Icon className="i i-sm" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
