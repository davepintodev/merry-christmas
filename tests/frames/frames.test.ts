// XMAS-31a "Scene core engine and reference pictures": the committed
// reference pictures in this folder, compared with the scene rendered now.
// A mismatch fails and names the picture; to accept a change on purpose run
// `pnpm frames:update`, the only command that rewrites them.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { referenceFrames, referenceProblems } from '../../tools/frames.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));

describe('reference pictures in tests/frames', () => {
  it('has one reference per phase and one mid-blend', () => {
    expect(referenceFrames.map((r) => r.name)).toEqual(['dawn', 'frosty-morning', 'sunset', 'purple-night', 'sunset-to-purple-night']);
  });

  it('match the scene as it renders now', () => {
    expect(referenceProblems(DIR), 'run `pnpm frames:update` only if the change is meant').toEqual([]);
  });
});
