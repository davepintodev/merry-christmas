// XMAS-32d "The globe", slice 4: Santa with his sleigh and two reindeer
// circling high inside the globe (XMAS-32 acceptance criteria). He is one flat
// drawing (santa-trot-1 / santa-trot-2, 48 x 12 art pixels, from the Santa
// sheet), always at his full width (squeeze is exactly 1 all the way round),
// mirrored when flying the other way, point-sampled onto whole picture pixels
// (crisp: every pixel is one of his own colours, never a mix; XMAS-75),
// clipped to the glass, and painted in his own colours whatever the phase.
// Nothing is random.
//
// Interface pinned here (from prototype/visual-direction/variant-b.js):
//   santaPlacement(turn, timeMs) -> { angle, x, y, depth, squeeze, mirrored, trot }
//     relative to the globe's centre in art pixels (x right, y down), with
//     t = timeMs / 1000, R = 56, lim = R - 3, orbit = lim * 0.42:
//     angle = 2 + turn + 0.45 t, depth = sin(angle), and x a constant-speed
//     triangle wave: x = orbit * (2 / PI) * asin(cos(angle)), so |x| <= orbit,
//     linear in the angle with a sharp reversal at the ends (where depth is 0
//     and he flips). `orbit` is read off the placement at angle 0 (the formula's
//     reach shrinks so he stays at least 2 art pixels inside the glass),
//     y = -0.46 R + 2 sin(1.3 t) + depth * orbit * tilt (tilt: the ground tilt
//     projectPoint uses for depth), squeeze = 1,
//     mirrored = depth > 0, trot = floor(7 t) % 2.
//   drawSanta(picture, width, layout, turn, timeMs) paints the drawing centred
//   on that placement, mirrored when mirrored, transparent pixels skipped,
//   clipped to the glass circle. Non-finite turn or time: RangeError, picture
//   untouched (as projectShape and drawShapes do).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawings, type Drawing } from '../shared/art.generated.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { sceneFrame, sceneLayout, type SceneLayout } from './frame.ts';
import { drawGlobe } from './globe.ts';
import { drawSanta, santaPlacement } from './santa.ts';
import { projectPoint } from './shapes.ts';
import { createDrag, DRAG_SETTINGS } from '../page/drag.ts';
import { colourAt, FILL_A, FILL_B, overPlain, solid, type Drawn } from '../../tests/helpers/scene.ts';

const BLOCK = 0x123456;
const shapesMode = vi.hoisted(() => ({ block: false }));
vi.mock('./shapes-draw.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shapes-draw.ts')>();
  return {
    ...actual,
    drawShapes: (...args: Parameters<typeof actual.drawShapes>): void => {
      if (!shapesMode.block) return actual.drawShapes(...args);
      // An opaque block over the top of the glass, where Santa flies.
      const [picture, width, layout] = args;
      const { cx, cy, radius } = layout.globe;
      for (let y = Math.round(cy - 45); y < Math.round(cy - 5); y++) {
        for (let x = Math.round(cx - 45); x < Math.round(cx + 45); x++) {
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius - 3) picture[y * width + x] = 0x123456;
        }
      }
    },
  };
});

const W = 240;
const H = 180;
const SEED = 12345;
const FULL = 2 * Math.PI;
const LAYOUT = sceneLayout(W, H, SEED);
const R = 56;
const LIM = R - 3;
/** Santa's reach: his x at angle 0, where the triangle wave is at its extreme (the formula's constant, which shrinks to keep him inside the glass). */
const ORBIT = santaPlacement(-2, 0).x;
/** How far inside the glass circle every opaque pixel's centre must stay, in art pixels. */
const GLASS_MARGIN = 2;
/** The ground tilt the shapes use: a step towards the visitor moves a floor point this far down. */
const TILT = projectPoint(0, 1, 0, 0)[1] - projectPoint(0, 0, 0, 0)[1];
/** One scene step: 60 a second. */
const STEP_MS = 1000 / 60;
/** The most whole pixels any edge of his painted box may jump in one step (transparent edge columns allow a little more than one). */
const WORST_STEP = 2;
/** Seconds Santa takes to go once round his orbit at a fixed turn. */
const ORBIT_SECONDS = FULL / 0.45;

afterEach(() => {
  shapesMode.block = false;
  vi.restoreAllMocks();
});

function drawing(name: string): Drawing {
  const d = drawings[name];
  if (d === undefined) throw new Error(`no drawing ${name}`);
  return d;
}

/** The colour of every opaque pixel of the drawing. */
const opaque = (d: Drawing): number[] => Array.from(d.pixels, (_, i) => colourAt(d, i % d.width, Math.floor(i / d.width))).filter((c) => c >= 0);
const palette = (d: Drawing): Set<number> => new Set(opaque(d));
const opaqueCount = (d: Drawing): number => opaque(d).length;

const TROT = [drawing('santa-trot-1'), drawing('santa-trot-2')] as const;
const SANTA_COLOURS = new Set([...palette(TROT[0]), ...palette(TROT[1])]);

interface Expected { x: number; y: number; depth: number; squeeze: number; mirrored: boolean; trot: 0 | 1 }

/** The placement the interface asks for, worked out here from the formula. */
function expected(turn: number, timeMs: number): Expected {
  const t = timeMs / 1000;
  const angle = 2 + turn + t * 0.45;
  const depth = Math.sin(angle);
  return {
    x: ORBIT * (2 / Math.PI) * Math.asin(Math.cos(angle)),
    y: -R * 0.46 + Math.sin(t * 1.3) * 2 + depth * ORBIT * TILT,
    depth,
    squeeze: 1,
    mirrored: depth > 0,
    trot: (Math.floor(t * 7) % 2) as 0 | 1,
  };
}

