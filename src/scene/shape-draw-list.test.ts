// XMAS-80: the shapes' bodies as an ordered list of draw steps (drawing, map to
// globe-centred art units, a gable's triangle clip; far first) and a CPU
// renderer at any whole zoom. At zoom 1 it is today's drawShapes bodies; at a
// higher zoom each block's centre pixel is the zoom 1 picture. sceneFrame can
// leave the bodies out (shapeBodies: false) while the shadows stay.
import { describe, expect, it } from 'vitest';
import type { Drawing } from '../shared/art.generated.ts';
import type { PhaseReading } from '../shared/clock.ts';
import { masterColours } from '../../art/colours.ts';
import { BASE_WIDTH, renderBase } from './base-fine.ts';
import { sceneFrame, sceneLayout, type SceneInput, type SceneLayout } from './frame.ts';
import { BASE_SINK } from './globe.ts';
import { renderDrawList, renderShadowSteps, shadowDrawList, shapeDrawList, type DrawStep, type ShadowStep } from './shape-draw-list.ts';
import { drawShapes } from './shapes-draw.ts';
import { globeShapes, onFloor, projectShape, sheet, wrapTurn, type GlobeShape } from './shapes.ts';

const W = 240;
const H = 180;
const SEED = 12345;
const T = 1_000_000;
const FULL = 2 * Math.PI;
const LAYOUT = sceneLayout(W, H, SEED);
const NIGHT: PhaseReading = { from: 'purple-night', to: 'purple-night', share: 0 };
const FILL = 0x010203;
const FILL_B = 0xfdfcfb;
/** Turns over a whole sweep, 0 to 2π inclusive, plus awkward ones between. */
const SWEEP = [...Array.from({ length: 17 }, (_, k) => (k * FULL) / 16), 0.123, 1.7, 3.0, 5.9];
const COLOURS = masterColours.map((c) => Number.parseInt(c.slice(1), 16));

function sceneInput(over: Partial<SceneInput> = {}): SceneInput {
  return { time: T, drag: 0, phase: NIGHT, seed: SEED, width: W, height: H, ...over };
}

/** sceneFrame input with shapeBodies set to flag, or left absent when flag is undefined (the default case). */
function withBodies(flag: boolean | undefined, over: Partial<SceneInput> = {}): SceneInput {
  return Object.assign(sceneInput(over), flag === undefined ? {} : { shapeBodies: flag });
}

function filled(layout: SceneLayout, zoom: number, colour: number): Uint32Array {
  return new Uint32Array(layout.width * zoom * layout.height * zoom).fill(colour);
}

/** The bodies in depth order on `colour`, with Santa too when `time` is given (sceneInput's is T). */
function rendered(turn: number, zoom: number, colour = FILL, time?: number): Uint32Array {
  const picture = filled(LAYOUT, zoom, colour);
  renderDrawList(picture, W, LAYOUT, time === undefined ? shapeDrawList(turn) : shapeDrawList(turn, globeShapes, time), zoom);
  return picture;
}

function shadowsOn(turn: number, zoom: number, colour = FILL): Uint32Array {
  const picture = filled(LAYOUT, zoom, colour);
  renderShadowSteps(picture, W, LAYOUT, shadowDrawList(turn), zoom);
  return picture;
}

function near(p: readonly number[], q: readonly number[]): boolean {
  return p.length === q.length && p.every((v, i) => Math.abs(v - (q[i] ?? Number.NaN)) < 1e-9);
}

/** Nearness of a shape to the visitor at a turn, as the page's own ordering sees it. */
function farFirst(shapes: readonly GlobeShape[], turn: number): GlobeShape[] {
  const t = wrapTurn(turn);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [...shapes].sort(
    (a, b) =>
      (a.x * sin + a.z * cos) - (b.x * sin + b.z * cos) ||
      a.x - b.x ||
      a.z - b.z ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      (a.design ?? 0) - (b.design ?? 0),
  );
}

/** The step the agreed rules give a projected face: a, b, d are the top left, top right and bottom left corners; a gable hangs the drawing from its apex's level. */
function expectedStep(face: { drawing: string; corners: readonly (readonly [number, number])[] }): { name: string; a: number[]; b: number[]; d: number[]; clip?: number[][] } {
  const ring = face.corners;
  const [p, q, r, s] = ring;
  if (ring.length === 4 && p && q && s) return { name: face.drawing, a: [...p], b: [...q], d: [...s] };
  if (ring.length !== 3 || !p || !q || !r) throw new Error('bad ring');
  const height = sheet(face.drawing).height;
  const lift = [q[0] - (p[0] + r[0]) / 2, q[1] - (p[1] + r[1]) / 2] as const;
  const top = [p[0] + lift[0], p[1] + lift[1]];
  return {
    name: face.drawing,
    a: top,
    b: [r[0] + lift[0], r[1] + lift[1]],
    d: [top[0] ?? 0, (top[1] ?? 0) + height],
    clip: ring.map((c) => [...c]),
  };
}

/**
 * XMAS-68: the base is the page's last layer, over the shapes and Santa, so a bodiless frame has no base body either
 * (shapeBodies false leaves it to the fine layer). Lays it, at one pixel to an art pixel, over `picture` as the frame draws it.
 */
