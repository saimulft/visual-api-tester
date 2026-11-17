'use client';

import { AlertCircle } from 'lucide-react';
import { useId } from 'react';
import { DatePicker, Input, MultiSelect, Segmented, Select, Switch, type DateRange } from '@/components/ui';
import { valueProblem, type ApiSpec, type Control, type Value } from '@/contracts/spec';
import { isChanged, isEmptyValue, startValue } from '@/contracts/values';
import { Dial } from './dial';
import { Fader } from './fader';
import { KeywordsInput } from './keywords';
import { MapRadius, type PointRadius } from './map-radius';
import { PlacesInput } from './places';
import { fmt, rangeText, scaleOf, type Scale } from './scale';

/**
 * One control from the spec, drawn the way board 07 draws its kind, in the canvas's .ctl row: the label
 * with its provenance dot (violet when the AI set it, teal once you change it), the raw parameter under it,
 * and the four states: set by AI, changed by you, needed (a required control left empty) and a problem.
 * `readOnly` draws it without letting it change (chat A's Setup page).
 */
export type ControlContext = {
  /** The spec, for costs and the API's name. */
  spec?: ApiSpec;
  /** Credits left on the key, for the amount control's "after this run" bar. */
  creditsLeft?: number | null;
  /** The spec needs a key and none is saved. */
  needsKey?: boolean;
  /** Where keys are added. */
  keysHref?: string;
};

export type ControlViewProps = {
  control: Control;
  value: Value | undefined;
  onChange?: (value: Value) => void;
  readOnly?: boolean;
  /** A problem from the server (a 422 naming this control). */
  error?: string | null;
  context?: ControlContext;
};

const isMinMax = (v: unknown): v is { min?: number | string; max?: number | string } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !('lat' in v);
const isPoint = (v: unknown): v is PointRadius => typeof v === 'object' && v !== null && 'lat' in v && 'lng' in v;
const asList = (v: Value | undefined): string[] => (Array.isArray(v) ? v : []);

/** What one record costs on the run that this control sizes, from the run plan. */
function costEach(spec: ApiSpec | undefined, control: Control): { each: number; unit: string } | null {
  if (!spec || spec.run.takeControlId !== control.id) return null;
  const endpointId = spec.run.mode === 'searchThenCollect' ? spec.run.collectId : spec.run.endpointId;
  const endpoint = spec.endpoints.find((e) => e.id === endpointId);
  if (!endpoint || endpoint.free) return null;
  return { each: endpoint.cost.perRecord + (spec.run.mode === 'searchThenCollect' ? endpoint.cost.perCall : 0), unit: endpoint.cost.unit };
}

export function ControlView({ control, value, onChange, readOnly, error, context }: ControlViewProps) {
  const id = useId();
  const current = value === undefined ? startValue(control) : value;
  const changed = isChanged(control, current) || control.by === 'user';
  const problem = error ?? valueProblem(control, current)?.split(`"${control.id}"`).join(control.label) ?? null;
  const needed = Boolean(control.required && isEmptyValue(current));
  const set = (next: Value) => {
    if (!readOnly) onChange?.(next);
  };
  const disabled = readOnly || !onChange;

  return (
    <div className="ctl" data-kind={control.kind}>
      <div className="ctl-label">
        <span className="ctl-name">
          <label htmlFor={id}>{control.label}</label>
          {control.required && (
            <span style={{ color: 'var(--err)' }} aria-hidden="true">
              {' '}
              *
            </span>
          )}
          <span className={changed ? 'prov you' : 'prov'} />
          <span className="sr">{changed ? ', changed by you' : ', set by AI'}</span>
        </span>
        <span className="ctl-param" title={control.param}>
          {control.param}
        </span>
      </div>
      <div className="ctl-body">
        <Body control={control} value={current} set={set} disabled={disabled} id={id} invalid={Boolean(problem)} context={context} />
        {problem ? (
          <p className="err-text" role="alert">
            <AlertCircle className="i i-sm" aria-hidden="true" />
            {problem}
          </p>
        ) : needed ? (
          <p className="hint">This endpoint can’t run without it.</p>
        ) : control.help ? (
          <p className="hint">{control.help}</p>
        ) : null}
      </div>
    </div>
  );
}