/** drawSanta over the two plain backgrounds. */
function drawn(turn: number, timeMs: number, layout: SceneLayout = LAYOUT): Drawn {
  return overPlain(layout, (pic, width) => drawSanta(pic, width, layout, turn, timeMs));
}

function touchedIndexes(d: Drawn): number[] {
  return Array.from(d.a.keys()).filter((i) => d.a[i] !== FILL_A || d.b[i] !== FILL_B);
}

interface Box { left: number; right: number; top: number; bottom: number }

/** The box of the picture indexes in `list`, in picture columns and rows (inclusive). */
function bounds(list: number[], width: number): Box {
  if (list.length === 0) expect.fail('Santa drew nothing');
  const xs = list.map((i) => i % width);
  const ys = list.map((i) => Math.floor(i / width));
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

const box = (d: Drawn): Box => bounds(touchedIndexes(d), d.width);

/** The painted pixels' box on a picture that was filled with FILL_A. */
const pixelBox = (pic: Uint32Array): Box => bounds(Array.from(pic.keys()).filter((i) => pic[i] !== FILL_A), W);

/** The largest difference in any colour channel between two pictures. */
function maxChannelDiff(a: Uint32Array, b: Uint32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) for (const s of [16, 8, 0]) worst = Math.max(worst, Math.abs((((a[i] ?? 0) >> s) & 255) - (((b[i] ?? 0) >> s) & 255)));
  return worst;
}

/** A turn that puts Santa at `angle` at timeMs. */
function turnFor(angle: number, timeMs: number): number {
  return angle - 2 - (timeMs / 1000) * 0.45;
}

/**
 * A (turn, time) at which Santa flies at depth `side` (+1 in front, -1
 * behind), so squeeze is 1 and x is 0, in trot frame `trot`. Sprites are
 * point-sampled onto whole pixels, so any such time lands him on the grid.
 */
function onGrid(side: 1 | -1, trot: 0 | 1): { turn: number; time: number } {
  const time = ((trot + 0.5) / 7) * 1000;
  return { turn: turnFor((side * Math.PI) / 2, time), time };
}

/**
 * The picture Santa should paint, worked out here from the spec: squeeze is 1,
 * so a box of 48 columns by 12 rows at the rounded centre, each column taking
 * the drawing column under it (mirrored when flying the other way), transparent
 * pixels skipped, clipped to the glass.
 */
function reference(turn: number, timeMs: number): Map<number, number> {
  const p = expected(turn, timeMs);
  const d = TROT[p.trot];
  const { cx, cy, radius } = LAYOUT.globe;
  const left = Math.round(cx + p.x - d.width / 2);
  const top = Math.round(cy + p.y - d.height / 2);
  const out = new Map<number, number>();
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const c = colourAt(d, p.mirrored ? d.width - 1 - x : x, y);
      if (c >= 0 && (left + x + 0.5 - cx) ** 2 + (top + y + 0.5 - cy) ** 2 <= radius ** 2) out.set((top + y) * LAYOUT.width + left + x, c);
    }
  }
  return out;
}

const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
const READINGS: [string, PhaseReading][] = [
  ...PHASES.map((p): [string, PhaseReading] => [p, { from: p, to: p, share: 0 }]),
  ['purple-night -> dawn at 0.5', { from: 'purple-night', to: 'dawn', share: 0.5 }],
  ['frosty-morning -> sunset at 0.25', { from: 'frosty-morning', to: 'sunset', share: 0.25 }],
];
const NIGHT: PhaseReading = { from: 'purple-night', to: 'purple-night', share: 0 };

function globe(turn: number, time: number, phase: PhaseReading = NIGHT, layout: SceneLayout = LAYOUT): Uint32Array {
  const pic = new Uint32Array(layout.width * layout.height).fill(FILL_A);
  drawGlobe(pic, layout.width, layout, phase, turn, time);
  return pic;
}

/** The pixels drawSanta touches alone, and those it wholly covers (same colour over two backgrounds). */
function santaAlone(turn: number, time: number): { touched: number[]; whole: Map<number, number> } {
  const d = drawn(turn, time);
  const list = touchedIndexes(d);
  return { touched: list, whole: new Map(list.filter((i) => solid(d, i)).map((i) => [i, d.a[i] ?? 0])) };
}

/** The columns the drawing's opaque pixels span, first to last. */
function opaqueColumns(d: Drawing): number {
  const cols = [...Array(d.width).keys()].filter((x) => Array.from({ length: d.height }, (_, y) => colourAt(d, x, y)).some((c) => c >= 0));
  return Math.max(...cols) - Math.min(...cols) + 1;
}

function inGlass(l: SceneLayout, i: number, margin: number): boolean {
  const dx = (i % l.width) + 0.5 - l.globe.cx;
  const dy = Math.floor(i / l.width) + 0.5 - l.globe.cy;
  return dx * dx + dy * dy <= (l.globe.radius + margin) ** 2;
}

