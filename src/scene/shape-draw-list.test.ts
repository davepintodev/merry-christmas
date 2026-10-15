// XMAS-80: the shapes' bodies as an ordered list of draw steps (per face: its
// drawing, the map from drawing pixels to globe-centred art units, and a
// gable's triangle clip; far shapes first, each shape's far faces first) and
// a CPU renderer that draws the list at any whole zoom. At zoom 1 the picture
// is today's drawShapes bodies; at a higher zoom the centre pixel of each
// zoom x zoom block is the zoom 1 picture. sceneFrame can leave the bodies
// out (shapeBodies: false) while the shadows stay.
import { describe, expect, it } from 'vitest';
import type { Drawing } from '../shared/art.generated.ts';
import type { PhaseReading } from '../shared/clock.ts';
import { masterColours } from '../../art/colours.ts';
import { sceneFrame, sceneLayout, type SceneInput, type SceneLayout } from './frame.ts';
import { renderDrawList, shapeDrawList, type DrawStep } from './shape-draw-list.ts';
import { drawShapes } from './shapes-draw.ts';
import { globeShapes, projectShape, sheet, wrapTurn, type GlobeShape } from './shapes.ts';

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

function filled(layout: SceneLayout, zoom: number, colour: number, width = layout.width): Uint32Array {
  return new Uint32Array(width * zoom * layout.height * zoom).fill(colour);
}

