// XMAS-79 "Smooth between steps: turn, lean and Santa": the scene steps 60 times
// a second but frames come at any rate, so draw shows the pose partway between
// the last two steps. makePoseTrack remembers those two poses and blend(f)
// gives the one between; smoothTime(steps, f) is the same for Santa's time.
// The drawing is one step behind the finger at most, and never ahead of it.
import { describe, expect, it } from 'vitest';
import { makePoseTrack, smoothTime } from './pose.ts';
import { STEP_MS, makeStepper } from './steps.ts';

describe('makePoseTrack', () => {
  it('starts with previous and latest both at the initial pose', () => {
    const track = makePoseTrack({ turn: 3, lean: -2 });
    expect(track.latest()).toEqual({ turn: 3, lean: -2 });
    for (const f of [0, 0.5, 1]) expect(track.blend(f)).toEqual({ turn: 3, lean: -2 });
  });

  it('blend at 0 is the previous pose and at 1 the latest', () => {
    const track = makePoseTrack({ turn: 0, lean: 0 });
    track.push({ turn: 10, lean: 4 });
    expect(track.blend(0)).toEqual({ turn: 0, lean: 0 });
    expect(track.blend(1)).toEqual({ turn: 10, lean: 4 });
  });

  it('blend is linear in between, for turn and lean separately', () => {
    const track = makePoseTrack({ turn: 0, lean: 0 });
    track.push({ turn: 10, lean: -4 });
    const mid = track.blend(0.25);
    expect(mid.turn).toBeCloseTo(2.5, 12);
    expect(mid.lean).toBeCloseTo(-1, 12);
  });

  it('push makes the old latest the previous, and drops the one before', () => {
    const track = makePoseTrack({ turn: 0, lean: 0 });
    track.push({ turn: 10, lean: 1 });
    track.push({ turn: 14, lean: 3 });
    expect(track.latest()).toEqual({ turn: 14, lean: 3 });
    expect(track.blend(0)).toEqual({ turn: 10, lean: 1 });
    expect(track.blend(0.5)).toEqual({ turn: 12, lean: 2 });
    expect(track.blend(1)).toEqual({ turn: 14, lean: 3 });
  });

  it('the same pose pushed twice holds still', () => {
    const track = makePoseTrack({ turn: 0, lean: 0 });
    track.push({ turn: 5, lean: 5 });
    track.push({ turn: 5, lean: 5 });
    expect(track.blend(0.37)).toEqual({ turn: 5, lean: 5 });
  });

  it('works when the turn goes backwards', () => {
    const track = makePoseTrack({ turn: 10, lean: 0 });
    track.push({ turn: 6, lean: 0 });
    expect(track.blend(0.5).turn).toBeCloseTo(8, 12);
  });

  it('clamps a fraction outside 0 to 1', () => {
    const track = makePoseTrack({ turn: 0, lean: 0 });
    track.push({ turn: 10, lean: 2 });
    expect(track.blend(-0.5)).toEqual({ turn: 0, lean: 0 });
    expect(track.blend(1.5)).toEqual({ turn: 10, lean: 2 });
    expect(track.blend(Number.POSITIVE_INFINITY)).toEqual({ turn: 10, lean: 2 });
    expect(track.blend(Number.NEGATIVE_INFINITY)).toEqual({ turn: 0, lean: 0 });
  });

  it('blending does not change the track', () => {
    const track = makePoseTrack({ turn: 0, lean: 0 });
    track.push({ turn: 10, lean: 2 });
    track.blend(0.9);
    expect(track.latest()).toEqual({ turn: 10, lean: 2 });
    expect(track.blend(0)).toEqual({ turn: 0, lean: 0 });
  });

  it('keeps the pose it was given even if the caller changes its object afterwards', () => {
    const track = makePoseTrack({ turn: 0, lean: 0 });
    const pose = { turn: 10, lean: 2 };
    track.push(pose);
    pose.turn = 999;
    expect(track.latest().turn).toBe(10);
    expect(track.blend(1).turn).toBe(10);
  });

  it('two tracks do not share state', () => {
    const a = makePoseTrack({ turn: 0, lean: 0 });
    const b = makePoseTrack({ turn: 0, lean: 0 });
    a.push({ turn: 10, lean: 10 });
    expect(b.latest()).toEqual({ turn: 0, lean: 0 });
  });
});

describe('smoothTime', () => {
  it('is 0 before any step, whatever the fraction', () => {
    for (const f of [0, 0.5, 1]) expect(smoothTime(0, f)).toBe(0);
  });

  it('after one step runs from 0 to a whole step as the fraction goes 0 to 1', () => {
    expect(smoothTime(1, 0)).toBe(0);
    expect(smoothTime(1, 0.5)).toBeCloseTo(STEP_MS / 2, 9);
    expect(smoothTime(1, 1)).toBeCloseTo(STEP_MS, 9);
  });

  it('is the previous step time at fraction 0 and the latest at 1', () => {
    expect(smoothTime(10, 0)).toBeCloseTo(9 * STEP_MS, 9);
    expect(smoothTime(10, 1)).toBeCloseTo(10 * STEP_MS, 9);
    expect(smoothTime(10, 0.25)).toBeCloseTo(9.25 * STEP_MS, 9);
  });

  it('clamps the fraction, and is never negative', () => {
    expect(smoothTime(10, -3)).toBeCloseTo(9 * STEP_MS, 9);
    expect(smoothTime(10, 7)).toBeCloseTo(10 * STEP_MS, 9);
    expect(smoothTime(0, -1)).toBe(0);
    expect(smoothTime(1, -1)).toBe(0);
  });

  it('joins up from one step to the next: fraction 1 now is fraction 0 a step later', () => {
    expect(smoothTime(7, 1)).toBeCloseTo(smoothTime(8, 0), 9);
  });
});

