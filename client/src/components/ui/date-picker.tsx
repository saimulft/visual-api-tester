'use client';

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { Popover as RPopover } from 'radix-ui';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Select } from './select';

/**
 * DatePicker (one date or a range) and TimePicker (a styled list of times). Never the browser's own
 * pickers. Dates are "YYYY-MM-DD" strings; a range is { min?, max? } of those. The calendar is the canvas's
 * .cal grid (Monday first), drawn with date-fns.
 */
export type DateRange = { min?: string; max?: string };
type Preset = { label: string; value: string | DateRange };

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const read = (s?: string) => (s ? parseISO(s) : undefined);
const nice = (s?: string) => (s ? format(parseISO(s), 'd MMM yyyy') : '');

export function describeDate(value: string | DateRange | null | undefined, placeholder = 'Pick a date'): string {
  if (!value) return placeholder;
  if (typeof value === 'string') return nice(value);
  if (value.min && value.max) return `${nice(value.min)} to ${nice(value.max)}`;
  if (value.min) return `Since ${nice(value.min)}`;
  if (value.max) return `Until ${nice(value.max)}`;
  return placeholder;
}

function Calendar({
  month,
  onMonth,
  isOn,
  inRange,
  onPick,
  min,
  max,
}: {
  month: Date;
  onMonth: (d: Date) => void;
  isOn: (d: Date) => boolean;
  inRange: (d: Date) => boolean;
  onPick: (d: Date) => void;
  min?: Date;
  max?: Date;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const list: Date[] = [];
    for (let d = start; !isAfter(d, end); d = addDays(d, 1)) list.push(d);
    return list;
  }, [month]);
  return (
    <>
      <div className="cal-head">
        <button
          className="btn btn-sm btn-icon btn-ghost"
          type="button"
          aria-label="Previous month"
          onClick={() => onMonth(addMonths(month, -1))}
        >
          <ChevronLeft className="i" aria-hidden="true" />
        </button>
        <span aria-live="polite">{format(month, 'MMMM yyyy')}</span>
        <button
          className="btn btn-sm btn-icon btn-ghost"
          type="button"
          aria-label="Next month"
          onClick={() => onMonth(addMonths(month, 1))}
        >
          <ChevronRight className="i" aria-hidden="true" />
        </button>
      </div>
      <div className="cal-grid">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <span key={d} className="dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const disabled = (min && isBefore(d, min)) || (max && isAfter(d, max));
          return (
            <button
              key={d.toISOString()}
              type="button"
              className={cn(!isSameMonth(d, month) && 'out', inRange(d) && 'is-between')}
              aria-pressed={isOn(d)}
              aria-label={format(d, 'EEEE d MMMM yyyy')}
              disabled={Boolean(disabled)}
              onClick={() => onPick(d)}
            >
              {format(d, 'd')}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function DatePicker({
  value,
  onChange,
  range,
  presets,
  placeholder = 'Pick a date',
  label,
  id,
  min,
  max,
  clearable = true,
}: {
  value: string | DateRange | null;
  onChange: (value: string | DateRange | null) => void;
  /** Pick a range (two clicks) instead of one date. */
  range?: boolean;
  /** Quick picks in the foot ("Last 7 days"). */
  presets?: Preset[];
  placeholder?: string;
  label?: string;
  id?: string;
  min?: string;
  max?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rangeValue = (typeof value === 'object' && value) || {};
  const single = typeof value === 'string' ? value : undefined;
  const anchor = read(range ? (rangeValue.min ?? rangeValue.max) : single) ?? new Date();
  const [month, setMonth] = useState(startOfMonth(anchor));
  const lo = read(rangeValue.min);
  const hi = read(rangeValue.max);
  const empty = range ? !rangeValue.min && !rangeValue.max : !single;

  const pick = (d: Date) => {
    if (!range) {
      onChange(iso(d));
      setOpen(false);
      return;
    }
    // First click starts a range; the second ends it (in either order).
    if (!lo || (lo && hi)) return onChange({ min: iso(d) });
    if (isBefore(d, lo)) return onChange({ min: iso(d), max: iso(lo) });
    onChange({ min: iso(lo), max: iso(d) });
    setOpen(false);
  };

  return (
    <RPopover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(startOfMonth(anchor));
        setOpen(next);
      }}
    >
      <div className="pop">
        <RPopover.Trigger
          className="datefield"
          type="button"
          id={id}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <CalendarDays className="i" aria-hidden="true" />
          <span className={cn(empty && 'muted')}>{describeDate(value, placeholder)}</span>
        </RPopover.Trigger>
        {clearable && !empty && (
          <button
            className="btn btn-sm btn-icon btn-ghost datefield-clear"
            type="button"
            aria-label="Clear the date"
            onClick={() => onChange(range ? {} : null)}
          >
            <X className="i i-sm" aria-hidden="true" />
          </button>
        )}
      </div>
      <RPopover.Portal>
        <RPopover.Content
          className="cal is-floating"
          sideOffset={6}
          align="start"
          role="dialog"
          aria-label={range ? 'Pick a date range' : 'Pick a date'}
        >
          <Calendar
            month={month}
            onMonth={setMonth}
            min={read(min)}
            max={read(max)}
            isOn={(d) =>
              range
                ? Boolean((lo && isSameDay(d, lo)) || (hi && isSameDay(d, hi)))
                : Boolean(single && isSameDay(d, parseISO(single)))
            }
            inRange={(d) => Boolean(range && lo && hi && isAfter(d, lo) && isBefore(d, hi))}
            onPick={pick}
          />
          {presets && presets.length > 0 && (
            <div className="cal-foot">
              {presets.map((p) => {
                const on = JSON.stringify(p.value) === JSON.stringify(value);
                return (
                  <button
                    key={p.label}
                    className={cn('chip', on && 'is-on')}
                    type="button"
                    onClick={() => {
                      onChange(p.value);
                      setOpen(false);
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/** "09:00" to "9:00 am". */
export function describeTime(value: string) {
  const [h, m] = value.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** A time from a styled list, every `stepMinutes` (30 by default). Value is "HH:MM", 24-hour. */
export function TimePicker({
  value,
  onChange,
  stepMinutes = 30,
  label,
  id,
  end,
}: {
  value: string;
  onChange: (value: string) => void;
  stepMinutes?: number;
  label?: string;
  id?: string;
  /** Shown at the end of each option (a time zone). */
  end?: ReactNode;
}) {
  const options = useMemo(() => {
    const list: { value: string; label: string; icon: ReactNode; end?: ReactNode }[] = [];
    for (let m = 0; m < 24 * 60; m += stepMinutes) {
      const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      list.push({ value: v, label: describeTime(v), icon: <Clock className="i i-sm" aria-hidden="true" />, end });
    }
    if (value && !list.some((o) => o.value === value))
      list.push({ value, label: describeTime(value), icon: <Clock className="i i-sm" aria-hidden="true" />, end });
    return list.sort((a, b) => a.value.localeCompare(b.value));
  }, [stepMinutes, value, end]);
  return <Select options={options} value={value} onChange={onChange} label={label} id={id} className="timefield" />;
}
