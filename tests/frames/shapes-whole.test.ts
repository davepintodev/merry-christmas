// XMAS-85: no frame of a full turn shows pieces of one object detached. Read
// through the draw list at every 5 degree step of a full turn and at the 45 and
// 135 degree views: the faces of each shape (house, presents, lamp post, pines,
// snowman) touch each other on screen, so the shape is one piece, and the
// pictures drawn from them (house-seams.test.ts checks the house's pixels) have
// no gap between a shape's faces.
import { describe, expect, it } from 'vitest';
import { sceneLayout } from '../../src/scene/frame.ts';
import { renderDrawList, shapeDrawList } from '../../src/scene/shape-draw-list.ts';
import type { FaceDraw } from '../../src/scene/shapes-draw.ts';
import { globeShapes } from '../../src/scene/shapes.ts';

type Pt = readonly [number, number];
const DEGREES = [...Array.from({ length: 72 }, (_, k) => k * 5), 45, 135];
const EPS = 1e-6;

function polygon(s: FaceDraw): Pt[] {
  if (s.clip !== undefined) return [...s.clip];
  return [s.a, s.b, [s.b[0] + s.d[0] - s.a[0], s.b[1] + s.d[1] - s.a[1]], s.d];
}

function inside(poly: readonly Pt[], p: Pt): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Pt;
    const [xj, yj] = poly[j] as Pt;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Two faces are joined when they share an edge (two different corners of one lie on the other's
 * outline) or overlap (a corner of one lies strictly inside the other). Meeting at one corner only
 * is not joined: a gap can run along the rest of the edge.
 */
function touch(p: readonly Pt[], q: readonly Pt[]): boolean {
  const onOutline = (pt: Pt, to: readonly Pt[]): boolean => to.some((t, i) => distToSegment(pt, t, to[(i + 1) % to.length] as Pt) < EPS);
  const near = (from: readonly Pt[], to: readonly Pt[]): boolean => {
    const on = from.filter((pt) => onOutline(pt, to));
    const apart = on.some((u, i) => on.some((v, j) => j > i && Math.hypot(u[0] - v[0], u[1] - v[1]) > 1e-4));
    return apart || from.some((pt) => !onOutline(pt, to) && inside(to, pt));
  };
  return near(p, q) || near(q, p);
}

