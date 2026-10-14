// XMAS-32d "The globe", slice 4: the auto turn. No visitor input turns the
// globe yet, so the page turns it slowly by itself: autoTurn(timeMs) is the
// turn in radians, 0.5 + t * 2π / 60 with t = timeMs / 1000 (one full turn a
// minute), finite for any finite time >= 0 and continuous: it is never folded
// back into [0, 2π), so it never jumps (drawGlobe folds it itself).
import { describe, expect, it } from 'vitest';
import { autoTurn } from './turn.ts';

const FULL = 2 * Math.PI;

describe('autoTurn', () => {
  it('starts at 0.5 rad at time 0', () => {
    expect(autoTurn(0)).toBeCloseTo(0.5, 12);
  });

  it.each([1, 1_000, 15_000, 30_000, 59_999, 60_000, 123_456])('follows 0.5 + t * 2π / 60 at %s ms', (time) => {
    expect(autoTurn(time)).toBeCloseTo(0.5 + (time / 1000) * (FULL / 60), 9);
  });

  it('turns once a minute: a minute later is exactly one full turn on, not folded back', () => {
    for (const time of [0, 7_000, 60_000, 3_600_000]) {
      expect(autoTurn(time + 60_000) - autoTurn(time), `from ${time} ms`).toBeCloseTo(FULL, 6);
    }
  });

  it('never jumps, also where the turn passes a whole turn', () => {
    // Where 0.5 + t * 2π / 60 crosses 2π k: a folded turn would jump back by 2π there.
    const crossings = [1, 2, 3, 100].map((k) => ((FULL * k - 0.5) / (FULL / 60)) * 1000);
    const step = 1000 / 60;
    for (const c of crossings) {
      for (let time = Math.max(0, c - 5 * step); time < c + 5 * step; time += step) {
        const change = autoTurn(time + step) - autoTurn(time);
        expect(change, `at ${time.toFixed(1)} ms`).toBeGreaterThan(0);
        expect(change, `at ${time.toFixed(1)} ms`).toBeCloseTo((step / 1000) * (FULL / 60), 9);
      }
    }
  });

  it('only ever grows, by a small step each 1/60 s', () => {
    let prev = autoTurn(0);
    for (let k = 1; k <= 4_000; k++) {
      const next = autoTurn((k * 1000) / 60);
      expect(next).toBeGreaterThan(prev);
      expect(next - prev).toBeLessThan(0.002);
      prev = next;
    }
  });

  it('stays finite for a huge time', () => {
    for (const time of [8.64e7, 3.15e10, 1e15, Number.MAX_SAFE_INTEGER]) {
      expect(Number.isFinite(autoTurn(time)), `${time} ms`).toBe(true);
    }
  });

  it('gives the same turn for the same time', () => {
    expect(autoTurn(42_424)).toBe(autoTurn(42_424));
  });
});
