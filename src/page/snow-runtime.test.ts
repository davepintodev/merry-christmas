// XMAS-36b3 "Page wiring of the snow": the runtime that owns the page's two
// snows. Each test checks the runtime against the plain snow functions it
// should compose, driven by hand, so no mock is needed.
import { describe, expect, it } from 'vitest';
import { createOutsideSnow, OUTSIDE_SNOW, setOutsideChristmasDay, stepOutsideSnow } from '../scene/outside-snow.ts';
import { createGlobeSnow, GLOBE_SNOW, setChristmasDay, stepGlobeSnow } from '../scene/snow.ts';
import { makeSnowRuntime, type SnowRuntime } from './snow-runtime.ts';

const SEED = 7;
const W = 130;
const H = 260;
const outsideCount = (w: number, h: number, day: boolean): number =>
  Math.round(((w * h) / 700) * (day ? OUTSIDE_SNOW.christmasDay.amount : OUTSIDE_SNOW.ordinary.amount));
const picture = (r: SnowRuntime): string => JSON.stringify([r.snow?.flakes, r.snow?.stir, r.outsideSnow?.flakes]);
const turnAt = (k: number): number => k * 0.01;

function run(r: SnowRuntime, steps: number, day = false, w = W, h = H, from = 0): void {
  for (let k = from; k < from + steps; k++) r.step({ turn: turnAt(k), christmasDay: day, width: w, height: h });
}

