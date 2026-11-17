'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from './cn';

/** A value with a Copy button that says "Copied" for a moment. */
export function CopyField({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className={cn('copyfield', className)}>
      <code>{value}</code>
      <button
        className={cn('btn btn-sm', copied && 'is-copied')}
        type="button"
        onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
        }}
      >
        {copied ? <Check className="i i-sm" aria-hidden="true" /> : <Copy className="i i-sm" aria-hidden="true" />}
        <span aria-live="polite">{copied ? 'Copied' : label}</span>
      </button>
    </div>
  );
}