describe('santaPlacement: where Santa flies', () => {
  const CASES: [number, number][] = [[0, 0], [0, 1_234_567], [1.1, 500], [-2.7, 9_876], [3 * Math.PI, 42_000], [0.5, 60_000], [5.9, 13_961]];

  it.each(CASES)('follows the orbit formula at turn %s, time %s ms', (turn, time) => {
    const p = santaPlacement(turn, time);
    const want = expected(turn, time);
    expect(p.x, 'x').toBeCloseTo(want.x, 9);
    expect(p.y, 'y').toBeCloseTo(want.y, 9);
    expect(p.depth, 'depth').toBeCloseTo(want.depth, 9);
    expect(p.squeeze, 'squeeze').toBeCloseTo(want.squeeze, 9);
    expect(p.mirrored, 'mirrored').toBe(want.mirrored);
    expect(p.trot, 'trot').toBe(want.trot);
    expect(Math.sin(p.angle), 'sin(angle) is the depth').toBeCloseTo(want.depth, 9);
    expect(ORBIT * (2 / Math.PI) * Math.asin(Math.cos(p.angle)), 'the triangle wave of angle carries x').toBeCloseTo(want.x, 9);
  });

  it('starts at time 0 on angle 2 + turn, trot frame 0, with no bob, and alternates the trot frame seven times a second', () => {
    for (const turn of [0, 0.5, -1, 4]) {
      const p = santaPlacement(turn, 0);
      expect(Math.sin(p.angle)).toBeCloseTo(Math.sin(2 + turn), 12);
      expect(Math.cos(p.angle)).toBeCloseTo(Math.cos(2 + turn), 12);
      expect(p.trot).toBe(0);
      expect(p.y).toBeCloseTo(-R * 0.46 + Math.sin(2 + turn) * ORBIT * TILT, 12);
    }
    const seen: number[] = [];
    for (let k = 0; k < 21; k++) seen.push(santaPlacement(0.3, (k * 1000) / 7 + 20).trot);
    expect(seen).toEqual(Array.from({ length: 21 }, (_, k) => k % 2));
  });

  it('drops the near side of the orbit down the picture by the same ground tilt projectPoint uses for the shapes', () => {
    const time = 3_000;
    const front = santaPlacement(turnFor(Math.PI / 2, time), time);
    const back = santaPlacement(turnFor(-Math.PI / 2, time), time);
    expect(front.depth).toBeCloseTo(1, 12);
    expect(back.depth).toBeCloseTo(-1, 12);
    // A floor point ORBIT towards the visitor against one ORBIT away: the shapes' own drop.
    const drop = projectPoint(0, ORBIT, 0, 0)[1] - projectPoint(0, -ORBIT, 0, 0)[1];
    expect(drop, 'the shapes tilt the floor').toBeGreaterThan(0);
    expect(front.y - back.y).toBeCloseTo(drop, 9);
  });

  it('flies high in the globe: above the middle, inside the glass, at every point of the orbit', () => {
    for (let k = 0; k < 360; k++) {
      const p = santaPlacement(k * 0.11, k * 97.3);
      expect(p.y, `k ${k}`).toBeLessThan(-R * 0.2);
      expect(Math.hypot(p.x, p.y), `k ${k}`).toBeLessThan(LIM);
    }
  });

  it('never squeezes him and never lets x pass his reach: squeeze is exactly 1 and |x| <= orbit at every angle', () => {
    expect(ORBIT).toBeGreaterThan(5);
    for (let k = 0; k <= 720; k++) expect(santaPlacement((k * FULL) / 720, 1_000).squeeze, `k ${k}`).toBe(1);
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.01]) expect(santaPlacement(turnFor(angle, 2_000), 2_000).squeeze, `angle ${angle}`).toBe(1);
    for (let k = 0; k <= 1440; k++) expect(Math.abs(santaPlacement((k * FULL) / 1440, 1_000).x), `k ${k}`).toBeLessThanOrEqual(ORBIT + 1e-9);
  });

  it('flies at a constant speed across: x is piecewise linear in the angle, the same slope everywhere between the ends', () => {
    const time = 1_500;
    const slope = (ORBIT * 2) / Math.PI;
    const N = 1000;
    const delta = FULL / N;
    let compared = 0;
    for (let k = 0; k < N; k++) {
      // Sample mid-interval offsets so no sample sits on the ends, where asin of a rounded cosine is coarse.
      const a0 = (k + 0.25) * delta;
      const a1 = (k + 0.75) * delta;
      // An interval over an end (angle 0 or PI) is where he turns round, not a straight run.
      if (Math.floor(a0 / Math.PI) !== Math.floor(a1 / Math.PI)) continue;
      const [x0, x1] = [a0, a1].map((a) => santaPlacement(turnFor(a, time), time).x) as [number, number];
      expect(Math.abs(Math.abs((x1 - x0) / (a1 - a0)) - slope) / slope, `angle ${a0.toFixed(4)}: speed`).toBeLessThan(1e-9);
      compared++;
    }
    expect(compared).toBeGreaterThan(N - 4);
  });

  it('moves the same way for the whole of each half of the orbit and the other way for the other half', () => {
    const time = 800;
    const dir = (a: number): number => Math.sign(santaPlacement(turnFor(a + 0.01, time), time).x - santaPlacement(turnFor(a, time), time).x);
    const first = dir(0.05);
    expect(first).not.toBe(0);
    for (let a = 0.05; a < Math.PI - 0.05; a += 0.05) expect(dir(a), `angle ${a.toFixed(2)}`).toBe(first);
    for (let a = Math.PI + 0.05; a < FULL - 0.05; a += 0.05) expect(dir(a), `angle ${a.toFixed(2)}`).toBe(-first);
  });

  it.each([0, Math.PI, FULL, -Math.PI])('turns round sharply at the end, angle %s: no easing, the speed at the end is the speed elsewhere', (end) => {
    const time = 2_222;
    const slope = (ORBIT * 2) / Math.PI;
    const frame = 0.45 / 60;
    const at = (a: number): number => santaPlacement(turnFor(a, time), time).x;
    const peak = at(end);
    const before = at(end - frame);
    const after = at(end + frame);
    expect(Math.abs(peak), 'at the end he is at full reach').toBeCloseTo(ORBIT, 9);
    expect(Math.abs(peak) - Math.abs(before), 'one frame before: full speed').toBeCloseTo(slope * frame, 9);
    expect(Math.abs(peak) - Math.abs(after), 'one frame after: full speed').toBeCloseTo(slope * frame, 9);
    expect(Math.sign(before - peak), 'he is coming from the inside').toBe(-Math.sign(peak));
    expect(Math.sign(after - peak), 'and goes back to the inside: the direction reverses within one frame').toBe(-Math.sign(peak));
  });

  it('reverses direction within one 1/60 s frame of time at the end, with the speed unchanged', () => {
    const slopeT = ((ORBIT * 2) / Math.PI) * 0.45;
    const t0 = 3_000;
    const turn = turnFor(0.002, t0);
    const xs = [-2, -1, 0, 1, 2].map((k) => santaPlacement(turn, t0 + (k * 1000) / 60).x);
    const dxs = xs.slice(1).map((x, i) => (x - (xs[i] ?? 0)) * 60);
    for (const dx of [dxs[0], dxs[3]]) expect(Math.abs(dx ?? 0), 'speed away from the end').toBeCloseTo(slopeT, 6);
    expect(Math.sign(dxs[0] ?? 0)).toBe(-Math.sign(dxs[3] ?? 0));
    expect(Math.max(...dxs.map(Math.abs)), 'never faster').toBeLessThanOrEqual(slopeT + 1e-6);
    expect(Math.min(...dxs.map(Math.abs)), 'never slower: no slowing down at the end').toBeGreaterThan(slopeT * 0.2);
  });

  it('is at an extreme of x (|x| = orbit) exactly when depth is 0, and only then', () => {
    for (const end of [0, Math.PI, FULL, -Math.PI, 3 * Math.PI]) {
      const p = santaPlacement(turnFor(end, 1_000), 1_000);
      expect(Math.abs(p.x), `end ${end}`).toBeCloseTo(ORBIT, 9);
      expect(p.depth, `end ${end}`).toBeCloseTo(0, 9);
    }
    for (let k = 0; k < 720; k++) {
      const a = 0.0037 + (k * FULL) / 720;
      const p = santaPlacement(turnFor(a, 1_000), 1_000);
      if (Math.abs(p.depth) > 0.05) expect(Math.abs(p.x), `angle ${a}`).toBeLessThan(ORBIT - 0.01);
      if (Math.abs(p.x) > ORBIT - 1e-6) expect(Math.abs(p.depth), `angle ${a}`).toBeLessThan(0.05);
    }
  });

  it('mirrors him exactly while he flies on the near side (depth > 0), flipping next to full reach at the ends of the orbit and nowhere else', () => {
    for (const [angle, want] of [[Math.PI / 2, true], [0.1, true], [-Math.PI / 2, false], [-0.1, false]] as const) {
      expect(santaPlacement(turnFor(angle, 700), 700).mirrored, `angle ${angle}`).toBe(want);
    }
    // angle 2 + turn = π exactly gives sin = 1.2e-16 in floating point; use 0 itself.
    expect(santaPlacement(-2, 0).mirrored, 'depth 0 counts as behind').toBe(false);
    const step = 0.45 / 60;
    for (const end of [0, Math.PI]) {
      const before = santaPlacement(turnFor(end - step, 500), 500);
      const after = santaPlacement(turnFor(end + step, 500), 500);
      expect(before.mirrored, `end ${end}: before`).toBe(end !== 0);
      expect(after.mirrored, `end ${end}: after`).toBe(end === 0);
      // The flip happens next to full reach, so the sprite does not jump across when it turns.
      expect(Math.abs(before.x), `end ${end}`).toBeGreaterThan(ORBIT - 0.2);
      expect(Math.abs(after.x), `end ${end}`).toBeGreaterThan(ORBIT - 0.2);
    }
    for (const a of [0.3, 1, 1.5, Math.PI - 0.3, Math.PI + 0.3, 5, 6]) {
      expect(santaPlacement(turnFor(a + 0.01, 500), 500).mirrored, `angle ${a}`).toBe(santaPlacement(turnFor(a, 500), 500).mirrored);
    }
  });

  it('keeps every opaque pixel of the sprite at least 2 art pixels inside the glass circle, at every angle and every bob', () => {
    expect(LAYOUT.globe.radius, 'the glass these tests are written on').toBe(R);
    // Times that put the bob at its top, at its bottom, and in between; the turn sweeps the whole orbit independently.
    let worst = 0;
    let where = '';
    for (const time of [0, 1_208, 3_625, 5_000, 9_777, 20_123, 1e7 + 1_208]) {
      for (let k = 0; k < 720; k++) {
        const turn = (k * FULL) / 720 + 0.0007;
        const p = santaPlacement(turn, time);
        const d = TROT[p.trot];
        const left = Math.round(LAYOUT.globe.cx + p.x - d.width / 2);
        const top = Math.round(LAYOUT.globe.cy + p.y - d.height / 2);
        for (let y = 0; y < d.height; y++) {
          for (let x = 0; x < d.width; x++) {
            if (colourAt(d, p.mirrored ? d.width - 1 - x : x, y) < 0) continue;
            const dist = Math.hypot(left + x + 0.5 - LAYOUT.globe.cx, top + y + 0.5 - LAYOUT.globe.cy);
            if (dist > worst) [worst, where] = [dist, `turn ${turn.toFixed(3)} time ${time} pixel ${x},${y}`];
          }
        }
      }
    }
    expect(worst, `the furthest opaque pixel centre from the globe's centre (${where})`).toBeLessThanOrEqual(R - GLASS_MARGIN);
  });

  it('uses the room: he flies out to within a few pixels of that margin at the ends, not hugging the middle', () => {
    const widest = Math.max(...Array.from({ length: 720 }, (_, k) => Math.abs(santaPlacement((k * FULL) / 720, 0).x)));
    // Full width, so his edge at the end is ORBIT + 24 from the middle; it should come close to the glass less its margin.
    expect(widest + 24, 'his outer edge at the ends of the orbit').toBeGreaterThan(R - GLASS_MARGIN - 14);
  });


  it('gives the same placement for a turn, the same turn a whole turn on, and whole turns back', () => {
    for (const turn of [0, 0.4, 2.9, -0.4, -7.5, 1e6]) {
      const a = santaPlacement(turn, 4_321);
      for (const other of [turn + FULL, turn - FULL, turn + 5 * FULL]) {
        const b = santaPlacement(other, 4_321);
        for (const key of ['x', 'y', 'depth'] as const) expect(b[key], `turn ${turn} vs ${other}: ${key}`).toBeCloseTo(a[key], 6);
        expect(b.mirrored).toBe(a.mirrored);
        expect(b.trot).toBe(a.trot);
      }
    }
  });

  it('stays finite and on the formula for a huge time and a huge turn', () => {
    for (const [turn, time] of [[0, 1e12], [1e9, 1e12], [-1e9, 8.64e10]] as [number, number][]) {
      const p = santaPlacement(turn, time);
      const want = expected(turn, time);
      for (const v of [p.angle, p.x, p.y, p.depth, p.squeeze]) expect(Number.isFinite(v), `turn ${turn} time ${time}`).toBe(true);
      expect(p.x).toBeCloseTo(want.x, 3);
      expect(p.y).toBeCloseTo(want.y, 3);
      expect(p.squeeze).toBe(1);
      expect([0, 1]).toContain(p.trot);
    }
  });

  it('refuses a non-finite turn or time with a RangeError', () => {
    for (const [turn, time] of [[Number.NaN, 0], [Infinity, 0], [-Infinity, 0], [0, Number.NaN], [0, Infinity]] as [number, number][]) {
      expect(() => santaPlacement(turn, time), `turn ${turn} time ${time}`).toThrow(RangeError);
    }
  });
});

