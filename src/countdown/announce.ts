// XMAS-29 "Screen reader text and the announcement at zero" (spec 6.5).
import type { TimeLeft } from '../shared/clock.ts';

/** The one line read out on Christmas Day and announced once at zero. */
export const GREETING = 'Merry Christmas!';

/** One unit's count and noun, singular at exactly one: "1 day", "2 days". */
function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

/** Joins the units as "a", "a and b" or "a, b and c". */
function list(parts: readonly string[]): string {
  const last = parts[parts.length - 1] ?? '';
  if (parts.length === 1) return last;
  return `${parts.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * The hidden countdown text for a time left, in whole minutes (no seconds):
 * "78 days, 4 hours and 12 minutes until Christmas". Units at zero are left
 * out; under a minute it is "Less than a minute until Christmas"; on
 * Christmas Day it is GREETING.
 */
export function spokenTime(t: TimeLeft): string {
  if (t.christmasDay) return GREETING;
  const parts: string[] = [];
  if (t.days > 0) parts.push(count(t.days, 'day'));
  if (t.hours > 0) parts.push(count(t.hours, 'hour'));
  if (t.minutes > 0) parts.push(count(t.minutes, 'minute'));
  if (parts.length === 0) return 'Less than a minute until Christmas';
  return `${list(parts)} until Christmas`;
}

/**
 * What the polite live region should announce when the time left moves from
 * `before` (null on the first reading after load) to `now`: GREETING only
 * when a countdown reading is followed by a Christmas Day reading, else null.
 */
export function announcement(before: TimeLeft | null, now: TimeLeft): string | null {
  if (before === null || before.christmasDay || !now.christmasDay) return null;
  return GREETING;
}
