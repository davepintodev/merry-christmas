// XMAS-25 "Shared clock: time left, the Christmas Day state, phase and blend".
// Spec 3.9 (?now link option), 6.2 (device clock read every tick, zone and
// DST changes picked up), 6.4 (zero and the Christmas Day state), 7.6
// (phases and blends). Every local date is built after the zone is set.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeClock, phaseAt, timeLeft, type PhaseName, type PhaseReading } from './clock.ts';

const originalTZ = process.env['TZ'];
function setTZ(tz: string): void {
  process.env['TZ'] = tz;
}
afterEach(() => {
  if (originalTZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = originalTZ;
});

/** Local wall-clock time in the current zone. Month is 1-based. */
function local(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): Date {
  return new Date(y, mo - 1, d, h, mi, s, ms);
}


function left(days: number, hours: number, minutes: number, seconds: number) {
  return { christmasDay: false, days, hours, minutes, seconds };
}
const CHRISTMAS = { christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 };

/** How much of `phase` is in the mix: from weighs 1 - share, to weighs share. */
function weight(r: PhaseReading, phase: PhaseName): number {
  let w = 0;
  if (r.from === phase) w += 1 - r.share;
  if (r.to === phase) w += r.share;
  return w;
}

function steady(phase: PhaseName): PhaseReading {
  return { from: phase, to: phase, share: 0 };
}

describe('timeLeft: counting down to 25 December', () => {
  beforeEach(() => setTZ('UTC'));

  it('one second before zero leaves exactly one second', () => {
    expect(timeLeft(local(2026, 12, 24, 23, 59, 59))).toEqual(left(0, 0, 0, 1));
  });

  it('ten seconds before zero leaves ten seconds', () => {
    expect(timeLeft(local(2026, 12, 24, 23, 59, 50))).toEqual(left(0, 0, 0, 10));
  });

  it('at exactly 25 December 00:00:00 the state is Christmas Day with all zero', () => {
    expect(timeLeft(local(2026, 12, 25, 0, 0, 0))).toEqual(CHRISTMAS);
  });

  it('holds Christmas Day at midday on 25 December', () => {
    expect(timeLeft(local(2026, 12, 25, 12, 0, 0))).toEqual(CHRISTMAS);
  });

  it('holds Christmas Day at the last second of 25 December', () => {
    expect(timeLeft(local(2026, 12, 25, 23, 59, 59))).toEqual(CHRISTMAS);
  });

  it('holds Christmas Day at the last millisecond of 25 December', () => {
    expect(timeLeft(local(2026, 12, 25, 23, 59, 59, 999))).toEqual(CHRISTMAS);
  });

  it('from midnight starting 26 December targets next year (364 days, non-leap)', () => {
    // 26 Dec 2026 -> 25 Dec 2027: no 29 February in between.
    expect(timeLeft(local(2026, 12, 26, 0, 0, 0))).toEqual(left(364, 0, 0, 0));
  });

  it('days pass 99 and are not capped', () => {
    const r = timeLeft(local(2026, 1, 1, 0, 0, 0));
    expect(r).toEqual(left(358, 0, 0, 0));
    expect(r.days).toBeGreaterThan(99);
  });

  it('splits a mixed remainder into days, hours, minutes and seconds', () => {
    // 10 Dec 2026 13:47:22 -> 25 Dec 00:00:00 = 14 d 10 h 12 m 38 s.
    expect(timeLeft(local(2026, 12, 10, 13, 47, 22))).toEqual(left(14, 10, 12, 38));
  });

  it('returns whole numbers within their ranges', () => {
    for (let i = 0; i < 200; i++) {
      const t = local(2026, 1, 1).getTime() + i * 1_234_567_000;
      const r = timeLeft(new Date(t));
      if (r.christmasDay) continue;
      for (const n of [r.days, r.hours, r.minutes, r.seconds]) expect(Number.isInteger(n)).toBe(true);
      expect(r.hours).toBeGreaterThanOrEqual(0);
      expect(r.hours).toBeLessThan(24);
      expect(r.minutes).toBeGreaterThanOrEqual(0);
      expect(r.minutes).toBeLessThan(60);
      expect(r.seconds).toBeGreaterThanOrEqual(0);
      expect(r.seconds).toBeLessThan(60);
      expect(r.days).toBeGreaterThanOrEqual(0);
    }
  });

  it('is worked out from the reading, not by subtracting a second from a previous answer', () => {
    // Two readings an hour apart give answers exactly an hour apart, and a
    // reading that jumps backwards goes back up: no state carried between calls.
    const a = timeLeft(local(2026, 12, 1, 10, 0, 0));
    const b = timeLeft(local(2026, 12, 1, 11, 0, 0));
    const c = timeLeft(local(2026, 12, 1, 10, 0, 0));
    expect(a).toEqual(left(23, 14, 0, 0));
    expect(b).toEqual(left(23, 13, 0, 0));
    expect(c).toEqual(a);
  });

  it('does not mutate the Date it is given', () => {
    const d = local(2026, 12, 24, 23, 59, 59);
    const before = d.getTime();
    timeLeft(d);
    expect(d.getTime()).toBe(before);
  });
});

describe('timeLeft: leap years', () => {
  beforeEach(() => setTZ('UTC'));

  it('counts 29 February 2028 (301 days from 28 February 2028)', () => {
    expect(timeLeft(local(2028, 2, 28, 0, 0, 0))).toEqual(left(301, 0, 0, 0));
  });

  it('counts 300 days from 28 February in a non-leap year (2027)', () => {
    expect(timeLeft(local(2027, 2, 28, 0, 0, 0))).toEqual(left(300, 0, 0, 0));
  });

  it('from 26 December 2027 to Christmas 2028 spans 29 February: 365 days', () => {
    expect(timeLeft(local(2027, 12, 26, 0, 0, 0))).toEqual(left(365, 0, 0, 0));
  });

  it('on 29 February 2028 itself counts to 25 December 2028', () => {
    expect(timeLeft(local(2028, 2, 29, 12, 0, 0))).toEqual(left(299, 12, 0, 0));
  });
});

describe('timeLeft: the visitor\'s current time zone', () => {
  it('targets local midnight in a zone ahead of UTC', () => {
    setTZ('Asia/Tokyo');
    expect(timeLeft(local(2026, 12, 24, 23, 59, 59))).toEqual(left(0, 0, 0, 1));
    expect(timeLeft(local(2026, 12, 25, 0, 0, 0))).toEqual(CHRISTMAS);
  });

  it('targets local midnight in a zone behind UTC', () => {
    setTZ('America/Los_Angeles');
    expect(timeLeft(local(2026, 12, 24, 23, 59, 59))).toEqual(left(0, 0, 0, 1));
    expect(timeLeft(local(2026, 12, 26, 0, 0, 0))).toEqual(left(364, 0, 0, 0));
  });

  it('works in a zone with a non-hour offset', () => {
    setTZ('Asia/Kathmandu'); // UTC+05:45
    expect(timeLeft(local(2026, 12, 24, 23, 0, 0))).toEqual(left(0, 1, 0, 0));
  });

  it('the same instant gives a different answer after the zone changes (no cached zone)', () => {
    const instant = new Date(Date.UTC(2026, 11, 24, 20, 0, 0)); // 24 Dec 20:00 UTC
    setTZ('UTC');
    expect(timeLeft(instant)).toEqual(left(0, 4, 0, 0));
    setTZ('Asia/Tokyo'); // 25 Dec 05:00 there
    expect(timeLeft(instant)).toEqual(CHRISTMAS);
    setTZ('America/New_York'); // 24 Dec 15:00 there
    expect(timeLeft(instant)).toEqual(left(0, 9, 0, 0));
  });

  it('Christmas Day in one zone is still the countdown in another for the same instant', () => {
    const instant = new Date(Date.UTC(2026, 11, 25, 23, 30, 0)); // 25 Dec 23:30 UTC
    setTZ('UTC');
    expect(timeLeft(instant)).toEqual(CHRISTMAS);
    setTZ('Pacific/Kiritimati'); // UTC+14: 26 Dec 13:30
    expect(timeLeft(instant).christmasDay).toBe(false);
    expect(timeLeft(instant)).toEqual(left(363, 10, 30, 0));
  });

  it('counts the real time left across a DST change (autumn: the hour gained is counted)', () => {
    setTZ('Europe/London');
    // 24 Oct 2026 12:00 BST (11:00 UTC) -> 25 Dec 2026 00:00 GMT (00:00 UTC):
    // 61 days 13 hours of real time; clocks go back on 25 Oct.
    const now = local(2026, 10, 24, 12, 0, 0);
    expect(now.getTimezoneOffset()).toBe(-60);
    expect(timeLeft(now)).toEqual(left(61, 13, 0, 0));
  });

  it('counts the real time left across a DST change (spring: the hour lost is not counted)', () => {
    setTZ('Europe/London');
    // 26 Dec 2026 00:00 GMT -> 25 Dec 2027 00:00 GMT is 364 days of wall clock;
    // the spring hour lost and the autumn hour gained cancel out.
    expect(timeLeft(local(2026, 12, 26, 0, 0, 0))).toEqual(left(364, 0, 0, 0));
    // 1 Mar 2027 00:00 GMT -> 25 Dec 2027 00:00 GMT, through both changes: 299 days.
    expect(timeLeft(local(2027, 3, 1, 0, 0, 0))).toEqual(left(299, 0, 0, 0));
    // 1 Apr 2027 00:00 BST (31 Mar 23:00 UTC) -> 25 Dec 00:00 GMT: 268 days 1 hour.
    expect(timeLeft(local(2027, 4, 1, 0, 0, 0))).toEqual(left(268, 1, 0, 0));
  });

  it('picks up a DST offset change between two readings of a zone (no cached offset)', () => {
    setTZ('Europe/London');
    const summer = new Date(Date.UTC(2026, 6, 1, 11, 0, 0)); // 12:00 BST
    const winter = new Date(Date.UTC(2026, 11, 1, 11, 0, 0)); // 11:00 GMT
    expect(timeLeft(summer)).toEqual(left(176, 13, 0, 0));
    expect(timeLeft(winter)).toEqual(left(23, 13, 0, 0));
  });
});

describe('phaseAt: phases at fixed local hours', () => {
  beforeEach(() => setTZ('UTC'));

  it.each([
    ['00:00:00', 0, 0, 0, 'purple-night'],
    ['03:00:00', 3, 0, 0, 'purple-night'],
    ['06:14:59', 6, 14, 59, 'purple-night'],
    ['06:45:01', 6, 45, 1, 'dawn'],
    ['07:15:00', 7, 15, 0, 'dawn'],
    ['07:44:59', 7, 44, 59, 'dawn'],
    ['08:15:01', 8, 15, 1, 'frosty-morning'],
    ['12:00:00', 12, 0, 0, 'frosty-morning'],
    ['17:14:59', 17, 14, 59, 'frosty-morning'],
    ['17:45:01', 17, 45, 1, 'sunset'],
    ['18:15:00', 18, 15, 0, 'sunset'],
    ['18:44:59', 18, 44, 59, 'sunset'],
    ['19:15:01', 19, 15, 1, 'purple-night'],
    ['23:59:59', 23, 59, 59, 'purple-night'],
  ] as const)('at %s outside any blend it is steady %s', (_label, h, m, s, phase) => {
    expect(phaseAt(local(2026, 12, 10, h, m, s))).toEqual(steady(phase));
  });
});

const BOUNDARIES = [
  { name: 'Dawn 06:30', h: 6, m: 30, from: 'purple-night', to: 'dawn' },
  { name: 'Frosty morning 08:00', h: 8, m: 0, from: 'dawn', to: 'frosty-morning' },
  { name: 'Sunset 17:30', h: 17, m: 30, from: 'frosty-morning', to: 'sunset' },
  { name: 'Purple night 19:00', h: 19, m: 0, from: 'sunset', to: 'purple-night' },
] as const;

describe.each(BOUNDARIES)('phaseAt: the 30-minute blend centred on $name', ({ h, m, from, to }) => {
  beforeEach(() => setTZ('UTC'));
  const at = (offsetSec: number): Date => new Date(local(2026, 12, 10, h, m, 0).getTime() + offsetSec * 1000);

  it('one second before the blend starts is steady on the old phase', () => {
    expect(phaseAt(at(-15 * 60 - 1))).toEqual(steady(from));
  });

  it('at the start of the blend the mix is all old phase', () => {
    const r = phaseAt(at(-15 * 60));
    expect(weight(r, from)).toBeCloseTo(1, 9);
    expect(weight(r, to)).toBeCloseTo(0, 9);
  });

  it('one second into the blend names both phases with a tiny share', () => {
    expect(phaseAt(at(-15 * 60 + 1))).toEqual({ from, to, share: expect.closeTo(1 / 1800, 9) });
  });

  it('at the start time itself (middle of the blend) the share is one half', () => {
    expect(phaseAt(at(0))).toEqual({ from, to, share: expect.closeTo(0.5, 9) });
  });

  it('a quarter of the way in the share is one quarter (linear)', () => {
    expect(phaseAt(at(-15 * 60 + 450))).toEqual({ from, to, share: expect.closeTo(0.25, 9) });
  });

  it('three quarters of the way in the share is three quarters (linear)', () => {
    expect(phaseAt(at(15 * 60 - 450))).toEqual({ from, to, share: expect.closeTo(0.75, 9) });
  });

  it('one second before the blend ends names both phases with share near 1', () => {
    expect(phaseAt(at(15 * 60 - 1))).toEqual({ from, to, share: expect.closeTo(1799 / 1800, 9) });
  });

  it('at the end of the blend the mix is all new phase', () => {
    const r = phaseAt(at(15 * 60));
    expect(weight(r, to)).toBeCloseTo(1, 9);
    expect(weight(r, from)).toBeCloseTo(0, 9);
  });

  it('one second after the blend ends is steady on the new phase', () => {
    expect(phaseAt(at(15 * 60 + 1))).toEqual(steady(to));
  });

  it('the share rises steadily across the blend and stays in [0, 1]', () => {
    let prev = -1;
    for (let s = -15 * 60 + 1; s < 15 * 60; s += 7) {
      const r = phaseAt(at(s));
      expect(r.from).toBe(from);
      expect(r.to).toBe(to);
      expect(r.share).toBeGreaterThan(prev);
      expect(r.share).toBeGreaterThanOrEqual(0);
      expect(r.share).toBeLessThanOrEqual(1);
      expect(r.share).toBeCloseTo((s + 15 * 60) / 1800, 9);
      prev = r.share;
    }
  });

  it('includes milliseconds in the share', () => {
    const r = phaseAt(new Date(at(0).getTime() + 900));
    expect(r.share).toBeCloseTo(0.5 + 0.9 / 1800, 9);
  });
});

describe('phaseAt: the visitor\'s current time zone', () => {
  it('uses local hours, not UTC hours', () => {
    setTZ('Asia/Tokyo');
    expect(phaseAt(local(2026, 12, 10, 12, 0, 0))).toEqual(steady('frosty-morning')); // 03:00 UTC
    expect(phaseAt(local(2026, 12, 10, 3, 0, 0))).toEqual(steady('purple-night')); // 18:00 UTC
  });

  it('the same instant reads a different phase after the zone changes (no cached zone)', () => {
    const instant = new Date(Date.UTC(2026, 11, 10, 12, 0, 0));
    setTZ('UTC');
    expect(phaseAt(instant)).toEqual(steady('frosty-morning'));
    setTZ('Asia/Tokyo'); // 21:00 there
    expect(phaseAt(instant)).toEqual(steady('purple-night'));
    setTZ('America/New_York'); // 07:00 there
    expect(phaseAt(instant)).toEqual(steady('dawn'));
  });

  it('on the day clocks go forward, Dawn follows the new local hour', () => {
    setTZ('Europe/London');
    // 29 Mar 2026: 01:00 GMT -> 02:00 BST. 06:30 BST is 05:30 UTC.
    expect(phaseAt(new Date(Date.UTC(2026, 2, 29, 5, 30, 0)))).toEqual({
      from: 'purple-night',
      to: 'dawn',
      share: expect.closeTo(0.5, 9),
    });
  });

  it('on the day clocks go back, Dawn follows the new local hour', () => {
    setTZ('Europe/London');
    // 25 Oct 2026: 02:00 BST -> 01:00 GMT. 06:30 GMT is 06:30 UTC; 05:30 UTC is 05:30 GMT.
    expect(phaseAt(new Date(Date.UTC(2026, 9, 25, 6, 30, 0)))).toEqual({
      from: 'purple-night',
      to: 'dawn',
      share: expect.closeTo(0.5, 9),
    });
    expect(phaseAt(new Date(Date.UTC(2026, 9, 25, 5, 30, 0)))).toEqual(steady('purple-night'));
  });

  it('picks up the DST offset between summer and winter readings (no cached offset)', () => {
    setTZ('Europe/London');
    // 17:30 UTC: 18:30 BST in July (sunset), 17:30 GMT in December (mid-blend).
    expect(phaseAt(new Date(Date.UTC(2026, 6, 1, 17, 30, 0)))).toEqual(steady('sunset'));
    expect(phaseAt(new Date(Date.UTC(2026, 11, 1, 17, 30, 0)))).toEqual({
      from: 'frosty-morning',
      to: 'sunset',
      share: expect.closeTo(0.5, 9),
    });
  });
});

describe('makeClock: real time', () => {
  it('with no search string reads realNow on every call', () => {
    let t = 1_800_000_000_000;
    const clock = makeClock('', () => t);
    expect(clock().getTime()).toBe(1_800_000_000_000);
    t += 12_345;
    expect(clock().getTime()).toBe(1_800_000_012_345);
  });

  it('defaults to the device clock when realNow is not given', () => {
    const before = Date.now();
    const d = makeClock('')().getTime();
    const after = Date.now();
    expect(d).toBeGreaterThanOrEqual(before);
    expect(d).toBeLessThanOrEqual(after);
  });

  it('ignores other query parameters', () => {
    const clock = makeClock('?lang=en&foo=bar', () => 42_000);
    expect(clock().getTime()).toBe(42_000);
  });

  it.each([
    '?now=',
    '?now=garbage',
    '?now=2026-13-01T10:00:00',
    '?now=2026-12-24T25:00:00',
    '?now=%E2%9C%A8',
    '?now=<script>alert(1)</script>',
  ])('falls back to real time for an invalid ?now: %s', (search) => {
    let t = 1_800_000_000_000;
    const clock = makeClock(search, () => t);
    const first = clock();
    expect(Number.isNaN(first.getTime())).toBe(false);
    expect(first.getTime()).toBe(1_800_000_000_000);
    t += 5_000;
    expect(clock().getTime()).toBe(1_800_000_005_000);
  });
});

describe('makeClock: pretend clock from ?now', () => {
  it('starts at the given local time', () => {
    setTZ('America/New_York');
    const clock = makeClock('?now=2026-12-24T23:59:50', () => 5_000_000);
    expect(clock().getTime()).toBe(local(2026, 12, 24, 23, 59, 50).getTime());
  });

  it('reads the given time as local time in the visitor\'s zone, not UTC', () => {
    setTZ('Asia/Tokyo');
    const clock = makeClock('?now=2026-12-24T23:59:50', () => 0);
    expect(clock().getTime()).toBe(Date.UTC(2026, 11, 24, 14, 59, 50));
  });

  it('keeps running from that moment by the real time elapsed since makeClock', () => {
    setTZ('UTC');
    let t = 9_999_000;
    const clock = makeClock('?now=2026-12-24T23:59:50', () => t);
    t += 3_250;
    expect(clock().getTime()).toBe(local(2026, 12, 24, 23, 59, 53, 250).getTime());
    t += 6_750;
    expect(clock().getTime()).toBe(local(2026, 12, 25, 0, 0, 0).getTime());
  });

  it('drives timeLeft through zero to the Christmas Day state', () => {
    setTZ('Europe/Berlin');
    let t = 1_000;
    const clock = makeClock('?now=2026-12-24T23:59:50', () => t);
    expect(timeLeft(clock())).toEqual(left(0, 0, 0, 10));
    t += 9_000;
    expect(timeLeft(clock())).toEqual(left(0, 0, 0, 1));
    t += 1_000;
    expect(timeLeft(clock())).toEqual(CHRISTMAS);
  });

  it('drives timeLeft past the end of Christmas Day to next year', () => {
    setTZ('UTC');
    let t = 0;
    const clock = makeClock('?now=2026-12-25T23:59:59', () => t);
    expect(timeLeft(clock())).toEqual(CHRISTMAS);
    t += 1_000;
    expect(timeLeft(clock())).toEqual(left(364, 0, 0, 0));
  });

  it('drives phaseAt through a blend', () => {
    setTZ('UTC');
    let t = 0;
    const clock = makeClock('?now=2026-12-10T17:14:59', () => t);
    expect(phaseAt(clock())).toEqual(steady('frosty-morning'));
    t += 15 * 60 * 1000 + 1_000; // 17:30:00
    expect(phaseAt(clock())).toEqual({ from: 'frosty-morning', to: 'sunset', share: expect.closeTo(0.5, 9) });
  });

  it('finds now among other query parameters', () => {
    setTZ('UTC');
    const clock = makeClock('?lang=en&now=2026-12-24T23:59:50&x=1', () => 0);
    expect(clock().getTime()).toBe(local(2026, 12, 24, 23, 59, 50).getTime());
  });

  it('accepts a URL-encoded value', () => {
    setTZ('UTC');
    const clock = makeClock('?now=2026-12-24T23%3A59%3A50', () => 0);
    expect(clock().getTime()).toBe(local(2026, 12, 24, 23, 59, 50).getTime());
  });

  it('returns a fresh Date each call, so mutating one does not move the clock', () => {
    setTZ('UTC');
    const clock = makeClock('?now=2026-12-24T23:59:50', () => 0);
    const a = clock();
    a.setFullYear(2000);
    expect(clock().getTime()).toBe(local(2026, 12, 24, 23, 59, 50).getTime());
  });

  it('can be set in a leap year', () => {
    setTZ('UTC');
    const clock = makeClock('?now=2028-02-29T12:00:00', () => 0);
    expect(timeLeft(clock())).toEqual(left(299, 12, 0, 0));
  });

  it('a pretend clock running across a DST change reads the new local phase', () => {
    setTZ('Europe/London');
    let t = 0;
    // 29 Mar 2026 00:30 GMT; 6 real hours later it is 07:30 BST (dawn), not 06:30.
    const clock = makeClock('?now=2026-03-29T00:30:00', () => t);
    t += 6 * 3_600_000;
    expect(clock().getTime()).toBe(Date.UTC(2026, 2, 29, 6, 30, 0));
    expect(phaseAt(clock())).toEqual(steady('dawn'));
  });

  it('two clocks made at different moments run independently', () => {
    setTZ('UTC');
    let t = 0;
    const a = makeClock('?now=2026-12-24T23:59:50', () => t);
    t += 4_000;
    const b = makeClock('?now=2026-12-24T23:59:50', () => t);
    t += 1_000;
    expect(a().getTime() - b().getTime()).toBe(4_000);
    expect(timeLeft(a())).toEqual(left(0, 0, 0, 5));
    expect(timeLeft(b())).toEqual(left(0, 0, 0, 9));
  });
});