function withBase(picture: Uint32Array, layout: SceneLayout, turn: number): Uint32Array {
  renderBase(picture, layout.width, layout.globe.cx - BASE_WIDTH / 2, layout.groundTop - BASE_SINK, 1, wrapTurn(turn));
  return picture;
}

/**
 * Counts the pixels where the list (bodies and Santa, XMAS-83) laid over a bodiless frame is not today's frame: where the list
 * painted a pixel the whole frame must hold it, elsewhere the two frames must agree. Also reports how many painted pixels matched.
 */
function overlayMismatch(turn: number, phase: PhaseReading = NIGHT): { bad: number; matched: number } {
  const whole = sceneFrame(sceneInput({ turn, phase }));
  const bare = sceneFrame(withBodies(false, { turn, phase }));
  // The base goes over the bodies and Santa; the bodiless frame is without it, so it goes on all three.
  const list = withBase(rendered(turn, 1, FILL, T), whole.layout, turn);
  // XMAS-82: the bodiless frame has no shadows either; where the shadows go, the whole frame may hold them over the bare one.
  const shaded = Uint32Array.from(bare.picture);
  renderShadowSteps(shaded, W, bare.layout, shadowDrawList(turn), 1);
  withBase(shaded, whole.layout, turn);
  withBase(bare.picture, whole.layout, turn);
  let bad = 0;
  let matched = 0;
  for (let i = 0; i < whole.picture.length; i++) {
    const w = whole.picture[i];
    if (list[i] === FILL) {
      if (w !== shaded[i] && w !== bare.picture[i]) bad += 1;
    } else if (w === list[i]) matched += 1;
    else if (w !== bare.picture[i] && w !== shaded[i]) bad += 1;
  }
  return { bad, matched };
}

function plainDrawing(width: number, height: number, pixels: number[]): Drawing {
  return { sheet: 'test', x: 0, y: 0, width, height, pixels: Uint8Array.from(pixels) };
}

/** A small layout whose globe centre is chosen, for steps placed by hand. */
function layoutAt(width: number, height: number, cx: number, cy: number): SceneLayout {
  return { ...LAYOUT, width, height, globe: { ...LAYOUT.globe, cx, cy } };
}

/** The centre of every pixel of a picture at `zoom` that is not FILL, in art units from the globe's centre. */
function paintedAt(picture: Uint32Array, zoom: number, layout = LAYOUT): [number, number][] {
  const side = layout.width * zoom;
  const out: [number, number][] = [];
  picture.forEach((p, i) => {
    if (p !== FILL) out.push([((i % side) + 0.5) / zoom - layout.globe.cx, (Math.floor(i / side) + 0.5) / zoom - layout.globe.cy]);
  });
  return out;
}

/** A blank small picture (globe centred) with `steps` drawn on it. */
function drawSmall(steps: readonly DrawStep[], zoom = 1, size = 8): Uint32Array {
  const layout = layoutAt(size, size, size / 2, size / 2);
  const picture = filled(layout, zoom, FILL);
  renderDrawList(picture, size, layout, steps, zoom);
  return picture;
}

/** How many art pixels' zoom x zoom block centres in `many` differ from the matching pixel of the zoom 1 picture `one`. */
function centreMismatches(many: Uint32Array, one: Uint32Array, zoom: number): number {
  const centre = (zoom - 1) / 2;
  let mismatches = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (many[(y * zoom + centre) * W * zoom + x * zoom + centre] !== one[y * W + x]) mismatches += 1;
  }
  return mismatches;
}

/** The whole frame, the bodiless frame, and the bodies, shadows and base laid on a blank picture, at one turn. */
function framesAt(turn: number) {
  return {
    whole: sceneFrame(sceneInput({ turn })),
    bare: sceneFrame(withBodies(false, { turn })),
    bodies: rendered(turn, 1, FILL, T),
    shadows: shadowsOn(turn, 1, FILL),
    based: withBase(filled(LAYOUT, 1, FILL), LAYOUT, turn),
  };
}

