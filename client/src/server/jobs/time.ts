// Adapted from dl-cms/cms/src/server/jobs/time.ts (without the per-site time zone)

/** An IANA time zone this runtime knows, or null. */
export function validTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() });
    return value.trim();
  } catch {
    return null;
  }
}

/** Milliseconds the zone is ahead of UTC at that moment (negative west of Greenwich). */
export function offsetAt(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The UTC moment (ms) of a wall-clock time in a zone. DST gaps move forward, like most schedulers. */
export function zonedToUtc(y: number, m: number, d: number, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

/** The wall-clock date and time in a zone at a moment. */
export function zonedParts(at: number, timeZone: string) {
  const local = new Date(at + offsetAt(at, timeZone));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

/** The next time it's hour:minute in the zone, strictly after `now`. */
export function nextDailyRun(now: Date, hour: number, minute: number, timeZone: string): Date {
  const zone = validTimeZone(timeZone) ?? 'UTC';
  let { year: y, month: m, day: d } = zonedParts(now.getTime(), zone);
  for (let i = 0; i < 3; i++) {
    const at = zonedToUtc(y, m, d, hour, minute, zone);
    if (at > now.getTime()) return new Date(at);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
