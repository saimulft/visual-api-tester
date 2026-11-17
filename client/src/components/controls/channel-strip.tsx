'use client';

import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { channelNumber, type Channel, type Value, type Values } from '@/contracts/spec';
import { ControlView, type ControlContext } from './control-view';

/**
 * One channel of the rack (the canvas's .channel): its CH number, title, control count and hint, then
 * each control. `readOnly` draws it for chat A's Setup page.
 */
export function ChannelStrip({
  channel,
  index,
  values,
  onChange,
  readOnly,
  errors,
  context,
}: {
  channel: Channel;
  /** Its place in the spec: 0 reads "CH 01". */
  index: number;
  values: Values;
  onChange?: (controlId: string, value: Value) => void;
  readOnly?: boolean;
  /** Problems by control id (a 422 from a run). */
  errors?: Record<string, string>;
  context?: ControlContext;
}) {
  const count = channel.controls.length;
  return (
    <div className="channel">
      <div className="ch-head">
        <span className="ch-num" data-n={channelNumber(index)} />
        <h3 className="ch-title">{channel.title}</h3>
        <span className="ch-count">
          {count} {count === 1 ? 'control' : 'controls'}
        </span>
      </div>
      {channel.hint && (
        <p className="ai-note">
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          </svg>
          <span>{channel.hint}</span>
        </p>
      )}
      {context?.needsKey && (
        <p className="hint ch-key">
          <KeyRound className="i i-sm" aria-hidden="true" />
          <span>
            These controls need your {context.spec?.api.name ?? 'API'} key to run.{' '}
            <Link href={context.keysHref ?? '/settings/ai'}>Add it in Settings</Link>
          </span>
        </p>
      )}
      {channel.controls.map((control) => (
        <ControlView
          key={control.id}
          control={control}
          value={values[control.id]}
          onChange={onChange ? (value) => onChange(control.id, value) : undefined}
          readOnly={readOnly}
          error={errors?.[control.id]}
          context={context}
        />
      ))}
    </div>
  );
}
