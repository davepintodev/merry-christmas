// XMAS-29 "Screen reader text and the announcement at zero" (spec 6.5): the
// hidden countdown text as a pure function of the time left, and the decision
// to announce "Merry Christmas!" only when the page sees zero pass.
//
// Zero-valued units are left out ("3 days and 5 minutes"); under a minute it
// reads "Less than a minute until Christmas". Seconds are never spoken.
import { describe, expect, it } from 'vitest';
import type { TimeLeft } from '../shared/clock.ts';
import { GREETING, announcement, spokenTime } from './announce.ts';

const left = (days: number, hours: number, minutes: number, seconds = 0): TimeLeft => ({
  christmasDay: false,
  days,
  hours,
  minutes,
  seconds,
});
const CHRISTMAS: TimeLeft = { christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 };

describe('spokenTime', () => {
  it('reads an ordinary moment as days, hours and minutes until Christmas', () => {
    expect(spokenTime(left(78, 4, 12))).toBe('78 days, 4 hours and 12 minutes until Christmas');
  });

  it('uses the singular for a value of one in each unit', () => {
    expect(spokenTime(left(1, 1, 1))).toBe('1 day, 1 hour and 1 minute until Christmas');
  });

  it('mixes singular and plural per unit', () => {
    expect(spokenTime(left(2, 1, 59))).toBe('2 days, 1 hour and 59 minutes until Christmas');
    expect(spokenTime(left(1, 23, 2))).toBe('1 day, 23 hours and 2 minutes until Christmas');
  });

  it('never speaks seconds: the seconds value does not change the text', () => {
    const base = spokenTime(left(78, 4, 12, 0));
    expect(spokenTime(left(78, 4, 12, 59))).toBe(base);
    expect(spokenTime(left(78, 4, 12, 1))).toBe(base);
    expect(base).not.toMatch(/second/i);
  });

  it('leaves out zero days', () => {
    expect(spokenTime(left(0, 4, 12))).toBe('4 hours and 12 minutes until Christmas');
  });

  it('leaves out zero hours between days and minutes', () => {
    expect(spokenTime(left(3, 0, 5))).toBe('3 days and 5 minutes until Christmas');
  });

  it('leaves out zero minutes', () => {
    expect(spokenTime(left(3, 2, 0))).toBe('3 days and 2 hours until Christmas');
  });

  it('reads a single remaining unit on its own', () => {
    expect(spokenTime(left(364, 0, 0))).toBe('364 days until Christmas');
    expect(spokenTime(left(1, 0, 0))).toBe('1 day until Christmas');
    expect(spokenTime(left(0, 1, 0))).toBe('1 hour until Christmas');
    expect(spokenTime(left(0, 0, 1))).toBe('1 minute until Christmas');
    expect(spokenTime(left(0, 0, 1, 59))).toBe('1 minute until Christmas');
  });

  it('reads three-digit days in full', () => {
    expect(spokenTime(left(115, 11, 30))).toBe('115 days, 11 hours and 30 minutes until Christmas');
  });

  it('under a minute left reads "Less than a minute until Christmas", never "0 minutes"', () => {
    expect(spokenTime(left(0, 0, 0, 59))).toBe('Less than a minute until Christmas');
    expect(spokenTime(left(0, 0, 0, 1))).toBe('Less than a minute until Christmas');
    expect(spokenTime(left(0, 0, 0, 0))).toBe('Less than a minute until Christmas');
  });

  it('never says a zero-valued unit', () => {
    for (const t of [left(0, 4, 12), left(3, 0, 5), left(3, 2, 0), left(0, 0, 7), left(0, 0, 0, 30)]) {
      expect(spokenTime(t)).not.toMatch(/\b0 /);
    }
  });

  it('on Christmas Day reads the greeting', () => {
    expect(GREETING).toBe('Merry Christmas!');
    expect(spokenTime(CHRISTMAS)).toBe('Merry Christmas!');
  });

  it('the Christmas Day flag wins over any stray unit values', () => {
    expect(spokenTime({ christmasDay: true, days: 3, hours: 2, minutes: 1, seconds: 0 })).toBe('Merry Christmas!');
  });
});

describe('announcement', () => {
  it('announces the greeting when a countdown reading is followed by Christmas Day (zero passes)', () => {
    expect(announcement(left(0, 0, 0, 1), CHRISTMAS)).toBe('Merry Christmas!');
  });

  it('announces when the device clock jumps from an earlier day straight into Christmas Day', () => {
    expect(announcement(left(5, 3, 2, 1), CHRISTMAS)).toBe('Merry Christmas!');
  });

  it('announces nothing on the first reading after load, even on Christmas Day', () => {
    expect(announcement(null, CHRISTMAS)).toBeNull();
    expect(announcement(null, left(78, 4, 12))).toBeNull();
  });

  it('announces nothing while Christmas Day goes on', () => {
    expect(announcement(CHRISTMAS, CHRISTMAS)).toBeNull();
  });

  it('announces nothing during an ordinary countdown, including the last second', () => {
    expect(announcement(left(78, 4, 12, 1), left(78, 4, 12, 0))).toBeNull();
    expect(announcement(left(0, 0, 0, 2), left(0, 0, 0, 1))).toBeNull();
  });

  it('announces nothing when Christmas Day ends and the countdown starts again', () => {
    expect(announcement(CHRISTMAS, left(364, 0, 0))).toBeNull();
  });
});
