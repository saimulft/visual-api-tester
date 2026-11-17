'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

/** The switch: a 44x26 track whose knob slides over 320ms. */
export function Switch({
  checked,
  onChange,
  label,
  text,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The accessible name when there's no visible label. */
  label?: string;
  /** Text beside the switch (the canvas's .switch-text). */
  text?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const button = (
    <button
      id={id}
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
  if (!text) return button;
  return (
    <span className="switch-row">
      {button}
      <span className="switch-text">{text}</span>
    </span>
  );
}

/** A checkbox in the canvas's .cbox style, with its label. */
export function Checkbox({
  checked,
  onChange,
  children,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      className={cn('check', className)}
      onClick={() => onChange(!checked)}
    >
      <span className={cn('cbox', checked && 'is-on')}>{checked && <Check className="i" aria-hidden="true" />}</span>
      {children && <span>{children}</span>}
    </button>
  );
}