describe('the Santa drawings', () => {
  it('are two 48 x 12 trot frames from the Santa sheet that differ, in the same colours', () => {
    for (const d of TROT) {
      expect([d.width, d.height]).toEqual([48, 12]);
      expect(d.sheet).toBe('santa.png');
    }
    expect(Array.from(TROT[0].pixels)).not.toEqual(Array.from(TROT[1].pixels));
    expect([...palette(TROT[0])].sort()).toEqual([...palette(TROT[1])].sort());
  });
});

describe('drawSanta: Santa in the picture', () => {
  it.each([[0, 'santa-trot-1', -1], [1, 'santa-trot-2', -1], [0, 'santa-trot-1', 1], [1, 'santa-trot-2', 1]] as const)(
    'paints trot frame %s on the grid at squeeze 1 as %s, pixel for pixel, on side %s (-1 far: as drawn; 1 near: its horizontal mirror)',
    (trot, name, side) => {
      const { turn, time } = onGrid(side, trot);
      const p = expected(turn, time);
      expect(p.trot).toBe(trot);
      expect(p.mirrored).toBe(side === 1);
      const d = drawing(name);
      const left = Math.round(LAYOUT.globe.cx + p.x - d.width / 2);
      const top = Math.round(LAYOUT.globe.cy + p.y - d.height / 2);
      const pic = drawn(turn, time, LAYOUT);
      const wrong: string[] = [];
      for (let y = 0; y < d.height; y++) {
        for (let x = 0; x < d.width; x++) {
          const want = colourAt(d, p.mirrored ? d.width - 1 - x : x, y);
          const i = (top + y) * W + left + x;
          const [ga, gb] = [pic.a[i], pic.b[i]];
          if (want < 0 ? ga !== FILL_A || gb !== FILL_B : ga !== want || gb !== want) wrong.push(`${x},${y}`);
        }
      }
      expect(wrong, `${name} side ${side}: pixels not as drawn (transparent ones must keep the background)`).toEqual([]);
      const outside = touchedIndexes(pic).filter((i) => {
        const x = i % W;
        const y = Math.floor(i / W);
        return x < left || x >= left + d.width || y < top || y >= top + d.height;
      });
      expect(outside.map((i) => `${i % W},${Math.floor(i / W)}`), 'pixels drawn outside the drawing').toEqual([]);
    },
  );

  it('centres him on his placement at every point of the orbit', () => {
    for (let k = 0; k < 48; k++) {
      const time = 250 + k * 291.7;
      const turn = 0.37 * k;
      const p = expected(turn, time);
      const b = box(drawn(turn, time));
      expect(Math.abs((b.left + b.right + 1) / 2 - (LAYOUT.globe.cx + p.x)), `k ${k}: across`).toBeLessThanOrEqual(1);
      expect(Math.abs((b.top + b.bottom + 1) / 2 - (LAYOUT.globe.cy + p.y)), `k ${k}: down`).toBeLessThanOrEqual(1);
    }
  });

  it('draws him at his full width at every angle and trot frame: exactly the pixels the sampled drawing gives, never thinner, in his own colours', () => {
    for (const time of [1_700, 3_210, 3_210 + 1_000 / 7]) {
      for (const angle of [0, 0.4, 0.9, 1, Math.PI / 2, 2.5, Math.PI, 4, -Math.PI / 2, 5.6]) {
        const turn = turnFor(angle, time);
        const at = `angle ${angle} time ${time}`;
        const trot = TROT[expected(turn, time).trot];
        expect(santaPlacement(turn, time).squeeze, at).toBe(1);
        const want = reference(turn, time);
        expect(want.size, `${at}: reference draws something`).toBeGreaterThan(0);
        const pic = drawn(turn, time);
        const list = touchedIndexes(pic);
        expect(list.map((i) => [i, pic.a[i] ?? 0]), at).toEqual([...want].sort((x, y) => x[0] - y[0]));
        const b = box(pic);
        expect(b.right - b.left + 1, `${at}: columns`).toBe(opaqueColumns(trot));
        expect(b.bottom - b.top + 1, `${at}: rows`).toBeLessThanOrEqual(12);
        expect(list.length, `${at}: every opaque pixel drawn`).toBe(opaqueCount(trot));
        expect(list.every((i) => solid(pic, i)), `${at}: crisp`).toBe(true);
      }
    }
    for (let k = 0; k < 120; k++) {
      const time = (k * ORBIT_SECONDS * 1000) / 120;
      expect(touchedIndexes(drawn(0.8, time)).length, `k ${k}`).toBe(opaqueCount(TROT[expected(0.8, time).trot]));
    }
  });

  it('draws crisp at every angle: each pixel he touches is wholly one of his colours, never a mix or a tint of the background', () => {
    let seen = 0;
    for (let k = 0; k < 90; k++) {
      const time = 137 + k * 311.3;
      const turn = 0.29 * k;
      const pic = drawn(turn, time);
      for (const i of touchedIndexes(pic)) {
        seen++;
        expect(pic.a[i], `k ${k}: pixel ${i} over the first background`).toBe(pic.b[i]);
        expect(SANTA_COLOURS.has(pic.a[i] ?? -1), `k ${k}: pixel ${i} colour ${(pic.a[i] ?? 0).toString(16)}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(1_000);
  });

  it.each([
    ['at a fixed turn', () => 0.25, 5_000, Math.floor((ORBIT_SECONDS * 1000 + 1_000) / STEP_MS)],
    ['under the page\'s own turn, time and turn advancing together', (time: number) => 0.5 + (time / 1000) * (FULL / 60), 0, 700],
  ] as [string, (time: number) => number, number, number][])(
    'moves in whole pixels %s: from one 1/60 s step to the next his box edges move by a pixel or two, and every pixel is his colour or the background',
    (_, turnAt, start, steps) => {
      const paint = (time: number): Uint32Array => {
        const pic = new Uint32Array(W * H).fill(FILL_A);
        drawSanta(pic, W, LAYOUT, turnAt(time), time);
        return pic;
      };
      let worst = 0;
      let where = '';
      let compared = 0;
      let prevTime = start;
      let prev = paint(prevTime);
      for (let k = 1; k <= steps; k++) {
        const time = start + k * STEP_MS;
        const next = paint(time);
        const a = expected(turnAt(prevTime), prevTime);
        const b = expected(turnAt(time), time);
        for (const c of next) if (c !== FILL_A && !SANTA_COLOURS.has(c)) expect.fail(`time ${time}: a pixel that is neither his colour nor the background`);
        // A trot frame change and the flip at the ends of the orbit are meant to change the drawing.
        if (a.trot === b.trot && a.mirrored === b.mirrored) {
          compared++;
          const [pb, nb] = [pixelBox(prev), pixelBox(next)];
          const changed = Math.max(Math.abs(pb.left - nb.left), Math.abs(pb.right - nb.right), Math.abs(pb.top - nb.top), Math.abs(pb.bottom - nb.bottom));
          if (changed > worst) {
            worst = changed;
            where = `time ${prevTime.toFixed(1)} -> ${time.toFixed(1)}`;
          }
        }
        prev = next;
        prevTime = time;
      }
      expect(compared, 'steps compared').toBeGreaterThan(300);
      expect(worst, `furthest an edge of his box jumped in one step (${where})`).toBeLessThanOrEqual(WORST_STEP);
    },
    60_000,
  );

  it('draws the two trot frames differently: the legs move between frames at the same place', () => {
    // Two times either side of the bob's top (sin(1.3 t) = 1 at t0), so the bob is the same, that
    // straddle the trot change at 8/7 s; the turn keeps the angle the same, so only the trot frame differs.
    const t0 = Math.PI / 2 / 1.3;
    const [ta, tb] = [(t0 - 0.07) * 1000, (t0 + 0.07) * 1000];
    expect(Math.floor((ta / 1000) * 7) % 2).not.toBe(Math.floor((tb / 1000) * 7) % 2);
    const angle = -Math.PI / 2;
    const [a, b] = [drawn(turnFor(angle, ta), ta), drawn(turnFor(angle, tb), tb)];
    expect(expected(turnFor(angle, ta), ta).y).toBeCloseTo(expected(turnFor(angle, tb), tb).y, 9);
    const diff = [...touchedIndexes(a), ...touchedIndexes(b)].filter((i) => a.a[i] !== b.a[i]).length;
    expect(diff, 'pixels that differ between the two trot frames').toBeGreaterThan(0);
  });

  it('keeps every pixel he paints inside the glass circle, and clips him where the glass is smaller than his orbit', () => {
    for (let k = 0; k < 60; k++) {
      expect(touchedIndexes(drawn(k * 0.9, k * 233.1)).filter((i) => !inGlass(LAYOUT, i, 0)), `k ${k}: pixels outside the glass`).toEqual([]);
    }
    // A glass smaller than his orbit: he must be cut at its edge, not drawn past it.
    const small: SceneLayout = { ...LAYOUT, globe: { ...LAYOUT.globe, radius: 22 } };
    const time = 4_000;
    const turn = turnFor(Math.PI / 2, time);
    const outside = (i: number): boolean => !inGlass(small, i, 0);
    const cut = touchedIndexes(drawn(turn, time, small));
    expect(touchedIndexes(drawn(turn, time)).filter(outside).length, 'unclipped Santa reaches past the small glass').toBeGreaterThan(0);
    expect(cut.filter(outside), 'pixels past the small glass').toEqual([]);
    expect(cut.length, 'the part inside the small glass still shows').toBeGreaterThan(0);
  });

  it('is not clipped by the glass: on a glass too big to touch, every pixel he paints is at least 2 art pixels inside the real glass radius', () => {
    const huge: SceneLayout = { ...LAYOUT, globe: { ...LAYOUT.globe, radius: 1_000 } };
    for (let k = 0; k < 360; k++) {
      const turn = k * 0.173;
      const time = k * 211.7;
      const list = touchedIndexes(drawn(turn, time, huge));
      expect(list.length, `k ${k}: nothing lost to the glass`).toBe(opaqueCount(TROT[expected(turn, time).trot]));
      expect(list.filter((i) => !inGlass(LAYOUT, i, -GLASS_MARGIN)), `k ${k}: pixels closer than ${GLASS_MARGIN} to the glass edge`).toEqual([]);
    }
  });

  it('draws the same picture for a turn and the same turn plus or minus whole turns', () => {
    for (const turn of [0.3, -2.2, 40]) {
      for (const other of [turn + FULL, turn - 3 * FULL]) {
        expect(maxChannelDiff(drawn(turn, 6_543).a, drawn(other, 6_543).a), `turn ${turn} vs ${other}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('refuses a non-finite turn or time with a RangeError and leaves the picture alone', () => {
    for (const [turn, time] of [[Number.NaN, 0], [Infinity, 100], [0, Number.NaN], [0, -Infinity]] as [number, number][]) {
      const pic = new Uint32Array(W * H).fill(FILL_A);
      expect(() => drawSanta(pic, W, LAYOUT, turn, time), `turn ${turn} time ${time}`).toThrow(RangeError);
      expect(pic.every((c) => c === FILL_A), `turn ${turn} time ${time}: picture untouched`).toBe(true);
    }
  });
});

// Santa inside the globe as drawGlobe(picture, width, layout, phase, turn, time)
// and sceneFrame (which passes input.time) draw him. Order inside drawGlobe:
// glass, Santa if behind (depth <= 0), the shapes, Santa if in front (depth > 0),
// then reflections, cast shadow and base. The real shapes never reach as high as
// Santa flies, so the depth order is pinned by swapping drawShapes for an opaque
// block over the top of the glass.
describe('drawGlobe: Santa in the depth order', () => {
  // One turn, two times half an orbit apart: behind at BEHIND, in front at FRONT.
  // Only Santa differs between the two pictures; his two boxes do not overlap.
  const BEHIND = 2_000;
  const FRONT = BEHIND + (Math.PI / 0.45) * 1000;
  const TURN = turnFor(-Math.PI / 2, BEHIND);

  it('puts him behind at one time and in front half an orbit later, lower down the picture and flying the other way', () => {
    const back = santaPlacement(TURN, BEHIND);
    const front = santaPlacement(TURN, FRONT);
    expect(back.depth).toBeCloseTo(-1, 9);
    expect(front.depth).toBeCloseTo(1, 9);
    expect(back.mirrored).toBe(false);
    expect(front.mirrored).toBe(true);
    const mean = (rows: number[]): number => rows.reduce((a, b) => a + b, 0) / rows.length;
    const backRows = santaAlone(TURN, BEHIND).touched.map((i) => Math.floor(i / W));
    const frontRows = santaAlone(TURN, FRONT).touched.map((i) => Math.floor(i / W));
    expect(mean(frontRows) - mean(backRows), 'the near side sits lower by about the ground tilt').toBeGreaterThan(front.y - back.y - 3);
  });

  it('draws him over the glass: with the real shapes his box shows him, not the glass', () => {
    const back = santaAlone(TURN, BEHIND);
    const [p, q] = [globe(TURN, BEHIND), globe(TURN, FRONT)];
    expect(back.touched.filter((i) => p[i] !== q[i]).length, 'pixels of his far-side box that show him').toBeGreaterThanOrEqual(0.5 * back.touched.length);
  });

  it('hides him behind an opaque shape while he flies on the far side (depth <= 0)', () => {
    shapesMode.block = true;
    const back = santaAlone(TURN, BEHIND);
    expect(back.touched.length).toBeGreaterThan(0);
    const p = globe(TURN, BEHIND);
    const { cx, cy, radius } = LAYOUT.globe;
    const inBlock = (i: number): boolean => {
      const x = i % W;
      const y = Math.floor(i / W);
      return x >= Math.round(cx - 45) && x < Math.round(cx + 45) && y >= Math.round(cy - 45) && y < Math.round(cy - 5) && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius - 3;
    };
    const covered = back.touched.filter(inBlock);
    expect(covered.length, 'his box reaches the shape').toBeGreaterThan(0);
    const shown = covered.filter((i) => p[i] !== BLOCK).map((i) => `${i % W},${Math.floor(i / W)}`);
    expect(shown, 'pixels where Santa shows through the shape in front of him').toEqual([]);
  });

  it('draws him over an opaque shape while he flies on the near side (depth > 0)', () => {
    shapesMode.block = true;
    const front = santaAlone(TURN, FRONT);
    expect(front.whole.size).toBeGreaterThan(0);
    const p = globe(TURN, BEHIND);
    const q = globe(TURN, FRONT);
    const changed = front.touched.filter((i) => p[i] !== q[i]);
    expect(changed.length, 'pixels of his near-side box that show him over the shape').toBeGreaterThanOrEqual(0.5 * front.touched.length);
    const own = [...front.whole].filter(([i, c]) => q[i] === c);
    expect(own.length, 'wholly covered pixels in his own colour over the shape').toBeGreaterThanOrEqual(0.5 * front.whole.size);
  });
});

describe('drawGlobe: Santa\'s colours and what he leaves alone', () => {
  it('keeps Santa in his own colours in every phase and blend: only the glass tints', () => {
    for (const [turn, time] of [[0.3, 1_500], [2.2, 9_000], [4.9, 20_000]] as [number, number][]) {
      const alone = santaAlone(turn, time);
      expect(alone.whole.size, `turn ${turn} time ${time}: wholly covered`).toBeGreaterThan(5);
      expect([...alone.whole.values()].some((c) => SANTA_COLOURS.has(c)), 'some wholly covered pixels are his own colours').toBe(true);
      for (const [name, phase] of READINGS) {
        const pic = globe(turn, time, phase);
        const kept = [...alone.whole].filter(([i, c]) => pic[i] === c).length;
        // A reflection may pass over a few of his pixels.
        expect(kept / alone.whole.size, `${name} turn ${turn} time ${time}: his pixels in his own colours`).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it('changes nothing outside the glass as he flies: two times at one turn differ only inside the circle', () => {
    for (const layout of [LAYOUT, sceneLayout(161, 172, SEED), sceneLayout(320, 180, SEED)]) {
      const [a, b] = [globe(1.7, 3_000, NIGHT, layout), globe(1.7, 8_500, NIGHT, layout)];
      const differ = Array.from(a.keys()).filter((i) => a[i] !== b[i]);
      expect(differ.filter((i) => !inGlass(layout, i, 0)), `${layout.width}x${layout.height}: pixels outside the glass changed with the time`).toEqual([]);
      expect(differ.length, `${layout.width}x${layout.height}: Santa moved`).toBeGreaterThan(0);
    }
  });

  it('draws the same picture for a turn and the same turn plus or minus whole turns, at the same time', () => {
    for (const turn of [0.4, -3.1, 77]) {
      for (const other of [turn + FULL, turn - 2 * FULL]) {
        expect(maxChannelDiff(globe(turn, 4_444), globe(other, 4_444)), `turn ${turn} vs ${other}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('draws at time 0 and at a huge time', () => {
    for (const time of [0, 1e12]) {
      const pic = globe(0.5, time);
      const later = globe(0.5, time + 7_000);
      const alone = santaAlone(0.5, time);
      expect(alone.touched.length, `time ${time}`).toBeGreaterThan(0);
      expect(alone.touched.some((i) => pic[i] !== later[i]), `time ${time}: Santa in the globe`).toBe(true);
    }
  });
});

describe('sceneFrame: Santa at the input time', () => {
  it('draws the globe at input.time: inside the glass the frame is drawGlobe at that time', () => {
    for (const time of [0, 3_000, 1_234_567]) {
      const turn = 1.1;
      const f = sceneFrame({ time, drag: 0, phase: NIGHT, seed: SEED, width: W, height: H, turn });
      const g = globe(turn, time, NIGHT, f.layout);
      const wrong = Array.from(g.keys()).filter((i) => inGlass(f.layout, i, -3) && f.picture[i] !== g[i]).slice(0, 8);
      expect(wrong.map((i) => `${i % W},${Math.floor(i / W)}`), `time ${time}: glass pixels unlike drawGlobe at that time`).toEqual([]);
    }
  });

  it('moves Santa when only the time changes', () => {
    const at = (time: number): Uint32Array => sceneFrame({ time, drag: 0, phase: NIGHT, seed: SEED, width: W, height: H, turn: 0 }).picture;
    const [a, b] = [at(1_000), at(4_000)];
    expect(Array.from(a.keys()).filter((i) => inGlass(LAYOUT, i, -3) && a[i] !== b[i]).length).toBeGreaterThan(0);
  });
});

// XMAS-67 "Drag direction feels reversed": the turn a drag yields, fed to the real
// projection and to Santa's orbit, carries the front surface the way the finger went.
/** The turn after the pointer goes down at x = 0 and moves to `toX`, from `initialTurn`. */
function turnAfterDrag(toX: number, initialTurn: number): number {
  const drag = createDrag(initialTurn, DRAG_SETTINGS);
  drag.pointerDown(1, 0, 0, 0);
  drag.pointerMove(1, toX, 0, 0.5);
  return drag.step(1 / 60).turn;
}

const screenX = (x: number, z: number, turn: number): number => projectPoint(x, z, 0, turn)[0];
const POINTS: [number, number][] = [[0, 10], [-25, 20], [30, 5], [14, 27], [-40, 1], [10, -20], [-30, -10]];
/** The points on the visitor's side of the globe at `turn`: nearness x sin t + z cos t > 0 (z > 0 at turn 0). */
function front(turn: number): [number, number][] {
  const near = POINTS.filter(([x, z]) => x * Math.sin(turn) + z * Math.cos(turn) > 1);
  expect(near.length, 'some points are in front').toBeGreaterThan(1);
  return near;
}

describe('the drag and the projection agree on which way is right', () => {
  it.each([['right', 12, 1], ['left', -12, -1]] as const)('a drag to the %s moves every front surface point that way on screen, from every start turn', (_, toX, sign) => {
    for (const start of [0, 1.3, -2.2, 5]) {
      const after = turnAfterDrag(toX, start);
      for (const [x, z] of front(start)) {
        expect(sign * (screenX(x, z, after) - screenX(x, z, start)), `turn ${start} point (${x}, ${z})`).toBeGreaterThan(0);
      }
    }
  });

  it('moves the front surface by about the finger distance times the radius it sits at, to the right', () => {
    const after = turnAfterDrag(10, 0);
    // A point at z = 27 on the centre line moves by z sin(turn) to the right.
    expect(screenX(0, 27, after)).toBeCloseTo(27 * Math.sin(10 * DRAG_SETTINGS.turnPerPixel), 6);
  });
});

describe('the drag and Santa agree on which way is right', () => {
  it.each([['right', 6, 1], ['left', -6, -1]] as const)('a drag to the %s moves Santa that way while he flies in front', (_, toX, sign) => {
    for (const start of [0, 0.2, -0.5]) {
      const before = santaPlacement(start, 1000);
      expect(before.depth, `turn ${start}: starts in front`).toBeGreaterThan(0.3);
      const after = santaPlacement(turnAfterDrag(toX, start), 1000);
      expect(after.depth, `turn ${start}: stays in front`).toBeGreaterThan(0);
      expect(sign * (after.x - before.x), `turn ${start}: x`).toBeGreaterThan(0);
    }
  });

  it('moves Santa the same way as a front shape for the same drag', () => {
    const before = santaPlacement(0, 1000);
    const after = santaPlacement(turnAfterDrag(8, 0), 1000);
    const shape = screenX(0, 20, turnAfterDrag(8, 0)) - screenX(0, 20, 0);
    expect(Math.sign(after.x - before.x)).toBe(Math.sign(shape));
  });
});
