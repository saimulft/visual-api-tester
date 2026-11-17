'use client';

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { Stepper } from '@/components/ui';
import { dialAngle, dialValueAt, fmt, keyStep, type Scale } from './scale';

/**
 * The dial (board 07): a ring of ticks, a turning hand over 270°, the readout and a stepper. Drag round
 * it, or use the keys: arrows step, Page Up and Page Down move a tenth, Home and End go to the ends.
 */
export function Dial({
  scale,
  value,
  onChange,
  label,
  unit,
  disabled,
}: {
  scale: Scale;
  value: number;
  onChange: (value: number) => void;
  label: string;
  unit?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const angle = dialAngle(value, scale);
  const arc = ((angle + 135) / 270) * 270;
  const text = `${fmt(value)}${unit ? ` ${unit}` : ''}`;
  const set = (v: number) => onChange(Math.min(scale.max, Math.max(scale.min, v)));

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - (box.left + box.width / 2);
    const y = event.clientY - (box.top + box.height / 2);
    const degrees = (Math.atan2(x, -y) * 180) / Math.PI; // 0 at the top, clockwise
    set(dialValueAt(degrees < 0 ? degrees + 360 : degrees, scale));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = keyStep(scale, false);
    const big = keyStep(scale, true);
    const moves: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageUp: big,
      PageDown: -big,
    };
    if (event.key in moves) set(value + moves[event.key]);
    else if (event.key === 'Home') set(scale.min);
    else if (event.key === 'End') set(scale.max);
    else return;
    event.preventDefault();
  };

  return (
    <div className="dial-wrap">
      <div
        ref={ref}
        className="dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={scale.min}
        aria-valuemax={scale.max}
        aria-valuenow={value}
        aria-valuetext={text}
        aria-disabled={disabled || undefined}
        style={{ cursor: disabled ? 'default' : 'grab', touchAction: 'none' }}
        onKeyDown={disabled ? undefined : onKey}
        onPointerDown={
          disabled
            ? undefined
            : (event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                fromPointer(event);
              }
        }
        onPointerMove={
          disabled
            ? undefined
            : (event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
              }
        }
      >
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="ring" cx="60" cy="60" r="56" pathLength="360" transform="rotate(135 60 60)" />
          <circle
            className="arc"
            cx="60"
            cy="60"
            r="48"
            pathLength="360"
            transform="rotate(135 60 60)"
            style={{ strokeDasharray: `${arc} 360` }}
          />
        </svg>
        <div className="dial-cap">
          <span className="dial-hand" style={{ transform: `rotate(${angle}deg)` }} />
        </div>
      </div>
      <div className="dial-val">
        <output className="readout" style={{ fontSize: 22 }}>
          {text}
        </output>
        {!disabled && (
          <Stepper
            value={value}
            onChange={set}
            min={scale.min}
            max={scale.max}
            step={scale.step}
            label={label}
            format={(n) => fmt(n)}
          />
        )}
      </div>
    </div>
  );
}
