// XMAS-36a "Snow and the stir", slice 1: the globe-snow simulation (spec
// 8.1-8.3). A pure module: no drawing, no Math.random, no clock. One
// stepGlobeSnow call is one 1/60 s step. Coordinates are art px relative to
// the globe centre, y grows downward, z > 0 is toward the viewer; the glass
// has radius 56 and lying snow rests on the floor at y = 25 below the centre.
//
// Ordinary days: 340 flakes, about 30% in the air, falling at 6.5 px/s.
// Christmas Day: 500 flakes, about 50% in the air. The stir lifts snow from
// the floor and moves it in eddies; it fades to almost nothing in about 6.5 s.
// Flakes only come to rest when the stir is below 0.25. A push moves the air
// snow for a moment; turning the globe carries the air snow round with a lag.
//
// Bad input: a non-finite raise, turn or push throws (RangeError or Error)
// and leaves the snow untouched; a negative raise either throws the same way
// or is ignored (treated as 0) - it never lowers the stir.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GLOBE_SNOW,
  SNOW_SETTINGS,
  airCount,
  createGlobeSnow,
  setChristmasDay,
  stepGlobeSnow,
  type Flake,
  type GlobeSnow,
  type SnowInput,
} from './snow.ts';

const STEPS_PER_SECOND = 60;
const RADIUS = 56;
const FLOOR_Y = 25;
const FALL = 6.5; // px/s
/** No flake may move further than this in one 1/60 s step (240 px/s), except a lying flake restarting high up. */
const MAX_STEP = 4;

const CALM: SnowInput = { turn: 0, raise: 0, push: { x: 0, y: 0, z: 0 } };

function input(over: Partial<SnowInput> = {}): SnowInput {
  return { ...CALM, push: { ...CALM.push }, ...over };
}

function run(snow: GlobeSnow, steps: number, inp: SnowInput = CALM): void {
  for (let i = 0; i < steps; i++) stepGlobeSnow(snow, inp);
}

function snap(snow: GlobeSnow): Flake[] {
  return snow.flakes.map((f) => ({ ...f }));
}

function dist(f: Flake): number {
  return Math.hypot(f.x, f.y, f.z);
}

function moved(a: Flake, b: Flake): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Angle about the vertical (y) axis, and its wrapped change. */
function yaw(f: Flake): number {
  return Math.atan2(f.z, f.x);
}
function yawChange(a: Flake, b: Flake): number {
  let d = yaw(b) - yaw(a);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

function target(christmasDay: boolean): number {
  const a = christmasDay ? { flakes: 500, share: 0.5 } : { flakes: 340, share: 0.3 };
  return a.flakes * a.share;
}

/** "Back near the target": within 15% of the target plus 3 flakes. */
function nearTarget(count: number, christmasDay: boolean): boolean {
  const t = target(christmasDay);
  return Math.abs(count - t) <= 0.15 * t + 3;
}

/** Records snapshots of every step (including the start) while running `steps` steps. */
function record(snow: GlobeSnow, steps: number, inputAt: (i: number) => SnowInput = () => CALM): Flake[][] {
  const out = [snap(snow)];
  for (let i = 0; i < steps; i++) {
    stepGlobeSnow(snow, inputAt(i));
    out.push(snap(snow));
  }
  return out;
}

/** Indices of flakes in the air in every snapshot and never jumping more than MAX_STEP. */
function airThroughout(frames: Flake[][], awayFromGlass = RADIUS + 1): number[] {
  const n = frames[0]!.length;
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    let ok = true;
    for (let k = 0; k < frames.length && ok; k++) {
      const f = frames[k]![i]!;
      if (f.resting || dist(f) > awayFromGlass) ok = false;
      if (k > 0 && moved(frames[k - 1]![i]!, f) > MAX_STEP) ok = false;
    }
    if (ok) keep.push(i);
  }
  return keep;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GLOBE_SNOW and SNOW_SETTINGS', () => {
  it('names the ordinary amounts: 340 flakes, 30% in the air, 6.5 px/s', () => {
    expect(GLOBE_SNOW.ordinary).toEqual({ flakes: 340, airShare: 0.3, fallSpeed: 6.5 });
  });

  it('names the Christmas Day amounts: 500 flakes, 50% in the air, 6.5 px/s', () => {
    expect(GLOBE_SNOW.christmasDay).toEqual({ flakes: 500, airShare: 0.5, fallSpeed: 6.5 });
  });

  it('names every stir and glass number', () => {
    expect(SNOW_SETTINGS).toMatchObject({
      radius: 56,
      settleSeconds: 6.5,
      swirlLag: 1.3,
      turbulence: 60,
      settleBelow: 0.25,
      throwAbove: 0.12,
      maxStir: 1.6,
    });
  });
});

