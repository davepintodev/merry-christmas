// XMAS-32b "The globe", slice 2: the turning shapes inside the globe (XMAS-21
// 7.2-7.4). The red house (snowy gable roof, lit windows, chimney), eight
// presents in four designs and the lamp post stand on the globe's floor disc
// as small boxes and cylinders, turned about the globe's vertical axis by the
// turn; their faces carry the House and Props sheets' drawings. Everything
// that turns is blended on the fixed grid, nearer shapes cover farther ones,
// the shapes cast smooth shadows on the floor away from the disc at the top
// left, their colours never change with the phase, and nothing outside the
// glass (nor the base) changes.
//
// Interface pinned here: src/scene/shapes.ts exports globeShapes, floorDisc
// and projectShape(shape, turn); src/scene/shapes-draw.ts exports
// drawShapes(picture, width, layout, phase, turn, shapes = globeShapes),
// which drawGlobe calls (through that module) inside the glass. A point
// (x, z) of a shape turns to screen x = x cos t - z sin t (the floor turns
// the same way as the lettering slides), its nearness to the visitor being
// x sin t + z cos t; at turn 0 the house's front faces the visitor.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { drawings, type Drawing } from '../shared/art.generated.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { GLOBE_RADIUS, sceneFrame, sceneLayout, type SceneFrame, type SceneInput, type SceneLayout } from './frame.ts';
import { drawShapes } from './shapes-draw.ts';
import { floorDisc, globeShapes, projectShape, type GlobeShape, type ProjectedFace } from './shapes.ts';

// The slice-1 globe (glass, base, lettering, no shapes) is sceneFrame with
// drawShapes switched off; every other test draws the real shapes.
const shapesOn = vi.hoisted(() => ({ value: true }));
vi.mock('./shapes-draw.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shapes-draw.ts')>();
  return {
    ...actual,
    drawShapes: (...args: Parameters<typeof actual.drawShapes>): void => {
      if (shapesOn.value) actual.drawShapes(...args);
    },
  };
});

afterEach(() => {
  shapesOn.value = true;
});

const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
const READINGS: [string, PhaseReading][] = [
  ...PHASES.map((p): [string, PhaseReading] => [p, { from: p, to: p, share: 0 }]),
  ['purple-night -> dawn at 0.5', { from: 'purple-night', to: 'dawn', share: 0.5 }],
  ['frosty-morning -> sunset at 0.25', { from: 'frosty-morning', to: 'sunset', share: 0.25 }],
];
const W = 240;
const H = 180;
const SEED = 12345;
const T = 1_000_000;
const FULL = 2 * Math.PI;
const SIZES: [number, number][] = [
  [W, H],
  [320, 180],
  [240, 300],
  [161, 160],
  [2 * GLOBE_RADIUS, 160],
];
/** Two backgrounds no drawing uses: a pixel that comes out the same over both is wholly covered by a shape. */
const FILL_A = 0x010203;
const FILL_B = 0xfdfcfb;
/** A mid-tone floor for the shadow, so darker is visible. */
const FILL_MID = 0x8090a0;
const LAYOUT = sceneLayout(W, H, SEED);
const NIGHT: PhaseReading = { from: 'purple-night', to: 'purple-night', share: 0 };
/** The rows below the globe's centre still above the base, in the shortest picture. */
const LOWEST_FREE = Math.min(...SIZES.map(([w, h]) => {
  const l = sceneLayout(w, h, SEED);
  return l.groundTop - l.globe.cy;
}));

const HOUSE_DRAWINGS = ['house-wall-front', 'house-wall-back', 'house-wall-left', 'house-wall-right', 'house-roof-front', 'house-roof-back', 'house-chimney'];

