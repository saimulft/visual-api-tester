'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

/** Segmented pills: every option visible, one pressed. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  block,
  className,
}: {
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  block?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('seg', block && 'is-block', className)} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