function Body({
  control,
  value,
  set,
  disabled,
  id,
  invalid,
  context,
}: {
  control: Control;
  value: Value;
  set: (value: Value) => void;
  disabled: boolean;
  id: string;
  invalid: boolean;
  context?: ControlContext;
}) {
  const scale: Scale = scaleOf(control);
  const options = control.options ?? [];
  switch (control.kind) {
    case 'text':
      return (
        <Input
          id={id}
          type="text"
          value={typeof value === 'string' ? value : ''}
          placeholder={`Any ${control.label.toLowerCase()}`}
          invalid={invalid}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        />
      );

    case 'keywords':
      return <KeywordsInput id={id} label={control.label} value={asList(value)} onChange={set} disabled={disabled} invalid={invalid} />;

    case 'choice': {
      const picked = typeof value === 'string' ? value : null;
      if (options.length <= 4)
        return (
          <Segmented
            label={control.label}
            options={options.map((o) => ({ value: o.value, label: o.label }))}
            value={picked ?? ''}
            onChange={(v) => !disabled && set(v)}
          />
        );
      return (
        <Select
          id={id}
          options={options}
          value={picked}
          onChange={set}
          disabled={disabled}
          foot={
            <>
              <span>{options.length} options</span>
              <span className="mono">{control.param}</span>
            </>
          }
        />
      );
    }

    case 'multi':
      return (
        <MultiSelect
          id={id}
          label={control.label}
          options={options}
          value={asList(value)}
          onChange={set}
          disabled={disabled}
          placeholder="Add"
          foot={(n) => (
            <>
              <span>{n} picked</span>
              <span className="mono">{control.param}</span>
            </>
          )}
        />
      );

    case 'toggle': {
      const on = value === true;
      return (
        <Switch
          id={id}
          checked={on}
          disabled={disabled}
          onChange={set}
          label={control.label}
          text={on ? 'On' : 'Off'}
        />
      );
    }

    case 'range':
    case 'logRange': {
      const range = isMinMax(value) ? value : {};
      const low = typeof range.min === 'number' ? range.min : scale.min;
      const high = typeof range.max === 'number' ? range.max : scale.max;
      return (
        <Fader
          dual
          scale={scale}
          label={control.label}
          disabled={disabled}
          low={low}
          high={high}
          names={control.kind === 'logRange' ? ['at least', 'at most'] : ['from', 'to']}
          onChange={(min, max) => set({ min, max })}
          top={
            <>
              <output className="readout">{rangeText(range, scale)}</output>
              <span className="readout soft" style={{ fontSize: 12 }}>
                {control.kind === 'logRange' ? 'log scale' : (control.unit ?? `${fmt(high - low)} span`)}
              </span>
            </>
          }
        />
      );
    }

    case 'dial': {
      const n = typeof value === 'number' ? value : scale.min;
      return <Dial scale={scale} value={n} onChange={set} label={control.label} unit={control.unit} disabled={disabled} />;
    }

    case 'amount': {
      const n = typeof value === 'number' ? value : scale.min;
      const cost = costEach(context?.spec, control);
      const spend = cost ? n * cost.each : 0;
      const left = context?.creditsLeft;
      return (
        <>
          <Fader
            scale={scale}
            label={control.label}
            disabled={disabled}
            value={n}
            onChange={set}
            top={
              <>
                <output className="readout">
                  {fmt(n)}
                  {control.unit ? ` ${control.unit}` : ''}
                </output>
                {cost && (
                  <span className="readout soft" style={{ fontSize: 12 }}>
                    {fmt(spend)} {cost.unit}
                  </span>
                )}
              </>
            }
          />
          {cost && typeof left === 'number' && left > 0 && (
            <div className="field" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                <span className="muted">After this run</span>
                <span className="mono num">
                  {fmt(Math.max(0, left - spend))} of {fmt(left)} left
                </span>
              </div>
              <div className="bar">
                <i style={{ width: `${Math.max(0, Math.min(100, ((left - spend) / left) * 100))}%` }} />
              </div>
            </div>
          )}
        </>
      );
    }

    case 'date': {
      const dateValue: string | DateRange | null = control.range
        ? isMinMax(value)
          ? { min: value.min === undefined ? undefined : String(value.min), max: value.max === undefined ? undefined : String(value.max) }
          : {}
        : typeof value === 'string'
          ? value
          : null;
      const today = new Date();
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const daysAgo = (n: number) => iso(new Date(today.getTime() - n * 86_400_000));
      return (
        <DatePicker
          id={id}
          range={control.range}
          value={dateValue}
          label={control.label}
          placeholder="Any time"
          onChange={(next) => set(next === null ? (control.range ? {} : null) : (next as Value))}
          presets={
            control.range
              ? [
                  { label: 'Last 7 days', value: { min: daysAgo(7), max: iso(today) } },
                  { label: 'Last 30 days', value: { min: daysAgo(30), max: iso(today) } },
                  { label: 'This year', value: { min: `${today.getFullYear()}-01-01`, max: iso(today) } },
                ]
              : [
                  { label: 'A week ago', value: daysAgo(7) },
                  { label: 'A month ago', value: daysAgo(30) },
                  { label: 'Start of the year', value: `${today.getFullYear()}-01-01` },
                ]
          }
        />
      );
    }

    case 'places':
      return (
        <PlacesInput
          id={id}
          label={control.label}
          value={asList(value)}
          onChange={set}
          disabled={disabled}
          invalid={invalid}
          foot={
            <>
              <span>{context?.spec?.channels.some((c) => c.controls.some((k) => k.kind === 'mapRadius')) ? 'Places by name' : 'No radius in this API'}</span>
              <span className="mono">{control.param}</span>
            </>
          }
        />
      );

    case 'mapRadius': {
      const radiusScale = { min: control.min ?? 0.1, max: control.max ?? 50, step: control.step ?? 0.1, log: false };
      return (
        <MapRadius
          value={isPoint(value) ? value : null}
          onChange={set}
          scale={radiusScale}
          unit={control.unit ?? 'km'}
          label={control.label}
          disabled={disabled}
        />
      );
    }
  }
}
