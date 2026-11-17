'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { fmt, fromPosition, keyStep, scaleBackground, ticksOf, toPosition, type Scale } from './scale';

/**
 * A fader over a printed tick scale (the canvas's .fader): one knob, or two for a from-and-to range. The
 * knobs are real range inputs, so arrow keys, Home and End work; Page Up and Page Down move a tenth. A log
 * scale runs the inputs on positions (0 to 100) and reads out the value.
 */
type Common = {
  scale: Scale;
  label: string;
  /** The .fader-top line: the readout and its soft note. */
  top: ReactNode;
  disabled?: boolean;
  /** Tick labels, when the scale's own aren't right ("5 km"). */
  ticks?: { at: number; label: string }[];
  className?: string;
};

type Single = Common & { dual?: false; value: number; onChange: (value: number) => void };
type Dual = Common & {
  dual: true;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  /** Names for the two knobs ("at least", "at most"). */
  names?: [string, string];
};

const MIN_GAP_POSITION = 2.5;

export function Fader(props: Single | Dual) {
  const { scale, label, top, disabled, className } = props;
  const ticks = props.ticks ?? ticksOf(scale);
  const toInput = (v: number) => (scale.log ? toPosition(v, scale) : v);
  const fromInput = (raw: number) =>
    scale.log ? fromPosition(raw, scale) : fromPosition(toPosition(raw, scale), scale);
  const inputMin = scale.log ? 0 : scale.min;
  const inputMax = scale.log ? 100 : scale.max;
  const inputStep = scale.log ? 0.5 : scale.step;

  /** Page Up and Page Down move a tenth of the scale. */
  const onPage = (current: number, apply: (v: number) => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
    event.preventDefault();
    const sign = event.key === 'PageUp' ? 1 : -1;
    const delta = keyStep(scale, true);
    if (scale.log) apply(fromPosition(toPosition(current, scale) + sign * delta, scale));
    else apply(fromInput(current + sign * delta));
  };

  let fill: { left: number; width: number };
  let inputs: ReactNode;
  if (props.dual) {
    const pLow = toPosition(props.low, scale);
    const pHigh = toPosition(props.high, scale);
    fill = { left: pLow, width: Math.max(0, pHigh - pLow) };
    const setLow = (v: number) => {
      const capped = scale.log
        ? Math.min(toPosition(v, scale), pHigh - MIN_GAP_POSITION)
        : Math.min(v, props.high - scale.step);
      props.onChange(scale.log ? fromPosition(capped, scale) : capped, props.high);
    };
    const setHigh = (v: number) => {
      const floored = scale.log
        ? Math.max(toPosition(v, scale), pLow + MIN_GAP_POSITION)
        : Math.max(v, props.low + scale.step);
      props.onChange(props.low, scale.log ? fromPosition(floored, scale) : floored);
    };
    const [lowName, highName] = props.names ?? ['at least', 'at most'];
    inputs = (
      <>
        <input
          type="range"
          min={inputMin}
          max={inputMax}
          step={inputStep}
          value={toInput(props.low)}
          disabled={disabled}
          aria-label={`${label}, ${lowName}`}
          aria-valuetext={fmt(props.low)}
          onChange={(e) => setLow(fromInput(Number(e.target.value)))}
          onKeyDown={onPage(props.low, setLow)}
        />
        <input
          type="range"
          min={inputMin}
          max={inputMax}
          step={inputStep}
          value={toInput(props.high)}
          disabled={disabled}
          aria-label={`${label}, ${highName}`}
          aria-valuetext={fmt(props.high)}
          onChange={(e) => setHigh(fromInput(Number(e.target.value)))}
          onKeyDown={onPage(props.high, setHigh)}
        />
      </>
    );
  } else {
    const p = toPosition(props.value, scale);
    fill = { left: 0, width: p };
    inputs = (
      <input
        type="range"
        min={inputMin}
        max={inputMax}
        step={inputStep}
        value={toInput(props.value)}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={fmt(props.value)}
        onChange={(e) => props.onChange(fromInput(Number(e.target.value)))}
        onKeyDown={onPage(props.value, props.onChange)}
      />
    );
  }

  return (
    <div className={className ? `fader ${className}` : 'fader'}>
      <div className="fader-top">{top}</div>
      <div className="track">
        <div className="zone">
          <div className="fill" style={{ left: `${fill.left}%`, width: `${fill.width}%` }} />
        </div>
        {inputs}
      </div>
      <div className="scale" style={{ backgroundSize: scaleBackground(scale) }} aria-hidden="true" />
      <div className="ticks" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={`${tick.at}-${tick.label}`} style={{ left: `${tick.at}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