function rendered(turn: number, zoom: number, colour = FILL, layout = LAYOUT, shapes: readonly GlobeShape[] = globeShapes): Uint32Array {
  const picture = filled(layout, zoom, colour);
  renderDrawList(picture, layout.width, layout, shapeDrawList(turn, shapes), zoom);
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
 * Counts the pixels where the list (bodies and Santa, XMAS-83) laid over a bodiless frame is not today's frame. The bodiless frame
 * holds no Santa, so where the list painted a pixel the whole frame must hold it; where the list painted nothing the two frames
 * must agree. Also reports how many painted pixels matched.
 */
function overlayMismatch(turn: number, phase: PhaseReading = NIGHT): { bad: number; matched: number } {
  const whole = sceneFrame(sceneInput({ turn, phase }));
  const bare = sceneFrame(withBodies(false, { turn, phase }));
  const list = renderedWithSanta(turn, 1);
  let bad = 0;
  let matched = 0;
  for (let i = 0; i < whole.picture.length; i++) {
    const w = whole.picture[i];
    if (list[i] === FILL) {
      if (w !== bare.picture[i]) bad += 1;
    } else if (w === list[i]) matched += 1;
    else bad += 1;
  }
  return { bad, matched };
}

/** The bodies and Santa (at time T, as sceneInput has it) in depth order, laid on `fill`. */
function renderedWithSanta(turn: number, zoom: number, colour = FILL): Uint32Array {
  const picture = filled(LAYOUT, zoom, colour);
  renderDrawList(picture, LAYOUT.width, LAYOUT, shapeDrawList(turn, globeShapes, T), zoom);
  return picture;
}

function plainDrawing(width: number, height: number, pixels: number[]): Drawing {
  return { sheet: 'test', x: 0, y: 0, width, height, pixels: Uint8Array.from(pixels) };
}

/** A small layout whose globe centre is chosen, for steps placed by hand. */
function layoutAt(width: number, height: number, cx: number, cy: number): SceneLayout {
  return { ...LAYOUT, width, height, globe: { ...LAYOUT.globe, cx, cy } };
}

describe('shapeDrawList: the list', () => {
  it('throws a RangeError for a turn that is not finite', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => shapeDrawList(bad)).toThrow(RangeError);
    }
  });

  it('is empty for an empty shapes list', () => {
    expect(shapeDrawList(0.4, [])).toEqual([]);
  });

  it('has one step per visible face of every shape, each with its own drawing', () => {
    for (const turn of SWEEP) {
      const steps = shapeDrawList(turn);
      const faces = globeShapes.flatMap((shape) => projectShape(shape, turn));
      expect(steps).toHaveLength(faces.length);
      expect(steps.map((s) => s.drawing).sort((x, y) => x.x - y.x || x.y - y.y || x.sheet.localeCompare(y.sheet))).toEqual(
        faces.map((f) => sheet(f.drawing)).sort((x, y) => x.x - y.x || x.y - y.y || x.sheet.localeCompare(y.sheet)),
      );
    }
  });

  it('puts far shapes first and, inside a shape, its far faces first, at several turns', () => {
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
      });
    }
  });

  it('orders shapes by nearness whatever order the caller lists them in', () => {
    const far: GlobeShape = { kind: 'present', x: 0, z: -20, width: 10, depth: 10, height: 10, design: 1 };
    const nearOne: GlobeShape = { kind: 'present', x: 0, z: 20, width: 10, depth: 10, height: 10, design: 2 };
    const one = shapeDrawList(0, [far, nearOne]);
    const other = shapeDrawList(0, [nearOne, far]);
    expect(other).toEqual(one);
    // Every step of the far present comes before every step of the near one.
    const farLen = projectShape(far, 0).length;
    expect(one.slice(0, farLen).map((s) => s.drawing)).toEqual([...projectShape(far, 0)].reverse().map((f) => sheet(f.drawing)));
    // Half a turn later the two swap places.
    const turned = shapeDrawList(Math.PI, [far, nearOne]);
    expect(turned.slice(0, projectShape(nearOne, Math.PI).length).map((s) => s.drawing)).toEqual(
      [...projectShape(nearOne, Math.PI)].reverse().map((f) => sheet(f.drawing)),
    );
  });

  it('takes a, b and d from a four-corner face as its top left, top right and bottom left, with no clip', () => {
    let quads = 0;
    for (const turn of SWEEP) {
      const faces = farFirst(globeShapes, turn).flatMap((shape) => [...projectShape(shape, turn)].reverse());
      shapeDrawList(turn).forEach((step, i) => {
        const face = faces[i];
        if (face?.corners.length !== 4) return;
        quads += 1;
        expect(step.clip).toBeUndefined();
        expect(near(step.a, face.corners[0] ?? [])).toBe(true);
        expect(near(step.b, face.corners[1] ?? [])).toBe(true);
        expect(near(step.d, face.corners[3] ?? [])).toBe(true);
      });
    }
    expect(quads).toBeGreaterThan(0);
  });

  it('gives a gable its triangle as the clip, hung from the apex level, and no other face one', () => {
    let gables = 0;
    for (const turn of SWEEP) {
      const faces = farFirst(globeShapes, turn).flatMap((shape) => [...projectShape(shape, turn)].reverse());
      shapeDrawList(turn).forEach((step, i) => {
        const face = faces[i];
        if (face === undefined) return;
        if (face.corners.length !== 3) {
          expect(step.clip).toBeUndefined();
          return;
        }
        gables += 1;
        const want = expectedStep(face);
        expect(step.clip).toHaveLength(3);
        step.clip?.forEach((c, k) => expect(near(c, want.clip?.[k] ?? [])).toBe(true));
        expect(near(step.a, want.a)).toBe(true);
        expect(near(step.b, want.b)).toBe(true);
        expect(near(step.d, want.d)).toBe(true);
      });
    }
    expect(gables).toBeGreaterThan(0);
  });

  it('keeps a gable drawing\'s proportions: one art unit down per drawing row, its width axis the base edge, the triangle inside the drawing', () => {
    let gables = 0;
    for (const turn of SWEEP) {
      for (const step of shapeDrawList(turn)) {
        if (step.clip === undefined) continue;
        gables += 1;
        const [p, , r] = step.clip;
        // The downward axis is the drawing's whole height, straight down: not squashed or stretched.
        expect(step.d[0]).toBeCloseTo(step.a[0], 9);
        expect(step.d[1] - step.a[1]).toBeCloseTo(step.drawing.height, 9);
        // The width axis is the gable's base edge (p to r), so the drawing spans the gable's width.
        expect(step.b[0] - step.a[0]).toBeCloseTo((r?.[0] ?? Number.NaN) - (p?.[0] ?? Number.NaN), 9);
        expect(step.b[1] - step.a[1]).toBeCloseTo((r?.[1] ?? Number.NaN) - (p?.[1] ?? Number.NaN), 9);
        // Every clip corner has drawing coordinates u, v within 0..1.
        const ux = step.b[0] - step.a[0];
        const uy = step.b[1] - step.a[1];
        const vy = step.d[1] - step.a[1];
        for (const [x, y] of step.clip) {
          const dx = x - step.a[0];
          const dy = y - step.a[1];
          const v = dy / vy - 0;
          // d is straight down, so dy = uy * u + vy * v and dx = ux * u.
          const u = Math.abs(ux) > 1e-9 ? dx / ux : 0;
          const vFull = (dy - uy * u) / vy;
          expect(vFull).toBeGreaterThan(-1e-9);
          expect(vFull).toBeLessThan(1 + 1e-9);
          expect(v).toBeGreaterThan(-1);
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
    for (const turn of [FULL, -FULL, 2 * FULL, -3 * FULL]) {
      expect(shapeDrawList(turn)).toEqual(base);
    }
  });

  it('does not change the shapes it is given', () => {
    const shapes = globeShapes.map((s) => ({ ...s }));
    const copy = JSON.stringify(shapes);
    shapeDrawList(1.1, shapes);
    expect(JSON.stringify(shapes)).toBe(copy);
  });
});

describe('renderDrawList: the renderer', () => {
  it('draws nothing for an empty list and leaves the picture alone', () => {
    const picture = filled(LAYOUT, 3, FILL);
    renderDrawList(picture, W, LAYOUT, [], 3);
    expect(picture.every((p) => p === FILL)).toBe(true);
  });

  it('rejects a zoom that is not a whole number of at least 1', () => {
    for (const bad of [0, -2, 1.5, Number.NaN]) {
      expect(() => renderDrawList(filled(LAYOUT, 1, FILL), W, LAYOUT, shapeDrawList(0), bad)).toThrow(RangeError);
    }
  });

  it('point-samples each drawing pixel as a whole zoom-sized block about the globe centre', () => {
    const layout = layoutAt(8, 8, 4, 4);
    const drawing = plainDrawing(2, 2, [1, 2, 3, 4]);
    const step: DrawStep = { drawing, a: [-2, -2], b: [2, -2], d: [-2, 2] };
    for (const zoom of [1, 2, 3, 5]) {
      const picture = filled(layout, zoom, FILL);
      renderDrawList(picture, 8, layout, [step], zoom);
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
    const layout = layoutAt(8, 8, 4, 4);
    const drawing = plainDrawing(2, 1, [1, 2]);
    const picture = filled(layout, 1, FILL);
    renderDrawList(picture, 8, layout, [{ drawing, a: [2, -1], b: [-2, -1], d: [2, 1] }], 1);
    expect(picture[4 * 8 + 3]).toBe(COLOURS[1]);
    expect(picture[4 * 8 + 5 - 0]).toBe(COLOURS[0] ?? -1);
  });

  it('leaves the background where a drawing pixel is transparent', () => {
    const layout = layoutAt(8, 8, 4, 4);
    const drawing = plainDrawing(2, 2, [0, 2, 3, 0]);
    const picture = filled(layout, 2, FILL);
    renderDrawList(picture, 8, layout, [{ drawing, a: [-2, -2], b: [2, -2], d: [-2, 2] }], 2);
    expect(picture[4 * 16 + 4]).toBe(FILL); // top left block, transparent
    expect(picture[4 * 16 + 10]).toBe(COLOURS[1]); // top right block spans x 8..11
    expect(picture[10 * 16 + 4]).toBe(COLOURS[2]); // bottom left block spans y 8..11
    expect(picture[10 * 16 + 10]).toBe(FILL); // bottom right, transparent
  });

  it('lets a later step cover an earlier one where they overlap, and only there', () => {
    const layout = layoutAt(8, 8, 4, 4);
    const first: DrawStep = { drawing: plainDrawing(1, 1, [1]), a: [-3, -3], b: [1, -3], d: [-3, 1] };
    const second: DrawStep = { drawing: plainDrawing(1, 1, [2]), a: [-1, -1], b: [3, -1], d: [-1, 3] };
    const picture = filled(layout, 1, FILL);
    renderDrawList(picture, 8, layout, [first, second], 1);
    expect(picture[2 * 8 + 2]).toBe(COLOURS[0]);
    expect(picture[4 * 8 + 4]).toBe(COLOURS[1]);
    const swapped = filled(layout, 1, FILL);
    renderDrawList(swapped, 8, layout, [second, first], 1);
    expect(swapped[4 * 8 + 4]).toBe(COLOURS[0]);
  });

  it('draws only the clip triangle of a clipped step', () => {
    const layout = layoutAt(12, 12, 6, 6);
    const drawing = plainDrawing(1, 1, [1]);
    const clip = [[-4, 4], [0, -4], [4, 4]] as const;
    const step: DrawStep = { drawing, a: [-4, -4], b: [4, -4], d: [-4, 4], clip };
    for (const zoom of [1, 3]) {
      const picture = filled(layout, zoom, FILL);
      renderDrawList(picture, 12, layout, [step], zoom);
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
        const picture = rendered(turn, zoom);
        const side = W * zoom;
        let painted = 0;
        for (let i = 0; i < picture.length; i++) {
          if (picture[i] === FILL) continue;
          painted += 1;
          const x = ((i % side) + 0.5) / zoom - LAYOUT.globe.cx;
          const y = (Math.floor(i / side) + 0.5) / zoom - LAYOUT.globe.cy;
          expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9);
          expect(x).toBeLessThanOrEqual(Math.max(...xs) + 1e-9);
          expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
          expect(y).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
        }
        expect(painted).toBeGreaterThan(0);
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

  it('clips at the picture edges without wrapping a row onto the next', () => {
    for (const zoom of [1, 3]) {
      for (const turn of [0, 2.2]) {
        // The same shapes with the globe 30 and then 90 pixels from the left edge, and 20 from the top:
        // the narrow picture must be the wide one cropped, so nothing leaks to the row before or after.
        const wide = layoutAt(W, 80, 90, 55);
        const cut = layoutAt(W - 60, 80, 30, 55);
        const bigPic = filled(wide, zoom, FILL);
        renderDrawList(bigPic, wide.width, wide, shapeDrawList(turn), zoom);
        const smallPic = filled(cut, zoom, FILL);
        renderDrawList(smallPic, cut.width, cut, shapeDrawList(turn), zoom);
        const sideBig = wide.width * zoom;
        const sideSmall = cut.width * zoom;
        for (let y = 0; y < 80 * zoom; y++) {
          for (let x = 0; x < sideSmall; x++) {
            expect(smallPic[y * sideSmall + x]).toBe(bigPic[y * sideBig + x + 60 * zoom]);
          }
        }
      }
    }
  });

  it('clips at the top without wrapping and does not touch rows below the picture', () => {
    const tall = layoutAt(W, 120, 100, 80);
    const short = layoutAt(W, 60, 100, 20);
    const bigPic = filled(tall, 1, FILL);
    renderDrawList(bigPic, W, tall, shapeDrawList(0.5), 1);
    const smallPic = filled(short, 1, FILL);
    renderDrawList(smallPic, W, short, shapeDrawList(0.5), 1);
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < W; x++) expect(smallPic[y * W + x]).toBe(bigPic[(y + 60) * W + x]);
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

  it('equals sceneFrame\'s whole picture when laid over the frame without bodies (Santa in its depth order), over the whole sweep', () => {
    for (const turn of SWEEP) {
      const { bad, matched } = overlayMismatch(turn);
      expect(bad).toBe(0);
      expect(matched).toBeGreaterThan(0);
    }
  });

  it('holds in every phase', () => {
    const phases: PhaseReading[] = [
      { from: 'dawn', to: 'dawn', share: 0 },
      { from: 'sunset', to: 'sunset', share: 0 },
      { from: 'frosty-morning', to: 'sunset', share: 0.25 },
    ];
    for (const phase of phases) {
      for (const turn of [0.4, 2.9, -1.3]) {
        const { bad, matched } = overlayMismatch(turn, phase);
        expect(bad).toBe(0);
        expect(matched).toBeGreaterThan(0);
      }
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
        expect(Math.abs(x)).toBeLessThanOrEqual(radius);
        expect(Math.abs(y)).toBeLessThanOrEqual(radius + 1);
        inside += 1;
      }
      expect(inside).toBeGreaterThan(0);
    }
  });

  it('holds at a turn that is negative, a whole turn or many turns', () => {
    for (const turn of [-FULL, FULL, -0.75, 7 * FULL + 0.3]) {
      const { bad, matched } = overlayMismatch(turn);
      expect(bad).toBe(0);
      expect(matched).toBeGreaterThan(0);
    }
  });
});

describe('the list at a higher zoom', () => {
  it('has, at the centre of each zoom x zoom block, the zoom 1 picture (zoom 3 and 5)', () => {
    for (const zoom of [3, 5]) {
      for (const turn of SWEEP) {
        const one = rendered(turn, 1);
        const many = rendered(turn, zoom);
        const centre = (zoom - 1) / 2;
        let mismatches = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (many[(y * zoom + centre) * W * zoom + x * zoom + centre] !== one[y * W + x]) mismatches += 1;
          }
        }
        expect(mismatches).toBe(0);
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
      const centre = (zoom - 1) / 2;
      let bodies = 0;
      let mismatches = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (many[(y * zoom + centre) * W * zoom + x * zoom + centre] !== one[y * W + x]) mismatches += 1;
          if (one[y * W + x] !== base.picture[y * W + x]) bodies += 1;
        }
      }
      expect(mismatches).toBe(0);
      expect(bodies).toBeGreaterThan(0);
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
    const yes = sceneFrame(withBodies(true, { turn: 0.8 }));
    expect(yes.picture).toEqual(absent.picture);
  });

  it('draws no shape bodies when false: the frame differs from the default only where the bodies are', () => {
    for (const turn of [0, 1.1, 4.0]) {
      const whole = sceneFrame(sceneInput({ turn }));
      const bare = sceneFrame(withBodies(false, { turn }));
      const covered = renderedWithSanta(turn, 1);
      let differing = 0;
      for (let i = 0; i < whole.picture.length; i++) {
        if (whole.picture[i] !== bare.picture[i]) {
          differing += 1;
          expect(covered[i]).not.toBe(FILL); // a body or Santa pixel
        }
      }
      expect(differing).toBeGreaterThan(0);
    }
  });

  it('leaves the rest of the picture unchanged: no pixel outside the shapes moves, and the shadows stay', () => {
    const turn = 2.4;
    const whole = sceneFrame(sceneInput({ turn }));
    const bare = sceneFrame(withBodies(false, { turn }));
    const bodies = rendered(turn, 1, FILL);
    // Laying the bodies back over the bare frame restores today's picture exactly, shadows included.
    const back = Uint32Array.from(bare.picture);
    renderDrawList(back, W, bare.layout, shapeDrawList(turn, globeShapes, T), 1);
    expect(back).toEqual(whole.picture);
    expect(bodies.some((p) => p !== FILL)).toBe(true);
  });

  it('works with a handed-in target and layout, and does not change the layout', () => {
    const layout = sceneLayout(W, H, SEED);
    const target = new Uint32Array(W * H).fill(0xffffffff);
    const frame = sceneFrame(withBodies(false, { turn: 0.5 }), target, layout);
    expect(frame.picture).toBe(target);
    expect(frame.layout).toBe(layout);
    expect(frame.picture).not.toEqual(sceneFrame(sceneInput({ turn: 0.5 })).picture);
  });

  it('still throws for a non-finite turn when false', () => {
    expect(() => sceneFrame(withBodies(false, { turn: Number.NaN }))).toThrow(RangeError);
  });
});
