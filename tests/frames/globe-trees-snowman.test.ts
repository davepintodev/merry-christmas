// XMAS-32c "The globe", slice 3: the three pines and the snowman inside the
// globe (XMAS-32 acceptance criteria). The pines and the snowman's body are
// flat drawings that always face the visitor, like the lamp post: never
// narrowed, mirrored or turned, standing on the floor disc and carried round
// with it. The snowman's face, arms and scarf turn with the globe: his face
// shows at turn 0; half a turn on, his back shows (no face, arms and scarf from
// behind). Everything is blended on the fixed grid, takes its place in the
// depth order with the turning shapes, and keeps its colours in every phase
// (only the glass tints).
//
// Interface pinned here: ShapeKind gains 'pine' and 'snowman'; globeShapes
// holds the three pines and the one snowman next to the ten turning shapes;
// projectShape(pine, turn) returns one face named after its drawing, and
// projectShape(snowman, turn) returns 'snowman-body' plus, when seen,
// 'snowman-face', 'snowman-arms' and 'snowman-scarf'. A four-cornered face's
// corners are its drawing's top left, top right, bottom right and bottom left.
import { describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { drawings, type Drawing } from '../../src/shared/art.generated.ts';
import type { PhaseName, PhaseReading } from '../../src/shared/clock.ts';
import { GLOBE_RADIUS, sceneFrame, sceneLayout, type SceneLayout } from '../../src/scene/frame.ts';
import { drawShapes } from '../../src/scene/shapes-draw.ts';
import { globeShapes, onFloor, projectPoint, projectShape, type GlobeShape, type ProjectedFace } from '../../src/scene/shapes.ts';

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
const SIZES: [number, number][] = [[W, H], [320, 180], [240, 300], [161, 172], [2 * GLOBE_RADIUS, 172]];
/** Two backgrounds no drawing uses: a pixel that comes out the same over both is wholly covered by a shape. */
const FILL_A = 0x010203;
const FILL_B = 0xfdfcfb;
const LAYOUT = sceneLayout(W, H, SEED);
const NIGHT: PhaseReading = { from: 'purple-night', to: 'purple-night', share: 0 };
/** The rows below the globe's centre still above the base, in the shortest picture. */
const LOWEST_FREE = Math.min(...SIZES.map(([w, h]) => sceneLayout(w, h, SEED)).map((l) => l.groundTop - l.globe.cy));
/** Every colour any drawing uses: the only colours a shape pixel may take besides the floor shadow's shade. */
const SPRITE_COLOURS = new Set<number>(Object.values(drawings).flatMap((d) => [...palette(d)]));
const SNOWMAN_DRAWINGS = ['snowman-body', 'snowman-face', 'snowman-arms', 'snowman-scarf', 'snowman-buttons'];
const TURNING_KINDS = new Set(['house', 'present', 'lamp-post']);

function hexNum(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function rgb(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The floor shadow's flat shade (shapes-draw.ts): this ink at this share over what is under it. */
const SHADOW_INK = 0x1d3350;
const SHADOW_SHARE = 0.32;

function shadeOver(under: number): number {
  const [r, g, b] = rgb(under);
  const [ir, ig, ib] = rgb(SHADOW_INK);
  const mix = (u: number, i: number): number => Math.round(u + (i - u) * SHADOW_SHARE);
  return (mix(r, ir) << 16) | (mix(g, ig) << 8) | mix(b, ib);
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

function opaqueCount(d: Drawing): number {
  return Array.from(d.pixels).filter((n) => n !== 0).length;
}

function only<T>(list: readonly T[]): T {
  expect(list.length).toBe(1);
  const first = list[0];
  if (first === undefined) expect.fail('empty list');
  return first;
}

const pines = (): GlobeShape[] => globeShapes.filter((s) => s.kind === 'pine');
const snowmen = (): GlobeShape[] => globeShapes.filter((s) => s.kind === 'snowman');
const figures = (): GlobeShape[] => [...pines(), ...snowmen()];
const turning = (): GlobeShape[] => globeShapes.filter((s) => TURNING_KINDS.has(s.kind));

/** The one drawing a pine carries. */
const pineName = (pine: GlobeShape): string => only(projectShape(pine, 0)).drawing;

function must(faces: readonly ProjectedFace[], name: string, why: string): ProjectedFace {
  const f = faces.find((g) => g.drawing === name);
  if (f === undefined) expect.fail(`${why}: no ${name} face`);
  return f;
}

const names = (faces: readonly ProjectedFace[]): string[] => faces.map((f) => f.drawing);
const xs = (f: ProjectedFace): number[] => f.corners.map((c) => c[0]);
const ys = (f: ProjectedFace): number[] => f.corners.map((c) => c[1]);
const centreX = (f: ProjectedFace): number => xs(f).reduce((s, x) => s + x, 0) / f.corners.length;

function corner(f: ProjectedFace, i: number): readonly [number, number] {
  const c = f.corners[i];
  if (c === undefined) expect.fail(`${f.drawing} has no corner ${i}`);
  return c;
}

/** A face that is its drawing as drawn: four corners, upright, unmirrored, at the drawing's own size. */
function expectUpright(f: ProjectedFace, why: string): void {
  const d = drawing(f.drawing);
  expect(f.corners.length, `${why}: four corners`).toBe(4);
  const [tl, tr, br, bl] = [corner(f, 0), corner(f, 1), corner(f, 2), corner(f, 3)];
  const checks: [string, number, number][] = [
    ['top edge runs left to right at full width', tr[0] - tl[0], d.width],
    ['top edge level', tr[1] - tl[1], 0],
    ['left edge runs down at full height', bl[1] - tl[1], d.height],
    ['left edge upright', bl[0] - tl[0], 0],
    ['bottom edge at full width', br[0] - bl[0], d.width],
    ['right edge at full height', br[1] - tr[1], d.height],
  ];
  for (const [what, got, want] of checks) expect(got, `${why}: ${what}`).toBeCloseTo(want, 6);
}

/** The middle of the face's foot is on the shape's floor point at turn t. */
function expectOnFoot(f: ProjectedFace, s: GlobeShape, t: number, why: string): void {
  const [footX, footY] = projectPoint(s.x, s.z, 0, t);
  expect(Math.abs(centreX(f) - footX), `${why}: foot across`).toBeLessThanOrEqual(0.25);
  expect(Math.abs(Math.max(...ys(f)) - footY), `${why}: foot on the floor`).toBeLessThanOrEqual(0.25);
}

/** The face's left and top edges, in the default layout, are whole art pixels. */
function expectOnGrid(f: ProjectedFace, why: string): void {
  const left = LAYOUT.globe.cx + Math.min(...xs(f));
  const top = LAYOUT.globe.cy + Math.min(...ys(f));
  expect(Math.abs(left - Math.round(left)), `${why}: left edge on the grid`).toBeLessThan(1e-9);
  expect(Math.abs(top - Math.round(top)), `${why}: top edge on the grid`).toBeLessThan(1e-9);
}

interface Drawn { a: Uint32Array; b: Uint32Array; layout: SceneLayout; width: number }

/** drawShapes over the two plain backgrounds. */
function drawn(turn: number, shapes: readonly GlobeShape[], layout: SceneLayout = LAYOUT, phase: PhaseReading = NIGHT): Drawn {
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

const bare = (d: Drawn, i: number): boolean => d.a[i] === FILL_A && d.b[i] === FILL_B;
const solidIndexes = (d: Drawn): number[] => Array.from(d.a, (_, i) => i).filter((i) => solid(d, i));

/** The colours wholly covered pixels show. */
function solidColours(d: Drawn): Set<number> {
  return new Set(solidIndexes(d).map((i) => d.a[i] ?? -1));
}

/**
 * Whether a is nearer the visitor than b at turn t, from the axis their
 * footprints are apart on (as in shapes.test.ts). Undefined when that does
 * not settle it.
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

/** The colours only a snowman part shows, none of the body's: the face's own colours (the nose). */
function onlyIn(name: string, others: readonly string[]): Set<number> {
  const out = palette(drawing(name));
  for (const o of others) for (const c of palette(drawing(o))) out.delete(c);
  return out;
}

/**
 * The drawing's opaque pixels, placed where `f` puts them at turn 0 on the grid,
 * that are not painted as drawn over both backgrounds (`skip` leaves some out).
 * Returns how many were checked and the "x,y" of each that is wrong.
 */
function paintedAsDrawn(pic: Drawn, f: ProjectedFace, skip: (px: number, py: number) => boolean = () => false): { checked: number; wrong: string[] } {
  const d = drawing(f.drawing);
  const left = Math.round(LAYOUT.globe.cx + Math.min(...xs(f)));
  const top = Math.round(LAYOUT.globe.cy + Math.min(...ys(f)));
  let checked = 0;
  const wrong: string[] = [];
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const want = colourAt(d, x, y);
      if (want < 0 || skip(left + x + 0.5 - LAYOUT.globe.cx, top + y + 0.5 - LAYOUT.globe.cy)) continue;
      checked++;
      const i = (top + y) * W + left + x;
      if (pic.a[i] !== want || pic.b[i] !== want) wrong.push(`${x},${y}`);
    }
  }
  return { checked, wrong };
}

/**
 * Draws `shape` alone over a plain background at every 0.001 rad all the way
 * round, in the smallest picture. Returns the first pixel that is not crisp
 * (neither the background, one of the drawings' own colours nor the floor
 * shadow's flat shade, once or laid over itself) and, for the pixels in a
 * drawing's own colours, the furthest any edge of their box jumped in one
 * step, with where.
 */
function sweep(shape: GlobeShape | readonly GlobeShape[], layout: SceneLayout = sceneLayout(161, 172, SEED)): { bad: string; jump: number; where: string } {
  const shapes: readonly GlobeShape[] = Array.isArray(shape) ? shape : [shape as GlobeShape];
  const width = layout.width;
  const allowed = new Set<number>([FILL_A, ...SPRITE_COLOURS]);
  let shade = FILL_A;
  for (let n = 0; n < 4; n++) {
    shade = shadeOver(shade);
    allowed.add(shade);
  }
  const paint = (t: number): Uint32Array => {
    const pic = new Uint32Array(width * layout.height).fill(FILL_A);
    drawShapes(pic, width, layout, NIGHT, t, shapes);
    return pic;
  };
  const boxOf = (pic: Uint32Array): [number, number, number, number] => {
    let box: [number, number, number, number] = [Infinity, -Infinity, Infinity, -Infinity];
    pic.forEach((c, i) => {
      if (SPRITE_COLOURS.has(c)) box = [Math.min(box[0], i % width), Math.max(box[1], i % width), Math.min(box[2], Math.floor(i / width)), Math.max(box[3], Math.floor(i / width))];
    });
    return box;
  };
  const STEP = 0.001;
  let prev = boxOf(paint(0));
  let bad = '';
  let jump = 0;
  let where = '';
  for (let k = 1; k * STEP <= FULL + STEP; k++) {
    const t = k * STEP;
    const pic = paint(t);
    if (bad === '') {
      for (let i = 0; i < pic.length; i++) {
        if (!allowed.has(pic[i] ?? -1)) {
          bad = `turn ${t.toFixed(3)} pixel ${i % width},${Math.floor(i / width)}: ${(pic[i] ?? 0).toString(16)}`;
          break;
        }
      }
    }
    const next = boxOf(pic);
    // A single drawing's box moves by whole pixels, never far, as it turns (a shape that comes into or leaves the picture aside).
    if (Number.isFinite(prev[0]) && Number.isFinite(next[0])) {
      const step = Math.max(...next.map((v, j) => Math.abs(v - (prev[j] ?? 0))));
      if (step > jump) {
        jump = step;
        where = `turn ${(t - STEP).toFixed(3)} -> ${t.toFixed(3)}`;
      }
    }
    prev = next;
  }
  return { bad, jump, where };
}

describe('globeShapes: the pines and the snowman', () => {
  it('holds three pines, one of each pine drawing, each as wide and tall as its drawing', () => {
    const list = pines();
    expect(list.length).toBe(3);
    expect(list.map(pineName).sort()).toEqual(['pine-1', 'pine-2', 'pine-3']);
    for (const p of list) {
      const d = drawing(pineName(p));
      expect([p.width, p.height], `${pineName(p)} size`).toEqual([d.width, d.height]);
      expect(p.depth, `${pineName(p)} stands on a footprint`).toBeGreaterThan(0);
      expect(p.design, `${pineName(p)} carries no present design`).toBeUndefined();
    }
  });

  it('holds one snowman as wide and tall as his body drawing, next to the ten turning shapes', () => {
    const snowman = only(snowmen());
    const body = drawing('snowman-body');
    expect([snowman.width, snowman.height]).toEqual([body.width, body.height]);
    expect(snowman.depth).toBeGreaterThan(0);
    expect(snowman.design).toBeUndefined();
    expect(turning().length).toBe(10);
    expect(globeShapes.length).toBe(14);
  });

  it('stands each pine and the snowman on the floor disc, inside the glass and above the base, at every turn', () => {
    expect(figures().length).toBe(4);
    for (const s of figures()) {
      for (let k = 0; k < 72; k++) {
        const t = (k * FULL) / 72;
        const [footX, footY] = projectPoint(s.x, s.z, 0, t);
        expect(onFloor(footX, footY), `${s.kind} at ${s.x},${s.z} turn ${t.toFixed(2)}: foot off the floor`).toBe(true);
        for (const f of projectShape(s, t)) {
          for (const [x, y] of f.corners) {
            expect(Math.hypot(x, y), `${s.kind} turn ${t.toFixed(2)} ${f.drawing}: corner past the rim`).toBeLessThanOrEqual(GLOBE_RADIUS - 2.5);
            expect(y, `${s.kind} turn ${t.toFixed(2)} ${f.drawing}: corner over the base`).toBeLessThanOrEqual(LOWEST_FREE);
          }
        }
      }
    }
  });
});

describe('globeShapes: room round the pines and the snowman', () => {
  /**
   * How far a figure's drawings reach either side of its foot on screen, at
   * any turn: a drawing that always faces the visitor sweeps a disc of this
   * radius round its floor point as the globe turns.
   */
  function reach(s: GlobeShape): number {
    let most = 0;
    for (let k = 0; k < 72; k++) {
      const t = (k * FULL) / 72;
      const [footX] = projectPoint(s.x, s.z, 0, t);
      for (const f of projectShape(s, t)) for (const x of xs(f)) most = Math.max(most, Math.abs(x - footX));
    }
    return most;
  }

  /** The distance on the floor from a point to a shape's footprint box: zero inside it. */
  function toFootprint(x: number, z: number, s: GlobeShape): number {
    const dx = Math.max(0, Math.abs(x - s.x) - s.width / 2);
    const dz = Math.max(0, Math.abs(z - s.z) - s.depth / 2);
    return Math.hypot(dx, dz);
  }

  // Review bug (XMAS-32c round 2): drawShapes puts shapes in depth order by
  // their middles, so a figure whose drawing could reach another shape's
  // footprint at some turn would swap order with it while they overlap.
  it('keeps every pine and the snowman clear of every other shape: its drawing\'s reach round its foot never meets another footprint', () => {
    const clashes: string[] = [];
    for (const fig of figures()) {
      const r = reach(fig);
      expect(r, `${fig.kind} at ${fig.x},${fig.z}: reach`).toBeGreaterThanOrEqual(fig.width / 2 - 1e-6);
      for (const other of globeShapes) {
        if (other === fig) continue;
        const gap = figures().includes(other)
          ? Math.hypot(fig.x - other.x, fig.z - other.z) - r - reach(other)
          : toFootprint(fig.x, fig.z, other) - r;
        if (gap <= 0) clashes.push(`${fig.kind} at ${fig.x},${fig.z} (reach ${r.toFixed(2)}) and ${other.kind} at ${other.x},${other.z}: ${gap.toFixed(2)}`);
      }
    }
    expect(clashes, 'figures whose drawings can reach another shape').toEqual([]);
  });
});

describe('projectShape: the pines always face the visitor', () => {
  it('shows each pine as its one drawing, upright, unmirrored and at full size, standing on its floor point, at every turn', () => {
    for (const p of pines()) {
      const name = pineName(p);
      for (let k = 0; k < 48; k++) {
        const t = (k * FULL) / 48;
        const f = only(projectShape(p, t));
        expect(f.drawing, `turn ${t.toFixed(2)}`).toBe(name);
        expectUpright(f, `${name} turn ${t.toFixed(2)}`);
      }
      for (const t of [0, 0.7, Math.PI / 2, 2.9, Math.PI, 4.6, -1.2]) expectOnFoot(only(projectShape(p, t)), p, t, `${name} turn ${t}`);
    }
  });
});

describe('projectShape: the snowman', () => {
  it('shows his body as its drawing, upright and at full size, standing on his floor point at every turn', () => {
    const snowman = only(snowmen());
    for (let k = 0; k < 48; k++) {
      const t = (k * FULL) / 48;
      const faces = projectShape(snowman, t);
      for (const n of names(faces)) expect(SNOWMAN_DRAWINGS, `snowman face ${n}`).toContain(n);
      const body = must(faces, 'snowman-body', `turn ${t.toFixed(2)}`);
      expectUpright(body, `snowman-body turn ${t.toFixed(2)}`);
      expectOnFoot(body, snowman, t, `turn ${t.toFixed(2)}: body`);
    }
  });

  it('shows his face, arms and scarf at turn 0, the face on his head within the body', () => {
    const faces = projectShape(only(snowmen()), 0);
    expect(names(faces)).toEqual(expect.arrayContaining(SNOWMAN_DRAWINGS));
    const body = must(faces, 'snowman-body', 'turn 0');
    const head = must(faces, 'snowman-face', 'turn 0');
    expect(Math.min(...xs(head))).toBeGreaterThanOrEqual(Math.min(...xs(body)) - 1e-6);
    expect(Math.max(...xs(head))).toBeLessThanOrEqual(Math.max(...xs(body)) + 1e-6);
    const mid = (Math.min(...ys(body)) + Math.max(...ys(body))) / 2;
    expect(Math.max(...ys(head)), 'the face sits in the upper half of the body').toBeLessThanOrEqual(mid);
    expect(Math.min(...ys(head))).toBeGreaterThanOrEqual(Math.min(...ys(body)) - 1e-6);
  });

  it('hides his face for the back half of a turn and shows it for the front half, arms and scarf still there from behind', () => {
    const snowman = only(snowmen());
    for (let k = -8; k <= 8; k++) {
      const front = (k * Math.PI) / 32; // within a quarter turn of facing the visitor
      expect(names(projectShape(snowman, front)), `turn ${front.toFixed(2)}: face shows`).toContain('snowman-face');
      const back = Math.PI + front;
      expect(names(projectShape(snowman, back)), `turn ${back.toFixed(2)}: face hidden`).not.toContain('snowman-face');
    }
    const behind = names(projectShape(snowman, Math.PI));
    expect(behind).toEqual(expect.arrayContaining(['snowman-body', 'snowman-arms', 'snowman-scarf']));
  });

  it('turns his face with the globe: it slides left of his middle for a small turn and right for a small turn back', () => {
    const snowman = only(snowmen());
    const offset = (t: number): number => {
      const faces = projectShape(snowman, t);
      return centreX(must(faces, 'snowman-face', `turn ${t}`)) - centreX(must(faces, 'snowman-body', `turn ${t}`));
    };
    const zero = offset(0);
    expect(offset(0.5), 'turn 0.5 moves the face the way the floor turns').toBeLessThan(zero - 0.2);
    expect(offset(-0.5), 'turn -0.5 moves it the other way').toBeGreaterThan(zero + 0.2);
    expect(offset(0.3)).toBeGreaterThan(offset(0.5));
  });

  it('shows the arms and scarf mirrored from behind: their drawing left side on the screen right at half a turn', () => {
    const snowman = only(snowmen());
    for (const part of ['snowman-arms', 'snowman-scarf']) {
      const ahead = must(projectShape(snowman, 0), part, 'turn 0');
      expect(corner(ahead, 1)[0] - corner(ahead, 0)[0], `${part} turn 0: drawn as drawn`).toBeGreaterThan(0);
      const behind = must(projectShape(snowman, Math.PI), part, 'turn π');
      expect(corner(behind, 1)[0] - corner(behind, 0)[0], `${part} turn π: seen from behind`).toBeLessThan(0);
    }
  });
});

describe('drawShapes: the pines and the snowman in the picture', () => {
  it('paints each pine at turn 0 on the grid in its own drawing colours, pixel for pixel', () => {
    for (const p of pines()) {
      const f = only(projectShape(p, 0));
      expectOnGrid(f, f.drawing);
      expect(paintedAsDrawn(drawn(0, [p]), f).wrong, `${f.drawing}: drawing pixels not painted as drawn`).toEqual([]);
    }
  });

  // XMAS-75: sprites are point-sampled. Off the grid a pine pixel takes the one
  // drawing pixel under its centre, whole: its colour is one of the drawing's
  // own, never a mix of the pixels it straddles. A pine slid off the grid keeps
  // nearly every pixel of its drawing, give or take its edge rows and columns.
  it('keeps each pine whole off the grid, painted as the one drawing pixel under each picture pixel\'s centre, never a mix', () => {
    const { cx, cy } = LAYOUT.globe;
    for (const p of pines()) {
      const name = pineName(p);
      const d = drawing(name);
      const own = palette(d);
      let checked = 0;
      let offGrid = 0;
      const wrong: string[] = [];
      for (let k = 0; k < 24; k++) {
        const t = (k * FULL) / 24 + 0.013;
        const [ax, ay] = corner(only(projectShape(p, t)), 0);
        const pic = drawn(t, [p]);
        const covered = solidIndexes(pic);
        expect(covered.length, `${name} turn ${t.toFixed(2)}: covered pixels`).toBeGreaterThanOrEqual(0.8 * opaqueCount(d));
        expect(covered.length, `${name} turn ${t.toFixed(2)}: no bigger than its drawing`).toBeLessThanOrEqual(opaqueCount(d));
        // Every solid pixel is one of the drawing's own colours.
        for (const i of covered) {
          if (!own.has(pic.a[i] ?? -1)) wrong.push(`turn ${t.toFixed(2)} pixel ${i % W},${Math.floor(i / W)}: ${(pic.a[i] ?? 0).toString(16)} is not a colour of ${name}`);
        }
        const y0 = Math.floor(cy + ay) - 1;
        const x0 = Math.floor(cx + ax) - 1;
        for (let y = y0; y <= y0 + d.height + 2; y++) {
          for (let x = x0; x <= x0 + d.width + 2; x++) {
            const u = x + 0.5 - cx - ax;
            const v = y + 0.5 - cy - ay;
            // A pixel centre on a drawing pixel's edge is a tie: skip it.
            if (Math.abs(u - Math.round(u)) < 1e-6 || Math.abs(v - Math.round(v)) < 1e-6) continue;
            const want = u >= 0 && v >= 0 && u < d.width && v < d.height ? colourAt(d, Math.floor(u), Math.floor(v)) : -1;
            if (want < 0) continue;
            checked++;
            if (Math.abs(ax - Math.round(ax)) > 1e-3) offGrid++;
            const i = y * W + x;
            if ((pic.a[i] !== want || pic.b[i] !== want) && wrong.length < 8) wrong.push(`turn ${t.toFixed(2)} pixel ${x},${y}: ${(pic.a[i] ?? 0).toString(16)} is not the drawing pixel ${want.toString(16)} under its centre`);
          }
        }
      }
      expect(checked, `${name}: pixels checked`).toBeGreaterThan(100);
      expect(offGrid, `${name}: pixels checked off the grid`).toBeGreaterThan(0);
      expect(wrong, `${name}: pixels not the drawing pixel under their centre`).toEqual([]);
    }
  });

  // Review nit (XMAS-32c round 1): which pine drawing a pine carries belongs
  // to the shape itself, not to its identity in the list.
  it('gives a copy of each pine the same drawing as the pine itself', () => {
    for (const p of pines()) {
      const copy: GlobeShape = Object.freeze({ ...p });
      for (const t of [0, 1.3, Math.PI]) expect(only(projectShape(copy, t)).drawing, `copy of ${pineName(p)} turn ${t}`).toBe(pineName(p));
    }
  });

  it('paints the snowman body at turn 0 on the grid as drawn, wherever his face, arms and scarf leave it', () => {
    const snowman = only(snowmen());
    const faces = projectShape(snowman, 0);
    const body = must(faces, 'snowman-body', 'turn 0');
    expectOnGrid(body, 'body');
    expectOnGrid(must(faces, 'snowman-face', 'turn 0'), 'face');
    const parts = faces.filter((f) => f.drawing !== 'snowman-body');
    const nearPart = (px: number, py: number): boolean =>
      parts.some((f) => px >= Math.min(...xs(f)) - 1 && px <= Math.max(...xs(f)) + 1 && py >= Math.min(...ys(f)) - 1 && py <= Math.max(...ys(f)) + 1);
    const { checked, wrong } = paintedAsDrawn(drawn(0, [snowman]), body, nearPart);
    expect(checked, 'body pixels clear of the turning parts').toBeGreaterThanOrEqual(20);
    expect(wrong, 'body pixels not painted as drawn').toEqual([]);
  });

  it('shows his face (its own colours) at turn 0 and not from behind, while arms and scarf show both ways', () => {
    const snowman = only(snowmen());
    const faceOnly = onlyIn('snowman-face', ['snowman-body', 'snowman-arms', 'snowman-scarf']);
    expect(faceOnly.size, 'the face has a colour of its own').toBeGreaterThan(0);
    const ahead = solidColours(drawn(0, [snowman]));
    const behind = drawn(Math.PI, [snowman]);
    const behindColours = new Set([...solidColours(behind), ...Array.from(behind.a)]);
    expect([...faceOnly].some((c) => ahead.has(c)), 'face colour at turn 0').toBe(true);
    expect([...faceOnly].filter((c) => behindColours.has(c)), 'face colour at turn π').toEqual([]);
    for (const part of ['snowman-arms', 'snowman-scarf']) {
      const own = onlyIn(part, ['snowman-body', 'snowman-face']);
      expect(own.size, `${part} has a colour of its own`).toBeGreaterThan(0);
      expect([...own].some((c) => ahead.has(c)), `${part} at turn 0`).toBe(true);
      expect([...own].some((c) => behindColours.has(c)), `${part} at turn π`).toBe(true);
    }
  });

  // XMAS-75: the pines slide on the grid in whole pixels too, never a mix.
  it.each([
    ['the snowman (his face, arms and scarf turn)', 0, 2],
    ['pine-1', 1, 1],
    ['pine-2', 2, 1],
    ['pine-3', 3, 1],
  ] as const)('turns %s in whole pixels: 0.001 rad never makes a mixed pixel, and its box never jumps more than the limit, all the way round', (label, k, limit) => {
    const sorted = [...pines()].sort((a, b) => pineName(a).localeCompare(pineName(b)));
    const { bad, jump, where } = sweep(k === 0 ? only(snowmen()) : (sorted[k - 1] as GlobeShape));
    expect(bad, `${label}: first pixel that is not crisp`).toBe('');
    expect(jump, `${label}: furthest its box jumped in one step (${where}); limit ${limit}`).toBeLessThanOrEqual(limit);
  }, 60_000);

  // Review bug (XMAS-32c round 2): a pine stood so near a present that its
  // drawing overlaps the present on screen while the two swap depth order
  // flips a whole patch of pixels from one to the other within 0.001 rad.
  // Point-sampled, a swap is a crisp pop by design, so what is pinned is that
  // every pixel stays a drawing's own colour or the shadow's flat shade.
  it('turns the whole globe (all its shapes together) in whole pixels: 0.001 rad never makes a mixed pixel, all the way round', () => {
    const { bad } = sweep(globeShapes, LAYOUT);
    expect(bad, 'first pixel that is not crisp').toBe('');
  }, 300_000);

  // Review gap (XMAS-32c round 3): the pines and the snowman stand clear of
  // the house at the default turn, so the house shows whole.
  it('leaves every house pixel as it was at turn 0 once the pines and the snowman stand in the globe', () => {
    const house = only(globeShapes.filter((s) => s.kind === 'house'));
    const alone = drawn(0, [house]);
    const without = drawn(0, turning());
    const all = drawn(0, globeShapes);
    // The house's pixels the other turning shapes leave as they are.
    const mine = solidIndexes(alone).filter((i) => without.a[i] === alone.a[i] && without.b[i] === alone.b[i]);
    expect(mine.length, 'house pixels at turn 0').toBeGreaterThanOrEqual(28 * 15);
    const changed = mine.filter((i) => all.a[i] !== alone.a[i] || all.b[i] !== alone.b[i]).map((i) => `${i % W},${Math.floor(i / W)}`);
    expect(changed, 'house pixels a pine or the snowman covers at turn 0').toEqual([]);
  });

  it('keeps the pines and the snowman in the same colours in every phase and blend (only the glass tints)', () => {
    for (const turn of [0, 0.8, Math.PI, 3.6]) {
      const first = drawn(turn, figures(), LAYOUT, NIGHT);
      const covered = solidIndexes(first);
      expect(covered.length, `turn ${turn}: pine and snowman pixels`).toBeGreaterThan(0);
      for (const [name, phase] of READINGS) {
        const d = drawn(turn, figures(), LAYOUT, phase);
        for (const i of covered) if (d.a[i] !== first.a[i]) expect.fail(`${name} turn ${turn}: pixel ${i % W},${Math.floor(i / W)} changed colour`);
      }
    }
  });

  it('puts the pines and the snowman in depth order with the turning shapes: the nearer one covers, whatever the list order', () => {
    let overlaps = 0;
    for (let k = 0; k < 24; k++) {
      const turn = (k * FULL) / 24 + 0.05;
      const alone = new Map<GlobeShape, Drawn>(globeShapes.map((s) => [s, drawn(turn, [s])]));
      for (const fig of figures()) {
        for (const other of globeShapes) {
          if (other === fig) continue;
          const af = alone.get(fig) as Drawn;
          const ao = alone.get(other) as Drawn;
          const both: number[] = [];
          for (let p = 0; p < af.a.length; p++) if (solid(af, p) && solid(ao, p)) both.push(p);
          if (both.length === 0) continue;
          const figNearer = nearer(fig, other, turn);
          if (figNearer === undefined) continue;
          const [near, far] = figNearer ? [fig, other] : [other, fig];
          const nearAlone = figNearer ? af : ao;
          for (const order of [[near, far], [far, near]]) {
            const d = drawn(turn, order);
            for (const p of both) {
              overlaps++;
              if (d.a[p] !== nearAlone.a[p]) {
                expect.fail(`turn ${turn.toFixed(2)}: ${far.kind} at ${far.x},${far.z} drawn over the nearer ${near.kind} at ${near.x},${near.z} (pixel ${p % W},${Math.floor(p / W)})`);
              }
            }
          }
        }
      }
    }
    expect(overlaps, 'pixels where a pine or the snowman overlaps another shape').toBeGreaterThan(0);
  });

  it('draws no checkerboard dither in the pines\' and the snowman\'s edges', () => {
    for (const turn of [0, 0.37, Math.PI / 2, 2.1, Math.PI, 4.71, 5.5]) {
      const d = drawn(turn, figures());
      expect(solidIndexes(d).length, `turn ${turn}: drawn`).toBeGreaterThan(0);
      for (let y = 0; y + 1 < H; y++) {
        for (let x = 0; x + 1 < W; x++) {
          const quad = [y * W + x, y * W + x + 1, (y + 1) * W + x, (y + 1) * W + x + 1];
          if (quad.every((i) => solid(d, i))) continue;
          for (const pic of [d.a, d.b]) {
            const [p, q, r, s] = quad.map((i) => pic[i] ?? -1) as [number, number, number, number];
            // A diagonal edge of a crisp sprite against the background is two stair-stepped pixels, not a dither.
            if (SPRITE_COLOURS.has(p) || SPRITE_COLOURS.has(q)) continue;
            if (p !== q && p === s && q === r) expect.fail(`turn ${turn}: checkerboard at ${x},${y}`);
          }
        }
      }
    }
  });

  it.each(SIZES)('touches nothing outside the glass nor on the base at %s x %s, at every turn', (width, height) => {
    const layout = sceneLayout(width, height, SEED);
    let touched = 0;
    for (let k = 0; k < 12; k++) {
      const turn = (k * FULL) / 12;
      const d = drawn(turn, figures(), layout);
      for (let i = 0; i < d.a.length; i++) {
        if (bare(d, i)) continue;
        touched++;
        const x = i % width;
        const y = Math.floor(i / width);
        const dx = x + 0.5 - layout.globe.cx;
        const dy = y + 0.5 - layout.globe.cy;
        if (dx * dx + dy * dy > (layout.globe.radius - 1) ** 2) expect.fail(`turn ${turn.toFixed(2)}: pixel ${x},${y} outside the glass was drawn`);
        if (y >= layout.groundTop) expect.fail(`turn ${turn.toFixed(2)}: pixel ${x},${y} on the base was drawn`);
      }
    }
    expect(touched).toBeGreaterThan(0);
  });
});

describe('sceneFrame: the pines and the snowman in the globe', () => {
  it('shows the pines and the snowman in every phase, as drawShapes paints them', () => {
    for (const [name, phase] of READINGS) {
      const f = sceneFrame({ time: T, drag: 0, phase, seed: SEED, width: W, height: H, turn: 0 });
      const all = drawn(0, globeShapes, f.layout, phase);
      const mine = drawn(0, figures(), f.layout, phase);
      // Only the pixels where a pine or the snowman is what shows in front.
      const covered = solidIndexes(mine).filter((i) => solid(all, i) && all.a[i] === mine.a[i]);
      expect(covered.length, `${name}: pine and snowman pixels in front`).toBeGreaterThanOrEqual(40);
      const shown = covered.filter((i) => f.picture[i] === all.a[i]).length;
      expect(shown / covered.length, `${name}: share shown as drawn (reflections may pass over some)`).toBeGreaterThanOrEqual(0.8);
    }
  });
});