describe('shapeDrawList: the list', () => {
  it('throws a RangeError for a turn that is not finite, and is empty for an empty shapes list', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => shapeDrawList(bad)).toThrow(RangeError);
    }
    expect(shapeDrawList(0.4, [])).toEqual([]);
  });

  it('has one step per visible face, far shapes first and inside a shape its far faces first, a, b, d from the corners and a gable\'s triangle as the clip, at several turns', () => {
    let quads = 0;
    let gables = 0;
    for (const turn of SWEEP) {
      const expected = farFirst(globeShapes, turn).flatMap((shape) => [...projectShape(shape, turn)].reverse().map(expectedStep));
      const steps = shapeDrawList(turn);
      expect(steps).toHaveLength(expected.length);
      steps.forEach((step, i) => {
        const want = expected[i];
        expect(step.drawing).toEqual(sheet(want?.name ?? ''));
        expect(near(step.a, want?.a ?? [])).toBe(true);
        expect(near(step.b, want?.b ?? [])).toBe(true);
        expect(near(step.d, want?.d ?? [])).toBe(true);
        if (want?.clip === undefined) {
          quads += 1;
          expect(step.clip).toBeUndefined();
        } else {
          gables += 1;
          expect(step.clip).toHaveLength(3);
          step.clip?.forEach((c, k) => expect(near(c, want.clip?.[k] ?? [])).toBe(true));
        }
      });
    }
    expect(quads).toBeGreaterThan(0);
    expect(gables).toBeGreaterThan(0);
  });

  it('orders shapes by nearness whatever order the caller lists them in', () => {
    const far: GlobeShape = { kind: 'present', x: 0, z: -20, width: 10, depth: 10, height: 10, design: 1 };
    const nearOne: GlobeShape = { kind: 'present', x: 0, z: 20, width: 10, depth: 10, height: 10, design: 2 };
    const firstDrawings = (steps: readonly { drawing: unknown }[], shape: GlobeShape, turn: number): unknown[] =>
      steps.slice(0, projectShape(shape, turn).length).map((s) => s.drawing);
    const farFaces = (shape: GlobeShape, turn: number): unknown[] => [...projectShape(shape, turn)].reverse().map((f) => sheet(f.drawing));
    const one = shapeDrawList(0, [far, nearOne]);
    expect(shapeDrawList(0, [nearOne, far])).toEqual(one);
    // Every step of the far present comes before every step of the near one.
    expect(firstDrawings(one, far, 0)).toEqual(farFaces(far, 0));
    // Half a turn later the two swap places.
    expect(firstDrawings(shapeDrawList(Math.PI, [far, nearOne]), nearOne, Math.PI)).toEqual(farFaces(nearOne, Math.PI));
  });

  it('keeps a gable drawing\'s proportions: one art unit down per drawing row, its width axis the base edge, the triangle inside the drawing', () => {
    let gables = 0;
    for (const turn of SWEEP) {
      for (const step of shapeDrawList(turn)) {
        if (step.clip === undefined) continue;
        gables += 1;
        const [p = [], , r = []] = step.clip;
        const ux = step.b[0] - step.a[0];
        const uy = step.b[1] - step.a[1];
        const vy = step.d[1] - step.a[1];
        // The downward axis is the drawing's whole height, straight down: not squashed or stretched.
        expect(step.d[0]).toBeCloseTo(step.a[0], 9);
        expect(vy).toBeCloseTo(step.drawing.height, 9);
        // The width axis is the gable's base edge (p to r), so the drawing spans the gable's width.
        expect(ux).toBeCloseTo((r[0] ?? Number.NaN) - (p[0] ?? Number.NaN), 9);
        expect(uy).toBeCloseTo((r[1] ?? Number.NaN) - (p[1] ?? Number.NaN), 9);
        // Every clip corner has drawing coordinates u, v within 0..1 (d is straight down: dy = uy * u + vy * v, dx = ux * u).
        for (const [x, y] of step.clip) {
          const dy = y - step.a[1];
          const u = Math.abs(ux) > 1e-9 ? (x - step.a[0]) / ux : 0;
          const vFull = (dy - uy * u) / vy;
          expect(vFull).toBeGreaterThan(-1e-9);
          expect(vFull).toBeLessThan(1 + 1e-9);
          expect(dy / vy).toBeGreaterThan(-1);
          if (Math.abs(ux) > 1e-9) {
            expect(u).toBeGreaterThan(-1e-9);
            expect(u).toBeLessThan(1 + 1e-9);
          }
        }
      }
    }
    expect(gables).toBeGreaterThan(0);
  });

  it('shows the same list at turn 0 and at whole turns, negative or positive', () => {
    const base = shapeDrawList(0);
    for (const turn of [FULL, -FULL, 2 * FULL, -3 * FULL]) expect(shapeDrawList(turn)).toEqual(base);
  });

  it('does not change the shapes it is given', () => {
    const shapes = globeShapes.map((s) => ({ ...s }));
    const copy = JSON.stringify(shapes);
    shapeDrawList(1.1, shapes);
    expect(JSON.stringify(shapes)).toBe(copy);
  });
});

