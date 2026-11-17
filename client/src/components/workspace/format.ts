/**
 * Dates, sizes and counts as the canvas writes them: "today at 10:42", "Mon 16 Nov", "412 KB", "6,818".
 * Times read in the person's time zone.
 */
const DAY = 24 * 60 * 60 * 1000;

function parts(at: number, timeZone?: string) {
  const f = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(f.formatToParts(new Date(at)).map((p) => [p.type, p.value])) as Record<string, string>;
}

const dayKey = (at: number, timeZone?: string) => {
  const p = parts(at, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
};

/** "10:42". */
export function clock(at: number, timeZone?: string): string {
  const p = parts(at, timeZone);
  return `${p.hour}:${p.minute}`;
}

/** "today", "yesterday", "tomorrow", "Mon 16 Nov" or "16 Nov 2025". */
export function dayText(at: number, timeZone?: string, now = Date.now()): string {
  const key = dayKey(at, timeZone);
  if (key === dayKey(now, timeZone)) return 'today';
  if (key === dayKey(now - DAY, timeZone)) return 'yesterday';
  if (key === dayKey(now + DAY, timeZone)) return 'tomorrow';
  const p = parts(at, timeZone);
  const sameYear = p.year === parts(now, timeZone).year;
  if (Math.abs(at - now) < 7 * DAY) return `${p.weekday} ${p.day} ${p.month}`;
  return sameYear ? `${p.day} ${p.month}` : `${p.day} ${p.month} ${p.year}`;
}

/** "Today 11:00", "Mon 16 Nov 09:00", "12 Nov 15:12". */
export function whenText(at: number, timeZone?: string, now = Date.now()): string {
  const day = dayText(at, timeZone, now);
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${clock(at, timeZone)}`;
}

/** "Mon 16 Nov" for tables, "Today 06:00" when it's today. */
export function shortDay(at: number, timeZone?: string, now = Date.now()): string {
  const day = dayText(at, timeZone, now);
  if (day === 'today') return `Today ${clock(at, timeZone)}`;
  if (day === 'yesterday') return 'Yesterday';
  const p = parts(at, timeZone);
  if (Math.abs(at - now) < 7 * DAY) return `${p.weekday} ${p.day} ${p.month}`;
  return p.year === parts(now, timeZone).year ? `${p.day} ${p.month}` : `${p.day} ${p.month} ${p.year}`;
}

/** "16 Nov". */
export function dateText(at: number, timeZone?: string): string {
  const p = parts(at, timeZone);
  return `${p.day} ${p.month}`;
}

export function count(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '';
}

/** "412 KB", "5.8 MB". */
export function bytesText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "0.41 s" from milliseconds. */
export function secondsText(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms / 1000)} s`;
}

/** "200 OK", "401 Unauthorized". */
export function statusText(status: number | null): string {
  if (status === null) return 'No answer';
  const names: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No content',
    400: 'Bad request',
    401: 'Unauthorized',
    402: 'Payment required',
    403: 'Forbidden',
    404: 'Not found',
    408: 'Timeout',
    422: 'Unprocessable',
    429: 'Too many requests',
    500: 'Server error',
    502: 'Bad gateway',
    503: 'Unavailable',
    504: 'Gateway timeout',
  };
  return `${status} ${names[status] ?? ''}`.trim();
}

/** "s" when a count isn't one. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}