function hexNum(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function rgb(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function brightness(n: number): number {
  const [r, g, b] = rgb(n);
  return r + g + b;
}

function drawing(name: string): Drawing {
  const d = drawings[name];
  if (d === undefined) throw new Error(`no drawing ${name}`);
  return d;
}

/** A drawing's colour at (x, y), as a 0xRRGGBB number; -1 when transparent. */
function colourAt(d: Drawing, x: number, y: number): number {
  const n = d.pixels[y * d.width + x] ?? 0;
  return n === 0 ? -1 : hexNum(masterColours[n - 1] ?? '#000000');
}

/** Every colour a drawing uses. */
function palette(d: Drawing): Set<number> {
  const out = new Set<number>();
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if (colourAt(d, x, y) >= 0) out.add(colourAt(d, x, y));
  return out;
}

function input(over: Partial<SceneInput> = {}): SceneInput {
  return { time: T, drag: 0, phase: NIGHT, seed: SEED, width: W, height: H, ...over };
}

/** The slice-1 picture for the same input: the globe without its shapes. */
function noShapes(over: Partial<SceneInput> = {}): SceneFrame {
  shapesOn.value = false;
  try {
    return sceneFrame(input(over));
  } finally {
    shapesOn.value = true;
  }
}

function inCircle(l: SceneLayout, x: number, y: number, margin: number): boolean {
  const dx = x + 0.5 - l.globe.cx;
  const dy = y + 0.5 - l.globe.cy;
  return dx * dx + dy * dy <= (l.globe.radius + margin) ** 2;
}

function only<T>(list: readonly T[]): T {
  expect(list.length).toBe(1);
  const first = list[0];
  if (first === undefined) expect.fail('empty list');
  return first;
}

const houses = (): GlobeShape[] => globeShapes.filter((s) => s.kind === 'house');
const presents = (): GlobeShape[] => globeShapes.filter((s) => s.kind === 'present');
const lamps = (): GlobeShape[] => globeShapes.filter((s) => s.kind === 'lamp-post');

function face(faces: readonly ProjectedFace[], name: string): ProjectedFace | undefined {
  return faces.find((f) => f.drawing === name);
}

function names(faces: readonly ProjectedFace[]): string[] {
  return faces.map((f) => f.drawing);
}

function xs(f: ProjectedFace): number[] {
  return f.corners.map((c) => c[0]);
}

function ys(f: ProjectedFace): number[] {
  return f.corners.map((c) => c[1]);
}

function extentX(f: ProjectedFace): number {
  return Math.max(...xs(f)) - Math.min(...xs(f));
}

function extentY(f: ProjectedFace): number {
  return Math.max(...ys(f)) - Math.min(...ys(f));
}

/** A point of the floor turned by t: [screen x, nearness to the visitor]. */
function spin(x: number, z: number, t: number): [number, number] {
  return [x * Math.cos(t) - z * Math.sin(t), x * Math.sin(t) + z * Math.cos(t)];
}

/**
 * Whether a is nearer the visitor than b at turn t, from the axis their
 * footprints are apart on: apart across x, the one further along x comes
 * nearer when sin t > 0; apart along z, the one further along z when
 * cos t > 0. Undefined when that does not settle it.
 */
function nearer(a: GlobeShape, b: GlobeShape, t: number): boolean | undefined {
  const votes: boolean[] = [];
  const s = Math.sin(t);
  const c = Math.cos(t);
  if (Math.abs(s) > 1e-6) {
    if (a.x - a.width / 2 >= b.x + b.width / 2) votes.push(s > 0);
    if (b.x - b.width / 2 >= a.x + a.width / 2) votes.push(s < 0);
  }
  if (Math.abs(c) > 1e-6) {
    if (a.z - a.depth / 2 >= b.z + b.depth / 2) votes.push(c > 0);
    if (b.z - b.depth / 2 >= a.z + a.depth / 2) votes.push(c < 0);
  }
  if (votes.length === 0 || votes.some((v) => v !== votes[0])) return undefined;
  return votes[0];
}

interface Drawn { a: Uint32Array; b: Uint32Array; layout: SceneLayout; width: number }

/** drawShapes over the two plain backgrounds. */
function drawn(turn: number, shapes: readonly GlobeShape[] = globeShapes, layout: SceneLayout = LAYOUT, phase: PhaseReading = NIGHT): Drawn {
  const width = layout.width;
  const a = new Uint32Array(width * layout.height).fill(FILL_A);
  const b = new Uint32Array(width * layout.height).fill(FILL_B);
  drawShapes(a, width, layout, phase, turn, shapes);
  drawShapes(b, width, layout, phase, turn, shapes);
  return { a, b, layout, width };
}

/** Wholly covered by a shape: the same colour over both backgrounds. */
function solid(d: Drawn, i: number): boolean {
  return d.a[i] === d.b[i] && d.a[i] !== FILL_A;
}

/** Untouched: each background shows. */
function bare(d: Drawn, i: number): boolean {
  return d.a[i] === FILL_A && d.b[i] === FILL_B;
}

function solidIndexes(d: Drawn): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.a.length; i++) if (solid(d, i)) out.push(i);
  return out;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / len));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function insidePolygon(px: number, py: number, corners: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const [xi, yi] = corners[i] ?? [0, 0];
    const [xj, yj] = corners[j] ?? [0, 0];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Pixels (index into the picture) whose centre lies on a visible face of any shape, or within one art pixel of its edge. */
function faceMask(layout: SceneLayout, turn: number, shapes: readonly GlobeShape[] = globeShapes): Uint8Array {
  const { cx, cy } = layout.globe;
  const mask = new Uint8Array(layout.width * layout.height);
  for (const shape of shapes) {
    for (const f of projectShape(shape, turn)) {
      const x0 = Math.max(0, Math.floor(cx + Math.min(...xs(f)) - 2));
      const x1 = Math.min(layout.width - 1, Math.ceil(cx + Math.max(...xs(f)) + 2));
      const y0 = Math.max(0, Math.floor(cy + Math.min(...ys(f)) - 2));
      const y1 = Math.min(layout.height - 1, Math.ceil(cy + Math.max(...ys(f)) + 2));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 - cx;
          const py = y + 0.5 - cy;
          let near = insidePolygon(px, py, f.corners);
          for (let i = 0; !near && i < f.corners.length; i++) {
            const [ax, ay] = f.corners[i] ?? [0, 0];
            const [bx, by] = f.corners[(i + 1) % f.corners.length] ?? [0, 0];
            if (segmentDistance(px, py, ax, ay, bx, by) <= 1) near = true;
          }
          if (near) mask[y * layout.width + x] = 1;
        }
      }
    }
  }
  return mask;
}

