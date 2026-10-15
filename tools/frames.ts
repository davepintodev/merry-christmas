// XMAS-31a "Scene core engine and reference pictures": the reference
// renderer, the deliberate update command (`pnpm frames:update`) and the check
// `pnpm run test:unit` runs. Pictures are PNGs written with tools/png.ts; only
// the update command writes them. XMAS-85: each picture is the fine layer's
// (tools/fine-frames.ts) at the fixed zoom REFERENCE_ZOOM, so it is larger than
// the art. The `pnpm frames` review page and its server live in
// tools/frames-review.ts and tools/frames-serve.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeSnowRuntime } from '../src/page/snow-runtime.ts';
import type { SceneInput } from '../src/scene/frame.ts';
import type { PhaseName } from '../src/shared/clock.ts';
import { fineFrame, type FineRgba } from './fine-frames.ts';
import { decodePng, encodePng } from './png.ts';

/** One reference picture: stored as tests/frames/<name>.png. */
export interface ReferenceFrame { name: string; input: SceneInput }

/** The picture size, seed and pretend clock every reference shares. */
const SIZE = { width: 130, height: 260 };
const SEED = 31;
const TIME = 1_234_567;
/** The fixed zoom of every reference: 5 screen pixels per art pixel (art/STYLE.md). */
const REFERENCE_ZOOM = 5;

/**
 * The snow reference's input: the page's snow runtime run for `steps` steps at the shared size and seed, the stir
 * raised for the first `raiseSteps` of them. The snows are the ones the page would draw at that point.
 */
function snowInput(phase: PhaseName, christmasDay: boolean, steps: number, raiseSteps = 0, raise = 0): SceneInput {
  const runtime = makeSnowRuntime(SEED);
  for (let k = 0; k < steps; k++) {
    runtime.step({ turn: 0, christmasDay, ...SIZE, raise: k < raiseSteps ? raise : 0 });
  }
  return {
    time: TIME,
    drag: 0,
    phase: { from: phase, to: phase, share: 0 },
    seed: SEED,
    ...SIZE,
    snow: runtime.snow ?? undefined,
    outsideSnow: runtime.outsideSnow ?? undefined,
  };
}

/** The fixed reference pictures: one per phase, one mid-blend, the globe at other turn angles (degrees and radians) and the snow. */
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
  ...(
    [
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
    ] as const
  ).map(
    ([name, phase, turn]): ReferenceFrame => ({
      name,
      input: { time: TIME, drag: 0, turn, phase: { from: phase, to: phase, share: 0 }, seed: SEED, ...SIZE },
    }),
  ),
  { name: 'snow-calm', input: snowInput('purple-night', false, 600) },
  { name: 'snow-mid-stir', input: snowInput('purple-night', false, 60, 30, 0.03) },
  { name: 'snow-christmas-day', input: snowInput('purple-night', true, 600) },
];

/** The reference's pixels as RGBA bytes: the fine layer's picture at REFERENCE_ZOOM, drawn without a browser. */
function referenceRgba(ref: ReferenceFrame): FineRgba {
  return fineFrame(ref.input, REFERENCE_ZOOM);
}

/** The reference picture as PNG bytes (RGBA, opaque), at the zoom-5 size of the fine layer. */
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
