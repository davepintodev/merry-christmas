// XMAS-46a: the pure sound model. Settings are named constants; the master gain
// fades in over 1 s and out over 0.3 s; stir chimes grow with stir, are capped,
// draw their notes from the settings and are deterministic for a random source.
import { describe, expect, it } from 'vitest';
import { SOUND_SETTINGS, masterGain, stirChimes } from './sound-model.ts';

/** A seeded, repeatable random source in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const STIRS = [0, 0.1, 0.3, 0.6, 0.9, 1.2, 1.6];

describe('SOUND_SETTINGS', () => {
  it('exports the levels, notes, fades and stir mapping as one named constant', () => {
    expect(SOUND_SETTINGS.windLevel).toBeGreaterThan(0);
    expect(SOUND_SETTINGS.chimeLayerLevel).toBeGreaterThan(0);
    expect(SOUND_SETTINGS.chimeNotes.length).toBeGreaterThan(0);
    expect(SOUND_SETTINGS.chimeNotes.every((hz) => hz > 0)).toBe(true);
    expect(SOUND_SETTINGS.fadeInSeconds).toBe(1);
    expect(SOUND_SETTINGS.fadeOutSeconds).toBe(0.3);
    expect(SOUND_SETTINGS.maxChimes).toBeGreaterThan(0);
    expect(SOUND_SETTINGS.maxChimeGain).toBeGreaterThan(0);
    expect(SOUND_SETTINGS.calmStir).toBeGreaterThanOrEqual(0);
  });
});

describe('masterGain', () => {
  it('unmuting targets the full level over 1 s', () => {
    const g = masterGain(true);
    expect(g.target).toBe(1);
    expect(g.seconds).toBe(1);
  });

  it('muting targets 0 over 0.3 s', () => {
    expect(masterGain(false)).toEqual({ target: 0, seconds: 0.3 });
  });
});

describe('stirChimes', () => {
  it('returns nothing for a calm stir', () => {
    expect(stirChimes(0, false, seeded(1))).toEqual([]);
    expect(stirChimes(SOUND_SETTINGS.calmStir, false, seeded(1))).toEqual([]);
  });

  it('returns nothing while paused, even at full stir', () => {
    expect(stirChimes(1.6, true, seeded(1))).toEqual([]);
  });

  it('gives a strong stir some chimes', () => {
    expect(stirChimes(1.6, false, seeded(1)).length).toBeGreaterThan(0);
  });

  it('a stronger stir never gives fewer or quieter chimes than a weaker one', () => {
    for (const seed of [1, 7, 42]) {
      let prevCount = 0;
      let prevGain = 0;
      for (const stir of STIRS) {
        const chimes = stirChimes(stir, false, seeded(seed));
        const total = chimes.reduce((a, c) => a + c.gain, 0);
        expect(chimes.length).toBeGreaterThanOrEqual(prevCount);
        expect(total).toBeGreaterThanOrEqual(prevGain - 1e-9);
        prevCount = chimes.length;
        prevGain = total;
      }
    }
  });

  it('caps the count and each gain, even for a stir beyond the range', () => {
    for (const stir of [1.6, 5, 1000]) {
      const chimes = stirChimes(stir, false, seeded(3));
      expect(chimes.length).toBeLessThanOrEqual(SOUND_SETTINGS.maxChimes);
      for (const c of chimes) {
        expect(c.gain).toBeGreaterThan(0);
        expect(c.gain).toBeLessThanOrEqual(SOUND_SETTINGS.maxChimeGain);
        expect(c.delay).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('takes every note from the settings, whatever the random source returns', () => {
    for (const r of [0, 0.5, 0.999999]) {
      for (const c of stirChimes(1.6, false, () => r)) {
        expect(SOUND_SETTINGS.chimeNotes).toContain(c.hz);
      }
    }
  });

  it('still picks a defined note when the random source returns exactly 1', () => {
    const chimes = stirChimes(1.6, false, () => 1);
    expect(chimes.length).toBeGreaterThan(0);
    for (const c of chimes) {
      expect(c.hz).toBeDefined();
      expect(SOUND_SETTINGS.chimeNotes).toContain(c.hz);
    }
  });

  it('gives the same result for the same random source', () => {
    expect(stirChimes(1.2, false, seeded(9))).toEqual(stirChimes(1.2, false, seeded(9)));
  });

  it('gives a different result for a different random source, so the source is really used', () => {
    expect(stirChimes(1.2, false, seeded(9))).not.toEqual(stirChimes(1.2, false, seeded(10)));
  });

  it('treats bad input (NaN, negative, infinite-negative stir) as calm: returns []', () => {
    expect(stirChimes(Number.NaN, false, seeded(1))).toEqual([]);
    expect(stirChimes(-0.5, false, seeded(1))).toEqual([]);
    expect(stirChimes(-Infinity, false, seeded(1))).toEqual([]);
  });
});