describe('renderDrawList: the renderer', () => {
  it('draws nothing for an empty list, and rejects a zoom that is not a whole number of at least 1', () => {
    const picture = filled(LAYOUT, 3, FILL);
    renderDrawList(picture, W, LAYOUT, [], 3);
    expect(picture.every((p) => p === FILL)).toBe(true);
    for (const bad of [0, -2, 1.5, Number.NaN]) {
      expect(() => renderDrawList(filled(LAYOUT, 1, FILL), W, LAYOUT, shapeDrawList(0), bad)).toThrow(RangeError);
    }
  });

  it('point-samples each drawing pixel as a whole zoom-sized block about the globe centre', () => {
    const drawing = plainDrawing(2, 2, [1, 2, 3, 4]);
    for (const zoom of [1, 2, 3, 5]) {
      const picture = drawSmall([{ drawing, a: [-2, -2], b: [2, -2], d: [-2, 2] }], zoom);
      const side = 8 * zoom;
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const inside = x >= 2 * zoom && x < 6 * zoom && y >= 2 * zoom && y < 6 * zoom;
          const col = x < 4 * zoom ? 0 : 1;
          const row = y < 4 * zoom ? 0 : 1;
          const want = inside ? COLOURS[(drawing.pixels[row * 2 + col] ?? 1) - 1] : FILL;
          expect(picture[y * side + x]).toBe(want);
        }
      }
    }
  });

  it('draws a mirrored drawing (b left of a) flipped', () => {
    const picture = drawSmall([{ drawing: plainDrawing(2, 1, [1, 2]), a: [2, -1], b: [-2, -1], d: [2, 1] }]);
    expect(picture[4 * 8 + 3]).toBe(COLOURS[1]);
    expect(picture[4 * 8 + 5]).toBe(COLOURS[0] ?? -1);
  });

  it('leaves the background where a drawing pixel is transparent', () => {
    const picture = drawSmall([{ drawing: plainDrawing(2, 2, [0, 2, 3, 0]), a: [-2, -2], b: [2, -2], d: [-2, 2] }], 2);
    expect(picture[4 * 16 + 4]).toBe(FILL); // top left block, transparent
    expect(picture[4 * 16 + 10]).toBe(COLOURS[1]); // top right block spans x 8..11
    expect(picture[10 * 16 + 4]).toBe(COLOURS[2]); // bottom left block spans y 8..11
    expect(picture[10 * 16 + 10]).toBe(FILL); // bottom right, transparent
  });

  it('lets a later step cover an earlier one where they overlap, and only there', () => {
    const first: DrawStep = { drawing: plainDrawing(1, 1, [1]), a: [-3, -3], b: [1, -3], d: [-3, 1] };
    const second: DrawStep = { drawing: plainDrawing(1, 1, [2]), a: [-1, -1], b: [3, -1], d: [-1, 3] };
    const picture = drawSmall([first, second]);
    expect(picture[2 * 8 + 2]).toBe(COLOURS[0]);
    expect(picture[4 * 8 + 4]).toBe(COLOURS[1]);
    expect(drawSmall([second, first])[4 * 8 + 4]).toBe(COLOURS[0]);
  });

  it('draws only the clip triangle of a clipped step', () => {
    const clip = [[-4, 4], [0, -4], [4, 4]] as const;
    const step: DrawStep = { drawing: plainDrawing(1, 1, [1]), a: [-4, -4], b: [4, -4], d: [-4, 4], clip };
    for (const zoom of [1, 3]) {
      const picture = drawSmall([step], zoom, 12);
      const side = 12 * zoom;
      const at = (ax: number, ay: number): number => picture[Math.floor((ay + 6) * zoom + zoom / 2) * side + Math.floor((ax + 6) * zoom + zoom / 2)] ?? -1;
      expect(at(0, 3)).toBe(COLOURS[0]); // low in the middle: inside
      expect(at(0, -3)).toBe(COLOURS[0]); // near the apex: inside
      expect(at(-3.5, -3.5)).toBe(FILL); // the top left corner is cut away
      expect(at(3.5, -3.5)).toBe(FILL);
      expect(at(-3.5, -1)).toBe(FILL);
    }
  });

  it('leaves every pixel outside the shapes\' boxes untouched', () => {
    for (const turn of [0, 1.7, 3.0]) {
      for (const zoom of [1, 3]) {
        const steps = shapeDrawList(turn);
        const xs = steps.flatMap((s) => [s.a[0], s.b[0], s.d[0], s.b[0] + s.d[0] - s.a[0]]);
        const ys = steps.flatMap((s) => [s.a[1], s.b[1], s.d[1], s.b[1] + s.d[1] - s.a[1]]);
        const painted = paintedAt(rendered(turn, zoom), zoom);
        for (const [x, y] of painted) {
          expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9);
          expect(x).toBeLessThanOrEqual(Math.max(...xs) + 1e-9);
          expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
          expect(y).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
        }
        expect(painted.length).toBeGreaterThan(0);
      }
    }
  });

  it('paints only sheet colours, whatever it is drawn over', () => {
    const a = rendered(0.9, 1, FILL);
    const b = rendered(0.9, 1, FILL_B);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== FILL) expect(COLOURS).toContain(a[i]);
      // a pixel is either a shape's own colour (same over both fills) or the fill itself
      expect(a[i] === FILL ? b[i] === FILL_B : a[i] === b[i]).toBe(true);
    }
  });

  it('clips at the picture edges and the top without wrapping a row onto the next or touching rows below the picture', () => {
    // Each case: a big picture and a small one cut from it at offset (dx, dy) art pixels; the small must be the big one cropped.
    const cases = [
      { big: layoutAt(W, 80, 90, 55), small: layoutAt(W - 60, 80, 30, 55), dx: 60, dy: 0, zooms: [1, 3], turns: [0, 2.2] },
      { big: layoutAt(W, 120, 100, 80), small: layoutAt(W, 60, 100, 20), dx: 0, dy: 60, zooms: [1], turns: [0.5] },
    ];
    for (const { big, small, dx, dy, zooms, turns } of cases) {
      for (const zoom of zooms) {
        for (const turn of turns) {
          const bigPic = filled(big, zoom, FILL);
          renderDrawList(bigPic, big.width, big, shapeDrawList(turn), zoom);
          const smallPic = filled(small, zoom, FILL);
          renderDrawList(smallPic, small.width, small, shapeDrawList(turn), zoom);
          const sideBig = big.width * zoom;
          const sideSmall = small.width * zoom;
          for (let y = 0; y < small.height * zoom; y++) {
            for (let x = 0; x < sideSmall; x++) {
              expect(smallPic[y * sideSmall + x]).toBe(bigPic[(y + dy * zoom) * sideBig + x + dx * zoom]);
            }
          }
        }
      }
    }
  });
});

