// XMAS-81: while the house turns, its walls, roof and gables must fit each other.
// Read through the draw list and its CPU renderer at many turn angles and at
// the zooms the fine layer stands for: where two walls meet they share their
// edge corner for corner and carry the same vertical axis (so brick rows
// continue across it), the gables stand on the walls' top edges, and the
// rendered house has no hole or crack inside its silhouette.
import { describe, expect, it } from 'vitest';
import { sceneLayout } from '../../src/scene/frame.ts';
import { renderDrawList, shapeDrawList } from '../../src/scene/shape-draw-list.ts';
import type { FaceDraw } from '../../src/scene/shapes-draw.ts';
import { globeShapes } from '../../src/scene/shapes.ts';

const HOUSE = globeShapes.filter((s) => s.kind === 'house');
const LAYOUT = sceneLayout(240, 180, 3);
const FILL = 0x7e7e7e7e;
/** 0 to 2π in 1.25 degree steps, plus angles off the grid and both sides of every quarter turn. */
const TURNS = [
  ...Array.from({ length: 288 }, (_, k) => (k * 2 * Math.PI) / 288),
  0.0001,
  2 * Math.PI - 0.0001,
  ...[1, 2, 3, 4].flatMap((q) => [(q * Math.PI) / 2 - 1e-6, (q * Math.PI) / 2 + 1e-6]),
  -0.7,
  9.123,
];

type Pt = readonly [number, number];
const same = (p: Pt, q: Pt): boolean => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;

/** The house faces that are whole walls (a quad drawn with a wall drawing), not the roof. */
function walls(turn: number): FaceDraw[] {
  return shapeDrawList(turn, HOUSE).filter((s) => s.clip === undefined && s.drawing.height === 15 && (s.drawing.width === 28 || s.drawing.width === 18));
}

function corners(s: FaceDraw): Pt[] {
  return [s.a, s.b, [s.b[0] + s.d[0] - s.a[0], s.b[1] + s.d[1] - s.a[1]], s.d];
}

function polygon(s: FaceDraw): readonly Pt[] {
  return s.clip ?? corners(s);
}

function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as Pt;
    const [xj, yj] = poly[j] as Pt;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe('the house at every turn: where its walls meet', () => {
  it('shows one wall or two adjacent ones, never a lone wall away from the other\'s edge', () => {
    let pairs = 0;
    for (const turn of TURNS) {
      const w = walls(turn);
      expect(w.length).toBeGreaterThanOrEqual(1);
      expect(w.length).toBeLessThanOrEqual(2);
      if (w.length === 2) pairs++;
    }
    expect(pairs).toBeGreaterThan(100);
  });

  it('two visible walls share one whole vertical edge, top and foot, to the last decimal', () => {
    for (const turn of TURNS) {
      const [p, q] = walls(turn);
      if (p === undefined || q === undefined) continue;
      const cp = corners(p);
      const cq = corners(q);
      // The edge is the pair of corners (top, foot) on the same side of one wall and the opposite side of the other.
      const meets = [
        same(cp[1] as Pt, cq[0] as Pt) && same(cp[2] as Pt, cq[3] as Pt),
        same(cp[0] as Pt, cq[1] as Pt) && same(cp[3] as Pt, cq[2] as Pt),
      ];
      expect(meets.some(Boolean), `walls do not meet at turn ${turn}`).toBe(true);
    }
  });

  it('keeps brick rows going across the edge: both walls have the same vertical axis, so a row meets its own row', () => {
    for (const turn of TURNS) {
      const [p, q] = walls(turn);
      if (p === undefined || q === undefined) continue;
      expect(p.drawing.height).toBe(q.drawing.height);
      expect(p.d[0] - p.a[0]).toBeCloseTo(q.d[0] - q.a[0], 9);
      expect(p.d[1] - p.a[1]).toBeCloseTo(q.d[1] - q.a[1], 9);
      // One drawing row is one art unit down, whatever the turn.
      expect(Math.hypot(p.d[0] - p.a[0], p.d[1] - p.a[1])).toBeCloseTo(p.drawing.height, 9);
    }
  });

  it('puts the same row at the same height on both sides of the edge: row boundaries of the two walls coincide on screen', () => {
    for (const turn of TURNS) {
      const [p, q] = walls(turn);
      if (p === undefined || q === undefined) continue;
      const cp = corners(p);
      const cq = corners(q);
      const [edgeP, edgeQ] = same(cp[1] as Pt, cq[0] as Pt) ? [cp[1] as Pt, cq[0] as Pt] : [cp[0] as Pt, cq[1] as Pt];
      // The edge's top is the same point, so row r of each starts at the same height there.
      expect(edgeP[1]).toBeCloseTo(edgeQ[1], 9);
      for (let row = 0; row <= p.drawing.height; row++) {
        const yp = edgeP[1] + (row * (p.d[1] - p.a[1])) / p.drawing.height;
        const yq = edgeQ[1] + (row * (q.d[1] - q.a[1])) / q.drawing.height;
        expect(yp).toBeCloseTo(yq, 9);
      }
    }
  });
});

