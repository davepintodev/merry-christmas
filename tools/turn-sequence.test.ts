// XMAS-85: tools/turn-sequence.ts, run as the CLI (`pnpm run frames:turn <dir>`),
// which has no exports: its output folder is what is checked.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fineFrame } from './fine-frames.ts';
import { referenceFrames } from './frames.ts';
import { decodePng } from './png.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const run = (args: string[]) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'turn-sequence.ts'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });

describe('turn-sequence', () => {
  it('without a folder argument prints usage and exits 1, writing nothing', () => {
    const r = run([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('usage');
    expect(r.stdout).toBe('');
  });

  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'xmas-turn-')), 'nested', 'out');
  temps.push(path.dirname(path.dirname(dir)));
  let result: ReturnType<typeof run>;
  beforeAll(() => {
    result = run([dir]);
  }, 180_000);

  it('exits 0 and creates the folder, even a nested one that does not exist', () => {
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(dir)).toBe(true);
  });

  it('writes 72 numbered frames, a contact sheet and an index, nothing else', () => {
    const files = readdirSync(dir).sort();
    const frames = Array.from({ length: 72 }, (_, n) => `frame-${String(n).padStart(2, '0')}.png`);
    expect(files).toEqual([...frames, 'contact-sheet.png', 'index.txt'].sort());
  });

  it('indexes the frames in order at 5 degree steps from 0 to 355, none repeated', () => {
    const lines = readFileSync(path.join(dir, 'index.txt'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(72);
    lines.forEach((line, n) => expect(line).toBe(`frame-${String(n).padStart(2, '0')}.png ${n * 5}`));
    expect(lines.at(-1)).toContain(' 355');
  });

  it('writes each frame as a 650 x 1300 PNG of the fine layer at that turn of snow-calm', () => {
    const calm = referenceFrames.find((r) => r.name === 'snow-calm');
    if (calm === undefined) throw new Error('no snow-calm');
    for (const n of [0, 18, 71]) {
      const png = decodePng(new Uint8Array(readFileSync(path.join(dir, `frame-${String(n).padStart(2, '0')}.png`))));
      expect([png.width, png.height]).toEqual([650, 1300]);
      const want = fineFrame({ ...calm.input, turn: (n * 5 * Math.PI) / 180 });
      expect(Buffer.from(png.rgba).equals(Buffer.from(want.rgba)), `frame ${n} is not the fine frame at ${n * 5} degrees`).toBe(true);
    }
  });

  it('the frames all differ from one another at a quarter turn apart and frame 0 differs from frame 36', () => {
    const read = (n: number) => readFileSync(path.join(dir, `frame-${String(n).padStart(2, '0')}.png`));
    const files = [0, 18, 36, 54].map(read);
    for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) expect((files[i] as Buffer).equals(files[j] as Buffer)).toBe(false);
  });

  it('writes a contact sheet at most 4000 pixels wide, 9 frames across and 8 rows, opaque, with white gutters', () => {
    const sheet = decodePng(new Uint8Array(readFileSync(path.join(dir, 'contact-sheet.png'))));
    expect(sheet.width).toBeLessThanOrEqual(4000);
    expect(sheet.width).toBeGreaterThan(1000);
    // 9 columns of a whole-number scale of 650 wide, 4 pixel gutters.
    const cell = (sheet.width - 8 * 4) / 9;
    expect(Number.isInteger(cell)).toBe(true);
    expect(650 / cell).toBeGreaterThanOrEqual(1);
    expect(sheet.height).toBe(8 * Math.floor(1300 / (650 / cell)) + 7 * 4);
    for (let i = 3; i < sheet.rgba.length; i += 4 * 1013) expect(sheet.rgba[i]).toBe(255);
    // The first gutter column is white all the way down.
    for (const y of [0, 100, sheet.height - 1]) {
      const i = (y * sheet.width + cell + 1) * 4;
      expect([sheet.rgba[i], sheet.rgba[i + 1], sheet.rgba[i + 2]]).toEqual([255, 255, 255]);
    }
  });
});