describe('the list at zoom 1 is today\'s drawShapes bodies', () => {
  it('equals every pixel drawShapes paints as a body, over two different fills, over the whole sweep', () => {
    for (const turn of SWEEP) {
      for (const fill of [FILL, FILL_B]) {
        const today = filled(LAYOUT, 1, fill);
        drawShapes(today, W, LAYOUT, NIGHT, turn);
        const mine = rendered(turn, 1, fill);
        for (let i = 0; i < mine.length; i++) {
          // A body pixel is whole: drawShapes paints it the same. Elsewhere it may only have added shadow.
          if (mine[i] !== fill) expect(today[i]).toBe(mine[i]);
        }
      }
    }
  });

  it('equals sceneFrame\'s whole picture when laid over the frame without bodies (Santa in its depth order): over the whole sweep, in every phase and at negative, whole or many turns', () => {
    const phases: PhaseReading[] = [
      { from: 'dawn', to: 'dawn', share: 0 },
      { from: 'sunset', to: 'sunset', share: 0 },
      { from: 'frosty-morning', to: 'sunset', share: 0.25 },
    ];
    const cases: [number, PhaseReading][] = [
      ...SWEEP.map((turn): [number, PhaseReading] => [turn, NIGHT]),
      ...phases.flatMap((phase) => [0.4, 2.9, -1.3].map((turn): [number, PhaseReading] => [turn, phase])),
      ...[-FULL, FULL, -0.75, 7 * FULL + 0.3].map((turn): [number, PhaseReading] => [turn, NIGHT]),
    ];
    for (const [turn, phase] of cases) {
      const { bad, matched } = overlayMismatch(turn, phase);
      expect(bad, `turn ${turn}, phase ${phase.from}->${phase.to}`).toBe(0);
      expect(matched).toBeGreaterThan(0);
    }
  });

  it('with a lean, shapeBodies:false changes nothing outside the globe\'s box, and something inside it', () => {
    for (const turn of [0.4, 2.9]) {
      const whole = sceneFrame(sceneInput({ turn, lean: 0.05 }));
      const bare = sceneFrame(withBodies(false, { turn, lean: 0.05 }));
      const { cx, cy, radius } = LAYOUT.globe;
      let inside = 0;
      for (let i = 0; i < whole.picture.length; i++) {
        if (whole.picture[i] === bare.picture[i]) continue;
        const x = (i % W) - cx;
        const y = Math.floor(i / W) - cy;
        // The bodiless frame is without the base's body too (XMAS-68): the base's box is the page's own layer.
        if (Math.abs(x) <= BASE_WIDTH / 2 && y + cy >= LAYOUT.groundTop - BASE_SINK) continue;
        expect(Math.abs(x)).toBeLessThanOrEqual(radius);
        expect(Math.abs(y)).toBeLessThanOrEqual(radius + 1);
        inside += 1;
      }
      expect(inside).toBeGreaterThan(0);
    }
  });
});

describe('the list at a higher zoom', () => {
  it('has, at the centre of each zoom x zoom block, the zoom 1 picture (zoom 3 and 5)', () => {
    for (const zoom of [3, 5]) {
      for (const turn of SWEEP) {
        expect(centreMismatches(rendered(turn, zoom), rendered(turn, 1), zoom)).toBe(0);
      }
    }
  });

  it('does the same laid over the real frame, so the shadows and glass under it do not matter', () => {
    for (const zoom of [3, 5]) {
      const turn = 1.3;
      const base = sceneFrame(withBodies(false, { turn }));
      const one = Uint32Array.from(base.picture);
      renderDrawList(one, W, base.layout, shapeDrawList(turn), 1);
      const many = new Uint32Array(W * H * zoom * zoom);
      // Each art pixel's block carries that pixel of the bodiless frame (the zoomed background).
      for (let y = 0; y < H * zoom; y++) {
        for (let x = 0; x < W * zoom; x++) many[y * W * zoom + x] = base.picture[Math.floor(y / zoom) * W + Math.floor(x / zoom)] ?? 0;
      }
      renderDrawList(many, W, base.layout, shapeDrawList(turn), zoom);
      expect(centreMismatches(many, one, zoom)).toBe(0);
      expect(one.filter((p, i) => p !== base.picture[i]).length).toBeGreaterThan(0); // the bodies are there
    }
  });

  it('keeps a gable\'s proportions: its drawn width and height scale with the zoom', () => {
    let gables = 0;
    let measured = 0;
    for (const turn of SWEEP) {
      for (const step of shapeDrawList(turn).filter((s) => s.clip !== undefined)) {
        gables += 1;
        const extent = (zoom: number): { w: number; h: number } => {
          const picture = filled(LAYOUT, zoom, FILL);
          renderDrawList(picture, W, LAYOUT, [step], zoom);
          const side = W * zoom;
          let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
          picture.forEach((p, i) => {
            if (p === FILL) return;
            const x = i % side;
            const y = Math.floor(i / side);
            l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y);
          });
          return r < l ? { w: 0, h: 0 } : { w: (r - l + 1) / zoom, h: (b - t + 1) / zoom };
        };
        const one = extent(1);
        if (one.w < 6 || one.h < 6) continue; // a thin sliver may be missed by point sampling
        measured += 1;
        for (const zoom of [3, 5]) {
          const many = extent(zoom);
          // Sampling at picture-pixel centres moves each edge by under one whole zoom block: two art pixels over both edges.
          expect(Math.abs(many.w - one.w)).toBeLessThanOrEqual(2 + 1e-9);
          expect(Math.abs(many.h - one.h)).toBeLessThanOrEqual(2 + 1e-9);
        }
      }
    }
    expect(gables).toBeGreaterThan(0);
    expect(measured).toBeGreaterThan(0);
  });
});