describe('globeShapes: what stands in the globe', () => {
  it('holds exactly one house, 22 art pixels wide (its front wall) and 16 deep (its side walls)', () => {
    const house = only(houses());
    expect(house.width).toBe(drawing('house-wall-front').width);
    expect(house.depth).toBe(drawing('house-wall-left').width);
    expect(house.height).toBeGreaterThanOrEqual(drawing('house-wall-front').height);
  });

  it('holds eight presents in exactly four designs, two of each, each a cube the size of its design drawing', () => {
    const list = presents();
    expect(list.length).toBe(8);
    const count = new Map<number, number>();
    for (const p of list) {
      expect(p.design, 'a present names its design').toBeDefined();
      const d = p.design ?? 0;
      count.set(d, (count.get(d) ?? 0) + 1);
      const side = drawing(`present-${d}-side`);
      expect([p.width, p.depth, p.height], `present design ${d} size`).toEqual([side.width, side.width, side.height]);
    }
    expect([...count.entries()].sort()).toEqual([[1, 2], [2, 2], [3, 2], [4, 2]]);
  });

  it('holds one lamp post, 2 across and 12 tall like its drawing, and no other turning shape', () => {
    const lamp = only(lamps());
    expect([lamp.width, lamp.depth, lamp.height]).toEqual([2, 2, 12]);
    // XMAS-32c adds the pines and the snowman (tests/frames/globe-trees-snowman.test.ts); the turning shapes stay ten.
    expect(globeShapes.filter((s) => s.kind === 'house' || s.kind === 'present' || s.kind === 'lamp-post').length).toBe(10);
    for (const s of globeShapes) if (s.kind !== 'present') expect(s.design, `${s.kind} carries no present design`).toBeUndefined();
  });

  it('lays the floor disc below the globe centre, inside the glass and its rim, and above the base in the shortest picture', () => {
    expect(floorDisc.y).toBeGreaterThan(0);
    expect(floorDisc.y).toBeLessThan(LOWEST_FREE);
    expect(floorDisc.radius).toBeGreaterThan(20);
    expect(floorDisc.radius).toBeLessThanOrEqual(Math.sqrt(GLOBE_RADIUS ** 2 - floorDisc.y ** 2) - 2.5);
  });

  it('stands every footprint wholly on the floor disc', () => {
    expect(globeShapes.length).toBeGreaterThan(0);
    for (const s of globeShapes) {
      for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        const d = Math.hypot(s.x + (x * s.width) / 2, s.z + (z * s.depth) / 2);
        expect(d, `${s.kind} ${s.design ?? ''} at ${s.x},${s.z}: corner off the floor`).toBeLessThanOrEqual(floorDisc.radius);
      }
    }
  });

  it('never lets two footprints overlap', () => {
    expect(globeShapes.length).toBeGreaterThan(1);
    globeShapes.forEach((a, i) => {
      globeShapes.forEach((b, j) => {
        if (j <= i) return;
        const across = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2);
        const deep = Math.min(a.z + a.depth / 2, b.z + b.depth / 2) - Math.max(a.z - a.depth / 2, b.z - b.depth / 2);
        if (across > 0 && deep > 0) expect.fail(`${a.kind} at ${a.x},${a.z} overlaps ${b.kind} at ${b.x},${b.z}`);
      });
    });
  });
});

