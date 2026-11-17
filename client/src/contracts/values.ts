import { allControls, valueProblem, type ApiSpec, type Control, type ControlKind, type Value, type Values } from './spec';

/**
 * Values: what each control is set to, by control id. Violet marks values the AI set (the control's default,
 * untouched); teal marks values the person changed (isChanged).
 *
 * The value each kind takes:
 * - text, choice: string
 * - keywords, multi, places: string[]
 * - toggle: boolean
 * - range, logRange: { min?, max? } numbers
 * - dial, amount: number
 * - date: "YYYY-MM-DD", or { min?, max? } of those when `range` is set
 * - mapRadius: { lat, lng, radius }
 * - null: not set (the request leaves the parameter out)
 */
/** The empty value of a kind, used when a control has no default. */
export function emptyValue(kind: ControlKind, control?: Pick<Control, 'range'>): Value {
  switch (kind) {
    case 'keywords':
    case 'multi':
    case 'places':
      return [];
    case 'toggle':
      return false;
    case 'range':
    case 'logRange':
      return {};
    case 'date':
      return control?.range ? {} : null;
    default:
      return null;
  }
}

/** A control's starting value: its default, or the kind's empty value. */
export function startValue(control: Control): Value {
  return control.default !== undefined ? control.default : emptyValue(control.kind, control);
}

/** Every control's starting value, by control id. */
export function defaultValues(spec: ApiSpec): Values {
  return Object.fromEntries(allControls(spec).map((control) => [control.id, startValue(control)]));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** True when two values mean the same (key order and undefined fields don't count). */
export function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  return canonical(a) === canonical(b);
}

/** True when the person changed the control from where the AI (or the kind) left it: teal, not violet. */
export function isChanged(control: Control, value: Value | undefined): boolean {
  if (value === undefined) return false;
  return !sameValue(value, startValue(control));
}

/** True when a value counts as not set, so the request leaves the parameter out. */
export function isEmptyValue(value: Value | undefined): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && !('lat' in value)) return value.min === undefined && value.max === undefined;
  return false;
}

/**
 * Fills missing values with each control's start value and drops ids no control has. Returns the problems
 * with what's left (a wrong shape, an unknown option, a required control left empty).
 */
export function resolveValues(spec: ApiSpec, input: Values = {}): { values: Values; problems: { path: string; message: string }[] } {
  const values: Values = {};
  const problems: { path: string; message: string }[] = [];
  for (const control of allControls(spec)) {
    const value = control.id in input ? input[control.id] : startValue(control);
    const problem = valueProblem(control, value);
    if (problem) problems.push({ path: control.id, message: problem });
    else if (control.required && isEmptyValue(value))
      problems.push({ path: control.id, message: `${control.label} needs a value.` });
    values[control.id] = value;
  }
  return { values, problems };
}
