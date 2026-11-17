'use client';

import { Minus, Plus } from 'lucide-react';

/** A number stepper: minus, the value, plus. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  label,
  format = (n) => n.toLocaleString('en-AU'),
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  format?: (n: number) => string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Fewer" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        <Minus className="i i-sm" aria-hidden="true" />
      </button>
      <output aria-live="polite" className="num">
        {format(value)}
      </output>
      <button type="button" aria-label="More" disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        <Plus className="i i-sm" aria-hidden="true" />
      </button>
    </div>
  );
}