describe('createGlobeSnow', () => {
  it('makes 340 flakes on an ordinary day with about 30% in the air', () => {
    const snow = createGlobeSnow(1, false);
    expect(snow.flakes).toHaveLength(340);
    expect(nearTarget(airCount(snow), false), `air ${airCount(snow)}`).toBe(true);
  });

  it('makes 500 flakes on Christmas Day with about 50% in the air', () => {
    const snow = createGlobeSnow(1, true);
    expect(snow.flakes).toHaveLength(500);
    expect(nearTarget(airCount(snow), true), `air ${airCount(snow)}`).toBe(true);
  });

  it('starts calm: no stir', () => {
    expect(createGlobeSnow(3, false).stir).toBe(0);
  });

  it('counts the air flakes as the flakes that are not resting', () => {
    const snow = createGlobeSnow(4, true);
    expect(airCount(snow)).toBe(snow.flakes.filter((f) => !f.resting).length);
    run(snow, 120, input({ raise: 0.02 }));
    expect(airCount(snow)).toBe(snow.flakes.filter((f) => !f.resting).length);
  });

  it.each([0, 1, -7, 0xffffffff, 2 ** 40 + 3, 0.5])('makes a valid globe for seed %s', (seed) => {
    const snow = createGlobeSnow(seed, false);
    expect(snow.flakes).toHaveLength(340);
    for (const f of snow.flakes) {
      for (const v of [f.x, f.y, f.z, f.phase]) expect(Number.isFinite(v)).toBe(true);
      expect(dist(f)).toBeLessThanOrEqual(RADIUS + 1e-9);
    }
  });

  it('lays resting flakes on the floor and keeps air flakes above it', () => {
    const snow = createGlobeSnow(5, false);
    for (const f of snow.flakes) {
      if (f.resting) expect(Math.abs(f.y - FLOOR_Y)).toBeLessThanOrEqual(2);
      else expect(f.y).toBeLessThan(FLOOR_Y);
    }
  });

  it('gives different seeds different snow', () => {
    expect(snap(createGlobeSnow(1, false))).not.toEqual(snap(createGlobeSnow(2, false)));
  });

  it('uses no Math.random and no clock', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random used');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now used');
    });
    vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('performance.now used');
    });
    const snow = createGlobeSnow(9, false);
    run(snow, 60, input({ raise: 0.5, turn: 0.2, push: { x: 10, y: 0, z: 0 } }));
    setChristmasDay(snow, true);
    run(snow, 60);
  });
});

describe('determinism', () => {
  const script = (i: number): SnowInput => ({
    turn: 0.01 * i,
    raise: i === 10 ? 1.2 : i === 300 ? 0.5 : 0,
    push: i === 100 ? { x: 40, y: -30, z: 10 } : { x: 0, y: 0, z: 0 },
  });

  function scripted(seed: number): GlobeSnow {
    const snow = createGlobeSnow(seed, false);
    for (let i = 0; i < 600; i++) {
      if (i === 200) setChristmasDay(snow, true);
      if (i === 450) setChristmasDay(snow, false);
      stepGlobeSnow(snow, script(i));
    }
    return snow;
  }

  it('gives identical state for the same seed and inputs over 600 steps', () => {
    const a = scripted(42);
    const b = scripted(42);
    expect(snap(a)).toEqual(snap(b));
    expect(a.stir).toBe(b.stir);
    expect(airCount(a)).toBe(airCount(b));
  });

  it('gives different state for different seeds under the same inputs', () => {
    expect(snap(scripted(42))).not.toEqual(snap(scripted(43)));
  });

  it('shares no state between globes: running one does not change a new one', () => {
    const fresh = snap(createGlobeSnow(7, false));
    const busy = createGlobeSnow(7, false);
    run(busy, 100, input({ raise: 0.3 }));
    expect(snap(createGlobeSnow(7, false))).toEqual(fresh);
  });
});

