import type { Control, Value } from '@/contracts/spec';

/**
 * The math behind faders and dials, kept pure so the value round trips can be tested: a value to a knob
 * position (0 to 100) and back, the printed ticks, and the readouts. A log scale gives each power of ten
 * the same room (1, 10, 100, 1k, 10k), so small and large counts both get space.
 */

export type Scale = {
  min: number;
  max: number;
  step: number;
  log: boolean;
};

export function scaleOf(control: Pick<Control, 'kind' | 'min' | 'max' | 'step'>): Scale {
  const log = control.kind === 'logRange';
  const min = control.min ?? (log ? 1 : 0);
  const max = control.max ?? (log ? 10_000 : 100);
  return { min, max: max > min ? max : min + 1, step: control.step ?? (log ? 1 : stepFor(max - min)), log };
}

function stepFor(span: number): number {
  if (span <= 20) return 1;
  if (span <= 200) return 1;
  return Math.pow(10, Math.floor(Math.log10(span)) - 2);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Rounds a log value to what people expect to read: 1, 2 ... 10, 20 ... 100, 110 ... 1,000, 1,100. */
export function niceLog(value: number): number {
  if (value >= 1000) return Math.round(value / 100) * 100;
  if (value >= 100) return Math.round(value / 10) * 10;
  return Math.max(1, Math.round(value));
}

function snap(value: number, scale: Scale): number {
  const stepped = Math.round((value - scale.min) / scale.step) * scale.step + scale.min;
  const decimals = (String(scale.step).split('.')[1] ?? '').length;
  return clamp(Number(stepped.toFixed(decimals)), scale.min, scale.max);
}

const logLo = (scale: Scale) => Math.log10(Math.max(scale.min, 1));
const logHi = (scale: Scale) => Math.log10(Math.max(scale.max, 1));

/** A value's knob position, 0 to 100. */
export function toPosition(value: number, scale: Scale): number {
  if (scale.log) {
    if (value <= scale.min) return 0;
    return clamp(((Math.log10(Math.max(value, 1)) - logLo(scale)) / (logHi(scale) - logLo(scale))) * 100, 0, 100);
  }
  return clamp(((value - scale.min) / (scale.max - scale.min)) * 100, 0, 100);
}

/** The value at a knob position, snapped to the step (or to a nice number on a log scale). */
export function fromPosition(position: number, scale: Scale): number {
  const p = clamp(position, 0, 100);
  if (scale.log) {
    if (p <= 0) return scale.min;
    if (p >= 100) return scale.max;
    const raw = Math.pow(10, logLo(scale) + ((logHi(scale) - logLo(scale)) * p) / 100);
    return clamp(niceLog(raw), scale.min, scale.max);
  }
  return snap(scale.min + ((scale.max - scale.min) * p) / 100, scale);
}

/** The step a key press moves: one step, or a tenth of the scale with Page Up and Page Down. */
export function keyStep(scale: Scale, big: boolean): number {
  if (scale.log) return big ? 5 : 0.5; // positions, on the 0 to 100 track
  if (!big) return scale.step;
  return Math.max(scale.step, snap(scale.min + (scale.max - scale.min) / 10, scale) - scale.min);
}

/** "1k", "10k", "1M": tick labels. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 1000) return `${trim(n / 1000)}k`;
  return trim(n);
}
const trim = (n: number) => String(Number(n.toFixed(2)));

export type Tick = { at: number; label: string };

/** Printed ticks: each power of ten on a log scale; round steps on a linear one, with both ends. */
export function ticksOf(scale: Scale, maxTicks = 5): Tick[] {
  if (scale.log) {
    const ticks: Tick[] = [{ at: 0, label: compact(scale.min) }];
    for (let e = Math.ceil(logLo(scale)); e <= Math.floor(logHi(scale)); e++) {
      const v = Math.pow(10, e);
      if (v <= scale.min) continue;
      ticks.push({ at: toPosition(v, scale), label: compact(v) });
    }
    if (ticks[ticks.length - 1].at < 99) ticks.push({ at: 100, label: compact(scale.max) });
    return ticks;
  }
  // Linear labels stay whole under 10,000, so years read 1990, not 1.99k.
  const label = (v: number) => (Math.abs(v) >= 10_000 ? compact(v) : trim(v));
  const span = scale.max - scale.min;
  const step = niceStep(span / (maxTicks - 1));
  const ticks: Tick[] = [{ at: 0, label: label(scale.min) }];
  for (let v = Math.ceil(scale.min / step) * step; v < scale.max; v += step) {
    if (v <= scale.min) continue;
    ticks.push({ at: toPosition(v, scale), label: label(v) });
  }
  const last = ticks[ticks.length - 1];
  if (100 - last.at >= 8) ticks.push({ at: 100, label: label(scale.max) });
  else if (last.at < 100) ticks[ticks.length - 1] = { at: 100, label: label(scale.max) };
  return ticks;
}

function niceStep(raw: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

/** The background size of the .scale tick strip: major marks at the tick step, minor ones at a fifth. */
export function scaleBackground(scale: Scale): string {
  if (scale.log) {
    const decades = Math.max(1, logHi(scale) - logLo(scale));
    const major = 100 / decades;
    return `${major}% 9px, ${major / 5}% 5px`;
  }
  const span = scale.max - scale.min;
  const step = niceStep(span / 4);
  const major = (step / span) * 100;
  return `${major}% 9px, ${major / 5}% 5px`;
}

/** Numbers as people read them: 1,284. */
export function fmt(n: number | string | undefined): string {
  if (n === undefined || n === '') return '';
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(n);
}

/** A range's readout: "50 to 200", "10,000+" at the open top of a log scale, "Any" when empty. */
export function rangeText(value: { min?: number | string; max?: number | string } | null | undefined, scale: Scale): string {
  const min = value?.min;
  const max = value?.max;
  const openTop = scale.log && (max === undefined || Number(max) >= scale.max);
  if (min === undefined && (max === undefined || openTop)) return 'Any';
  const lo = min === undefined ? fmt(scale.min) : fmt(min);
  if (openTop) return `${lo} to ${fmt(scale.max)}+`;
  return `${lo} to ${max === undefined ? fmt(scale.max) : fmt(max)}`;
}

/** The dial's hand angle: -135° at the minimum to 135° at the maximum. */
export function dialAngle(value: number, scale: Scale): number {
  return -135 + (toPosition(value, scale) / 100) * 270;
}

/** The value at a pointer angle on the dial (degrees, 0 at the top, clockwise). */
export function dialValueAt(angle: number, scale: Scale): number {
  let a = angle;
  if (a > 180) a -= 360;
  return fromPosition(((clamp(a, -135, 135) + 135) / 270) * 100, scale);
}

/** Splits typed text into keywords: commas, semicolons and line breaks separate them. */
export function splitWords(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Adds words to a list, keeping each once (case-insensitive). */
export function addWords(list: string[], words: string[]): string[] {
  const out = [...list];
  for (const word of words) if (!out.some((w) => w.toLowerCase() === word.toLowerCase())) out.push(word);
  return out;
}

/** A number value for a single fader or dial: the value, else the default, else the scale's minimum. */
export function numberOf(value: Value | undefined, scale: Scale): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, scale.min, scale.max) : scale.min;
}
