import { fmt, rangeText, scaleOf, toPosition } from '@/components/controls/scale';
import type { ApiSpec, Control, Value, Values } from '@/contracts/spec';
import { isEmptyValue } from '@/contracts/values';

/**
 * A project card's mini strip of its current control values (Projects.dc.html): the first fader-like control
 * drawn as a static track with its readout, then up to three other values as chips.
 */
export type CardStrip = {
  label: string;
  readout: string;
  fill: { left: number; width: number };
  knobs: number[];
} | null;

const FADERS = new Set(['range', 'logRange', 'dial', 'amount', 'mapRadius']);

function optionLabel(control: Control, value: string): string {
  return control.options?.find((o) => o.value === value)?.label ?? value;
}

/** A control's value as one short chip, or null when there's nothing to say. */
export function chipOf(control: Control, value: Value | undefined): string | null {
  if (value === undefined || isEmptyValue(value)) return null;
  switch (control.kind) {
    case 'toggle':
      return value === true ? control.label : null;
    case 'choice':
      return typeof value === 'string' ? optionLabel(control, value) : null;
    case 'multi':
    case 'keywords':
    case 'places': {
      const list = Array.isArray(value) ? value : [];
      if (!list.length) return null;
      const first = control.kind === 'multi' ? optionLabel(control, list[0]) : list[0];
      return list.length > 1 && control.kind !== 'multi' && list.length > 2
        ? `${list.length} ${control.label.toLowerCase()}`
        : first;
    }
    case 'date': {
      const nice = (d: unknown) =>
        typeof d === 'string'
          ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            })
          : '';
      if (typeof value === 'string') return `Since ${nice(value)}`;
      const range = value as { min?: string; max?: string };
      return range.min ? `Since ${nice(range.min)}` : range.max ? `Until ${nice(range.max)}` : null;
    }
    case 'text':
      return typeof value === 'string' ? value : null;
    default:
      return null;
  }
}

export function stripOf(spec: ApiSpec, values: Values): { strip: CardStrip; chips: string[] } {
  const controls = spec.channels.flatMap((c) => c.controls);
  const fader =
    controls.find((c) => FADERS.has(c.kind) && c.kind !== 'mapRadius' && c.id !== spec.run.takeControlId) ??
    controls.find((c) => FADERS.has(c.kind) && c.kind !== 'mapRadius');
  let strip: CardStrip = null;
  if (fader) {
    const scale = scaleOf(fader);
    const value = values[fader.id];
    if (fader.kind === 'range' || fader.kind === 'logRange') {
      const v = (value && typeof value === 'object' && !Array.isArray(value) && !('lat' in value) ? value : {}) as {
        min?: number;
        max?: number;
      };
      const lo = toPosition(typeof v.min === 'number' ? v.min : scale.min, scale);
      const hi = toPosition(typeof v.max === 'number' ? v.max : scale.max, scale);
      strip = { label: fader.label, readout: rangeText(v, scale), fill: { left: lo, width: hi - lo }, knobs: [lo, hi] };
    } else {
      const n = typeof value === 'number' ? value : scale.min;
      const p = toPosition(n, scale);
      strip = {
        label: fader.label,
        readout: `${fmt(n)}${fader.unit ? ` ${fader.unit}` : ''}`,
        fill: { left: 0, width: p },
        knobs: [p],
      };
    }
  }
  const chips: string[] = [];
  for (const control of controls) {
    if (control.id === fader?.id || chips.length >= 3) continue;
    const chip = chipOf(control, values[control.id]);
    if (chip && !chips.includes(chip)) chips.push(chip.length > 28 ? `${chip.slice(0, 27)}…` : chip);
  }
  return { strip, chips };
}