// Drives the stepper and the track the way the page does: each frame runs the
// steps due, each step pushes the pose it leaves, then draw blends at the
// frame's fraction. A steady turn of K a step is K * elapsed / STEP_MS "at the
// finger" at real time.
const K = 3;
const L = -0.5;

interface Drawn {
  elapsed: number;
  steps: number;
  turn: number;
  lean: number;
  time: number;
}

function drive(start: number, offsets: number[]): Drawn[] {
  const stepper = makeStepper(start);
  const track = makePoseTrack({ turn: 0, lean: 0 });
  let steps = 0;
  return offsets.map((offset) => {
    const now = start + offset;
    const due = stepper.due(now);
    for (let i = 0; i < due; i++) {
      steps++;
      track.push({ turn: steps * K, lean: steps * L });
    }
    const fraction = stepper.fraction(now);
    const pose = track.blend(fraction);
    return { elapsed: offset, steps, turn: pose.turn, lean: pose.lean, time: smoothTime(steps, fraction) };
  });
}

function offsetsAt(hz: number, seconds: number): number[] {
  return Array.from({ length: Math.round(hz * seconds) + 1 }, (_, i) => (i * 1000) / hz);
}

/** A jittery 60 Hz: each frame up to 6 ms early or late, never out of order. */
function jittery(seconds: number): number[] {
  const out: number[] = [];
  let seed = 12345;
  for (let i = 0; i <= 60 * seconds; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out.push(Math.max(i === 0 ? 0 : out[i - 1]!, (i * 1000) / 60 + ((seed % 1200) / 100 - 6)));
  }
  out[0] = 0;
  return out;
}

const SCHEDULES: [string, number[]][] = [
  ['144 Hz', offsetsAt(144, 3)],
  ['90 Hz', offsetsAt(90, 3)],
  ['60 Hz', offsetsAt(60, 3)],
  ['30 Hz', offsetsAt(30, 3)],
  ['a jittery 60 Hz', jittery(3)],
];

describe.each(SCHEDULES)('a steady turn drawn at %s', (_name, offsets) => {
  const frames = drive(9000.37, offsets);
  const settled = frames.filter((frame) => frame.steps >= 1);

  it('has frames after the first step to check', () => {
    expect(settled.length).toBeGreaterThan(frames.length / 2);
  });

  it('turn grows in proportion to real time: K * (elapsed / STEP_MS - 1)', () => {
    for (const frame of settled) {
      expect(frame.turn, `at ${frame.elapsed} ms`).toBeCloseTo(K * (frame.elapsed / STEP_MS - 1), 6);
      expect(frame.lean, `at ${frame.elapsed} ms`).toBeCloseTo(L * (frame.elapsed / STEP_MS - 1), 6);
    }
  });

  it('turn never goes backwards', () => {
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.turn, `frame ${i}`).toBeGreaterThanOrEqual(frames[i - 1]!.turn - 1e-9);
    }
  });

  it('is at most one step behind the true pose, and never ahead of it', () => {
    for (const frame of frames) {
      const truth = (K * frame.elapsed) / STEP_MS;
      expect(frame.turn, `at ${frame.elapsed} ms`).toBeLessThanOrEqual(truth + 1e-6);
      expect(frame.turn, `at ${frame.elapsed} ms`).toBeGreaterThanOrEqual(truth - K - 1e-6);
    }
  });

  it('Santa time is one step behind real time, growing with it', () => {
    for (const frame of settled) {
      expect(frame.time, `at ${frame.elapsed} ms`).toBeCloseTo(frame.elapsed - STEP_MS, 6);
    }
  });

  it('Santa time is never ahead of real time and never more than one step behind', () => {
    for (const frame of frames) {
      expect(frame.time).toBeLessThanOrEqual(frame.elapsed + 1e-6);
      expect(frame.time).toBeGreaterThanOrEqual(frame.elapsed - STEP_MS - 1e-6);
    }
  });
});

describe('a steady turn between steps', () => {
  it('moves on every frame at 144 Hz, even those that run no step', () => {
    const frames = drive(0, offsetsAt(144, 2)).filter((frame) => frame.steps >= 1);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.turn, `frame ${i}`).toBeGreaterThan(frames[i - 1]!.turn);
      expect(frames[i]!.time, `frame ${i}`).toBeGreaterThan(frames[i - 1]!.time);
    }
  });

  it('does not move in whole-step jumps: no frame gap is more than its share of the time', () => {
    const frames = drive(0, offsetsAt(144, 2)).filter((frame) => frame.steps >= 1);
    for (let i = 1; i < frames.length; i++) {
      const gap = frames[i]!.turn - frames[i - 1]!.turn;
      expect(gap, `frame ${i}`).toBeLessThan(K * 0.5);
    }
  });

  it('a late frame that runs several steps lands on the real-time turn, not a stale one', () => {
    const frames = drive(100, [0, 10, 20, 250, 260]);
    expect(frames[3]!.turn).toBeCloseTo(K * (250 / STEP_MS - 1), 6);
    expect(frames[4]!.turn).toBeCloseTo(K * (260 / STEP_MS - 1), 6);
  });
});