describe('the house at every turn: gables stand on the walls', () => {
  it('a gable\'s base is its side wall\'s top edge, foot to foot', () => {
    let gables = 0;
    for (const turn of TURNS) {
      const steps = shapeDrawList(turn, HOUSE);
      const w = walls(turn);
      for (const gable of steps.filter((s) => s.clip !== undefined)) {
        gables++;
        const [left, , right] = gable.clip as readonly Pt[];
        const wall = w.find((s) => s.drawing === gable.drawing);
        expect(wall, `gable with no side wall at turn ${turn}`).toBeDefined();
        const top = [(wall as FaceDraw).a, (wall as FaceDraw).b];
        expect(top.some((t) => same(t, left as Pt)) && top.some((t) => same(t, right as Pt)), `gable feet are off the wall top at turn ${turn}`).toBe(true);
      }
    }
    expect(gables).toBeGreaterThan(50);
  });

  it('a gable\'s apex is the roof ridge: it lies on the roof slope\'s top edge', () => {
    for (const turn of TURNS) {
      const steps = shapeDrawList(turn, HOUSE);
      const roofs = steps.filter((s) => s.drawing.width === 30);
      for (const gable of steps.filter((s) => s.clip !== undefined)) {
        const apex = (gable.clip as readonly Pt[])[1] as Pt;
        if (roofs.length === 0) continue;
        // The ridge is the roof's top edge a-b: the apex is on the line through them, between the ends (the roof overhangs).
        const roof = roofs[0] as FaceDraw;
        const dx = roof.b[0] - roof.a[0];
        const dy = roof.b[1] - roof.a[1];
        const cross = Math.abs((apex[0] - roof.a[0]) * dy - (apex[1] - roof.a[1]) * dx) / Math.hypot(dx, dy);
        expect(cross, `gable apex off the ridge at turn ${turn}`).toBeLessThan(1e-6);
      }
    }
  });
});

