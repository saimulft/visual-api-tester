'use client';

import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { passwordStrength } from '@/contracts/auth';
import { cn } from './cn';

/**
 * Field (label, hint, inline error) and the text inputs. A Field passes its id to its input through
 * `children` as a function, or use `id` on both.
 */
export function Field({
  label,
  hint,
  error,
  id,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  id?: string;
  className?: string;
  children: ReactNode | ((ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode);
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('field', className)}>
      <label className="label" htmlFor={inputId}>
        {label}
      </label>
      {typeof children === 'function' ? children({ id: inputId, describedBy, invalid: Boolean(error) }) : children}
      {error && (
        <p className="err-text" id={errorId} role="alert">
          <AlertCircle className="i i-sm" aria-hidden="true" />
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

type InputProps = ComponentProps<'input'> & { large?: boolean; invalid?: boolean; icon?: ReactNode; end?: ReactNode };

/** A text input. With `icon` or `end` it becomes the canvas's wrapped .input with the input inside. */
export function Input({ large, invalid, icon, end, className, ...rest }: InputProps) {
  const cls = cn('input', large && 'input-lg', invalid && 'is-err', className);
  if (!icon && !end) return <input className={cls} aria-invalid={invalid || undefined} {...rest} />;
  return (
    <div className={cls}>
      {icon}
      <input aria-invalid={invalid || undefined} {...rest} />
      {end}
    </div>
  );
}

export function Textarea({ invalid, className, ...rest }: ComponentProps<'textarea'> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn('input', 'textarea', invalid && 'is-err', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

/** A password field with show and hide, and (with `meter`) the four-bar strength line and its words. */
export function PasswordInput({
  meter,
  value,
  large = true,
  invalid,
  hintId,
  ...rest
}: Omit<InputProps, 'type' | 'value'> & { meter?: boolean; value: string; hintId?: string }) {
  const [shown, setShown] = useState(false);
  const strength = passwordStrength(value);
  return (
    <>
      <Input
        {...rest}
        large={large}
        invalid={invalid}
        value={value}
        type={shown ? 'text' : 'password'}
        end={
          <button
            className="btn btn-sm btn-icon btn-ghost"
            type="button"
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <EyeOff className="i" aria-hidden="true" /> : <Eye className="i" aria-hidden="true" />}
          </button>
        }
      />
      {meter && (
        <>
          <div className="pw-meter" aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={cn(strength.score >= n && 'on')} />
            ))}
          </div>
          <p className="hint" id={hintId} aria-live="polite">
            {strength.label ? `${strength.label}. ${strength.hint}` : strength.hint}
          </p>
        </>
      )}
    </>
  );
}