describe('projectShape: turning a shape about the globe axis', () => {
  it('shows the house front wall, front roof slope and chimney at turn 0, and not the back wall', () => {
    const faces = projectShape(only(houses()), 0);
    expect(names(faces)).toEqual(expect.arrayContaining(['house-wall-front', 'house-roof-front', 'house-chimney']));
    expect(names(faces)).not.toContain('house-wall-back');
    for (const n of names(faces)) expect(HOUSE_DRAWINGS, `house face ${n}`).toContain(n);
  });

  it('shows the back wall and back roof slope after half a turn, and not the front wall', () => {
    const faces = projectShape(only(houses()), Math.PI);
    expect(names(faces)).toEqual(expect.arrayContaining(['house-wall-back', 'house-roof-back']));
    expect(names(faces)).not.toContain('house-wall-front');
  });

  it('shows the right wall after a quarter turn and the left wall after three quarters', () => {
    const quarter = names(projectShape(only(houses()), Math.PI / 2));
    expect(quarter).toContain('house-wall-right');
    expect(quarter).not.toContain('house-wall-left');
    const three = names(projectShape(only(houses()), (3 * Math.PI) / 2));
    expect(three).toContain('house-wall-left');
    expect(three).not.toContain('house-wall-right');
  });

  it('narrows the front wall as cos of the turn and widens the side wall as sin, smoothly', () => {
    const house = only(houses());
    for (let k = 0; k <= 15; k++) {
      const t = k * 0.1;
      const faces = projectShape(house, t);
      const front = face(faces, 'house-wall-front');
      if (front === undefined) expect.fail(`turn ${t}: no front wall`);
      expect(Math.abs(extentX(front) - 22 * Math.cos(t)), `turn ${t}: front wall width`).toBeLessThanOrEqual(0.25);
      if (k > 0) {
        const side = face(faces, 'house-wall-right');
        if (side === undefined) expect.fail(`turn ${t}: no right wall`);
        expect(Math.abs(extentX(side) - 16 * Math.sin(t)), `turn ${t}: side wall width`).toBeLessThanOrEqual(0.25);
      }
    }
    for (const t of [0, Math.PI]) {
      const wall = face(projectShape(house, t), t === 0 ? 'house-wall-front' : 'house-wall-back');
      expect(wall && extentX(wall), `turn ${t}: square-on wall width`).toBeCloseTo(22, 6);
      expect(wall && extentY(wall), `turn ${t}: walls stand at their full 12 rows`).toBeCloseTo(12, 6);
    }
  });

  it('carries the house round the globe axis: the front wall centre sits at x cos t - z sin t', () => {
    const house = only(houses());
    for (const t of [0, 0.4, 1, 1.4, -0.7, 5.5]) {
      const front = face(projectShape(house, t), 'house-wall-front');
      if (front === undefined) expect.fail(`turn ${t}: no front wall`);
      const centre = xs(front).reduce((s, x) => s + x, 0) / front.corners.length;
      const [want] = spin(house.x, house.z + house.depth / 2, t);
      expect(Math.abs(centre - want), `turn ${t}: front wall centre across`).toBeLessThanOrEqual(0.25);
    }
  });

  it('gives each present its own design drawings, a side and a top, and never another design', () => {
    expect(presents().length).toBe(8);
    for (const p of presents()) {
      for (const t of [0, 1, 2.5, 4, 5.9]) {
        const faces = names(projectShape(p, t));
        expect(faces, `design ${p.design} turn ${t}`).toContain(`present-${p.design}-side`);
        expect(faces, `design ${p.design} turn ${t}: its top is seen from above`).toContain(`present-${p.design}-top`);
        for (const n of faces) expect(n, `design ${p.design} turn ${t}`).toMatch(new RegExp(`^present-${p.design}-(side|top)$`));
      }
    }
  });

  it('draws the present side square-on at turn 0 at the drawing size', () => {
    expect(presents().length).toBe(8);
    for (const p of presents()) {
      const side = projectShape(p, 0).filter((f) => f.drawing === `present-${p.design}-side`);
      expect(side.length, `design ${p.design}: one side square-on`).toBe(1);
      expect(extentX(side[0] as ProjectedFace)).toBeCloseTo(p.width, 6);
      expect(extentY(side[0] as ProjectedFace)).toBeCloseTo(p.height, 6);
    }
  });

  it('shows the lamp post the same from every side: its drawing, 2 across and 12 tall', () => {
    const lamp = only(lamps());
    for (let k = 0; k < 24; k++) {
      const t = (k * FULL) / 24;
      const post = face(projectShape(lamp, t), 'lamp-post');
      if (post === undefined) expect.fail(`turn ${t}: no lamp post face`);
      expect(extentX(post), `turn ${t}`).toBeCloseTo(2, 6);
      expect(extentY(post), `turn ${t}`).toBeCloseTo(12, 6);
    }
  });

  it('comes back to turn 0 after whole turns, and a negative turn equals the same turn a circle on', () => {
    expect(globeShapes.length).toBeGreaterThan(0);
    for (const s of globeShapes) {
      const zero = projectShape(s, 0);
      for (const t of [FULL, -FULL, 2 * FULL]) {
        const again = projectShape(s, t);
        expect(names(again), `${s.kind} turn ${t}`).toEqual(names(zero));
        again.forEach((f, i) => f.corners.forEach((c, j) => {
          expect(c[0]).toBeCloseTo(zero[i]?.corners[j]?.[0] ?? Number.NaN, 9);
          expect(c[1]).toBeCloseTo(zero[i]?.corners[j]?.[1] ?? Number.NaN, 9);
        }));
      }
      const neg = projectShape(s, -0.5);
      const pos = projectShape(s, FULL - 0.5);
      expect(names(neg)).toEqual(names(pos));
      neg.forEach((f, i) => f.corners.forEach((c, j) => expect(c[0]).toBeCloseTo(pos[i]?.corners[j]?.[0] ?? Number.NaN, 9)));
    }
  });

  it('keeps every face inside the glass (within its rim) and above the base of the shortest picture, at every turn', () => {
    expect(globeShapes.length).toBeGreaterThan(0);
    for (const s of globeShapes) {
      for (let k = 0; k < 72; k++) {
        const t = (k * FULL) / 72;
        for (const f of projectShape(s, t)) {
          for (const [x, y] of f.corners) {
            expect(Math.hypot(x, y), `${s.kind} turn ${t.toFixed(2)} ${f.drawing}: corner past the rim`).toBeLessThanOrEqual(GLOBE_RADIUS - 2.5);
            expect(y, `${s.kind} turn ${t.toFixed(2)} ${f.drawing}: corner over the base`).toBeLessThanOrEqual(LOWEST_FREE);
          }
        }
      }
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('throws a RangeError for a turn of %s', (turn) => {
    expect(() => projectShape(only(houses()), turn)).toThrow(RangeError);
  });

  it('is pure: the same faces for the same input, and the shape is left as it was', () => {
    const house = only(houses());
    const copy = Object.freeze({ ...house });
    const a = projectShape(copy, 0.9);
    expect(projectShape(copy, 0.9)).toEqual(a);
    expect(copy).toEqual(house);
  });
});

describe('drawShapes: the shapes in the picture', () => {
  it('draws the shapes: a house-sized patch of wholly covered pixels at turn 0', () => {
    expect(solidIndexes(drawn(0)).length).toBeGreaterThanOrEqual(22 * 12);
  });

  it('puts the front wall drawing on the grid at turn 0 in its own colour numbers, windows lit', () => {
    const house = only(houses());
    const front = face(projectShape(house, 0), 'house-wall-front');
    if (front === undefined) expect.fail('no front wall at turn 0');
    const left = LAYOUT.globe.cx + Math.min(...xs(front));
    const top = LAYOUT.globe.cy + Math.min(...ys(front));
    expect(Math.abs(left - Math.round(left)), 'front wall left edge on the grid').toBeLessThan(1e-9);
    expect(Math.abs(top - Math.round(top)), 'front wall top edge on the grid').toBeLessThan(1e-9);
    const d = drawn(0, [house]);
    const wall = drawing('house-wall-front');
    let match = 0;
    for (let y = 0; y < wall.height; y++) {
      for (let x = 0; x < wall.width; x++) {
        if (d.a[(Math.round(top) + y) * W + Math.round(left) + x] === colourAt(wall, x, y)) match++;
      }
    }
    expect(match / (wall.width * wall.height), 'share of the front wall in its drawing colours').toBeGreaterThanOrEqual(0.9);
  });

  it('paints each present in its own design drawing colours', () => {
    expect(presents().length).toBe(8);
    for (const p of presents()) {
      const d = drawn(0, [p]);
      const colours = new Set([...palette(drawing(`present-${p.design}-side`)), ...palette(drawing(`present-${p.design}-top`))]);
      const covered = solidIndexes(d);
      expect(covered.length, `design ${p.design}: covered pixels`).toBeGreaterThan(0);
      const own = covered.filter((i) => colours.has(d.a[i] ?? -1)).length;
      expect(own / covered.length, `design ${p.design}: share in its drawing colours`).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('keeps the shapes in the same colour numbers in every phase and blend (only the glass tint changes)', () => {
    for (const turn of [0, 0.8, 3.6]) {
      const first = drawn(turn, globeShapes, LAYOUT, NIGHT);
      const covered = solidIndexes(first);
      expect(covered.length).toBeGreaterThan(0);
      for (const [name, phase] of READINGS) {
        const d = drawn(turn, globeShapes, LAYOUT, phase);
        for (const i of covered) if (d.a[i] !== first.a[i]) expect.fail(`${name} turn ${turn}: shape pixel ${i % W},${Math.floor(i / W)} changed colour`);
      }
    }
  });

  it('draws nearer shapes over farther ones wherever they overlap, whatever order they are listed in', () => {
    const list = globeShapes;
    let overlaps = 0;
    for (const turn of [0, 0.8, Math.PI / 2, 2.4, Math.PI, 4, (3 * Math.PI) / 2, 5.5]) {
      const alone = list.map((s) => drawn(turn, [s]));
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const ai = alone[i] as Drawn;
          const aj = alone[j] as Drawn;
          const both: number[] = [];
          for (let p = 0; p < ai.a.length; p++) if (solid(ai, p) && solid(aj, p)) both.push(p);
          if (both.length === 0) continue;
          const si = list[i] as GlobeShape;
          const sj = list[j] as GlobeShape;
          const iNearer = nearer(si, sj, turn);
          if (iNearer === undefined) continue;
          const [near, far, nearAlone] = iNearer ? [si, sj, ai] : [sj, si, aj];
          for (const order of [[near, far], [far, near]]) {
            const d = drawn(turn, order);
            for (const p of both) {
              overlaps++;
              if (d.a[p] !== nearAlone.a[p]) {
                expect.fail(`turn ${turn}: ${far.kind} at ${far.x},${far.z} drawn over the nearer ${near.kind} at ${near.x},${near.z} (pixel ${p % W},${Math.floor(p / W)})`);
              }
            }
          }
        }
      }
    }
    expect(overlaps, 'overlapping shape pixels checked').toBeGreaterThan(0);
  });

  it('draws the same picture whatever order the shapes are listed in', () => {
    const reversed = [...globeShapes].reverse();
    const shuffled = globeShapes.map((s, i) => [s, (i * 7) % 10] as const).sort((a, b) => a[1] - b[1]).map(([s]) => s);
    for (const turn of [0, 1.1, 3.9]) {
      const want = Array.from(drawn(turn).a);
      expect(Array.from(drawn(turn, reversed).a), `turn ${turn} reversed`).toEqual(want);
      expect(Array.from(drawn(turn, shuffled).a), `turn ${turn} shuffled`).toEqual(want);
    }
  });

  it('draws nothing for an empty shape list', () => {
    const d = drawn(0.7, []);
    expect(d.a.every((c) => c === FILL_A)).toBe(true);
  });

  it.each(SIZES)('changes nothing outside the glass (inside its rim) and nothing on the base rows at %s x %s, at every turn', (width, height) => {
    const layout = sceneLayout(width, height, SEED);
    let touched = 0;
    for (let k = 0; k < 12; k++) {
      const turn = (k * FULL) / 12;
      const d = drawn(turn, globeShapes, layout);
      for (let i = 0; i < d.a.length; i++) {
        if (bare(d, i)) continue;
        touched++;
        const x = i % width;
        const y = Math.floor(i / width);
        if (!inCircle(layout, x, y, -1)) expect.fail(`turn ${turn.toFixed(2)}: pixel ${x},${y} outside the glass was drawn`);
        if (y >= layout.groundTop) expect.fail(`turn ${turn.toFixed(2)}: pixel ${x},${y} on the base was drawn`);
      }
    }
    expect(touched).toBeGreaterThan(0);
  });

  it('turns the shapes by in-between shades: 0.01 rad never flips a pixel between untouched and wholly covered', () => {
    for (const from of [0.5, 2.0, 4.4]) {
      let prev = drawn(from);
      for (let k = 1; k <= 12; k++) {
        const turn = from + k * 0.01;
        const next = drawn(turn);
        let moved = 0;
        let between = 0;
        for (let i = 0; i < next.a.length; i++) {
          if (prev.a[i] !== next.a[i]) moved++;
          if (!bare(next, i) && !solid(next, i)) between++;
          if ((bare(prev, i) && solid(next, i)) || (solid(prev, i) && bare(next, i))) {
            expect.fail(`turn ${(turn - 0.01).toFixed(2)} -> ${turn.toFixed(2)}: pixel ${i % W},${Math.floor(i / W)} jumped a whole step`);
          }
        }
        expect(moved, `turn ${turn.toFixed(2)}: pixels that moved`).toBeGreaterThan(0);
        expect(between, `turn ${turn.toFixed(2)}: in-between shades`).toBeGreaterThan(0);
        prev = next;
      }
    }
  });

  it('comes back to the same picture after whole turns, and a negative turn equals the same turn a circle on', () => {
    const zero = Array.from(drawn(0).a);
    expect(zero.some((c) => c !== FILL_A)).toBe(true);
    for (const t of [FULL, -FULL, 2 * FULL]) expect(Array.from(drawn(t).a), `turn ${t}`).toEqual(zero);
    expect(Array.from(drawn(-0.5).a)).toEqual(Array.from(drawn(FULL - 0.5).a));
  });

  it('gives the same picture for the same inputs', () => {
    const a = drawn(2.2, globeShapes, LAYOUT, READINGS[4]?.[1] ?? NIGHT);
    const b = drawn(2.2, globeShapes, LAYOUT, READINGS[4]?.[1] ?? NIGHT);
    expect(solidIndexes(a).length).toBeGreaterThan(0);
    expect(Array.from(b.a)).toEqual(Array.from(a.a));
    expect(Array.from(b.b)).toEqual(Array.from(a.b));
  });

  it('draws no checkerboard dither in its edges, shades and shadows', () => {
    for (const [name, phase] of READINGS) {
      for (const turn of [0, 0.7, 2.1, 5]) {
        const d = drawn(turn, globeShapes, LAYOUT, phase);
        for (let y = 0; y + 1 < H; y++) {
          for (let x = 0; x + 1 < W; x++) {
            const quad = [y * W + x, y * W + x + 1, (y + 1) * W + x, (y + 1) * W + x + 1];
            // A block wholly inside a drawing shows the drawing's own pattern.
            if (quad.every((i) => solid(d, i))) continue;
            for (const pic of [d.a, d.b]) {
              const [p, q, r, s] = quad.map((i) => pic[i] ?? -1) as [number, number, number, number];
              if (p !== q && p === s && q === r) expect.fail(`${name} turn ${turn}: checkerboard at ${x},${y}`);
            }
          }
        }
      }
    }
  });

  it('casts the shapes\' shadows on the floor, darker than it and away from the disc at the top left, whatever the turn', () => {
    const { cy } = LAYOUT.globe;
    for (const turn of [0, 1.3, Math.PI, 4.5]) {
      const picture = new Uint32Array(W * H).fill(FILL_MID);
      drawShapes(picture, W, LAYOUT, NIGHT, turn);
      const mask = faceMask(LAYOUT, turn);
      let shadow = 0;
      let shadowX = 0;
      let bodies = 0;
      let bodyX = 0;
      for (let i = 0; i < picture.length; i++) {
        const x = i % W;
        const y = Math.floor(i / W);
        if (mask[i] === 1) {
          bodies++;
          bodyX += x;
          continue;
        }
        const c = picture[i] ?? FILL_MID;
        if (c === FILL_MID) continue;
        if (brightness(c) >= brightness(FILL_MID)) expect.fail(`turn ${turn}: pixel ${x},${y} off every shape was drawn and is not a darker shadow`);
        if (y < cy + floorDisc.y - floorDisc.radius) expect.fail(`turn ${turn}: shadow pixel ${x},${y} above the floor`);
        shadow++;
        shadowX += x;
      }
      expect(shadow, `turn ${turn}: shadow pixels on the floor`).toBeGreaterThanOrEqual(10);
      expect(shadowX / shadow, `turn ${turn}: shadows fall right of the shapes, away from the light`).toBeGreaterThan(bodyX / bodies);
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('throws a RangeError for a turn of %s and leaves the picture alone', (turn) => {
    const picture = new Uint32Array(W * H).fill(FILL_A);
    expect(() => drawShapes(picture, W, LAYOUT, NIGHT, turn)).toThrow(RangeError);
    expect(picture.every((c) => c === FILL_A)).toBe(true);
  });
});

/** The convex hull of points, anticlockwise in screen terms (Andrew's monotone chain). */
function hull(points: readonly (readonly [number, number])[]): [number, number][] {
  const p = [...points].map(([x, y]): [number, number] => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as [number, number], lower[lower.length - 1] as [number, number], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2] as [number, number], upper[upper.length - 1] as [number, number], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** How far a point lies inside a convex ring: the distance to its nearest edge, negative when outside. */
function depthInside(px: number, py: number, ring: readonly (readonly [number, number])[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i] ?? [0, 0];
    const [bx, by] = ring[(i + 1) % ring.length] ?? [0, 0];
    best = Math.min(best, segmentDistance(px, py, ax, ay, bx, by));
  }
  return insidePolygon(px, py, ring) ? best : -best;
}

interface ColourRange { lo: [number, number, number]; hi: [number, number, number] }

/**
 * The range, channel by channel, of the colours a face's drawing shows under
 * picture pixel (x, y): any share of those drawing pixels lies inside it.
 * Undefined when the pixel is not wholly inside the face. A four-cornered
 * face's corners are its drawing's top left, top right, bottom right and
 * bottom left.
 */
function colourRange(f: ProjectedFace, layout: SceneLayout, x: number, y: number): ColourRange | undefined {
  if (f.corners.length !== 4) return undefined;
  const d = drawing(f.drawing);
  const [a, b, , c] = f.corners as [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
  const ux = (b[0] - a[0]) / d.width;
  const uy = (b[1] - a[1]) / d.width;
  const vx = (c[0] - a[0]) / d.height;
  const vy = (c[1] - a[1]) / d.height;
  const det = ux * vy - vx * uy;
  if (Math.abs(det) < 0.05) return undefined;
  const us: number[] = [];
  const vs: number[] = [];
  for (const [ox, oy] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
    const dx = x + ox - layout.globe.cx - a[0];
    const dy = y + oy - layout.globe.cy - a[1];
    us.push((vy * dx - vx * dy) / det);
    vs.push((-uy * dx + ux * dy) / det);
  }
  const EPS = 1e-6;
  if (Math.min(...us) < -EPS || Math.max(...us) > d.width + EPS || Math.min(...vs) < -EPS || Math.max(...vs) > d.height + EPS) return undefined;
  const lo: [number, number, number] = [255, 255, 255];
  const hi: [number, number, number] = [0, 0, 0];
  for (let v = Math.max(0, Math.floor(Math.min(...vs) + EPS)); v < Math.min(d.height, Math.ceil(Math.max(...vs) - EPS)); v++) {
    for (let u = Math.max(0, Math.floor(Math.min(...us) + EPS)); u < Math.min(d.width, Math.ceil(Math.max(...us) - EPS)); u++) {
      const here = colourAt(d, u, v);
      if (here < 0) return undefined;
      rgb(here).forEach((ch, i) => {
        lo[i] = Math.min(lo[i] ?? 255, ch);
        hi[i] = Math.max(hi[i] ?? 0, ch);
      });
    }
  }
  return { lo, hi };
}

/** Whether a colour lies within a range, give or take a rounding step. */
function withinRange(colour: number, r: ColourRange): boolean {
  return rgb(colour).every((ch, i) => ch >= (r.lo[i] ?? 0) - 1 && ch <= (r.hi[i] ?? 255) + 1);
}

/** Whether two ranges are clearly apart in some channel, so a mix of the two lies in neither. */
function apart(p: ColourRange, q: ColourRange): boolean {
  return [0, 1, 2].some((i) => (p.lo[i] ?? 0) - (q.hi[i] ?? 0) > 16 || (q.lo[i] ?? 0) - (p.hi[i] ?? 0) > 16);
}

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

describe('drawShapes: the house is one solid, its own faces hiding each other', () => {
  // Review bug 1: the gable ends are see-through. The house (box walls under
  // a roof) is a convex solid, so its outline on screen is the convex hull of
  // its visible walls' and roof's corners; every pixel well inside it must be
  // wholly covered by the house, over any background.
  const HOUSE_TURNS = [0, 0.3, 0.8, 1.2, Math.PI / 2, 2, 2.6, Math.PI, 3.8, 4.4, (3 * Math.PI) / 2, 5.1, 5.8];

  it.each(HOUSE_TURNS)('covers every pixel well inside the house outline at turn %s, gable ends included', (turn) => {
    const house = only(houses());
    const body = projectShape(house, turn).filter((f) => f.drawing !== 'house-chimney');
    expect(body.length, 'house walls and roof shown').toBeGreaterThan(0);
    const outline = hull(body.flatMap((f) => f.corners));
    const d = drawn(turn, [house]);
    const { cx, cy } = LAYOUT.globe;
    let inside = 0;
    const holes: string[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (depthInside(x + 0.5 - cx, y + 0.5 - cy, outline) < 1.5) continue;
        inside++;
        if (!solid(d, y * W + x)) holes.push(`${x},${y}`);
      }
    }
    expect(inside, 'pixels well inside the house outline').toBeGreaterThan(50);
    expect(holes, `turn ${turn.toFixed(2)}: pixels inside the house that show the background`).toEqual([]);
  });

  // Review bug 2: where the house's own faces overlap on screen (the chimney
  // over the roof slope behind it, one slope folding over the other), the
  // pixel shows one face's colour, never the average of the two. Shared edges
  // still blend: those pixels lie on no face's whole interior, so they are not
  // checked here, and the outline test above keeps them solid.
  it('shows one face\'s own colour, never a mix of two, wherever the house\'s faces overlap', () => {
    const house = only(houses());
    let overlaps = 0;
    const mixed: string[] = [];
    for (let k = 0; k < 48; k++) {
      const turn = (k * FULL) / 48;
      const faces = projectShape(house, turn);
      const d = drawn(turn, [house]);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const shown = faces.map((f) => colourRange(f, LAYOUT, x, y)).filter((r): r is ColourRange => r !== undefined);
          if (!shown.some((p, i) => shown.some((q, j) => j > i && apart(p, q)))) continue;
          overlaps++;
          const got = d.a[y * W + x] ?? -1;
          if (!shown.some((r) => withinRange(got, r)) && mixed.length < 8) {
            mixed.push(`turn ${turn.toFixed(2)} pixel ${x},${y}: ${hex(got)} lies in none of the overlapping faces' colours`);
          }
        }
      }
    }
    expect(overlaps, 'overlapping house face pixels checked').toBeGreaterThan(0);
    expect(mixed, 'overlap pixels showing a mix of two faces').toEqual([]);
  });

  it('draws the chimney over the roof slope behind it at a quarter turn, in the chimney\'s own colours', () => {
    const house = only(houses());
    const turn = Math.PI / 2;
    const faces = projectShape(house, turn);
    const chimney = face(faces, 'house-chimney');
    if (chimney === undefined) expect.fail('no chimney at a quarter turn');
    const roofs = faces.filter((f) => f.drawing.startsWith('house-roof-'));
    expect(roofs.length, 'roof slopes shown at a quarter turn').toBeGreaterThan(0);
    const chimneyColours = palette(drawing('house-chimney'));
    // Only the chimney's upper part: below that a nearer stretch of the
    // slope may rightly pass in front of the chimney's foot.
    const foot = Math.max(...ys(chimney)) - 2;
    const d = drawn(turn, [house]);
    let checked = 0;
    const wrong: string[] = [];
    for (let y = 0; y < H; y++) {
      if (y + 1 - LAYOUT.globe.cy > foot) continue;
      for (let x = 0; x < W; x++) {
        const own = colourRange(chimney, LAYOUT, x, y);
        if (own === undefined) continue;
        if (!roofs.some((f) => {
          const r = colourRange(f, LAYOUT, x, y);
          return r !== undefined && apart(r, own);
        })) continue;
        checked++;
        const got = d.a[y * W + x] ?? -1;
        if (!withinRange(got, own)) wrong.push(`${x},${y}: ${hex(got)} is not in the chimney's colours${chimneyColours.has(got) ? '' : ' (nor any chimney colour)'}`);
      }
    }
    expect(checked, 'chimney pixels over a roof slope').toBeGreaterThan(0);
    expect(wrong, 'chimney pixels over the roof slope').toEqual([]);
  });
});

describe('sceneFrame: the shapes in the globe', () => {
  it('draws the shapes inside the globe: the picture differs from the slice-1 globe, showing drawShapes\' covered pixels', () => {
    for (const [name, phase] of READINGS.slice(0, 4)) {
      const f = sceneFrame(input({ phase, turn: 0 }));
      const d = drawn(0, globeShapes, f.layout, phase);
      const covered = solidIndexes(d);
      expect(covered.length).toBeGreaterThan(0);
      const shown = covered.filter((i) => f.picture[i] === d.a[i]).length;
      expect(shown / covered.length, `${name}: share of the shapes shown as drawn (reflections may pass over some)`).toBeGreaterThanOrEqual(0.8);
    }
  });

  it.each(SIZES)('changes nothing outside the glass and nothing on the base compared with the slice-1 globe at %s x %s', (width, height) => {
    for (const [name, phase] of [READINGS[0], READINGS[4]] as [string, PhaseReading][]) {
      for (const turn of [0, 1.3, 4]) {
        const f = sceneFrame(input({ width, height, phase, turn }));
        const b = noShapes({ width, height, phase, turn });
        let changed = 0;
        for (let i = 0; i < f.picture.length; i++) {
          if (f.picture[i] === b.picture[i]) continue;
          changed++;
          const x = i % width;
          const y = Math.floor(i / width);
          if (!inCircle(f.layout, x, y, -1)) expect.fail(`${name} turn ${turn}: pixel ${x},${y} outside the glass changed`);
          if (y >= f.layout.groundTop) expect.fail(`${name} turn ${turn}: pixel ${x},${y} on the base changed`);
        }
        expect(changed, `${name} turn ${turn}: pixels the shapes changed`).toBeGreaterThan(0);
      }
    }
  });

  it('casts the shadows on the glass floor: off the shapes, every change from the slice-1 globe is darker', () => {
    for (const [name, phase] of READINGS) {
      const f = sceneFrame(input({ phase, turn: 0.6 }));
      const b = noShapes({ phase, turn: 0.6 });
      const mask = faceMask(f.layout, 0.6);
      let darker = 0;
      for (let i = 0; i < f.picture.length; i++) {
        if (mask[i] === 1 || f.picture[i] === b.picture[i]) continue;
        if (brightness(f.picture[i] ?? 0) >= brightness(b.picture[i] ?? 0)) expect.fail(`${name}: pixel ${i % W},${Math.floor(i / W)} off the shapes is not a darker shadow`);
        darker++;
      }
      expect(darker, `${name}: shadow pixels`).toBeGreaterThanOrEqual(10);
    }
  });
});
