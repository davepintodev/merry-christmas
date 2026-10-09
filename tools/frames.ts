// XMAS-31a "Scene core engine and reference pictures": the reference
// renderer, the deliberate update command (`pnpm frames:update`) and the check
// `pnpm run test:unit` runs. Pictures are PNGs written with tools/png.ts; only
// the update command writes them. The `pnpm frames` review page and its
// server live in tools/frames-review.ts and tools/frames-serve.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sceneFrame, type SceneInput } from '../src/scene/frame.ts';
import { decodePng, encodePng } from './png.ts';

/** One reference picture: stored as tests/frames/<name>.png. */
export interface ReferenceFrame { name: string; input: SceneInput }

/** The picture size, seed and pretend clock every reference shares. */
const SIZE = { width: 130, height: 260 };
const SEED = 31;
const TIME = 1_234_567;

/** The fixed reference pictures: one per phase and one mid-blend. */
export const referenceFrames: readonly ReferenceFrame[] = [
  ...(['dawn', 'frosty-morning', 'sunset', 'purple-night'] as const).map(
    (phase): ReferenceFrame => ({
      name: phase,
      input: { time: TIME, drag: 0, phase: { from: phase, to: phase, share: 0 }, seed: SEED, ...SIZE },
    }),
  ),
  {
    name: 'sunset-to-purple-night',
    input: { time: TIME, drag: 0, phase: { from: 'sunset', to: 'purple-night', share: 0.5 }, seed: SEED, ...SIZE },
  },
];

/** The reference's pixels as RGBA bytes, straight from the scene. */
function referenceRgba(ref: ReferenceFrame): { width: number; height: number; rgba: Uint8Array } {
  const frame = sceneFrame(ref.input);
  const rgba = new Uint8Array(frame.width * frame.height * 4);
  for (let i = 0; i < frame.picture.length; i++) {
    const colour = frame.picture[i] ?? 0;
    rgba[i * 4] = (colour >> 16) & 0xff;
    rgba[i * 4 + 1] = (colour >> 8) & 0xff;
    rgba[i * 4 + 2] = colour & 0xff;
    rgba[i * 4 + 3] = 0xff;
  }
  return { width: frame.width, height: frame.height, rgba };
}

/** The reference picture as PNG bytes (RGBA, opaque), rendered without a browser. */
export function renderReference(ref: ReferenceFrame): Uint8Array {
  const { width, height, rgba } = referenceRgba(ref);
  return encodePng(width, height, rgba);
}

/** Writes every reference picture into dir; returns the files written. */
export function updateReferences(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  return referenceFrames.map((ref) => {
    const file = path.join(dir, `${ref.name}.png`);
    writeFileSync(file, renderReference(ref));
    return file;
  });
}

/** True when two RGBA byte blocks are the same pixel for pixel. */
function sameRgba(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** One message per missing, mismatched, unreadable or stale picture in dir, each naming it; [] when all match. Never writes. */
export function referenceProblems(dir: string): string[] {
  const problems: string[] = [];
  const wanted = new Set(referenceFrames.map((ref) => `${ref.name}.png`));
  for (const ref of referenceFrames) {
    const name = `${ref.name}.png`;
    const file = path.join(dir, name);
    if (!existsSync(file)) {
      problems.push(`${name} is missing; run pnpm frames:update to write it`);
      continue;
    }
    let problem: string | null = null;
    try {
      const png = decodePng(new Uint8Array(readFileSync(file)));
      const want = referenceRgba(ref);
      if (png.width !== want.width || png.height !== want.height) {
        problem = `${name} is ${png.width} x ${png.height}, but the scene renders ${want.width} x ${want.height}`;
      } else if (!sameRgba(png.rgba, want.rgba)) {
        problem = `${name} does not match the scene as it renders now`;
      }
    } catch {
      problem = `${name} is not a readable PNG`;
    }
    if (problem !== null) problems.push(`${problem}; run pnpm frames:update to replace it`);
  }
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    // A missing folder has nothing but the missing pictures above.
  }
  for (const file of files) {
    if (file.endsWith('.png') && !wanted.has(file)) {
      problems.push(`${file} is no longer a reference; delete it or run pnpm frames:update`);
    }
  }
  return problems;
}

/** The port `pnpm frames` uses when PORT is unset or empty. */
const DEFAULT_PORT = 8124;

/** The address `pnpm frames` serves on: HOST (loopback when unset) and PORT. */
export function framesAddress(env: Record<string, string | undefined>): { host: string; port: number } {
  const host = env.HOST === undefined || env.HOST === '' ? 'localhost' : env.HOST;
  const raw = env.PORT;
  if (raw === undefined || raw === '') return { host, port: DEFAULT_PORT };
  if (!/^\d+$/.test(raw)) throw new RangeError(`PORT must be a whole number between 1 and 65535, got '${raw}'`);
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new RangeError(`PORT must be between 1 and 65535, got '${raw}'`);
  return { host, port };
}
