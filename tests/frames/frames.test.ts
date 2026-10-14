// XMAS-31a "Scene core engine and reference pictures": the committed
// reference pictures in this folder, compared with the scene rendered now.
// A mismatch fails and names the picture; to accept a change on purpose run
// `pnpm frames:update`, the only command that rewrites them.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sceneFrame } from '../../src/scene/frame.ts';
import { referenceFrames, referenceProblems } from '../../tools/frames.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));

describe('reference pictures in tests/frames', () => {
  it('has one reference per phase, one mid-blend, then the turned pictures (XMAS-32e)', () => {
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
    ]);
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

  it('match the scene as it renders now', () => {
    expect(referenceProblems(DIR), 'run `pnpm frames:update` only if the change is meant').toEqual([]);
  });
});
