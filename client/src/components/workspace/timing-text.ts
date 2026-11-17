/** Schedule timing in words for the browser (the server's timing.ts has croner; this needs none). */
type Timing = { cadence: 'hourly' | 'daily' | 'weekly' | 'monthly'; days: number[]; dayOfMonth: number | null; time: string };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const mondayFirst = (days: number[]) => [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
const weekdays = (days: number[]) => days.length === 5 && days.every((d) => d >= 1 && d <= 5);

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

/** "every Monday at 09:00", "every day at 06:00", "every hour", "on the 1st at 08:00". */
export function describeTimingShort(t: Timing): string {
  const [, m] = t.time.split(':');
  switch (t.cadence) {
    case 'hourly':
      return m === '00' ? 'every hour' : `every hour at ${m} past`;
    case 'daily':
      return `every day at ${t.time}`;
    case 'weekly': {
      const days = mondayFirst(t.days);
      if (weekdays(days)) return `every weekday at ${t.time}`;
      return `every ${days.map((d) => DAYS[d]).join(', ').replace(/, ([^,]*)$/, ' and $1')} at ${t.time}`;
    }
    case 'monthly':
      return `on the ${ordinal(t.dayOfMonth ?? 1)} at ${t.time}`;
  }
}

/** "Mondays 09:00", "Daily 06:00", "Hourly", "Monthly, 1st 08:00", as the project cards say it. */
export function cardTiming(t: Timing): string {
  switch (t.cadence) {
    case 'hourly':
      return 'Hourly';
    case 'daily':
      return `Daily ${t.time}`;
    case 'weekly': {
      const days = mondayFirst(t.days);
      if (weekdays(days)) return `Weekdays ${t.time}`;
      if (days.length === 1) return `${DAYS[days[0]]}s ${t.time}`;
      return `${days.map((d) => SHORT[d]).join(', ')} ${t.time}`;
    }
    case 'monthly':
      return `Monthly, ${ordinal(t.dayOfMonth ?? 1)} ${t.time}`;
  }
}

/** "Every Monday at 09:00", for the schedule list. */
export function describeTiming(t: Timing & { timezone?: string }, userZone?: string): string {
  const zone = t.timezone && userZone && t.timezone !== userZone ? `, ${(t.timezone.split('/').pop() ?? '').replace(/_/g, ' ')} time` : '';
  const [, m] = t.time.split(':');
  switch (t.cadence) {
    case 'hourly':
      return m === '00' ? 'Every hour, on the hour' : `Every hour at ${m} past`;
    case 'daily':
      return `Every day at ${t.time}${zone}`;
    case 'weekly':
      return `${describeTimingShort(t).replace(/^every/, 'Every')}${zone}`;
    case 'monthly':
      return `${ordinal(t.dayOfMonth ?? 1)} of each month at ${t.time}${zone}`;
  }
}