describe('setChristmasDay', () => {
  it('turning it on grows to 500 flakes and keeps every existing flake', () => {
    const snow = createGlobeSnow(11, false);
    run(snow, 90);
    const before = snap(snow).map((f) => JSON.stringify(f));
    setChristmasDay(snow, true);
    expect(snow.flakes).toHaveLength(500);
    const after = new Map<string, number>();
    for (const f of snow.flakes) {
      const k = JSON.stringify(f);
      after.set(k, (after.get(k) ?? 0) + 1);
    }
    for (const k of before) {
      expect(after.get(k) ?? 0, `kept ${k}`).toBeGreaterThan(0);
      after.set(k, after.get(k)! - 1);
    }
  });

  it('turning it off shrinks to 340 flakes, every one of them an existing flake', () => {
    const snow = createGlobeSnow(12, true);
    run(snow, 90);
    const before = new Set(snap(snow).map((f) => JSON.stringify(f)));
    setChristmasDay(snow, false);
    expect(snow.flakes).toHaveLength(340);
    for (const f of snow.flakes) expect(before.has(JSON.stringify(f))).toBe(true);
  });

  it('puts added flakes inside the glass', () => {
    const snow = createGlobeSnow(13, false);
    setChristmasDay(snow, true);
    for (const f of snow.flakes) expect(dist(f)).toBeLessThanOrEqual(RADIUS + 1e-9);
  });

  it('is idempotent: setting the same day twice is the same as once', () => {
    const once = createGlobeSnow(14, false);
    const twice = createGlobeSnow(14, false);
    setChristmasDay(once, true);
    setChristmasDay(twice, true);
    setChristmasDay(twice, true);
    expect(snap(twice)).toEqual(snap(once));
    run(once, 120);
    run(twice, 120);
    expect(snap(twice)).toEqual(snap(once));
  });

  it('setting the day it already is changes nothing', () => {
    const snow = createGlobeSnow(15, false);
    run(snow, 30);
    const before = snap(snow);
    setChristmasDay(snow, false);
    expect(snap(snow)).toEqual(before);
  });

  it('settles to about 50% in the air after turning on, and back to about 30% after turning off', () => {
    const snow = createGlobeSnow(16, false);
    setChristmasDay(snow, true);
    run(snow, 20 * STEPS_PER_SECOND);
    expect(nearTarget(airCount(snow), true), `on: air ${airCount(snow)}`).toBe(true);
    setChristmasDay(snow, false);
    run(snow, 20 * STEPS_PER_SECOND);
    expect(nearTarget(airCount(snow), false), `off: air ${airCount(snow)}`).toBe(true);
  });
});