describe('the snow runtime', () => {
  it('has no snow before the first step', () => {
    const r = makeSnowRuntime(SEED);
    expect(r.snow).toBeNull();
    expect(r.outsideSnow).toBeNull();
  });

  it('makes both snows on the first step, with the ordinary amounts', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 1);
    expect(r.snow?.flakes.length).toBe(GLOBE_SNOW.ordinary.flakes);
    expect(r.outsideSnow?.flakes.length).toBe(outsideCount(W, H, false));
  });

  it('starts on the Christmas Day amounts when the first step is Christmas Day', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 1, true);
    expect(r.snow?.flakes.length).toBe(GLOBE_SNOW.christmasDay.flakes);
    expect(r.outsideSnow?.flakes.length).toBe(outsideCount(W, H, true));
  });

  it('gives the same snow for the same seed and inputs, and other snow for another seed', () => {
    const a = makeSnowRuntime(SEED);
    const b = makeSnowRuntime(SEED);
    const c = makeSnowRuntime(SEED + 1);
    run(a, 200);
    run(b, 200);
    run(c, 200);
    expect(picture(a)).toBe(picture(b));
    expect(picture(a)).not.toBe(picture(c));
  });

  it('runs exactly the plain simulations, one step each per call', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 120);
    const globe = createGlobeSnow(SEED, false);
    const outside = createOutsideSnow(SEED, W, H, false);
    for (let k = 0; k < 120; k++) {
      stepGlobeSnow(globe, { turn: turnAt(k), raise: 0, push: { x: 0, y: 0, z: 0 } });
      stepOutsideSnow(outside);
    }
    expect(JSON.stringify(r.snow?.flakes)).toBe(JSON.stringify(globe.flakes));
    expect(JSON.stringify(r.outsideSnow?.flakes)).toBe(JSON.stringify(outside.flakes));
  });

  it('hands raise and push to the globe snow', () => {
    const r = makeSnowRuntime(SEED);
    const globe = createGlobeSnow(SEED, false);
    for (let k = 0; k < 90; k++) {
      const raise = k < 30 ? 0.05 : 0;
      const push = k === 10 ? { x: 80, y: 0, z: -40 } : { x: 0, y: 0, z: 0 };
      r.step({ turn: turnAt(k), christmasDay: false, width: W, height: H, raise, push });
      stepGlobeSnow(globe, { turn: turnAt(k), raise, push });
    }
    expect(r.snow?.stir ?? 0).toBeGreaterThan(0.1);
    expect(r.snow?.stir).toBe(globe.stir);
    expect(JSON.stringify(r.snow?.flakes)).toBe(JSON.stringify(globe.flakes));
    const calm = makeSnowRuntime(SEED);
    run(calm, 90);
    expect(picture(calm)).not.toBe(picture(r));
  });

  it('keeps the same snow objects while nothing changes', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 1);
    const [globe, outside] = [r.snow, r.outsideSnow];
    run(r, 50, false, W, H, 1);
    expect(r.snow).toBe(globe);
    expect(r.outsideSnow).toBe(outside);
  });

  it('switches both snows to Christmas Day and back, flake counts both ways', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 30);
    run(r, 30, true, W, H, 30);
    expect(r.snow?.flakes.length).toBe(500);
    expect(r.outsideSnow?.flakes.length).toBe(outsideCount(W, H, true));
    run(r, 30, false, W, H, 60);
    expect(r.snow?.flakes.length).toBe(340);
    expect(r.outsideSnow?.flakes.length).toBe(outsideCount(W, H, false));
  });

  it('switches the same way the plain snows do, and keeps the day once switched', () => {
    const r = makeSnowRuntime(SEED);
    const globe = createGlobeSnow(SEED, false);
    const outside = createOutsideSnow(SEED, W, H, false);
    for (let k = 0; k < 150; k++) {
      const day = k >= 50 && k < 100;
      if (k === 50 || k === 100) {
        setChristmasDay(globe, day);
        setOutsideChristmasDay(outside, day);
      }
      r.step({ turn: turnAt(k), christmasDay: day, width: W, height: H });
      stepGlobeSnow(globe, { turn: turnAt(k), raise: 0, push: { x: 0, y: 0, z: 0 } });
      stepOutsideSnow(outside);
    }
    expect(JSON.stringify(r.snow?.flakes)).toBe(JSON.stringify(globe.flakes));
    expect(JSON.stringify(r.outsideSnow?.flakes)).toBe(JSON.stringify(outside.flakes));
  });

  it('a steady Christmas Day equals snows made for Christmas Day from the start', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 100, true);
    const globe = createGlobeSnow(SEED, true);
    const outside = createOutsideSnow(SEED, W, H, true);
    for (let k = 0; k < 100; k++) {
      stepGlobeSnow(globe, { turn: turnAt(k), raise: 0, push: { x: 0, y: 0, z: 0 } });
      stepOutsideSnow(outside);
    }
    expect(JSON.stringify(r.snow?.flakes)).toBe(JSON.stringify(globe.flakes));
    expect(JSON.stringify(r.outsideSnow?.flakes)).toBe(JSON.stringify(outside.flakes));
  });

  it('a size change makes a new outside snow of the new size and leaves the globe snow alone', () => {
    const r = makeSnowRuntime(SEED);
    const control = makeSnowRuntime(SEED);
    run(r, 40);
    run(control, 40);
    const oldOutside = r.outsideSnow;
    const globe = r.snow;
    run(r, 1, false, 90, 200, 40);
    run(control, 1, false, W, H, 40);
    expect(r.outsideSnow).not.toBe(oldOutside);
    expect(r.outsideSnow?.flakes.length).toBe(outsideCount(90, 200, false));
    expect(r.snow).toBe(globe);
    expect(JSON.stringify(r.snow?.flakes)).toBe(JSON.stringify(control.snow?.flakes));
    expect(r.snow?.stir).toBe(control.snow?.stir);
  });

  it('a height-only or width-only change also makes a new outside snow', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 1);
    const first = r.outsideSnow;
    run(r, 1, false, W + 1, H, 1);
    const second = r.outsideSnow;
    expect(second).not.toBe(first);
    expect(second?.flakes.length).toBe(outsideCount(W + 1, H, false));
    run(r, 1, false, W + 1, H + 1, 2);
    expect(r.outsideSnow).not.toBe(second);
    expect(r.outsideSnow?.flakes.length).toBe(outsideCount(W + 1, H + 1, false));
  });

  it('a size change on Christmas Day makes the new outside snow with the Christmas Day amount', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 5, true);
    run(r, 1, true, 200, 100, 5);
    expect(r.outsideSnow?.flakes.length).toBe(outsideCount(200, 100, true));
    expect(r.snow?.flakes.length).toBe(500);
  });

  it('a size change and a day change together give both new amounts', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 5);
    run(r, 1, true, 200, 100, 5);
    expect(r.outsideSnow?.flakes.length).toBe(outsideCount(200, 100, true));
    expect(r.snow?.flakes.length).toBe(500);
  });

  it('a zero-size picture has no outside flakes and still steps the globe snow', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 3, false, 0, 0);
    expect(r.outsideSnow?.flakes.length).toBe(0);
    expect(r.snow?.flakes.length).toBe(340);
  });

  it('a bad turn throws and leaves both snows as they were, so the next good step matches a run without it', () => {
    const r = makeSnowRuntime(SEED);
    const control = makeSnowRuntime(SEED);
    run(r, 10);
    run(control, 10);
    const before = picture(r);
    expect(() => r.step({ turn: Number.NaN, christmasDay: false, width: W, height: H })).toThrow(RangeError);
    expect(picture(r)).toBe(before);
    run(r, 10, false, W, H, 10);
    run(control, 10, false, W, H, 10);
    expect(picture(r)).toBe(picture(control));
  });

  it('a negative raise or a non-finite push throws and changes nothing', () => {
    const r = makeSnowRuntime(SEED);
    run(r, 5);
    const before = picture(r);
    expect(() => r.step({ turn: 1, christmasDay: true, width: W, height: H, raise: -1 })).toThrow(RangeError);
    expect(() =>
      r.step({ turn: 1, christmasDay: true, width: W, height: H, push: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 } }),
    ).toThrow(RangeError);
    expect(picture(r)).toBe(before);
    expect(r.snow?.flakes.length, 'a failed step does not switch the day').toBe(340);
  });

  it('a bad size throws, leaves the old snows, and does not step the globe snow', () => {
    const r = makeSnowRuntime(SEED);
    const control = makeSnowRuntime(SEED);
    run(r, 5);
    run(control, 5);
    const outside = r.outsideSnow;
    expect(() => r.step({ turn: turnAt(5), christmasDay: false, width: Number.NaN, height: H })).toThrow(RangeError);
    expect(() => r.step({ turn: turnAt(5), christmasDay: false, width: -1, height: H })).toThrow(RangeError);
    expect(r.outsideSnow).toBe(outside);
    run(r, 5, false, W, H, 5);
    run(control, 5, false, W, H, 5);
    expect(picture(r)).toBe(picture(control));
  });

  it('a bad first step leaves no half-made snow behind a later good step', () => {
    const r = makeSnowRuntime(SEED);
    const control = makeSnowRuntime(SEED);
    expect(() => r.step({ turn: Number.NaN, christmasDay: false, width: W, height: H })).toThrow(RangeError);
    run(r, 20);
    run(control, 20);
    expect(picture(r)).toBe(picture(control));
  });
});