function components(faces: readonly FaceDraw[]): number {
  const polys = faces.map(polygon);
  const seen = new Set<number>();
  let parts = 0;
  for (let i = 0; i < polys.length; i++) {
    if (seen.has(i)) continue;
    parts++;
    const stack = [i];
    seen.add(i);
    while (stack.length > 0) {
      const at = stack.pop() as number;
      for (let j = 0; j < polys.length; j++) {
        if (!seen.has(j) && touch(polys[at] as Pt[], polys[j] as Pt[])) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
  }
  return parts;
}

describe('every shape is one piece at every turn of a full 360 degrees', () => {
  it('sweeps 72 five-degree steps plus the 45 and 135 degree views', () => {
    expect(DEGREES.length).toBe(74);
    expect(new Set(DEGREES.slice(0, 72)).size).toBe(72);
  });

  it.each(globeShapes.map((s, i) => [`${s.kind} #${i}`, s] as const))('%s: its faces touch, no piece is detached', (_name, shape) => {
    let multi = 0;
    for (const deg of DEGREES) {
      const faces = shapeDrawList((deg * Math.PI) / 180, [shape]);
      expect(faces.length, `${deg} degrees: nothing drawn`).toBeGreaterThan(0);
      if (faces.length > 1) multi++;
      expect(components(faces), `${deg} degrees: faces of the ${shape.kind} are detached`).toBe(1);
    }
    if (shape.kind === 'house' || shape.kind === 'present') expect(multi).toBeGreaterThan(40);
  });

  it('a corner-only touch is not a join, a shared edge and an overlap are', () => {
    const sq = (x: number, y: number): Pt[] => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    expect(touch(sq(0, 0), sq(1, 1))).toBe(false);
    expect(touch(sq(0, 0), sq(1, 0))).toBe(true);
    expect(touch(sq(0, 0), sq(0.5, 0.5))).toBe(true);
    expect(touch(sq(0, 0), sq(1.01, 0))).toBe(false);
  });

  it('the detection works: a face moved away from its shape is reported as a second piece', () => {
    const faces = shapeDrawList(0.3, globeShapes.filter((s) => s.kind === 'house'));
    const first = faces[0] as FaceDraw;
    const away: FaceDraw = { ...first, a: [first.a[0] + 500, first.a[1]], b: [first.b[0] + 500, first.b[1]], d: [first.d[0] + 500, first.d[1]], clip: first.clip?.map(([x, y]) => [x + 500, y] as Pt) };
    expect(components([away, ...faces.slice(1)])).toBeGreaterThan(1);
  });

  it('a shape drawn alone paints something at zoom 2 at every step, and the whole globe never paints fewer pixels than its largest shape', () => {
    const layout = sceneLayout(240, 180, 3);
    const side = layout.width * 2;
    const count = (steps: FaceDraw[]): number => {
      const pic = new Uint32Array(side * layout.height * 2).fill(0x7e7e7e7e);
      renderDrawList(pic, layout.width, layout, steps, 2);
      return pic.filter((c) => c !== 0x7e7e7e7e).length;
    };
    for (const deg of DEGREES.filter((_, i) => i % 3 === 0)) {
      const turn = (deg * Math.PI) / 180;
      const all = count(shapeDrawList(turn));
      for (const shape of globeShapes) {
        const own = count(shapeDrawList(turn, [shape]));
        expect(own, `${deg} degrees: ${shape.kind} paints nothing`).toBeGreaterThan(0);
        expect(all, `${deg} degrees: the globe paints far less than ${shape.kind} alone`).toBeGreaterThanOrEqual(own * 0.9);
      }
    }
  }, 60_000);
});

describe('no gap inside any shape: every pixel centre inside a face of it is painted', () => {
  const LAYOUT = sceneLayout(240, 180, 3);
  const FILL = 0x7e7e7e7e;
  const ZOOM = 2;
  const OPAQUE = 0xff112233;

  function gaps(shape: (typeof globeShapes)[number], turn: number): number {
    // Transparent drawing pixels are meant to show the background, so make them opaque: what is left unpainted is a crack between faces.
    const steps = shapeDrawList(turn, [shape]).map((s) => ({ ...s, drawing: { ...s.drawing, pixels: s.drawing.pixels.map((c) => (c === 0 ? OPAQUE : c)) } }) as FaceDraw);
    const side = LAYOUT.width * ZOOM;
    const picture = new Uint32Array(side * LAYOUT.height * ZOOM).fill(FILL);
    renderDrawList(picture, LAYOUT.width, LAYOUT, steps, ZOOM);
    let missing = 0;
    for (const step of steps) {
      const poly = polygon(step);
      const xs = poly.map((q) => q[0]);
      const ys = poly.map((q) => q[1]);
      for (let y = Math.floor(Math.min(...ys) * ZOOM); y <= Math.ceil(Math.max(...ys) * ZOOM); y++) {
        for (let x = Math.floor(Math.min(...xs) * ZOOM); x <= Math.ceil(Math.max(...xs) * ZOOM); x++) {
          const c: Pt = [(x + 0.5) / ZOOM, (y + 0.5) / ZOOM];
          if (!inside(poly, c)) continue;
          if (poly.some((v, i) => distToSegment(c, v, poly[(i + 1) % poly.length] as Pt) < 0.5 / ZOOM)) continue; // on the rim: half covered pixels may be skipped
          if (picture[Math.floor((c[1] + LAYOUT.globe.cy) * ZOOM) * side + Math.floor((c[0] + LAYOUT.globe.cx) * ZOOM)] === FILL) missing++;
        }
      }
    }
    return missing;
  }

  it.each(globeShapes.map((s, i) => [`${s.kind} #${i}`, s] as const))('%s: no unpainted pixel inside its faces at 72 turns plus 45 and 135', (_n, shape) => {
    for (const deg of DEGREES) expect(gaps(shape, (deg * Math.PI) / 180), `${deg} degrees: gap inside the ${shape.kind}`).toBe(0);
  }, 60_000);
});