describe('calm snow', () => {
  it.each([
    [false, 21],
    [true, 22],
  ])('keeps the air share near the target over 60 s calm (Christmas Day %s)', (christmasDay, seed) => {
    const snow = createGlobeSnow(seed, christmasDay);
    const counts: number[] = [];
    for (let s = 0; s < 60; s++) {
      run(snow, STEPS_PER_SECOND);
      counts.push(airCount(snow));
    }
    const t = target(christmasDay);
    for (const c of counts) expect(Math.abs(c - t), `air ${c} vs ${t}`).toBeLessThanOrEqual(0.2 * t + 3);
    expect(Math.abs(mean(counts) - t)).toBeLessThanOrEqual(0.1 * t + 2);
  });

  it('restarts lying flakes from the upper dome so the snow keeps falling', () => {
    const snow = createGlobeSnow(23, false);
    const frames = record(snow, 30 * STEPS_PER_SECOND);
    let restarts = 0;
    let low = 0;
    for (let k = 1; k < frames.length; k++) {
      for (let i = 0; i < frames[k]!.length; i++) {
        const a = frames[k - 1]![i]!;
        const b = frames[k]![i]!;
        if (a.resting && !b.resting) {
          restarts++;
          if (b.y >= 0) low++;
        }
      }
    }
    expect(low, 'restarts in the upper dome').toBe(0);
    expect(restarts).toBeGreaterThan(10);
  });

  it('lets air flakes fall at 0.6-1.4 times the fall speed, not all at one speed', () => {
    const snow = createGlobeSnow(24, false);
    const frames = record(snow, STEPS_PER_SECOND);
    const ids = airThroughout(frames, 48);
    expect(ids.length).toBeGreaterThan(30);
    const speeds = ids.map((i) => frames[STEPS_PER_SECOND]![i]!.y - frames[0]![i]!.y); // px per second
    for (const v of speeds) {
      expect(v).toBeGreaterThanOrEqual(0.6 * FALL - 0.3);
      expect(v).toBeLessThanOrEqual(1.4 * FALL + 0.3);
    }
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(1);
  });

  it('lets air flakes sway slightly from side to side', () => {
    const snow = createGlobeSnow(25, false);
    const frames = record(snow, STEPS_PER_SECOND);
    const ids = airThroughout(frames, 48);
    const side = ids.map((i) => {
      const a = frames[0]![i]!;
      const b = frames[STEPS_PER_SECOND]![i]!;
      return Math.hypot(b.x - a.x, b.z - a.z);
    });
    expect(Math.max(...side), 'some sway').toBeGreaterThan(0.05);
    for (const s of side) expect(s, 'only slight').toBeLessThan(FALL);
  });

  it('keeps resting flakes perfectly still while the globe does not turn', () => {
    const snow = createGlobeSnow(26, false);
    const frames = record(snow, 5 * STEPS_PER_SECOND);
    let checked = 0;
    let movedCount = 0;
    for (let k = 1; k < frames.length; k++) {
      for (let i = 0; i < frames[k]!.length; i++) {
        const a = frames[k - 1]![i]!;
        const b = frames[k]![i]!;
        if (a.resting && b.resting) {
          checked++;
          if (b.x !== a.x || b.y !== a.y || b.z !== a.z) movedCount++;
        }
      }
    }
    expect(movedCount).toBe(0);
    expect(checked).toBeGreaterThan(1000);
  });

  it('runs calm forever with zero raise: no stir, finite flakes, inside the glass', () => {
    const snow = createGlobeSnow(27, false);
    run(snow, 120 * STEPS_PER_SECOND);
    expect(snow.stir).toBe(0);
    expect(snow.flakes).toHaveLength(340);
    for (const f of snow.flakes) {
      for (const v of [f.x, f.y, f.z, f.phase]) expect(Number.isFinite(v)).toBe(true);
      expect(dist(f)).toBeLessThanOrEqual(RADIUS + 1e-9);
    }
    expect(nearTarget(airCount(snow), false)).toBe(true);
  });
});

