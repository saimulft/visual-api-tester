import { Cron } from 'croner';
import type { Cadence, NextRun } from '@/contracts/schedules';

/**
 * When a schedule runs: a cron pattern from its cadence, read in its time zone by croner, so 09:00 stays
 * 09:00 on both sides of a daylight-saving change.
 */
export type Timing = {
  cadence: Cadence;
  days: number[];
  dayOfMonth: number | null;
  time: string;
  timezone: string;
};

export function patternOf(t: Timing): string {
  const [h, m] = t.time.split(':').map(Number);
  switch (t.cadence) {
    case 'hourly':
      return `${m} * * * *`;
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekly':
      return `${m} ${h} * * ${[...new Set(t.days)].sort().join(',') || '1'}`;
    case 'monthly':
      return `${m} ${h} ${t.dayOfMonth ?? 1} * *`;
  }
}

/** The next `count` runs after `from` (ms). */
export function nextRuns(t: Timing, from: number, count = 3): number[] {
  try {
    const cron = new Cron(patternOf(t), { timezone: t.timezone, paused: true });
    return cron.nextRuns(count, new Date(from)).map((d) => d.getTime());
  } catch {
    return [];
  }
}

export function nextRunAfter(t: Timing, from: number): number | null {
  return nextRuns(t, from, 1)[0] ?? null;
}

const DAY = 24 * 60 * 60 * 1000;

function parts(at: number, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return p as Record<string, string>;
}

/** "Monday 23 November, 09:00" in the schedule's zone, and "in 5 days". */
export function describeNext(at: number, now: number, timeZone: string): NextRun {
  const p = parts(at, timeZone);
  const label = `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
  const ms = at - now;
  let inText: string;
  if (ms < 60 * 60 * 1000) inText = `in ${Math.max(1, Math.round(ms / 60000))} min`;
  else if (ms < DAY) inText = `in ${Math.round(ms / 3_600_000)} h`;
  else inText = `in ${Math.round(ms / DAY)} ${Math.round(ms / DAY) === 1 ? 'day' : 'days'}`;
  return { at, label, inText };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Every Monday at 09:00, Sydney time", as the schedule list says it. */
export function describeTiming(t: Timing, userZone?: string): string {
  const zone = t.timezone !== userZone ? `, ${cityOf(t.timezone)} time` : '';
  const [, m] = t.time.split(':');
  switch (t.cadence) {
    case 'hourly':
      return m === '00' ? 'Every hour, on the hour' : `Every hour at ${m} past`;
    case 'daily':
      return `Every day at ${t.time}${zone}`;
    case 'weekly': {
      const days = [...new Set(t.days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const names =
        days.length === 5 && days.every((d) => d >= 1 && d <= 5)
          ? 'weekday'
          : days
              .map((d) => WEEKDAYS[d])
              .join(', ')
              .replace(/, ([^,]*)$/, ' and $1');
      return `Every ${names} at ${t.time}${zone}`;
    }
    case 'monthly':
      return `${ordinal(t.dayOfMonth ?? 1)} of each month at ${t.time}${zone}`;
  }
}

export function ordinal(n: number): string {
  const s =
    n % 100 >= 11 && n % 100 <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${s}`;
}

/** "Australia/Sydney" reads "Sydney". */
export function cityOf(timeZone: string): string {
  return (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
}
