// XMAS-31a "Scene core engine and reference pictures": the reference
// renderer, the deliberate update command (`pnpm frames:update`), the check
// `pnpm run test:unit` runs, and the loopback address `pnpm frames` serves on.
// Pictures are PNGs written with tools/png.ts; only the update command writes them.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BASE_ROWS } from '../src/scene/base-fine.ts';
import { sceneFrame } from '../src/scene/frame.ts';
import { BASE_SINK } from '../src/scene/globe.ts';
import { fineFrame } from './fine-frames.ts';
import { drawSanta } from '../src/scene/santa.ts';
import type { PhaseName } from '../src/shared/clock.ts';
import { framesAddress, referenceFrames, referenceProblems, renderReference, updateReferences } from './frames.ts';
import { decodePng, encodePng } from './png.ts';
import { useTempDirs } from '../tests/helpers/temp.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = [
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
];
/** XMAS-32e: the turned pictures, each a steady phase at a turn other than 0. */
const TURNED: [string, PhaseName, number][] = [
  ['purple-night-turn-90', 'purple-night', Math.PI / 2],
  ['purple-night-turn-180', 'purple-night', Math.PI],
  ['purple-night-turn-270', 'purple-night', (3 * Math.PI) / 2],
  ['frosty-morning-turn-180', 'frosty-morning', Math.PI],
  ['purple-night-turn-45', 'purple-night', Math.PI / 4],
  ['purple-night-turn-135', 'purple-night', (3 * Math.PI) / 4],
  ['purple-night-turn-0-5-rad', 'purple-night', 0.5],
  ['purple-night-turn-1-5-rad', 'purple-night', 1.5],
  ['purple-night-turn-2-5-rad', 'purple-night', 2.5],
  ['purple-night-turn-4-rad', 'purple-night', 4],
];
const FILES = [...NAMES, 'preview'].map((n) => `${n}.png`).sort();
const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];

const tempDir = useTempDirs('xmas-frames-');

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).sort()) out[f] = readFileSync(path.join(dir, f)).toString('base64');
  return out;
}

function refByName(name: string) {
  const ref = referenceFrames.find((r) => r.name === name);
  if (ref === undefined) throw new Error(`no reference named ${name}`);
  return ref;
}

describe('referenceFrames', () => {
  it('lists one picture per phase, one mid-blend, then the turned pictures, by name', () => {
    expect(referenceFrames.map((r) => r.name)).toEqual(NAMES);
  });

  it.each(PHASES)('holds %s steady at a fixed pretend clock and seed', (p) => {
    const { input } = refByName(p);
    expect(input.phase).toEqual({ from: p, to: p, share: 0 });
    expect(Number.isInteger(input.seed)).toBe(true);
    expect(Number.isFinite(input.time)).toBe(true);
  });

  it('holds the blend picture at exactly half way from sunset to purple night', () => {
    expect(refByName('sunset-to-purple-night').input.phase).toEqual({ from: 'sunset', to: 'purple-night', share: 0.5 });
  });

  it.each([...PHASES, 'sunset-to-purple-night'])('keeps %s at turn 0', (name) => {
    expect(refByName(name).input.turn ?? 0).toBe(0);
  });

  it.each(TURNED)('holds %s steady in %s at turn %s, with the same clock, seed and size as the turn-0 picture', (name, phase, turn) => {
    const { input } = refByName(name);
    const base = refByName(phase).input;
    expect(input.phase).toEqual({ from: phase, to: phase, share: 0 });
    expect(input.turn).toBeCloseTo(turn, 12);
    expect([input.time, input.seed, input.width, input.height, input.drag]).toEqual([base.time, base.seed, base.width, base.height, base.drag]);
  });

  it.each(TURNED)('draws %s differently from its turn-0 picture inside the glass and identically outside it', (name, phase) => {
    const turned = sceneFrame(refByName(name).input);
    const flat = sceneFrame(refByName(phase).input);
    const { cx, cy, radius } = flat.layout.globe;
    let inside = 0;
    for (let i = 0; i < flat.picture.length; i++) {
      if (turned.picture[i] === flat.picture[i]) continue;
      const x = i % flat.width;
      const y = Math.floor(i / flat.width);
      const inGlass = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius ** 2;
      // The lettering wraps round the base with the turn (XMAS-68), so the base's box may change too.
      const onBase = y >= flat.layout.groundTop - BASE_SINK && y < flat.layout.groundTop - BASE_SINK + BASE_ROWS && Math.abs(x + 0.5 - cx) <= radius;
      if (inGlass) inside++;
      else if (!onBase) expect.fail(`${name}: pixel ${x},${y} outside the glass and base differs from ${phase}`);
    }
    expect(inside, `${name}: pixels inside the glass that differ from ${phase}`).toBeGreaterThan(50);
  });

  it.each(TURNED)('shows Santa in %s: his drawing\'s colours are in the glass', (name) => {
    const ref = refByName(name);
    const frame = sceneFrame(ref.input);
    const turn = ref.input.turn ?? 0;
    // Santa alone over two plain backgrounds: pixels he wholly covers come out the same over both.
    const a = new Uint32Array(frame.picture.length).fill(0x010203);
    const b = new Uint32Array(frame.picture.length).fill(0xfdfcfb);
    drawSanta(a, frame.width, frame.layout, turn, ref.input.time);
    drawSanta(b, frame.width, frame.layout, turn, ref.input.time);
    const whole: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] === b[i] && a[i] !== 0x010203) whole.push(i);
    expect(whole.length, `${name}: Santa drawn`).toBeGreaterThan(0);
    // A reflection or a shape in front may cover part of him; some of him must show.
    const shown = whole.filter((i) => frame.picture[i] === a[i]).length;
    expect(shown, `${name}: Santa's wholly covered pixels shown in the frame (of ${whole.length})`).toBeGreaterThanOrEqual(3);
  });
});