describe('the rendered house has no hole or crack in it', () => {
  /** Flood the unpainted pixels from the picture's border: any unpainted pixel not reached is enclosed by the house. */
  function enclosed(picture: Uint32Array, side: number, rows: number): number {
    const seen = new Uint8Array(picture.length);
    const stack: number[] = [];
    const push = (x: number, y: number): void => {
      const i = y * side + x;
      if (x < 0 || y < 0 || x >= side || y >= rows || seen[i] === 1 || picture[i] !== FILL) return;
      seen[i] = 1;
      stack.push(i);
    };
    for (let x = 0; x < side; x++) {
      push(x, 0);
      push(x, rows - 1);
    }
    for (let y = 0; y < rows; y++) {
      push(0, y);
      push(side - 1, y);
    }
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % side;
      const y = Math.floor(i / side);
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    let holes = 0;
    for (let i = 0; i < picture.length; i++) if (picture[i] === FILL && seen[i] === 0) holes++;
    return holes;
  }

  it('is whole at zoom 1, 3 and 5 over the whole turn', () => {
    for (const zoom of [1, 3, 5]) {
      const side = LAYOUT.width * zoom;
      const rows = LAYOUT.height * zoom;
      for (const turn of TURNS.filter((_, i) => i % 3 === 0 || i >= 288)) {
        const picture = new Uint32Array(side * rows).fill(FILL);
        renderDrawList(picture, LAYOUT.width, LAYOUT, shapeDrawList(turn, HOUSE), zoom);
        expect(enclosed(picture, side, rows), `holes in the house at zoom ${zoom}, turn ${turn}`).toBe(0);
      }
    }
  }, 60_000);

  it('paints every pixel centre inside the house\'s outline, between faces too: the pixels on the line where two walls meet are painted', () => {
    const zoom = 4;
    const side = LAYOUT.width * zoom;
    let onEdge = 0;
    for (const turn of TURNS.filter((_, i) => i % 2 === 0)) {
      const [p, q] = walls(turn);
      if (p === undefined || q === undefined) continue;
      if (Math.min(Math.abs(p.b[0] - p.a[0]), Math.abs(q.b[0] - q.a[0])) < 1) continue; // a wall nearly edge-on is a hairline: no pixel of it is beside the edge
      const picture = new Uint32Array(side * LAYOUT.height * zoom).fill(FILL);
      renderDrawList(picture, LAYOUT.width, LAYOUT, shapeDrawList(turn, HOUSE), zoom);
      const cp = corners(p);
      const cq = corners(q);
      const [top, foot] = same(cp[1] as Pt, cq[0] as Pt) ? [cp[1] as Pt, cp[2] as Pt] : [cp[0] as Pt, cp[3] as Pt];
      // Walk down the shared edge, a pixel centre on each side of it at the zoom's pixel size, and find each painted.
      for (let t = 0.1; t <= 0.9; t += 0.02) {
        const x = top[0] + (foot[0] - top[0]) * t;
        const y = top[1] + (foot[1] - top[1]) * t;
        for (const dx of [-0.5 / zoom, 0.5 / zoom]) {
          const px = Math.floor((x + dx + LAYOUT.globe.cx) * zoom);
          const py = Math.floor((y + LAYOUT.globe.cy) * zoom);
          expect(picture[py * side + px], `crack at turn ${turn}, t ${t}`).not.toBe(FILL);
          onEdge++;
        }
      }
    }
    expect(onEdge).toBeGreaterThan(1000);
  });

  it('covers its whole outline: every pixel centre inside any face polygon is painted at zoom 4', () => {
    const zoom = 4;
    const side = LAYOUT.width * zoom;
    for (const turn of TURNS.filter((_, i) => i % 7 === 0)) {
      const steps = shapeDrawList(turn, HOUSE).filter((s) => !s.drawing.pixels.includes(0));
      const picture = new Uint32Array(side * LAYOUT.height * zoom).fill(FILL);
      renderDrawList(picture, LAYOUT.width, LAYOUT, steps, zoom);
      for (const step of steps) {
        const poly = polygon(step);
        const xs = poly.map((p) => p[0]);
        const ys = poly.map((p) => p[1]);
        for (let y = Math.floor(Math.min(...ys) * zoom); y <= Math.ceil(Math.max(...ys) * zoom); y++) {
          for (let x = Math.floor(Math.min(...xs) * zoom); x <= Math.ceil(Math.max(...xs) * zoom); x++) {
            const cx = (x + 0.5) / zoom;
            const cy = (y + 0.5) / zoom;
            if (!inside(poly, cx, cy)) continue;
            const pxi = Math.floor((cx + LAYOUT.globe.cx) * zoom);
            const pyi = Math.floor((cy + LAYOUT.globe.cy) * zoom);
            expect(picture[pyi * side + pxi]).not.toBe(FILL);
          }
        }
      }
    }
  });
});