describe('turning the globe', () => {
  /** Turns from 0 to `total` over `steps` steps, then holds. */
  const turning = (total: number, steps: number) => (i: number) => input({ turn: (total * Math.min(i + 1, steps)) / steps });

  it('turns resting flakes with the globe about the vertical axis', () => {
    const snow = createGlobeSnow(31, false);
    run(snow, 60);
    const frames = record(snow, 30, turning(0.3, 30));
    const first = frames[0]!;
    const last = frames[30]!;
    const ids = first.map((_, i) => i).filter((i) => frames.every((fr) => fr[i]!.resting));
    expect(ids.length).toBeGreaterThan(100);
    const turns = ids.filter((i) => Math.hypot(first[i]!.x, first[i]!.z) > 2).map((i) => yawChange(first[i]!, last[i]!));
    const sign = Math.sign(turns[0]!);
    for (const i of ids) {
      const a = first[i]!;
      const b = last[i]!;
      expect(b.y).toBeCloseTo(a.y, 9);
      expect(Math.hypot(b.x, b.z)).toBeCloseTo(Math.hypot(a.x, a.z), 6);
    }
    for (const d of turns) expect(d * sign).toBeCloseTo(0.3, 6);
  });

  it('carries air snow round behind the globe, keeps it turning after the globe stops, then settles', () => {
    const snow = createGlobeSnow(32, false);
    run(snow, 60);
    // The sign of the globe's turn in flake coordinates, from a resting flake.
    const restIndex = snow.flakes.findIndex((f) => f.resting && Math.hypot(f.x, f.z) > 5);
    const restBefore = { ...snow.flakes[restIndex]! };

    const spin = (frames: Flake[][]) => {
      const ids = airThroughout(frames).filter((i) => frames.every((fr) => Math.hypot(fr[i]!.x, fr[i]!.z) > 8));
      expect(ids.length).toBeGreaterThan(20);
      return mean(ids.map((i) => yawChange(frames[0]![i]!, frames[frames.length - 1]![i]!)));
    };

    const during = record(snow, 60, turning(1, 60)); // 1 rad over 1 s
    const restAfter = snow.flakes[restIndex]!;
    const sign = Math.sign(yawChange(restBefore, restAfter));
    expect(sign).not.toBe(0);
    const hold = input({ turn: 1 });
    const after = record(snow, 60, () => hold);
    run(snow, 9 * STEPS_PER_SECOND, hold);
    const late = record(snow, 60, () => hold);

    const duringSpin = spin(during) * sign;
    expect(duringSpin, 'carried round').toBeGreaterThan(0.05);
    expect(duringSpin, 'but lagging behind the globe').toBeLessThan(0.9);
    expect(spin(after) * sign, 'still turning after the globe stops').toBeGreaterThan(0.05);
    expect(Math.abs(spin(late)), 'settled ten seconds later').toBeLessThan(0.01);
  });

  it('in a long steady turn carries air snow round at about 1.3x the globe (the water) rate', () => {
    // After a long steady turn the water spins with the globe; the air snow goes
    // round swirlLag (1.3) times as fast. 1.0x and 1.6x both fall outside the band.
    const snow = createGlobeSnow(33, false);
    run(snow, 60);
    const rate = 0.01; // rad per step, 0.6 rad/s
    let turn = 0;
    const restIndex = snow.flakes.findIndex((f) => f.resting && Math.hypot(f.x, f.z) > 5);
    let restTotal = 0; // summed per step: the 4.8 rad total would wrap past pi
    for (let i = 0; i < 8 * STEPS_PER_SECOND; i++) {
      const before = { ...snow.flakes[restIndex]! };
      turn += rate;
      stepGlobeSnow(snow, input({ turn }));
      restTotal += yawChange(before, snow.flakes[restIndex]!);
    }
    const sign = Math.sign(restTotal);
    expect(sign).not.toBe(0);
    const frames = record(snow, STEPS_PER_SECOND, () => {
      turn += rate;
      return input({ turn });
    });
    const ids = airThroughout(frames).filter((i) => frames.every((fr) => Math.hypot(fr[i]!.x, fr[i]!.z) > 8));
    expect(ids.length).toBeGreaterThan(20);
    // Sum the per-step yaw change so a flake going past half a turn is still counted right.
    const perFlake = ids.map((i) => {
      let total = 0;
      for (let k = 1; k < frames.length; k++) total += yawChange(frames[k - 1]![i]!, frames[k]![i]!);
      return total;
    });
    const ratio = (mean(perFlake) * sign) / (rate * STEPS_PER_SECOND);
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.45);
  });

  it('stirs the snow when the globe is turned fast, even with no raise', () => {
    const snow = createGlobeSnow(34, false);
    stepGlobeSnow(snow, CALM);
    for (let i = 1; i <= 10; i++) stepGlobeSnow(snow, input({ turn: 0.2 * i })); // 12 rad/s
    expect(snow.stir).toBeGreaterThan(0.05);
  });

  it('barely stirs the snow when the globe turns slowly, and not at all when it holds still', () => {
    const slow = createGlobeSnow(35, false);
    const still = createGlobeSnow(35, false);
    for (let i = 0; i <= 10 * STEPS_PER_SECOND; i++) {
      stepGlobeSnow(slow, input({ turn: 0.001 * i })); // 0.06 rad/s
      stepGlobeSnow(still, input({ turn: 1.5 }));
    }
    expect(slow.stir).toBeLessThan(0.02);
    expect(still.stir).toBe(0);
  });

  it('treats a turn wrapped into [-pi, pi] the same as the unwrapped turn', () => {
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const plain = createGlobeSnow(36, false);
    const wrapped = createGlobeSnow(36, false);
    for (let i = 0; i < 3 * STEPS_PER_SECOND; i++) {
      const turn = 2.9 + 0.02 * i; // passes pi (3.1 -> -3.1 wrapped) after ~12 steps, and again later
      stepGlobeSnow(plain, input({ turn }));
      stepGlobeSnow(wrapped, input({ turn: wrap(turn) }));
    }
    const a = snap(plain);
    const b = snap(wrapped);
    let worst = 0;
    let restingDiffers = 0;
    for (let i = 0; i < a.length; i++) {
      worst = Math.max(worst, Math.abs(a[i]!.x - b[i]!.x), Math.abs(a[i]!.y - b[i]!.y), Math.abs(a[i]!.z - b[i]!.z));
      if (a[i]!.resting !== b[i]!.resting) restingDiffers++;
    }
    expect(restingDiffers).toBe(0);
    expect(worst).toBeLessThan(1e-6);
    expect(wrapped.stir).toBeCloseTo(plain.stir, 9);
  });
});

