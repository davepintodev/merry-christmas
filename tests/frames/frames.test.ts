// XMAS-31a "Scene core engine and reference pictures": the committed
// reference pictures in this folder, compared with the scene rendered now.
// A mismatch fails and names the picture; to accept a change on purpose run
// `pnpm frames:update`, the only command that rewrites them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GLOBE_SNOW, SNOW_SETTINGS } from '../../src/scene/snow.ts';
import { sceneFrame } from '../../src/scene/frame.ts';
import { referenceFrames, referenceProblems } from '../../tools/frames.ts';
import { decodePng } from '../../tools/png.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));

describe('reference pictures in tests/frames', () => {
  it('has one reference per phase, one mid-blend, then the turned pictures (XMAS-32e) and the snow (XMAS-36b3)', () => {
    expect(referenceFrames.map((r) => r.name)).toEqual([
      'dawn',
      'frosty-morning',
      'sunset',
      'purple-night',
      'sunset-to-purple-night',
      'purple-night-turn-90',
      'purple-night-turn-180',
      'purple-night-turn-270',
      'frosty-morning-turn-180',
      'purple-night-turn-45',
      'purple-night-turn-135',
      'purple-night-turn-0-5-rad',
      'purple-night-turn-1-5-rad',
      'purple-night-turn-2-5-rad',
      'purple-night-turn-4-rad',
      'snow-calm',
      'snow-mid-stir',
      'snow-christmas-day',
    ]);
  });

  it('the snow pictures carry both snows: calm at rest, mid-stir between calm and the most, Christmas Day with the bigger amounts', () => {
    const input = (name: string) => referenceFrames.find((r) => r.name === name)?.input;
    const calm = input('snow-calm');
    const mid = input('snow-mid-stir');
    const day = input('snow-christmas-day');
    expect(calm?.snow?.flakes.length).toBe(GLOBE_SNOW.ordinary.flakes);
    expect(mid?.snow?.flakes.length).toBe(GLOBE_SNOW.ordinary.flakes);
    expect(day?.snow?.flakes.length).toBe(GLOBE_SNOW.christmasDay.flakes);
    for (const i of [calm, mid, day]) expect(i?.outsideSnow, 'outside snow is passed').toBeDefined();
    expect(calm?.snow?.stir ?? 1).toBeLessThan(0.05);
    expect(mid?.snow?.stir ?? 0).toBeGreaterThan(0.2);
    expect(mid?.snow?.stir ?? 9).toBeLessThan(SNOW_SETTINGS.maxStir * 0.9);
    expect(day?.outsideSnow?.flakes.length ?? 0).toBeGreaterThan(calm?.outsideSnow?.flakes.length ?? Infinity);
  });

  it('every reference picture differs from every other', () => {
    const pictures = referenceFrames.map((r) => ({ name: r.name, picture: sceneFrame(r.input).picture }));
    for (let i = 0; i < pictures.length; i++) {
      for (let j = i + 1; j < pictures.length; j++) {
        const [a, b] = [pictures[i], pictures[j]];
        if (a === undefined || b === undefined) continue;
        expect(a.picture.some((c, k) => c !== b.picture[k]), `${a.name} and ${b.name} are the same picture`).toBe(true);
      }
    }
  });

  it('are the fine layer at the fixed zoom 5: every committed picture is 650 x 1300', () => {
    for (const r of referenceFrames) {
      const png = decodePng(new Uint8Array(readFileSync(path.join(DIR, `${r.name}.png`))));
      expect([r.name, png.width, png.height]).toEqual([r.name, 650, 1300]);
    }
  });

  it('match the scene as it renders now', () => {
    expect(referenceProblems(DIR), 'run `pnpm frames:update` only if the change is meant').toEqual([]);
  });
});
