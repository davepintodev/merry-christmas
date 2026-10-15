// XMAS-31c "Frames review page": the pure logic behind the `pnpm frames`
// review page, without a browser: the frame list read from the folder at run
// time, each frame's display name, the whole-number scale it is shown at,
// and the result string the owner copies back.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { displayName, frameList, frameScale, resultString, type ReviewEntry } from './frames-review.ts';
import { encodePng } from './png.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'xmas-review-'));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const TINY = encodePng(1, 1, Uint8Array.from([1, 2, 3, 255]));

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).sort()) {
    const file = path.join(dir, f);
    try {
      out[f] = readFileSync(file).toString('base64');
    } catch {
      out[f] = '<folder>';
    }
  }
  return out;
}

describe('displayName', () => {
  it.each([
    ['sunset.png', 'Sunset'],
    ['dawn.png', 'Dawn'],
    ['purple-night.png', 'Purple night'],
    ['frosty-morning.png', 'Frosty morning'],
    ['sunset-to-purple-night.png', 'Sunset to purple night'],
  ])('names %s as %j', (file, name) => {
    expect(displayName(file)).toBe(name);
  });
});

describe('frameList', () => {
  it('lists every PNG in the folder, sorted by file name, with its display name', () => {
    const dir = tempDir();
    for (const f of ['sunset.png', 'dawn.png', 'frosty-morning.png']) writeFileSync(path.join(dir, f), TINY);
    expect(frameList(dir)).toEqual([
      { file: 'dawn.png', name: 'Dawn' },
      { file: 'frosty-morning.png', name: 'Frosty morning' },
      { file: 'sunset.png', name: 'Sunset' },
    ]);
  });

  it('skips files that are not PNGs and folders whose name ends in .png', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'dawn.png'), TINY);
    writeFileSync(path.join(dir, 'frames.test.ts'), '// not a picture');
    writeFileSync(path.join(dir, 'notes.txt'), 'hello');
    writeFileSync(path.join(dir, 'dawn.png.bak'), TINY);
    mkdirSync(path.join(dir, 'old.png'));
    expect(frameList(dir).map((f) => f.file)).toEqual(['dawn.png']);
  });

  it('accepts the .png extension in any case, as displayName does, and sorts by file name', () => {
    const dir = tempDir();
    for (const f of ['dawn.png', 'BLIZZARD.PNG', 'sunset.Png']) writeFileSync(path.join(dir, f), TINY);
    writeFileSync(path.join(dir, 'notes.PNG.txt'), 'hello');
    expect(frameList(dir)).toEqual([
      { file: 'BLIZZARD.PNG', name: 'BLIZZARD' },
      { file: 'dawn.png', name: 'Dawn' },
      { file: 'sunset.Png', name: 'Sunset' },
    ]);
  });

  it('reads the folder afresh on every call, so a picture added later appears with no code change', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'sunset.png'), TINY);
    expect(frameList(dir).map((f) => f.file)).toEqual(['sunset.png']);
    writeFileSync(path.join(dir, 'blizzard.png'), TINY);
    expect(frameList(dir).map((f) => f.file)).toEqual(['blizzard.png', 'sunset.png']);
    rmSync(path.join(dir, 'sunset.png'));
    expect(frameList(dir).map((f) => f.file)).toEqual(['blizzard.png']);
  });

  it('gives [] for an empty folder and for a missing one, without throwing', () => {
    expect(frameList(tempDir())).toEqual([]);
    expect(frameList(path.join(tempDir(), 'nope'))).toEqual([]);
  });

  it('lists the committed reference pictures in tests/frames, not a hard-coded phase list', () => {
    expect(frameList(path.join(ROOT, 'tests', 'frames')).map((f) => f.file)).toEqual([
      'dawn.png',
      'frosty-morning-turn-180.png',
      'frosty-morning.png',
      'purple-night-turn-0-5-rad.png',
      'purple-night-turn-1-5-rad.png',
      'purple-night-turn-135.png',
      'purple-night-turn-180.png',
      'purple-night-turn-2-5-rad.png',
      'purple-night-turn-270.png',
      'purple-night-turn-4-rad.png',
      'purple-night-turn-45.png',
      'purple-night-turn-90.png',
      'purple-night.png',
      'snow-calm.png',
      'snow-christmas-day.png',
      'snow-mid-stir.png',
      'sunset-to-purple-night.png',
      'sunset.png',
    ]);
  });

  it('never writes to the folder', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'dawn.png'), TINY);
    writeFileSync(path.join(dir, 'notes.txt'), 'hello');
    const before = snapshot(dir);
    frameList(dir);
    expect(snapshot(dir)).toEqual(before);
  });
});