describe('the stir', () => {
  it('adds raise to the stir', () => {
    const snow = createGlobeSnow(41, false);
    stepGlobeSnow(snow, input({ raise: 0.5 }));
    expect(snow.stir).toBeGreaterThan(0.49);
    expect(snow.stir).toBeLessThanOrEqual(0.5 + 1e-12);
    stepGlobeSnow(snow, input({ raise: 0.5 }));
    expect(snow.stir).toBeGreaterThan(0.97);
    expect(snow.stir).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('caps the stir at 1.6', () => {
    const snow = createGlobeSnow(42, false);
    stepGlobeSnow(snow, input({ raise: 5 }));
    expect(snow.stir).toBeLessThanOrEqual(1.6 + 1e-12);
    expect(snow.stir).toBeGreaterThan(1.55);
    for (let i = 0; i < 30; i++) {
      stepGlobeSnow(snow, input({ raise: 1 }));
      expect(snow.stir).toBeLessThanOrEqual(1.6 + 1e-12);
    }
  });

  it('fades to almost nothing in about 6.5 s, never rising on its own', () => {
    const snow = createGlobeSnow(43, false);
    stepGlobeSnow(snow, input({ raise: 1 }));
    const start = snow.stir;
    let last = start;
    for (let i = 1; i <= 400; i++) {
      stepGlobeSnow(snow, CALM);
      expect(snow.stir).toBeLessThanOrEqual(last);
      expect(snow.stir).toBeGreaterThanOrEqual(0);
      last = snow.stir;
      if (i === 2 * STEPS_PER_SECOND) expect(snow.stir, 'not gone after 2 s').toBeGreaterThan(0.2 * start);
    }
    expect(snow.stir, 'almost nothing after ~6.5 s').toBeLessThan(0.05 * start);
  });

  it('does not throw snow up from the floor while the stir is below 0.12', () => {
    const snow = createGlobeSnow(44, false);
    run(snow, 60);
    const frames = record(snow, 2 * STEPS_PER_SECOND, (i) => input({ raise: i === 0 ? 0.1 : 0 }));
    let lifted = 0;
    for (let k = 1; k < frames.length; k++) {
      for (let i = 0; i < frames[k]!.length; i++) {
        const a = frames[k - 1]![i]!;
        const b = frames[k]![i]!;
        if (a.resting && !b.resting && moved(a, b) <= MAX_STEP) lifted++;
      }
    }
    expect(lifted).toBe(0);
  });

  it('throws snow up from the floor once the stir passes 0.12', () => {
    const snow = createGlobeSnow(44, false);
    run(snow, 60);
    const frames = record(snow, STEPS_PER_SECOND, (i) => input({ raise: i === 0 ? 1 : 0 }));
    let lifted = 0;
    for (let k = 1; k < frames.length; k++) {
      for (let i = 0; i < frames[k]!.length; i++) {
        const a = frames[k - 1]![i]!;
        const b = frames[k]![i]!;
        if (a.resting && !b.resting && moved(a, b) <= MAX_STEP) lifted++;
      }
    }
    expect(lifted).toBeGreaterThan(10);
    expect(airCount(snow)).toBeGreaterThan(target(false) + 20);
  });

  it('lifts more snow and stirs wilder eddies the stronger the stir', () => {
    const measure = (raise: number) => {
      const snow = createGlobeSnow(45, false);
      run(snow, 60);
      stepGlobeSnow(snow, input({ raise }));
      run(snow, 30);
      const frames = record(snow, 60);
      const ids = airThroughout(frames);
      const speed = mean(
        ids.flatMap((i) => frames.slice(1).map((fr, k) => moved(frames[k]![i]!, fr[i]!))),
      );
      return { air: airCount(snow), speed };
    };
    const gentle = measure(0.5);
    const hard = measure(1.6);
    expect(hard.air).toBeGreaterThan(gentle.air + 10);
    expect(hard.speed).toBeGreaterThan(1.3 * gentle.speed);
  });

  it('moves snow in smooth eddies, not jitter: per-step velocity changes are small', () => {
    const snow = createGlobeSnow(46, false);
    run(snow, 60);
    stepGlobeSnow(snow, input({ raise: 1 }));
    run(snow, 15);
    const frames = record(snow, 60);
    const ids = airThroughout(frames, RADIUS - 4);
    expect(ids.length).toBeGreaterThan(30);
    const changes: number[] = [];
    const speeds: number[] = [];
    for (const i of ids) {
      for (let k = 2; k < frames.length; k++) {
        const a = frames[k - 2]![i]!;
        const b = frames[k - 1]![i]!;
        const c = frames[k]![i]!;
        const v1 = [b.x - a.x, b.y - a.y, b.z - a.z];
        const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
        changes.push(Math.hypot(v2[0]! - v1[0]!, v2[1]! - v1[1]!, v2[2]! - v1[2]!));
        speeds.push(Math.hypot(...v2));
      }
    }
    expect(mean(speeds), 'eddies do move the snow').toBeGreaterThan(0.2);
    expect(percentile(changes, 0.95), 'smoothly').toBeLessThan(0.3);
  });

  it('does not teleport flakes in a hard stir burst', () => {
    const snow = createGlobeSnow(47, false);
    run(snow, 60);
    const frames = record(snow, 3 * STEPS_PER_SECOND, (i) => input({ raise: i % 20 === 0 ? 1.6 : 0 }));
    let biggest = 0;
    for (let k = 1; k < frames.length; k++) {
      for (let i = 0; i < frames[k]!.length; i++) {
        const a = frames[k - 1]![i]!;
        const b = frames[k]![i]!;
        const restart = a.resting && !b.resting && b.y < 0;
        if (!restart) biggest = Math.max(biggest, moved(a, b));
      }
    }
    expect(biggest).toBeLessThanOrEqual(MAX_STEP);
  });

  it('only lets flakes come to rest while the stir is below 0.25', () => {
    const snow = createGlobeSnow(48, false);
    run(snow, 60);
    stepGlobeSnow(snow, input({ raise: 1.6 }));
    let prev = snap(snow);
    let landings = 0;
    let stirredLandings = 0;
    for (let k = 0; k < 20 * STEPS_PER_SECOND; k++) {
      stepGlobeSnow(snow, CALM);
      for (let i = 0; i < prev.length; i++) {
        if (!prev[i]!.resting && snow.flakes[i]!.resting) {
          landings++;
          if (snow.stir >= 0.25) stirredLandings++;
        }
      }
      prev = snap(snow);
    }
    expect(stirredLandings, 'landings while stir >= 0.25').toBe(0);
    expect(landings).toBeGreaterThan(0);
  });

  it('takes at least 10 s after a hard stir before the air share is back near the target, and does get back', () => {
    const snow = createGlobeSnow(49, false);
    run(snow, 60);
    stepGlobeSnow(snow, input({ raise: 1.6 }));
    let back = -1;
    for (let k = 1; k <= 40 * STEPS_PER_SECOND; k++) {
      stepGlobeSnow(snow, CALM);
      if (nearTarget(airCount(snow), false)) {
        back = k;
        break;
      }
    }
    expect(back, 'gets back within 40 s').toBeGreaterThan(0);
    expect(back, 'not before 10 s').toBeGreaterThanOrEqual(10 * STEPS_PER_SECOND);
  });
});

describe('the push', () => {
  it.each([
    ['+x', { x: 60, y: 0, z: 0 }, 'x' as const],
    ['-z', { x: 0, y: 0, z: -60 }, 'z' as const],
    ['up', { x: 0, y: -60, z: 0 }, 'y' as const],
  ])('moves air snow %s for a moment, then dies away', (_name, push, axis) => {
    const pushed = createGlobeSnow(51, false);
    const twin = createGlobeSnow(51, false);
    run(pushed, 60);
    run(twin, 60);
    const dir = Math.sign(push[axis]);
    const p = record(pushed, 5 * STEPS_PER_SECOND, (i) => input({ push: i === 0 ? push : { x: 0, y: 0, z: 0 } }));
    const t = record(twin, 5 * STEPS_PER_SECOND);

    const drift = (from: number, to: number) => {
      const window = (fr: Flake[][]) => fr.slice(from, to + 1);
      const okP = new Set(airThroughout(window(p)));
      const ids = airThroughout(window(t)).filter((i) => okP.has(i));
      expect(ids.length).toBeGreaterThan(20);
      return mean(ids.map((i) => (p[to]![i]![axis] - p[from]![i]![axis]) - (t[to]![i]![axis] - t[from]![i]![axis])));
    };

    expect(drift(0, STEPS_PER_SECOND) * dir, 'moved in the push direction').toBeGreaterThan(3);
    expect(Math.abs(drift(4 * STEPS_PER_SECOND, 5 * STEPS_PER_SECOND)), 'died away').toBeLessThan(0.5);
  });

  it('does not move resting flakes', () => {
    const snow = createGlobeSnow(52, false);
    run(snow, 60);
    const before = snap(snow);
    stepGlobeSnow(snow, input({ push: { x: 120, y: -80, z: 40 } }));
    let checked = 0;
    for (let i = 0; i < before.length; i++) {
      const a = before[i]!;
      const b = snow.flakes[i]!;
      if (a.resting && b.resting) {
        checked++;
        expect([b.x, b.y, b.z]).toEqual([a.x, a.y, a.z]);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('the glass', () => {
  it('keeps every flake inside the globe through hard stirs, pushes and fast turns', () => {
    const snow = createGlobeSnow(61, true);
    let furthest = 0;
    let nonFinite = 0;
    for (let i = 0; i < 20 * STEPS_PER_SECOND; i++) {
      const a = (i * 2.4) % (2 * Math.PI);
      stepGlobeSnow(snow, {
        turn: 0.08 * i,
        raise: i % 45 === 0 ? 1.6 : 0,
        push: i % 30 === 0 ? { x: 300 * Math.cos(a), y: -250, z: 300 * Math.sin(a) } : { x: 0, y: 0, z: 0 },
      });
      if (i === 600) setChristmasDay(snow, false);
      for (const f of snow.flakes) {
        const d = dist(f);
        if (!Number.isFinite(d)) nonFinite++;
        else if (d > furthest) furthest = d;
      }
    }
    expect(nonFinite).toBe(0);
    expect(furthest).toBeLessThanOrEqual(RADIUS + 1e-6);
  });

  it('keeps the flake count fixed while stepping', () => {
    const snow = createGlobeSnow(62, false);
    run(snow, 300, input({ raise: 0.4, turn: 1 }));
    expect(snow.flakes).toHaveLength(340);
  });
});

describe('bad input', () => {
  it.each([NaN, Infinity, -Infinity])('throws on a non-finite raise (%s) and leaves the snow untouched', (raise) => {
    const snow = createGlobeSnow(71, false);
    run(snow, 30, input({ raise: 0.01 }));
    const before = snap(snow);
    const stir = snow.stir;
    expect(() => stepGlobeSnow(snow, input({ raise }))).toThrow();
    expect(snap(snow)).toEqual(before);
    expect(snow.stir).toBe(stir);
  });

  it.each([
    ['turn NaN', { turn: NaN }],
    ['turn Infinity', { turn: Infinity }],
    ['push.x NaN', { push: { x: NaN, y: 0, z: 0 } }],
    ['push.y Infinity', { push: { x: 0, y: Infinity, z: 0 } }],
    ['push.z -Infinity', { push: { x: 0, y: 0, z: -Infinity } }],
  ])('throws on a non-finite %s and leaves the snow untouched', (_name, over) => {
    const snow = createGlobeSnow(72, false);
    run(snow, 30);
    const before = snap(snow);
    expect(() => stepGlobeSnow(snow, input(over as Partial<SnowInput>))).toThrow();
    expect(snap(snow)).toEqual(before);
  });

  it('never lowers the stir for a negative raise: it throws untouched or acts as raise 0', () => {
    const neg = createGlobeSnow(73, false);
    const zero = createGlobeSnow(73, false);
    stepGlobeSnow(neg, input({ raise: 1 }));
    stepGlobeSnow(zero, input({ raise: 1 }));
    const before = snap(neg);
    const stir = neg.stir;
    stepGlobeSnow(zero, CALM);
    let threw = false;
    try {
      stepGlobeSnow(neg, input({ raise: -1 }));
    } catch {
      threw = true;
    }
    if (threw) {
      expect(snap(neg)).toEqual(before);
      expect(neg.stir).toBe(stir);
    } else {
      expect(neg.stir).toBe(zero.stir);
      expect(snap(neg)).toEqual(snap(zero));
    }
  });
});