describe('sceneFrame: the shapeBodies option', () => {
  it('defaults to drawing the bodies: absent and true are the same picture', () => {
    const absent = sceneFrame(withBodies(undefined, { turn: 0.8 }));
    expect(sceneFrame(withBodies(true, { turn: 0.8 })).picture).toEqual(absent.picture);
  });

  it('draws no shape bodies when false: the frame differs from the default only where the bodies, shadows and base are, no other pixel moves, and the shadows go too', () => {
    for (const turn of [0, 1.1, 4.0, 2.4, 0.2, 5.1]) {
      const { whole, bare, bodies, shadows, based } = framesAt(turn);
      let differing = 0;
      let shadowOnly = 0;
      let shadowOnlyGone = 0;
      for (let i = 0; i < whole.picture.length; i++) {
        const covered = bodies[i] !== FILL || shadows[i] !== FILL || based[i] !== FILL; // a body, Santa, a shadow or a base pixel
        if (whole.picture[i] !== bare.picture[i]) {
          differing += 1;
          expect(covered).toBe(true);
        }
        if (!covered) expect(bare.picture[i]).toBe(whole.picture[i]);
        if (bodies[i] === FILL && shadows[i] !== FILL && based[i] === FILL) {
          shadowOnly += 1;
          // A shadow-only pixel of the whole frame is shaded; the bare frame has no shade there (Santa included).
          if (whole.picture[i] !== bare.picture[i]) shadowOnlyGone += 1;
        }
      }
      expect(differing).toBeGreaterThan(0);
      expect(shadowOnly).toBeGreaterThan(0);
      expect(shadowOnlyGone).toBeGreaterThan(shadowOnly / 2);
      expect(bodies.some((p) => p !== FILL)).toBe(true);
    }
  });

  it('with the shadows laid back and then the bodies, restores the whole frame (Santa included)', () => {
    const turn = 2.4;
    const { whole, bare, bodies } = framesAt(turn);
    // Laying the shadows back over the bare frame and then the bodies and Santa restores today's picture exactly.
    const back = Uint32Array.from(bare.picture);
    renderShadowSteps(back, W, bare.layout, shadowDrawList(turn), 1);
    renderDrawList(back, W, bare.layout, shapeDrawList(turn, globeShapes, T), 1);
    withBase(back, bare.layout, turn);
    expect(back).toEqual(whole.picture);
    expect(bodies.some((p) => p !== FILL)).toBe(true);
    const { bad, matched } = overlayMismatch(turn);
    expect(bad).toBe(0);
    expect(matched).toBeGreaterThan(0);
  });

  it('works with a handed-in target and layout, and does not change the layout; still throws for a non-finite turn', () => {
    const layout = sceneLayout(W, H, SEED);
    const target = new Uint32Array(W * H).fill(0xffffffff);
    const frame = sceneFrame(withBodies(false, { turn: 0.5 }), target, layout);
    expect(frame.picture).toBe(target);
    expect(frame.layout).toBe(layout);
    expect(frame.picture).not.toEqual(sceneFrame(sceneInput({ turn: 0.5 })).picture);
    expect(() => sceneFrame(withBodies(false, { turn: Number.NaN }))).toThrow(RangeError);
  });
});

const AWKWARD = [0, 0.5, 1.5, 2.5, 4, Math.PI / 4, (3 * Math.PI) / 4];
const PHASES: PhaseReading[] = [NIGHT, { from: 'dawn', to: 'dawn', share: 0 }, { from: 'sunset', to: 'sunset', share: 0 }, { from: 'frosty-morning', to: 'sunset', share: 0.25 }];

/** A shadow step that covers a whole box around the globe, to see only the floor disc's clip. */
function wideStep(layout: SceneLayout): ShadowStep {
  const { cx, cy } = layout.globe;
  return { polygon: [[-cx - 50, -cy - 50], [layout.width - cx + 50, -cy - 50], [layout.width - cx + 50, layout.height - cy + 50], [-cx - 50, layout.height - cy + 50]] };
}