describe('frameScale', () => {
  const FRAME = { width: 130, height: 260 };

  it('picks the largest whole number of physical pixels per art pixel that fits the room', () => {
    // 1000 / 130 = 7.7 across, 800 / 260 = 3.07 down: the height decides.
    expect(frameScale(FRAME, { width: 1000, height: 800 }, 1)).toEqual({ scale: 3, cssWidth: 390, cssHeight: 780 });
  });

  it('counts physical pixels: a device pixel ratio of 2 doubles the scale, not the CSS size', () => {
    // 2000 / 130 = 15.4 across, 1600 / 260 = 6.15 down.
    expect(frameScale(FRAME, { width: 1000, height: 800 }, 2)).toEqual({ scale: 6, cssWidth: 390, cssHeight: 780 });
  });

  it('lets the width decide for a wide frame in a narrow room', () => {
    // 300 / 100 = 3 across, 900 / 10 = 90 down.
    expect(frameScale({ width: 100, height: 10 }, { width: 300, height: 900 }, 1)).toEqual({ scale: 3, cssWidth: 300, cssHeight: 30 });
  });

  it('fits exactly at the boundary, and drops a whole step one pixel below it', () => {
    expect(frameScale(FRAME, { width: 260, height: 520 }, 1).scale).toBe(2);
    expect(frameScale(FRAME, { width: 260, height: 519 }, 1).scale).toBe(1);
    expect(frameScale(FRAME, { width: 259, height: 520 }, 1).scale).toBe(1);
  });

  it('never goes below 1, even when the room is smaller than the frame or zero', () => {
    expect(frameScale(FRAME, { width: 50, height: 50 }, 1)).toEqual({ scale: 1, cssWidth: 130, cssHeight: 260 });
    expect(frameScale(FRAME, { width: 0, height: 0 }, 1)).toEqual({ scale: 1, cssWidth: 130, cssHeight: 260 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('reads a device pixel ratio of %s as 1', (dpr) => {
    expect(frameScale(FRAME, { width: 1000, height: 800 }, dpr)).toEqual(frameScale(FRAME, { width: 1000, height: 800 }, 1));
  });

  it('gives a nonsense room the smallest scale, not NaN', () => {
    const got = frameScale(FRAME, { width: Number.NaN, height: -5 }, 1);
    expect(got).toEqual({ scale: 1, cssWidth: 130, cssHeight: 260 });
  });

  it('is always a whole number that fits, and the next whole number would not', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      for (const width of [320, 375, 768, 1024, 1366, 1920]) {
        for (const height of [480, 667, 800, 1080]) {
          const { scale, cssWidth, cssHeight } = frameScale(FRAME, { width, height }, dpr);
          const at = `${width}x${height}@${dpr}`;
          expect(Number.isInteger(scale), at).toBe(true);
          expect(cssWidth, at).toBeCloseTo((FRAME.width * scale) / dpr, 9);
          expect(cssHeight, at).toBeCloseTo((FRAME.height * scale) / dpr, 9);
          if (scale > 1) {
            expect(FRAME.width * scale <= width * dpr && FRAME.height * scale <= height * dpr, at).toBe(true);
          }
          const next = scale + 1;
          expect(FRAME.width * next > width * dpr || FRAME.height * next > height * dpr, at).toBe(true);
        }
      }
    }
  });
});

describe('resultString', () => {
  const e = (name: string, verdict: ReviewEntry['verdict'], comment = ''): ReviewEntry => ({ name, verdict, comment });

  it('matches the example in the ticket', () => {
    expect(resultString([e('Sunset', 'approved'), e('Dawn', 'denied', 'sky too dark')])).toBe(
      'Sunset:Yes, Dawn:Denied with comments: sky too dark',
    );
  });

  it('writes Yes, Denied, Denied with comments and Undecided, one per frame in the order given', () => {
    expect(
      resultString([
        e('Purple night', null),
        e('Dawn', 'denied'),
        e('Sunset', 'approved'),
        e('Frosty morning', 'denied', 'too blue'),
      ]),
    ).toBe('Purple night:Undecided, Dawn:Denied, Sunset:Yes, Frosty morning:Denied with comments: too blue');
  });

  it('gives an empty string for no frames', () => {
    expect(resultString([])).toBe('');
  });

  it('marks every frame Undecided before any judgement', () => {
    expect(resultString([e('Dawn', null), e('Sunset', null)])).toBe('Dawn:Undecided, Sunset:Undecided');
  });

  it('keeps an approved frame at Yes even with a comment', () => {
    expect(resultString([e('Sunset', 'approved', 'lovely')])).toBe('Sunset:Yes');
  });

  it('keeps an undecided frame at Undecided even with a comment', () => {
    expect(resultString([e('Sunset', null, 'thinking')])).toBe('Sunset:Undecided');
  });

  it('treats a denied frame with a blank or whitespace-only comment as Denied with no comment', () => {
    expect(resultString([e('Dawn', 'denied', '')])).toBe('Dawn:Denied');
    expect(resultString([e('Dawn', 'denied', '   \n\t \r\n ')])).toBe('Dawn:Denied');
  });

  it('collapses a newline in the comment to a space and trims it', () => {
    expect(resultString([e('Dawn', 'denied', 'sky\ntoo dark')])).toBe('Dawn:Denied with comments: sky too dark');
    expect(resultString([e('Dawn', 'denied', '  sky\r\ntoo dark \n')])).toBe('Dawn:Denied with comments: sky too dark');
  });

  it('never lets a line break into the result', () => {
    const out = resultString([e('Dawn', 'denied', 'one\ntwo\r\nthree\rfour'), e('Sunset', 'denied', '\nfive\n')]);
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toBe('Dawn:Denied with comments: one two three four, Sunset:Denied with comments: five');
  });

  it('keeps commas, colons and quotes in a comment as typed', () => {
    expect(resultString([e('Dawn', 'denied', 'stars: too many, "too bright"')])).toBe(
      'Dawn:Denied with comments: stars: too many, "too bright"',
    );
  });
});
