// XMAS-31b "Scene core", page runtime: the scene runs on a fixed clock of 60
// steps a second, whatever the screen's refresh rate. makeStepper(start)
// counts whole steps from `start`; due(now) says how many steps to run for a
// frame at `now` and remembers them, so no step is run twice or skipped.
// reset(now) starts counting again from `now` (after a hidden tab), so a long
// gap is not replayed as a burst of steps.
import { describe, expect, it } from 'vitest';
import { STEP_MS, STEPS_PER_SECOND, makeStepper } from './steps.ts';

/** Total steps due over frames at `start + i * period` for i = 1..count. */
function run(start: number, period: number, count: number): { total: number; perFrame: number[] } {
  const stepper = makeStepper(start);
  const perFrame: number[] = [];
  for (let i = 1; i <= count; i++) perFrame.push(stepper.due(start + i * period));
  return { total: perFrame.reduce((a, b) => a + b, 0), perFrame };
}

describe('the 60-step clock', () => {
  it('is 60 steps a second', () => {
    expect(STEPS_PER_SECOND).toBe(60);
    expect(STEP_MS).toBeCloseTo(1000 / 60, 12);
  });

  it.each([
    ['30 Hz', 30],
    ['60 Hz', 60],
    ['75 Hz', 75],
    ['120 Hz', 120],
    ['144 Hz', 144],
  ])('runs exactly 60 steps over one second at %s', (_name, hz) => {
    const { total } = run(12_345.678, 1000 / hz, hz);
    expect(total).toBe(60);
  });

  it('at 60 Hz runs one step per frame, with no float drift over ten minutes', () => {
    const { total, perFrame } = run(0, 1000 / 60, 60 * 600);
    expect(total).toBe(60 * 600);
    expect(new Set(perFrame)).toEqual(new Set([1]));
  });

  it('at 144 Hz never runs more than one step in a frame', () => {
    const { perFrame } = run(500, 1000 / 144, 144 * 3);
    expect(Math.max(...perFrame)).toBe(1);
    expect(perFrame.filter((n) => n === 0).length).toBeGreaterThan(0);
  });

  it('carries the part-step over: two half-steps make one step', () => {
    const stepper = makeStepper(1000);
    expect(stepper.due(1000 + STEP_MS / 2)).toBe(0);
    expect(stepper.due(1000 + STEP_MS)).toBe(1);
    expect(stepper.due(1000 + STEP_MS * 1.5)).toBe(0);
  });

  it('a late frame runs the steps it missed', () => {
    const stepper = makeStepper(0);
    expect(stepper.due(100)).toBe(6); // 100 ms is 6 whole steps
    expect(stepper.due(1000)).toBe(54); // 60 in total by one second
  });

  it('a frame at the same time again runs nothing more', () => {
    const stepper = makeStepper(0);
    expect(stepper.due(50)).toBe(3);
    expect(stepper.due(50)).toBe(0);
  });

  it('time going backwards runs nothing, and nothing is run twice when it moves on again', () => {
    const stepper = makeStepper(0);
    expect(stepper.due(500)).toBe(30);
    expect(stepper.due(200)).toBe(0);
    expect(stepper.due(500)).toBe(0);
    expect(stepper.due(1000)).toBe(30);
  });

  it('reset after a hidden gap starts afresh: no burst of steps for the time away', () => {
    const stepper = makeStepper(0);
    expect(stepper.due(1000)).toBe(60);
    stepper.reset(60_000); // the tab comes back a minute later
    expect(stepper.due(60_000)).toBe(0);
    expect(stepper.due(60_000 + STEP_MS)).toBe(1);
    expect(stepper.due(61_000)).toBe(59);
  });

  it('reset keeps the part-step it was given, not the one from before', () => {
    const stepper = makeStepper(0);
    expect(stepper.due(STEP_MS * 0.9)).toBe(0); // 0.9 of a step pending
    stepper.reset(10_000);
    expect(stepper.due(10_000 + STEP_MS * 0.2)).toBe(0); // the old 0.9 does not carry
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('refuses a start of %s', (bad) => {
    expect(() => makeStepper(bad)).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('refuses a frame time of %s and stays usable', (bad) => {
    const stepper = makeStepper(0);
    expect(() => stepper.due(bad)).toThrow(RangeError);
    expect(() => stepper.reset(bad)).toThrow(RangeError);
    expect(stepper.due(1000)).toBe(60);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('fraction refuses a time of %s', (bad) => {
    const stepper = makeStepper(0);
    expect(() => stepper.fraction(bad)).toThrow(RangeError);
    expect(stepper.due(1000)).toBe(60);
  });
});

// XMAS-79 "Smooth between steps": fraction(now), called after due(now) for the
// same frame, says how far `now` is into the next step not yet run (0 to 1).
describe('the part-step fraction', () => {
  it('is 0 at the start', () => {
    const stepper = makeStepper(1000);
    stepper.due(1000);
    expect(stepper.fraction(1000)).toBe(0);
  });

  it('is 0 exactly on a step boundary after due, never a tiny negative or nearly 1', () => {
    const stepper = makeStepper(0);
    expect(stepper.due(100)).toBe(6); // six steps are 100.00000000000001 ms
    expect(stepper.fraction(100)).toBe(0);
    expect(stepper.due(1000)).toBe(54);
    expect(stepper.fraction(1000)).toBe(0);
  });

  it('is 0 on boundaries at large, close times', () => {
    const stepper = makeStepper(123_456_789.123);
    for (let i = 1; i <= 120; i++) {
      const now = 123_456_789.123 + i * STEP_MS;
      stepper.due(now);
      expect(stepper.fraction(now), `step ${i}`).toBeLessThan(1e-6);
    }
  });

  it('is the part-step mid-step', () => {
    const stepper = makeStepper(1000);
    stepper.due(1000 + STEP_MS * 0.25);
    expect(stepper.fraction(1000 + STEP_MS * 0.25)).toBeCloseTo(0.25, 9);
    stepper.due(1000 + STEP_MS * 0.5);
    expect(stepper.fraction(1000 + STEP_MS * 0.5)).toBeCloseTo(0.5, 9);
    stepper.due(1000 + STEP_MS * 1.75);
    expect(stepper.fraction(1000 + STEP_MS * 1.75)).toBeCloseTo(0.75, 9);
  });

  it('is just under 1 a hair before the next boundary, and 0 on it', () => {
    const stepper = makeStepper(0);
    stepper.due(STEP_MS * 0.999);
    expect(stepper.fraction(STEP_MS * 0.999)).toBeCloseTo(0.999, 9);
    expect(stepper.due(STEP_MS)).toBe(1);
    expect(stepper.fraction(STEP_MS)).toBeLessThan(1e-6);
  });

  it('after many steps in one frame is the part-step of the last one', () => {
    const stepper = makeStepper(0);
    expect(stepper.due(100 + STEP_MS * 0.4)).toBe(6);
    expect(stepper.fraction(100 + STEP_MS * 0.4)).toBeCloseTo(0.4, 9);
    expect(stepper.due(5000 + STEP_MS * 0.7)).toBe(294);
    expect(stepper.fraction(5000 + STEP_MS * 0.7)).toBeCloseTo(0.7, 9);
  });

  it('stays within 0 and 1 over a run of irregular frames', () => {
    const stepper = makeStepper(77.7);
    let now = 77.7;
    for (let i = 0; i < 2000; i++) {
      now += 1 + ((i * 7919) % 41); // 1 to 41 ms
      stepper.due(now);
      const f = stepper.fraction(now);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('is 0 when time goes backwards, and is right again once it moves on', () => {
    const stepper = makeStepper(0);
    stepper.due(500);
    expect(stepper.due(200)).toBe(0);
    expect(stepper.fraction(200)).toBe(0);
    expect(stepper.due(500 + STEP_MS * 0.5)).toBe(0);
    expect(stepper.fraction(500 + STEP_MS * 0.5)).toBeCloseTo(0.5, 9);
  });

  it('is 0 for a time before the start', () => {
    const stepper = makeStepper(1000);
    stepper.due(900);
    expect(stepper.fraction(900)).toBe(0);
  });

  it('is 0 at the reset time and counts from it, not from before', () => {
    const stepper = makeStepper(0);
    stepper.due(STEP_MS * 0.9);
    expect(stepper.fraction(STEP_MS * 0.9)).toBeCloseTo(0.9, 9);
    stepper.reset(60_000);
    expect(stepper.fraction(60_000)).toBe(0);
    stepper.due(60_000 + STEP_MS * 0.2);
    expect(stepper.fraction(60_000 + STEP_MS * 0.2)).toBeCloseTo(0.2, 9);
  });

  it('is 0 at a reset time that is itself mid-way through an old step', () => {
    const stepper = makeStepper(0);
    stepper.due(1000);
    stepper.reset(1000 + STEP_MS * 0.6);
    expect(stepper.fraction(1000 + STEP_MS * 0.6)).toBe(0);
  });

  it('repeats the same answer for the same time', () => {
    const stepper = makeStepper(0);
    stepper.due(50 + 5);
    const a = stepper.fraction(55);
    expect(stepper.fraction(55)).toBe(a);
  });
});
