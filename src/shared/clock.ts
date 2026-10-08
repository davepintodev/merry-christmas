// XMAS-25 "Shared clock: time left, the Christmas Day state, phase and blend".
// Spec 3.9 (?now link option), 6.2 (device clock read every tick, zone and
// DST changes picked up), 6.4 (zero and the Christmas Day state), 7.6
// (phases and blends). Import-free and reading local Date methods fresh on
// every call, so the countdown script and the scene bundle can share it.
export type PhaseName = 'dawn' | 'frosty-morning' | 'sunset' | 'purple-night';
export interface TimeLeft { christmasDay: boolean; days: number; hours: number; minutes: number; seconds: number }
export interface PhaseReading { from: PhaseName; to: PhaseName; share: number }

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const XMAS_MONTH = 11; // December, in local getMonth() terms.
const XMAS_DAY = 25;

export function timeLeft(now: Date): TimeLeft {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  if (month === XMAS_MONTH && day === XMAS_DAY) {
    return { christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const countdownYear = month === XMAS_MONTH && day > XMAS_DAY ? year + 1 : year;
  const left = new Date(countdownYear, XMAS_MONTH, XMAS_DAY).getTime() - now.getTime();
  return {
    christmasDay: false,
    days: Math.floor(left / DAY),
    hours: Math.floor(left / HOUR) % 24,
    minutes: Math.floor(left / MINUTE) % 60,
    seconds: Math.floor(left / SECOND) % 60,
  };
}

const DAWN = 6 * HOUR + 30 * MINUTE;
const FROSTY_MORNING = 8 * HOUR;
const SUNSET = 17 * HOUR + 30 * MINUTE;
const PURPLE_NIGHT = 19 * HOUR;
const BLEND = 30 * MINUTE;

/** A blend is centred on its phase start: [start, end) runs linearly old -> new. */
type Blend = readonly [centre: number, from: PhaseName, to: PhaseName];
const BLENDS: readonly Blend[] = [
  [DAWN, 'purple-night', 'dawn'],
  [FROSTY_MORNING, 'dawn', 'frosty-morning'],
  [SUNSET, 'frosty-morning', 'sunset'],
  [PURPLE_NIGHT, 'sunset', 'purple-night'],
];

function steady(phase: PhaseName): PhaseReading {
  return { from: phase, to: phase, share: 0 };
}

export function phaseAt(now: Date): PhaseReading {
  const at = now.getHours() * HOUR + now.getMinutes() * MINUTE + now.getSeconds() * SECOND + now.getMilliseconds();
  for (const [centre, from, to] of BLENDS) {
    const start = centre - BLEND / 2;
    if (at >= start && at < start + BLEND) return { from, to, share: (at - start) / BLEND };
  }
  if (at < DAWN) return steady('purple-night');
  if (at < FROSTY_MORNING) return steady('dawn');
  if (at < SUNSET) return steady('frosty-morning');
  if (at < PURPLE_NIGHT) return steady('sunset');
  return steady('purple-night');
}

const LOCAL_NOW = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** Parses a ?now value as local wall-clock time; null when missing or invalid. */
function parseNow(value: string | null): number | null {
  if (value === null) return null;
  const match = LOCAL_NOW.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) return null;
  const time = new Date(year, month - 1, day, hours, minutes, seconds, 0);
  if (
    time.getFullYear() !== year ||
    time.getMonth() !== month - 1 ||
    time.getDate() !== day ||
    time.getHours() !== hours ||
    time.getMinutes() !== minutes ||
    time.getSeconds() !== seconds
  ) {
    return null; // rolled over, so no such local time (e.g. 25:00 or 31 February)
  }
  return time.getTime();
}

/** The raw `now` query value, parsed without DOM-only globals. */
function nowParam(search: string): string | null {
  for (const pair of search.replace(/^\?/, '').split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0 || pair.slice(0, eq) !== 'now') continue;
    try {
      return decodeURIComponent(pair.slice(eq + 1));
    } catch {
      return null; // malformed escape: treat as invalid
    }
  }
  return null;
}

export function makeClock(search: string, realNow: () => number = Date.now): () => Date {
  const start = parseNow(nowParam(search));
  if (start === null) return () => new Date(realNow());
  const made = realNow();
  return () => new Date(start + (realNow() - made));
}