describe('shadowDrawList: the list', () => {
  it('throws a RangeError for a turn that is not finite, and is empty for no shapes', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(() => shadowDrawList(bad)).toThrow(RangeError);
    expect(shadowDrawList(0.3, [])).toEqual([]);
  });

  it('has one step per shape, each a flat polygon of at least three finite vertices, far shapes first: each shape\'s step sits at its far-first place', () => {
    for (const turn of [...SWEEP, 0.4]) {
      const all = shadowDrawList(turn);
      expect(all).toHaveLength(globeShapes.length);
      for (const step of all) {
        expect(step.polygon.length).toBeGreaterThanOrEqual(3);
        for (const [x, y] of step.polygon) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      }
      farFirst(globeShapes, turn).forEach((shape, n) => {
        const alone = shadowDrawList(turn, [shape])[0];
        expect(alone).toBeDefined();
        const mine = all[n]?.polygon ?? [];
        expect(mine).toHaveLength(alone?.polygon.length ?? -1);
        mine.forEach((v, i) => expect(near(v, alone?.polygon[i] ?? [])).toBe(true));
      });
    }
  });

  it('is the same for a turn and a whole turn more, and for a negative turn', () => {
    for (const turn of [0.3, 2.2]) {
      const base = shadowDrawList(turn);
      for (const other of [turn + FULL, turn - FULL, turn + 5 * FULL]) {
        const again = shadowDrawList(other);
        again.forEach((step, n) => step.polygon.forEach((v, i) => expect(near(v, base[n]?.polygon[i] ?? [])).toBe(true)));
      }
    }
  });

  it('does not change the shapes it is given', () => {
    const shapes = [...globeShapes].reverse();
    const before = shapes.map((s) => ({ ...s }));
    shadowDrawList(1.1, shapes);
    expect(shapes).toEqual(before);
  });

  it('is smooth: a small turn moves each corner less than an art unit off the next shadow\'s outline, and the corners are not on whole art units', () => {
    // The distance from (x, y) to the nearest edge of `ring`.
    const outlineDistance = (ring: readonly (readonly [number, number])[], x: number, y: number): number =>
      Math.min(
        ...ring.map(([ax = 0, ay = 0], i) => {
          const [bx = 0, by = 0] = ring[(i + 1) % ring.length] ?? [];
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
          return Math.hypot(ax + t * dx - x, ay + t * dy - y);
        }),
      );
    let fractional = 0;
    for (const turn of [0.123, 1.7, 3.0, 5.9]) {
      const a = shadowDrawList(turn);
      const b = shadowDrawList(turn + 0.002);
      a.forEach((step, n) => {
        const next = b[n]?.polygon ?? [];
        for (const [x, y] of step.polygon) {
          expect(outlineDistance(next, x, y)).toBeLessThan(1);
          if (Math.abs(x - Math.round(x)) > 1e-6 || Math.abs(y - Math.round(y)) > 1e-6) fractional += 1;
        }
      });
    }
    expect(fractional).toBeGreaterThan(0);
  });
});

describe('renderShadowSteps: at zoom 1 it is today\'s drawShapes shadows', () => {
  it('equals the shadows drawShapes paints, pixel for pixel, over two fills, at the awkward turns', () => {
    let painted = 0;
    for (const turn of AWKWARD) {
      for (const fill of [FILL, FILL_B]) {
        const today = filled(LAYOUT, 1, fill);
        drawShapes(today, W, LAYOUT, NIGHT, turn, globeShapes, 'shadows');
        const mine = shadowsOn(turn, 1, fill);
        expect(mine).toEqual(today);
        painted += mine.filter((p) => p !== fill).length;
      }
    }
    expect(painted).toBeGreaterThan(0);
  });

  it('holds in every phase and over the whole sweep', () => {
    for (const phase of PHASES) {
      for (const turn of SWEEP) {
        const today = filled(LAYOUT, 1, FILL);
        drawShapes(today, W, LAYOUT, phase, turn, globeShapes, 'shadows');
        const mine = shadowsOn(turn, 1, FILL);
        let first = -1;
        for (let i = 0; i < mine.length; i++) if (mine[i] !== today[i]) { first = i; break; }
        expect(first, `phase ${phase.from}->${phase.to}, turn ${turn}`).toBe(-1);
        expect(mine.length).toBe(today.length);
      }
    }
  }, 30000);

  it('holds on another layout and over a picture already holding colours of the palette', () => {
    const layout = sceneLayout(320, 200, 99);
    for (const turn of [0.7, 3.3]) {
      const today = new Uint32Array(layout.width * layout.height).map((_, i) => COLOURS[i % COLOURS.length] ?? 0);
      const mine = Uint32Array.from(today);
      drawShapes(today, layout.width, layout, NIGHT, turn, globeShapes, 'shadows');
      renderShadowSteps(mine, layout.width, layout, shadowDrawList(turn), 1);
      expect(mine).toEqual(today);
    }
  });

  it('paints a shadow over a body already there as a blend (the shadow goes under the bodies by the order the caller draws)', () => {
    const turn = 0.5;
    const today = filled(LAYOUT, 1, FILL);
    drawShapes(today, W, LAYOUT, NIGHT, turn, globeShapes, 'shadows');
    const painted = today.filter((p) => p !== FILL);
    expect(painted.length).toBeGreaterThan(0);
    // One flat shade, over one fill: every shadow pixel is the same colour, not the fill and not a body colour.
    expect(new Set(painted).size).toBeLessThanOrEqual(2);
  });

});

