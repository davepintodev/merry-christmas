// XMAS-43a: the pure shake model. Motion readings (m/s², time in seconds) go in; the stir and the
// snow push built up since the last take() come out. The caller owns the clock.
import { describe, expect, it } from 'vitest';
import { createShake, SHAKE_SETTINGS, type MotionReading } from './shake.ts';

const settings = { threshold: 6, gravityTimeSec: 1, waitSec: 1.5, stirPerExcess: 1, pushPerExcess: 1, maxGapSec: 10 };

/** Feeds readings one second apart and returns what was built up. */
function feed(readings: MotionReading[], overrides: Partial<typeof settings & { maxGapSec: number }> = {}) {
  const shake = createShake({ ...settings, ...overrides });
  for (const r of readings) shake.reading(r);
  return { shake, out: shake.take() };
}
const at = (timeSec: number, x: number, y = 0, z = 0): MotionReading => ({ timeSec, acceleration: { x, y, z } });

describe('shake model', () => {
  it('names its settings, with the agreed threshold and waiting time', () => {
    expect(SHAKE_SETTINGS.threshold).toBe(6);
    expect(SHAKE_SETTINGS.waitSec).toBe(1.5);
    expect(typeof SHAKE_SETTINGS.gravityTimeSec).toBe('number');
  });

  it('stirs only above the threshold, and faster the harder the shake', () => {
    expect(feed([at(0, 5), at(1, 5)]).out.raise).toBe(0);
    expect(feed([at(0, 6), at(1, 6)]).out.raise).toBe(0);
    const soft = feed([at(0, 8), at(1, 8)]).out.raise;
    const hard = feed([at(0, 10), at(1, 10)]).out.raise;
    expect(soft).toBeCloseTo(2);
    expect(hard).toBeCloseTo(4);
  });

  it('honours an overridden threshold', () => {
    expect(feed([at(0, 5), at(1, 5)], { threshold: 2 }).out.raise).toBeCloseTo(3);
  });

  it('scales by the time between readings instead of counting them', () => {
    const slow = feed([at(0, 10), at(1, 10)]).out.raise;
    const fast = feed([at(0, 10), at(0.5, 10), at(1, 10)]).out.raise;
    expect(fast).toBeCloseTo(slow);
    // uneven gaps: each reading weighs the time since the one before it
    expect(feed([at(0, 10), at(0.25, 10), at(1, 10)]).out.raise).toBeCloseTo(4);
  });

  it('adds nothing for a first reading, or a missing, negative or non-finite time', () => {
    expect(feed([at(5, 20)]).out.raise).toBe(0);
    expect(feed([at(0, 10), { acceleration: { x: 10, y: 0, z: 0 } }]).out.raise).toBe(0);
    expect(feed([at(2, 10), at(1, 10)]).out.raise).toBe(0);
    expect(feed([at(0, 10), at(Number.NaN, 10)]).out.raise).toBe(0);
  });

  it('uses the size of a reading, not its sign', () => {
    const plus = feed([at(0, 10), at(1, 10)]).out.raise;
    const minus = feed([at(0, -10), at(1, -10)]).out.raise;
    expect(minus).toBeCloseTo(plus);
    expect(minus).toBeGreaterThan(0);
  });

  it('pushes against the jolt: scene x = -device x, scene y = +device y, z = 0', () => {
    const { out } = feed([at(0, 6, 8, 0), at(1, 6, 8, 0)]); // |a| = 10, excess 4
    expect(out.push.x).toBeCloseTo(-2.4);
    expect(out.push.y).toBeCloseTo(3.2);
    expect(out.push.z).toBe(0);
  });

  it('caps the time between readings at maxGapSec, so a long sleep is not a long shake', () => {
    const capped = feed([at(0, 10), at(0.5, 10)], { maxGapSec: 0.5 }).out.raise;
    expect(capped).toBeCloseTo(2);
    expect(feed([at(0, 10), at(10, 10)], { maxGapSec: 0.5 }).out.raise).toBeCloseTo(capped);
  });

  it('sums since the last take, then resets', () => {
    const { shake, out } = feed([at(0, 10), at(1, 10)]);
    expect(out.raise).toBeCloseTo(4);
    expect(shake.take()).toEqual({ raise: 0, push: { x: 0, y: 0, z: 0 } });
  });

  it('subtracts a slow running average when only gravity-included readings exist', () => {
    const shake = createShake(settings);
    const g = (timeSec: number, x = 0): MotionReading => ({ timeSec, accelerationIncludingGravity: { x, y: 0, z: 9.8 } });
    let t = 0;
    for (; t < 100; t++) shake.reading(g(t)); // resting: gravity alone is 9.8 > 6
    shake.take();
    for (; t < 110; t++) shake.reading(g(t));
    expect(shake.take().raise).toBeCloseTo(0, 3);
    shake.reading(g(t++, 20));
    shake.reading(g(t, 20));
    const out = shake.take();
    expect(out.raise).toBeGreaterThan(0);
    expect(out.push.x).toBeLessThan(0); // against the jolt: positive device x pushes scene x negative
    shake.reading({ timeSec: t + 1, accelerationIncludingGravity: { x: 0, y: 20, z: 9.8 } });
    expect(shake.take().push.y).toBeGreaterThan(0); // positive device y pushes scene y positive
  });

  it('prefers motion without gravity when it has numbers', () => {
    const shake = createShake(settings);
    shake.reading({ timeSec: 0, acceleration: { x: 10, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 } });
    shake.reading({ timeSec: 1, acceleration: { x: 10, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 } });
    expect(shake.take().raise).toBeCloseTo(4);
  });

  it('takes empty, null and NaN readings without an error or any stir', () => {
    const shake = createShake(settings);
    const junk: MotionReading[] = [
      {},
      { timeSec: null, acceleration: null, accelerationIncludingGravity: null },
      { timeSec: 1, acceleration: {} },
      { timeSec: 2, acceleration: { x: null, y: undefined, z: Number.NaN } },
      { timeSec: 3, accelerationIncludingGravity: { x: Number.NaN, y: 1, z: 2 } },
    ];
    for (const r of junk) expect(() => shake.reading(r)).not.toThrow();
    expect(shake.take()).toEqual({ raise: 0, push: { x: 0, y: 0, z: 0 } });
    expect(shake.active).toBe(false);
  });

  it('becomes active only once a reading with real numbers has arrived', () => {
    const shake = createShake(settings);
    expect(shake.active).toBe(false);
    shake.reading({});
    shake.reading({ timeSec: 0, acceleration: { x: Number.NaN, y: null, z: undefined } });
    expect(shake.active).toBe(false);
    shake.reading(at(0, 1));
    expect(shake.active).toBe(true);
  });
});
