// XMAS-83 part A: Santa as one sprite draw step in the shapes' draw list. He is
// placed at sub-art-pixel positions, ordered by depth among the shapes (never
// between two faces of one shape), drawn as whole blocks at any whole zoom, and
// no longer painted into the art picture or the front layer.
import { describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { drawings, type Drawing } from '../shared/art.generated.ts';
import type { PhaseReading } from '../shared/clock.ts';
import { BASE_WIDTH, renderBase } from './base-fine.ts';
import { sceneFrame, sceneLayout, type SceneInput, type SceneLayout } from './frame.ts';
import { BASE_SINK, NO_FRONT } from './globe.ts';
import { drawSanta, santaNearness, santaPlacement } from './santa.ts';
import { renderDrawList, renderShadowSteps, shadowDrawList, shapeDrawList, type DrawStep, type SantaDraw } from './shape-draw-list.ts';
import { globeShapes, projectShape, wrapTurn, type GlobeShape } from './shapes.ts';
import { nearness as shapeNearness, shapesFarFirst } from './shapes-draw.ts';

const W = 240;
const H = 180;
const SEED = 12345;
const T = 1_000_000;
const FULL = 2 * Math.PI;
const LAYOUT = sceneLayout(W, H, SEED);
const NIGHT: PhaseReading = { from: 'purple-night', to: 'purple-night', share: 0 };
const FILL = 0x010203;
const COLOURS = masterColours.map((c) => Number.parseInt(c.slice(1), 16));

function isSanta(step: DrawStep): step is SantaDraw {
  return 'sprite' in step;
}

function santaSteps(steps: readonly DrawStep[]): SantaDraw[] {
  return steps.filter(isSanta);
}

/** Where, in the Santa-less list, one shape's faces end and the next shape's begin (0 and the length included). */
function groupBoundaries(shapes: readonly GlobeShape[], turn: number): Set<number> {
  const boundaries = new Set<number>([0]);
  let run = 0;
  for (const shape of shapesFarFirst(shapes, turn)) {
    run += projectShape(shape, turn).length;
    boundaries.add(run);
  }
  return boundaries;
}

/** Santa's step is the only change to the list, and it sits at a shape-group boundary of it. */
function expectSantaBetweenShapes(shapes: readonly GlobeShape[], turn: number, time: number): void {
  const without = shapeDrawList(turn, shapes);
  const steps = shapeDrawList(turn, shapes, time);
  const at = steps.findIndex(isSanta);
  expect(at, `no Santa at turn ${turn}`).toBeGreaterThanOrEqual(0);
  expect(steps.filter((s) => !isSanta(s))).toEqual(without);
  expect(steps).toHaveLength(without.length + 1);
  expect(groupBoundaries(shapes, turn).has(at), `Santa inside a shape at turn ${turn}, index ${at}`).toBe(true);
}

function sceneInput(over: Partial<SceneInput> = {}): SceneInput {
  return { time: T, drag: 0, phase: NIGHT, seed: SEED, width: W, height: H, ...over };
}

function filled(layout: SceneLayout, zoom: number, colour = FILL): Uint32Array {
  return new Uint32Array(layout.width * zoom * layout.height * zoom).fill(colour);
}

/** Only Santa, on a flat fill, at whole `zoom`. */
function santaOnly(turn: number, time: number, zoom: number, layout = LAYOUT): Uint32Array {
  const picture = filled(layout, zoom);
  const santa = santaSteps(shapeDrawList(turn, [], time));
  renderDrawList(picture, layout.width, layout, santa, zoom);
  return picture;
}

function box(x: number, z: number): GlobeShape {
  return { kind: 'present', x, z, width: 8, depth: 8, height: 8, design: 1 };
}

function sprite(name: string): Drawing {
  const d = drawings[name];
  if (d === undefined) throw new Error(`no ${name}`);
  return d;
}

/** Number of 8-connected components of non-FILL pixels, and how many pixels. */
function components(picture: Uint32Array, side: number, background: number): { count: number; pixels: number } {
  const seen = new Uint8Array(picture.length);
  let count = 0;
  let pixels = 0;
  for (let i = 0; i < picture.length; i++) {
    if (picture[i] === background || seen[i]) continue;
    count += 1;
    const stack = [i];
    seen[i] = 1;
    while (stack.length > 0) {
      const p = stack.pop() as number;
      pixels += 1;
      const px = p % side;
      const py = Math.floor(p / side);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= side || ny * side + nx >= picture.length) continue;
          const q = ny * side + nx;
          if (picture[q] !== background && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
  }
  return { count, pixels };
}

describe('shapeDrawList: Santa step', () => {
  it('holds no Santa step when no time is given', () => {
    expect(santaSteps(shapeDrawList(0.7))).toHaveLength(0);
    expect(santaSteps(shapeDrawList(0.7, globeShapes))).toHaveLength(0);
  });

  it('holds exactly one Santa step when a time is given, with or without shapes', () => {
    for (const shapes of [globeShapes, [], [box(10, 10)]]) {
      for (const turn of [0, 1.3, 4.4, -2, 100]) {
        expect(santaSteps(shapeDrawList(turn, shapes, T))).toHaveLength(1);
      }
    }
  });

  it('keeps every shape step when Santa is added', () => {
    const without = shapeDrawList(2.2, globeShapes);
    const withSanta = shapeDrawList(2.2, globeShapes, T).filter((s) => !isSanta(s));
    expect(withSanta).toEqual(without);
  });

  it('builds the step from santaPlacement: position unrounded, squeeze, mirror and trot frame', () => {
    for (const [turn, time] of [[0, 0], [1.1, 12_345], [3.9, 777], [5.5, 100_001]] as const) {
      const place = santaPlacement(turn, time);
      const [step] = santaSteps(shapeDrawList(turn, globeShapes, time));
      expect(step?.x).toBeCloseTo(place.x, 12);
      expect(step?.y).toBeCloseTo(place.y, 12);
      expect(step?.squeeze).toBe(place.squeeze);
      expect(step?.mirrored).toBe(place.mirrored);
      expect(step?.sprite).toBe(sprite(place.trot === 0 ? 'santa-trot-1' : 'santa-trot-2'));
    }
  });

  it('keeps sub-art-pixel positions: two times a hair apart give different x or y', () => {
    const [a] = santaSteps(shapeDrawList(1, [], 5000));
    const [b] = santaSteps(shapeDrawList(1, [], 5010));
    expect(a && b && (a.x !== b.x || a.y !== b.y)).toBe(true);
    expect(Math.abs((a?.x ?? 0) - (b?.x ?? 0))).toBeLessThan(1);
  });

  it('throws a RangeError for a non-finite time or turn', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => shapeDrawList(0, globeShapes, bad)).toThrow(RangeError);
      expect(() => shapeDrawList(bad, globeShapes, T)).toThrow(RangeError);
    }
  });

  it('puts Santa after every shape no nearer than him and before every shape at least as near, at many turns', () => {
    // Shapes spread over his own depth range, so that at some turns he lands between groups.
    const reach = santaNearness({ ...santaPlacement(0, 0), depth: 1 });
    const shapes = [-0.8, -0.4, -0.1, 0.2, 0.5, 0.9].flatMap((f, i) => [
      box(reach * f * Math.cos(i), reach * f * Math.sin(i)),
    ]);
    let between = 0;
    for (let k = 0; k < 240; k++) {
      const turn = (k * FULL) / 240 + 0.01;
      const time = k * 913;
      const steps = shapeDrawList(turn, shapes, time);
      const at = steps.findIndex(isSanta);
      const his = santaNearness(santaPlacement(turn, time));
      const t = wrapTurn(turn);
      const cos = Math.cos(t);
      const sin = Math.sin(t);
      const ordered = shapesFarFirst(shapes, turn);
      let placed = 0;
      let before = 0;
      for (const shape of ordered) {
        if (placed < at) before += 1;
        placed += projectShape(shape, turn).length;
      }
      expect(placed, 'groups do not tile the list').toBe(steps.length - 1);
      const groupsBefore = ordered.slice(0, before);
      const groupsAfter = ordered.slice(before);
      expect(groupsBefore.length + groupsAfter.length).toBe(shapes.length);
      for (const shape of groupsBefore) expect(shapeNearness(shape, cos, sin), `turn ${k}`).toBeLessThanOrEqual(his);
      for (const shape of groupsAfter) expect(shapeNearness(shape, cos, sin), `turn ${k}`).toBeGreaterThanOrEqual(his);
      if (groupsBefore.length > 0 && groupsAfter.length > 0) between += 1;
    }
    expect(between).toBeGreaterThan(60);
  });

  it('is last when he is on the near side beyond every shape and first when beyond them on the far side', () => {
    const shapes = [box(0, 0), box(5, 5)];
    let first = 0;
    let last = 0;
    for (let k = 0; k < 360; k++) {
      const turn = (k * FULL) / 360;
      const steps = shapeDrawList(turn, shapes, T);
      const at = steps.findIndex(isSanta);
      const place = santaPlacement(turn, T);
      if (place.depth > 0.95) {
        expect(at).toBe(steps.length - 1);
        last += 1;
      }
      if (place.depth < -0.95) {
        expect(at).toBe(0);
        first += 1;
      }
    }
    expect(first).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(0);
  });

  it('never leaves Santa between two faces of the house, at 360 turns', () => {
    const house = globeShapes.find((s) => s.kind === 'house') as GlobeShape;
    for (let k = 0; k < 360; k++) {
      expectSantaBetweenShapes([house], (k * FULL) / 360, T + k * 1000);
    }
  });

  it('with the full set, Santa is never inside any shape: removing him gives the Santa-less list, and he sits at a shape boundary', () => {
    for (let k = 0; k < 180; k++) {
      expectSantaBetweenShapes(globeShapes, (k * FULL) / 180, T + k * 4321);
    }
  });
});

