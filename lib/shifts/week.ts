/**
 * Week/date math over ISO `YYYY-MM-DD` strings. All computation is done in UTC
 * so results never depend on the server's timezone. Weeks run Sunday–Saturday.
 */

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = toUtc(value);
  return !Number.isNaN(d.getTime()) && toIso(d) === value;
}

/** Weekday index of a date, Sunday = 0 … Saturday = 6. */
export function weekdayOf(date: string): number {
  return toUtc(date).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** The Sunday starting the week that contains `date`. */
export function sundayOf(date: string): string {
  return addDays(date, -weekdayOf(date));
}

/** The 7 dates of the week starting at `weekStart` (a Sunday). */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function todayIso(): string {
  return toIso(new Date());
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Human label like "Sun, Jul 12". */
export function dayLabel(date: string): string {
  return DAY_FORMAT.format(toUtc(date));
}