describe('renderShadowSteps: the floor disc', () => {
  it('paints no pixel whose centre is off the floor disc, at zoom 1, 2 and 5, at every turn', () => {
    for (const zoom of [1, 2, 5]) {
      for (const turn of [0, 0.5, 1.5, 2.5, 4, 5.9]) {
        const painted = paintedAt(shadowsOn(turn, zoom), zoom);
        for (const [dx, dy] of painted) expect(onFloor(dx, dy), `pixel ${dx},${dy} at zoom ${zoom}`).toBe(true);
        expect(painted.length).toBeGreaterThan(0);
      }
    }
  });

  it('a step covering the whole picture paints exactly the floor disc, at zoom 1 and 3', () => {
    const { cx, cy } = LAYOUT.globe;
    for (const zoom of [1, 3]) {
      const picture = filled(LAYOUT, zoom, FILL);
      renderShadowSteps(picture, W, LAYOUT, [wideStep(LAYOUT)], zoom);
      const side = W * zoom;
      let inside = 0;
      let mismatches = 0;
      picture.forEach((p, i) => {
        const want = onFloor(((i % side) + 0.5) / zoom - cx, (Math.floor(i / side) + 0.5) / zoom - cy);
        if (want) inside += 1;
        if ((p !== FILL) !== want) mismatches += 1;
      });
      expect(inside).toBeGreaterThan(100);
      expect(mismatches).toBe(0);
    }
  });

  it('paints nothing for an empty list, a step wholly off the disc or far outside the picture, or a degenerate polygon (a line, a point), and does not throw', () => {
    const far: ShadowStep = { polygon: [[900, 900], [950, 900], [950, 950], [900, 950]] };
    const negative: ShadowStep = { polygon: [[-900, -900], [-850, -900], [-850, -850]] };
    const line: ShadowStep = { polygon: [[0, 0], [10, 0], [20, 0]] };
    const point: ShadowStep = { polygon: [[3, 3], [3, 3], [3, 3]] };
    for (const steps of [[], [far, negative], [line, point]]) {
      const picture = filled(LAYOUT, 1, FILL);
      expect(() => renderShadowSteps(picture, W, LAYOUT, steps, 1)).not.toThrow();
      expect(picture).toEqual(filled(LAYOUT, 1, FILL));
    }
  });

  it('a step half off the picture\'s edge paints its on-disc part without wrapping to the other side', () => {
    const { cx } = LAYOUT.globe;
    const picture = filled(LAYOUT, 1, FILL);
    // A box that starts left of the picture and ends at the globe's centre.
    renderShadowSteps(picture, W, LAYOUT, [{ polygon: [[-cx - 40, -10], [0, -10], [0, 10], [-cx - 40, 10]] }], 1);
    const painted = paintedAt(picture, 1);
    for (const [dx, dy] of painted) {
      expect(dx).toBeLessThanOrEqual(0);
      expect(Math.abs(dy)).toBeLessThanOrEqual(10);
    }
    expect(painted.length).toBeGreaterThan(0);
  });
});

describe('renderShadowSteps: overlap, zoom and size', () => {
  it('takes the shade once where shadows overlap: every shadow laid twice paints the same picture as once', () => {
    for (const turn of [0.7, 2.2]) {
      const steps = shadowDrawList(turn);
      const once = shadowsOn(turn, 1);
      const twice = new Uint32Array(W * H).fill(FILL);
      renderShadowSteps(twice, W, LAYOUT, [...steps, ...steps], 1);
      expect(twice, `turn ${turn}`).toEqual(once);
    }
  });

  it('has, at the centre of each zoom x zoom block, the zoom 1 picture (zoom 3 and 5)', () => {
    for (const zoom of [3, 5]) {
      for (const turn of AWKWARD) {
        expect(centreMismatches(shadowsOn(turn, zoom), shadowsOn(turn, 1), zoom)).toBe(0);
      }
    }
  });

  it('throws a RangeError for a zoom that is not a whole number of at least 1, leaving the picture alone, and for a picture of the wrong size', () => {
    for (const zoom of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const picture = filled(LAYOUT, 1, FILL);
      expect(() => renderShadowSteps(picture, W, LAYOUT, shadowDrawList(0.5), zoom)).toThrow(RangeError);
      expect(picture).toEqual(filled(LAYOUT, 1, FILL));
    }
    expect(() => renderShadowSteps(new Uint32Array(W * H - 1), W, LAYOUT, shadowDrawList(0.5), 1)).toThrow(RangeError);
    expect(() => renderShadowSteps(new Uint32Array(W * H), W, LAYOUT, shadowDrawList(0.5), 2)).toThrow(RangeError);
  });

  it('moves smoothly at zoom 5: over a run of tiny turns the shadow changes on more frames than at zoom 1, and by under an art pixel', () => {
    let changed1 = 0;
    let changed5 = 0;
    let prev1 = shadowsOn(0.3, 1);
    let prev5 = shadowsOn(0.3, 5);
    for (let n = 1; n <= 40; n++) {
      const turn = 0.3 + n * 0.0005;
      const one = shadowsOn(turn, 1);
      const five = shadowsOn(turn, 5);
      if (one.some((p, i) => p !== prev1[i])) changed1 += 1;
      if (five.some((p, i) => p !== prev5[i])) changed5 += 1;
      prev1 = one;
      prev5 = five;
    }
    expect(changed5).toBeGreaterThan(changed1);
    expect(changed5).toBeGreaterThanOrEqual(30);
  });

  it('a shadow at zoom 5 is not the zoom 1 shadow blown up in whole art pixels (its edges are on the finer grid)', () => {
    let off = 0;
    for (const turn of [0.123, 1.7, 3.0, 5.9]) {
      const five = shadowsOn(turn, 5);
      const side = W * 5;
      for (let y = 0; y < H * 5; y++) {
        for (let x = 0; x < side; x++) {
          const blockFirst = five[(y - (y % 5)) * side + x - (x % 5)];
          if (five[y * side + x] !== blockFirst) off += 1;
        }
      }
    }
    expect(off).toBeGreaterThan(0);
  });
});