describe('renderDrawList: Santa', () => {
  it('at zoom 1 equals what drawSanta paints for the same turn and time', () => {
    for (const [turn, time] of [[0, 0], [1.1, 12_345], [2.6, 90_000], [3.9, 777], [5.5, 100_001], [-1, 4242]] as const) {
      const expected = filled(LAYOUT, 1);
      drawSanta(expected, LAYOUT.width, LAYOUT, turn, time);
      expect(santaOnly(turn, time, 1)).toEqual(expected);
    }
  });

  it('paints only the colours of his sprite, never a mix or a tint', () => {
    for (const zoom of [1, 3, 4]) {
      const picture = santaOnly(2.1, 31_000, zoom);
      const allowed = new Set([FILL, ...COLOURS]);
      expect(picture.every((c) => allowed.has(c))).toBe(true);
      expect(picture.some((c) => c !== FILL)).toBe(true);
    }
  });

  it('draws different pictures for times a fraction of an art pixel apart at zoom 4', () => {
    // find a time pair whose x moves by 1/4 to 3/4 of an art pixel and whose zoom 1 positions round alike
    const turn = 0.3;
    let found = false;
    for (let t = 0; t < 60_000 && !found; t += 37) {
      const a = santaPlacement(turn, t);
      const b = santaPlacement(turn, t + 40);
      if (a.trot !== b.trot || a.mirrored !== b.mirrored) continue;
      const same1 = Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
      const moved4 = Math.round(a.x * 4) !== Math.round(b.x * 4) || Math.round(a.y * 4) !== Math.round(b.y * 4);
      if (!same1 || !moved4) continue;
      if (Math.round(a.squeeze * 48) !== Math.round(b.squeeze * 48)) continue;
      found = true;
      expect(santaOnly(turn, t, 4)).not.toEqual(santaOnly(turn, t + 40, 4));
    }
    expect(found).toBe(true);
  });

  it('moves on the zoomed pixel grid: x offsets differing by a whole picture pixel shift the picture by exactly one column at zoom 4', () => {
    const turn = 0;
    const base = santaPlacement(turn, 0);
    // two hand-made steps a quarter art pixel apart
    const step = (dx: number): SantaDraw => ({ sprite: sprite('santa-trot-1'), x: base.x + dx, y: base.y, squeeze: 1, mirrored: false });
    const draw = (s: SantaDraw): Uint32Array => {
      const p = filled(LAYOUT, 4);
      renderDrawList(p, LAYOUT.width, LAYOUT, [s], 4);
      return p;
    };
    const side = LAYOUT.width * 4;
    const a = draw(step(0));
    const b = draw(step(0.25));
    // b is a shifted one column right (within the glass, away from clipping)
    let equal = 0;
    let total = 0;
    for (let y = 0; y < LAYOUT.height * 4; y++) {
      for (let x = 1; x < side; x++) {
        if (a[y * side + x - 1] !== FILL || b[y * side + x] !== FILL) {
          total += 1;
          if (a[y * side + x - 1] === b[y * side + x]) equal += 1;
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(equal / total).toBeGreaterThan(0.95);
  });

  it('draws every pixel as a whole block: at zoom z a hand-made unsqueezed sprite is blocks of z x z', () => {
    const tiny = plain(2, 2, [1, 2, 3, 1]);
    const layout = layoutAt(20, 20, 10, 10, 50);
    for (const zoom of [1, 2, 5]) {
      const p = new Uint32Array(20 * zoom * 20 * zoom).fill(FILL);
      renderDrawList(p, 20, layout, [{ sprite: tiny, x: 0, y: 0, squeeze: 1, mirrored: false }], zoom);
      const side = 20 * zoom;
      const lit: number[] = [];
      for (let i = 0; i < p.length; i++) if (p[i] !== FILL) lit.push(i);
      expect(lit).toHaveLength(4 * zoom * zoom);
      const xs = lit.map((i) => i % side);
      const ys = lit.map((i) => Math.floor(i / side));
      expect(Math.max(...xs) - Math.min(...xs) + 1).toBe(2 * zoom);
      expect(Math.max(...ys) - Math.min(...ys) + 1).toBe(2 * zoom);
      // each quadrant is one colour
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      for (const [qx, qy, n] of [[0, 0, 1], [1, 0, 2], [0, 1, 3], [1, 1, 1]] as const) {
        for (let j = 0; j < zoom; j++) {
          for (let i = 0; i < zoom; i++) {
            expect(p[(y0 + qy * zoom + j) * side + x0 + qx * zoom + i]).toBe(COLOURS[n - 1]);
          }
        }
      }
    }
  });

  it('mirrored flips the sprite left to right', () => {
    const tiny = plain(3, 1, [1, 2, 3]);
    const layout = layoutAt(20, 20, 10, 10, 50);
    const paint = (mirrored: boolean): number[] => {
      const p = new Uint32Array(400).fill(FILL);
      renderDrawList(p, 20, layout, [{ sprite: tiny, x: 0, y: 0, squeeze: 1, mirrored }], 1);
      return Array.from(p).filter((c) => c !== FILL);
    };
    expect(paint(false)).toEqual([COLOURS[0], COLOURS[1], COLOURS[2]]);
    expect(paint(true)).toEqual([COLOURS[2], COLOURS[1], COLOURS[0]]);
  });

  it('treats colour 0 as transparent and keeps what was under it', () => {
    const tiny = plain(3, 1, [1, 0, 3]);
    const layout = layoutAt(20, 20, 10, 10, 50);
    const p = new Uint32Array(400).fill(FILL);
    renderDrawList(p, 20, layout, [{ sprite: tiny, x: 0, y: 0, squeeze: 1, mirrored: false }], 1);
    expect(Array.from(p).filter((c) => c !== FILL)).toEqual([COLOURS[0], COLOURS[2]]);
  });

  it('squeezes to round(width * squeeze * zoom) picture pixels, and never below one', () => {
    const wide = plain(10, 1, Array<number>(10).fill(1));
    const layout = layoutAt(40, 20, 20, 10, 100);
    for (const [squeeze, zoom, want] of [[0.5, 1, 5], [0.5, 4, 20], [0.3, 2, 6], [0.001, 1, 1], [0.001, 4, 1]] as const) {
      const p = new Uint32Array(40 * zoom * 20 * zoom).fill(FILL);
      renderDrawList(p, 40, layout, [{ sprite: wide, x: 0, y: 0, squeeze, mirrored: false }], zoom);
      const lit = Array.from(p).filter((c) => c !== FILL).length;
      expect(lit).toBe(want * zoom);
    }
  });

  it('is clipped to the glass circle', () => {
    const slab = plain(40, 40, Array<number>(1600).fill(2));
    const layout = layoutAt(80, 80, 40, 40, 10);
    for (const zoom of [1, 3]) {
      const p = new Uint32Array(80 * zoom * 80 * zoom).fill(FILL);
      renderDrawList(p, 80, layout, [{ sprite: slab, x: 0, y: 0, squeeze: 1, mirrored: false }], zoom);
      const side = 80 * zoom;
      let inside = 0;
      for (let i = 0; i < p.length; i++) {
        if (p[i] === FILL) continue;
        inside += 1;
        const dx = ((i % side) + 0.5) / zoom - 40;
        const dy = (Math.floor(i / side) + 0.5) / zoom - 40;
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(10 + 1e-9);
      }
      expect(inside).toBeGreaterThan(0.9 * Math.PI * 100 * zoom * zoom);
    }
  });

  it('draws nothing and does not throw for a Santa wholly outside the picture', () => {
    const layout = layoutAt(20, 20, 10, 10, 50);
    const p = new Uint32Array(400).fill(FILL);
    renderDrawList(p, 20, layout, [{ sprite: sprite('santa-trot-1'), x: 500, y: -500, squeeze: 1, mirrored: false }], 1);
    expect(p.every((c) => c === FILL)).toBe(true);
  });

  it('still throws a RangeError for a zoom that is not whole, or a picture of the wrong size, with a Santa step', () => {
    const steps = shapeDrawList(0, globeShapes, T);
    for (const zoom of [0, -1, 1.5, Number.NaN]) {
      expect(() => renderDrawList(filled(LAYOUT, 1), LAYOUT.width, LAYOUT, steps, zoom)).toThrow(RangeError);
    }
    expect(() => renderDrawList(filled(LAYOUT, 1), LAYOUT.width, LAYOUT, steps, 2)).toThrow(RangeError);
  });
});

describe('renderDrawList: squeezing a sprite keeps any opaque pixel in the box a picture pixel covers', () => {
  const layout = layoutAt(20, 20, 10, 10, 50);
  /** The painted row from its first to its last lit pixel (FILL where a gap), at zoom 1, for a one-row sprite squeezed to `want` columns. */
  function row(pixels: number[], want: number, mirrored = false): number[] {
    const sprite = plain(pixels.length, 1, pixels);
    const p = new Uint32Array(400).fill(FILL);
    renderDrawList(p, 20, layout, [{ sprite, x: 0, y: 0, squeeze: want / pixels.length, mirrored }], 1);
    const lit = Array.from(p.keys()).filter((i) => p[i] !== FILL);
    expect(lit.length).toBeGreaterThan(0);
    const first = Math.min(...lit);
    const last = Math.max(...lit);
    expect(Math.floor(first / 20)).toBe(Math.floor(last / 20));
    return Array.from(p.slice(first, last + 1));
  }
  const c = (n: number): number => COLOURS[n - 1] as number;

  it('paints the link: a lone opaque pixel in a box shows, where centre sampling would drop it', () => {
    expect(row([1, 0, 0, 3, 0, 0, 0, 2], 4)).toEqual([c(1), c(3), FILL, c(2)]);
  });

  it('paints nothing for a box whose pixels are all transparent', () => {
    expect(row([1, 0, 0, 0, 0, 0, 0, 2], 4)).toEqual([c(1), FILL, FILL, c(2)]);
  });

  it('takes the colour of the opaque pixel nearest the box centre', () => {
    expect(row([1, 2, 3, 4, 5, 6], 2)).toEqual([c(2), c(5)]);
  });

  it('breaks a tie to the left in the sprite\'s own pixels', () => {
    expect(row([0, 0, 1, 2, 0, 0, 0, 5], 4)).toEqual([c(1), FILL, c(5)]);
  });

  it('breaks the tie to the left of the unmirrored sprite when mirrored, and flips the box order', () => {
    expect(row([1, 0, 0, 0, 3, 4, 0, 0], 4, true)).toEqual([c(3), FILL, c(1)]);
  });

  it('at no squeeze it is the sprite itself', () => {
    expect(row([1, 0, 3, 2], 4)).toEqual([c(1), FILL, c(3), c(2)]);
  });
});

describe('Santa stays one connected object', () => {
  it('is a single connected piece, never vanishing, at 360 turns at zoom 1, 2 and 4', () => {
    for (const zoom of [1, 2, 4]) {
      for (let k = 0; k < 360; k++) {
        const turn = (k * FULL) / 360;
        const time = 20_000 + k * 53;
        const picture = santaOnly(turn, time, zoom);
        const { count, pixels } = components(picture, LAYOUT.width * zoom, FILL);
        expect(pixels, `vanished at turn ${k} zoom ${zoom}`).toBeGreaterThan(0);
        expect(count, `split at turn ${k} zoom ${zoom}`).toBe(1);
      }
    }
  });

  it('is always 48 * zoom pixels wide: squeeze 1 at every angle, no thinning anywhere on the orbit', () => {
    const cols = (d: Drawing): number => {
      let lo = d.width;
      let hi = -1;
      for (let i = 0; i < d.pixels.length; i++) {
        if ((d.pixels[i] ?? 0) === 0) continue;
        lo = Math.min(lo, i % d.width);
        hi = Math.max(hi, i % d.width);
      }
      return hi - lo + 1;
    };
    for (const zoom of [1, 2, 4]) {
      for (let k = 0; k < 120; k++) {
        const turn = (k * FULL) / 120;
        const [step] = santaSteps(shapeDrawList(turn, [], T));
        expect(step?.squeeze, `zoom ${zoom} turn ${k}`).toBe(1);
        const width = LAYOUT.width * zoom;
        const picture = santaOnly(turn, T, zoom);
        let left = width;
        let right = -1;
        for (let i = 0; i < picture.length; i++) {
          if (picture[i] === FILL) continue;
          left = Math.min(left, i % width);
          right = Math.max(right, i % width);
        }
        expect(right - left + 1, `zoom ${zoom} turn ${k}`).toBe(cols(step?.sprite as Drawing) * zoom);
      }
    }
  });

  it('is not clipped by the glass: at zoom 1, 2 and 4 every opaque sprite pixel is painted, as whole blocks, at every turn and time', () => {
    for (const zoom of [1, 2, 4]) {
      for (let k = 0; k < 240; k++) {
        const turn = (k * FULL) / 240 + 0.003;
        const time = 700 + k * 1_237;
        const [step] = santaSteps(shapeDrawList(turn, [], time));
        const opaque = Array.from(step?.sprite.pixels ?? []).filter((n) => n !== 0).length;
        const picture = santaOnly(turn, time, zoom);
        const painted = picture.filter((c) => c !== FILL).length;
        expect(painted, `zoom ${zoom} turn ${k}: Santa's pixels lost to the glass`).toBe(opaque * zoom * zoom);
      }
    }
  });

  it('keeps at least a block of height and some width at the thinnest angle', () => {
    for (let k = 0; k < 360; k++) {
      const turn = (k * FULL) / 360;
      const picture = santaOnly(turn, T, 1);
      const xs = new Set<number>();
      for (let i = 0; i < picture.length; i++) if (picture[i] !== FILL) xs.add(i % LAYOUT.width);
      expect(xs.size).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Santa leaves the art picture and the front layer', () => {
  /** Share of Santa's own opaque pixels (placed on a flat fill) that the bodiless frame also holds in his colour. */
  function leftover(turn: number, time: number): { santaPixels: number; held: number } {
    const bare = sceneFrame(sceneInput({ turn, time, shapeBodies: false }));
    const only = santaOnly(turn, time, 1, bare.layout);
    let santaPixels = 0;
    let held = 0;
    for (let i = 0; i < only.length; i++) {
      if (only[i] === FILL) continue;
      santaPixels += 1;
      if (bare.picture[i] === only[i]) held += 1;
    }
    return { santaPixels, held };
  }

  it('leaves the bodiless art picture without his pixels, in front or behind', () => {
    let tested = 0;
    for (let k = 0; k < 24; k++) {
      const turn = (k * FULL) / 24;
      const time = T + k * 2900;
      const { santaPixels, held } = leftover(turn, time);
      expect(santaPixels).toBeGreaterThan(0);
      expect(held / santaPixels).toBeLessThan(0.2);
      tested += 1;
    }
    expect(tested).toBe(24);
  });

  it('still draws him in the default picture, among the shapes by depth: bodiless frame plus the whole list is the whole frame', () => {
    for (let k = 0; k < 12; k++) {
      const turn = (k * FULL) / 12;
      const time = T + k * 2900;
      const whole = sceneFrame(sceneInput({ turn, time }));
      const bare = sceneFrame(sceneInput({ turn, time, shapeBodies: false }));
      const back = Uint32Array.from(bare.picture);
      // The bodiless frame has no floor shadows either (XMAS-82): they go back first, then the bodies and Santa.
      renderShadowSteps(back, whole.layout.width, whole.layout, shadowDrawList(turn), 1);
      renderDrawList(back, whole.layout.width, whole.layout, shapeDrawList(turn, globeShapes, time), 1);
      // The base is the page's last layer over them (XMAS-68), so the bodiless frame is without its body too.
      renderBase(back, whole.layout.width, whole.layout.globe.cx - BASE_WIDTH / 2, whole.layout.groundTop - BASE_SINK, 1, wrapTurn(turn));
      expect(back).toEqual(whole.picture);
      // Where he is nearer than every shape, all of his pixels are in the default picture.
      if (santaPlacement(turn, time).depth > 0.95) {
        const only = santaOnly(turn, time, 1, whole.layout);
        for (let i = 0; i < only.length; i++) if (only[i] !== FILL) expect(whole.picture[i]).toBe(only[i]);
      }
    }
  }, 20_000);

  it('carries no Santa in a picture of his own: with the shapes left out the frame has no front or behind layer (he is a draw step, XMAS-83)', () => {
    for (let k = 0; k < 12; k++) {
      const frame = sceneFrame(sceneInput({ turn: (k * FULL) / 12, time: T + k * 5000, shapeBodies: false }));
      expect(frame).not.toHaveProperty('front');
      expect(frame).not.toHaveProperty('behind');
    }
  });
});

function plain(width: number, height: number, pixels: number[]): Drawing {
  return { sheet: 'test', x: 0, y: 0, width, height, pixels: Uint8Array.from(pixels) };
}

/** A layout with a chosen globe centre and radius, for sprites placed by hand. */
function layoutAt(width: number, height: number, cx: number, cy: number, radius: number): SceneLayout {
  return { ...LAYOUT, width, height, globe: { ...LAYOUT.globe, cx, cy, radius } };
}