describe('renderReference', () => {
  it.each(NAMES)('renders %s as an opaque PNG of the fine layer at zoom 5, pixel for pixel', (name) => {
    const ref = refByName(name);
    const png = decodePng(renderReference(ref));
    const fine = fineFrame(ref.input, 5);
    expect(png.width).toBe(ref.input.width * 5);
    expect(png.height).toBe(ref.input.height * 5);
    expect([png.width, png.height]).toEqual([650, 1300]);
    for (let i = 0; i < fine.rgba.length; i += 4) {
      const got = [png.rgba[i], png.rgba[i + 1], png.rgba[i + 2], png.rgba[i + 3]];
      if (got.join() !== [fine.rgba[i], fine.rgba[i + 1], fine.rgba[i + 2], 255].join()) expect.fail(`${name}: pixel ${i / 4} differs`);
    }
  });

  it('renders the same bytes every time', () => {
    const ref = refByName('purple-night');
    expect(Buffer.from(renderReference(ref)).equals(Buffer.from(renderReference(ref)))).toBe(true);
  });
});

describe('updateReferences and referenceProblems', () => {
  /** A folder updateReferences wrote, after checking it wrote every picture. */
  function updatedDir(): string {
    const dir = tempDir();
    const written = updateReferences(dir);
    expect(written.map((f) => path.basename(f)).sort()).toEqual(FILES);
    return dir;
  }

  // Rendering every reference is slow, so it is done once here; each test gets its own copy.
  let golden = '';
  beforeAll(() => {
    golden = updatedDir();
  }, 120_000);

  /** A folder of its own holding what updateReferences writes. */
  function freshDir(): string {
    const dir = tempDir();
    cpSync(golden, dir, { recursive: true });
    return dir;
  }

  it('writes exactly one PNG per reference, which then matches', () => {
    const dir = updatedDir();
    expect(readdirSync(dir).sort()).toEqual(FILES);
    expect(referenceProblems(dir)).toEqual([]);
  });

  it('names a missing picture and the command that makes it', () => {
    const dir = freshDir();
    rmSync(path.join(dir, 'sunset.png'));
    const problems = referenceProblems(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('sunset.png');
    expect(problems[0]).toContain('frames:update');
  });

  it('reports every picture when the folder is empty or missing, without throwing', () => {
    expect(referenceProblems(tempDir())).toHaveLength(NAMES.length + 1);
    expect(referenceProblems(path.join(tempDir(), 'nope'))).toHaveLength(NAMES.length + 1);
  });

  it('fails a one-pixel mismatch and names only that picture', () => {
    const dir = freshDir();
    const file = path.join(dir, 'frosty-morning.png');
    const png = decodePng(new Uint8Array(readFileSync(file)));
    png.rgba[0] = (png.rgba[0] ?? 0) ^ 1;
    writeFileSync(file, encodePng(png.width, png.height, png.rgba));
    const problems = referenceProblems(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('frosty-morning');
    expect(problems[0]).not.toContain('purple-night');
  });

  it('fails a picture of the wrong size and names it', () => {
    const dir = freshDir();
    writeFileSync(path.join(dir, 'purple-night.png'), encodePng(1, 1, Uint8Array.from([0, 0, 0, 255])));
    const problems = referenceProblems(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('purple-night');
  });

  it('fails an unreadable picture and names it, without throwing', () => {
    const dir = freshDir();
    writeFileSync(path.join(dir, 'dawn.png'), 'not a png');
    const problems = referenceProblems(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('dawn');
  });

  it('names a stale picture that is no longer a reference', () => {
    const dir = freshDir();
    writeFileSync(path.join(dir, 'old-phase.png'), readFileSync(path.join(dir, 'dawn.png')));
    const problems = referenceProblems(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('old-phase.png');
  });

  it('never writes: a failing check leaves the folder byte for byte as it was', () => {
    const dir = freshDir();
    rmSync(path.join(dir, 'sunset.png'));
    writeFileSync(path.join(dir, 'dawn.png'), 'not a png');
    const before = snapshot(dir);
    referenceProblems(dir);
    expect(snapshot(dir)).toEqual(before);
  });

  it('rewrites a mismatched picture back to the current render when updating', () => {
    const dir = freshDir();
    writeFileSync(path.join(dir, 'dawn.png'), 'not a png');
    updateReferences(dir);
    expect(referenceProblems(dir)).toEqual([]);
  });
});

// XMAS-31c replaced the all-pictures page: the review page (one picture at a
// time, frames found in the folder at run time) has one smoke test in
// tests/browser/frames-review.spec.ts.

describe('framesAddress', () => {
  it('stays on loopback when HOST is unset or empty, like pnpm dev', () => {
    expect(framesAddress({}).host).toBe('localhost');
    expect(framesAddress({ HOST: '' }).host).toBe('localhost');
  });
});

describe('package scripts', () => {
  function scripts(): Record<string, string> {
    return (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
  }

  it('never rewrites the references from pnpm check or test:unit', () => {
    const s = scripts();
    expect(s['frames:update'], 'frames:update must exist on its own').toBeTypeOf('string');
    for (const name of ['check', 'test:unit', 'build', 'typecheck']) {
      expect(s[name] ?? '', name).not.toMatch(/frames:update|frames-update/);
    }
  });
});

describe('the CLIs', () => {
  function run(script: string, args: string[], env: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [path.join(ROOT, 'tools', script), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 60_000,
    });
  }

  it('frames-update writes every reference into the folder it is given, and they match', () => {
    const dir = tempDir();
    const result = run('frames-update.ts', [dir]);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(FILES);
    expect(referenceProblems(dir)).toEqual([]);
  });
});
