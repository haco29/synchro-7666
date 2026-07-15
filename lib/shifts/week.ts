/**
 * Week/date math over ISO `YYYY-MM-DD` strings. All computation is done in UTC
 * so results never depend on the server's timezone. Weeks run Wednesday–Tuesday.
 */

/**
 * Weekday a week starts on, using `weekdayOf`'s Sunday = 0 … Saturday = 6 index.
 * Wednesday (3) is the single source of truth for the week anchor — change this
 * (or later derive it per team) and all week math follows.
 */
export const WEEK_START_DOW = 3;

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

/** The week-anchor day (Wednesday) starting the week that contains `date`. */
export function weekStartOf(date: string): string {
  const offset = (weekdayOf(date) - WEEK_START_DOW + 7) % 7;
  return addDays(date, -offset);
}

/** The 7 dates of the week starting at `weekStart` (a Wednesday), through Tuesday. */
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
