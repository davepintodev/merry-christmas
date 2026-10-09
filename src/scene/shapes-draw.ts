// XMAS-32b "The globe", slice 2: drawing the turning shapes into the picture.
// drawGlobe calls drawShapes inside the glass, over the glass's own colours:
// nearer shapes cover farther ones, a shape's faces are laid together so its
// own edges show no seam, and every edge is drawn as the in-between shade of
// what lies beyond it, so the shapes slide on the fixed grid like the
// lettering, and each shape casts a smooth shadow on the floor to its right,
// away from the disc at the top left (XMAS-21 7.2-7.4).
import { masterColours } from '../../art/colours.ts';
import type { PhaseReading } from '../shared/clock.ts';
import { blendShade, edgeCoverage } from './blend.ts';
import type { SceneLayout } from './frame.ts';
import { globeShapes, onFloor, projectPoint, projectShape, sheet, wrapTurn, type GlobeShape, type ProjectedFace } from './shapes.ts';

/** The master list's colours as numbers, so a drawing's pixel is a colour. */
const COLOUR_NUMBERS: readonly number[] = masterColours.map((colour) => Number.parseInt(colour.slice(1), 16));
/** The shadow runs this far right of a shape (the light is at the top left) and fades out over this many pixels. */
const SHADOW_SHIFT = 8;
const SHADOW_SOFT = 6;
/** How tall the shadow is on the floor, in art pixels, and how dark it gets: black only ever darkens the floor it falls on. */
const SHADOW_TALL = 4;
const SHADOW_STRENGTH = 0.4;
const SHADOW_INK = 0x000000;

/** Whether two colours differ by at most one step in every channel. */
function withinOneStep(a: number, b: number): boolean {
  return (
    Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)) <= 1 &&
    Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)) <= 1 &&
    Math.abs((a & 0xff) - (b & 0xff)) <= 1
  );
}

/**
 * Blends `colour` over the pixel at `index` by `coverage` (0..1). A face or
 * shadow that only grazes a pixel would tint it by at most one step of every
 * channel; on the glass's own gradient that reads as a 2 x 2 dither, so a
 * hairline is passed over, like a face seen edge-on.
 */
function paintPixel(picture: Uint32Array, index: number, colour: number, coverage: number): void {
  if (coverage <= 0) return;
  const under = picture[index] ?? 0;
  const drawn = blendShade(under, colour, coverage);
  if (coverage < 1 - 1e-9 && withinOneStep(drawn, under)) return;
  picture[index] = drawn;
}

/** The distance from a point to a segment, in art pixels. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const length = vx * vx + vy * vy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / length));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** How far a point is outside a convex ring of corners: zero inside it. */
function ringDistance(px: number, py: number, ring: readonly (readonly [number, number])[]): number {
  let left = false;
  let right = false;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i] ?? [0, 0];
    const [bx, by] = ring[(i + 1) % ring.length] ?? [0, 0];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross > 0) right = true;
    else if (cross < 0) left = true;
    best = Math.min(best, segmentDistance(px, py, ax, ay, bx, by));
  }
  return left && right ? best : 0;
}

/** The area of a convex ring of corners, in drawing pixels. */
function ringArea(ring: readonly (readonly [number, number])[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i] ?? [0, 0];
    const [bx, by] = ring[(i + 1) % ring.length] ?? [0, 0];
    twice += ax * by - bx * ay;
  }
  return Math.abs(twice) / 2;
}

/** The ring clipped to the drawing pixel [u0, u1] x [v0, v1], which may leave a shorter ring. */
function clipRing(ring: readonly (readonly [number, number])[], u0: number, v0: number, u1: number, v1: number): readonly (readonly [number, number])[] {
  let out: readonly (readonly [number, number])[] = ring;
  const sides: readonly (readonly [number, number, number])[] = [
    [0, u0, 1],
    [0, u1, -1],
    [1, v0, 1],
    [1, v1, -1],
  ];
  for (const [axis, edge, keep] of sides) {
    const inside = (p: readonly [number, number]): number => keep * ((axis === 0 ? p[0] : p[1]) - edge);
    const next: [number, number][] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i] ?? [0, 0];
      const b = out[(i + 1) % out.length] ?? [0, 0];
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) next.push([a[0], a[1]]);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    out = next;
    if (out.length === 0) return [];
  }
  return out;
}

/** The ring clipped to a convex polygon of either winding, which may leave a shorter ring. */
function clipConvex(ring: readonly (readonly [number, number])[], poly: readonly (readonly [number, number])[]): readonly (readonly [number, number])[] {
  let out = ring;
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i] ?? [0, 0];
    const [bx, by] = poly[(i + 1) % poly.length] ?? [0, 0];
    twice += ax * by - bx * ay;
  }
  const winding = twice < 0 ? -1 : 1;
  for (let i = 0; i < poly.length && out.length > 0; i++) {
    const [ax, ay] = poly[i] ?? [0, 0];
    const [bx, by] = poly[(i + 1) % poly.length] ?? [0, 0];
    const inside = (p: readonly [number, number]): number => winding * ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax));
    const next: [number, number][] = [];
    for (let j = 0; j < out.length; j++) {
      const a = out[j] ?? [0, 0];
      const b = out[(j + 1) % out.length] ?? [0, 0];
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) next.push([a[0], a[1]]);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    out = next;
  }
  return out;
}

/**
 * One face laid into a shape's scratch: the drawing's own pixels over the
 * face's corners. Each drawing pixel covering a picture pixel is taken by its
 * share of that pixel, so a pixel an edge between two drawing pixels runs
 * through shows the in-between shade between them. A face only adds what the
 * faces laid before it (the nearer ones) left of a pixel, so a nearer face
 * hides a farther one while two faces meeting along an edge still blend.
 */
function coverFace(cover: Float64Array, box: Box, layout: SceneLayout, show: ProjectedFace): void {
  const drawing = sheet(show.drawing);
  const { cx, cy } = layout.globe;
  const ring = show.corners;
  // A gable (three corners) shows the drawing hung from its apex's level, cut to the triangle.
  const [a, b, d] = ((): [readonly [number, number], readonly [number, number], readonly [number, number]] => {
    const [p, q, r, s] = ring;
    if (ring.length === 4 && p !== undefined && q !== undefined && s !== undefined) return [p, q, s];
    if (ring.length !== 3 || p === undefined || q === undefined || r === undefined) throw new Error(`${show.drawing} needs three or four corners`);
    const lift: [number, number] = [q[0] - (p[0] + r[0]) / 2, q[1] - (p[1] + r[1]) / 2];
    const top: [number, number] = [p[0] + lift[0], p[1] + lift[1]];
    return [top, [r[0] + lift[0], r[1] + lift[1]], [top[0], top[1] + drawing.height]];
  })();
  // The affine map from the drawing's pixels to the screen, and its inverse;
  // one drawing pixel is one unit, so an inverse area is a covered share.
  const ax = (b[0] - a[0]) / drawing.width;
  const ay = (b[1] - a[1]) / drawing.width;
  const bx = (d[0] - a[0]) / drawing.height;
  const by = (d[1] - a[1]) / drawing.height;
  const det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-12) return; // edge-on: no pixel of it shows
  const scale = Math.abs(det);
  const iux = by / det;
  const iuy = -bx / det;
  const ivx = -ay / det;
  const ivy = ax / det;
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const left = Math.max(box.left, Math.floor(cx + Math.min(...xs)));
  const right = Math.min(box.left + box.width - 1, Math.ceil(cx + Math.max(...xs)));
  const top = Math.max(box.top, Math.floor(cy + Math.min(...ys)));
  const bottom = Math.min(box.top + box.height - 1, Math.ceil(cy + Math.max(...ys)));
  const toDrawing = ([px, py]: readonly [number, number]): [number, number] => [iux * (px - a[0]) + iuy * (py - a[1]), ivx * (px - a[0]) + ivy * (py - a[1])];
  const outline = ring.length === 3 ? ring.map(toDrawing) : undefined;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      // The picture pixel's own corners in the drawing's pixels, in order.
      const square: [number, number][] = [
        [x - cx - a[0], y - cy - a[1]],
        [x + 1 - cx - a[0], y - cy - a[1]],
        [x + 1 - cx - a[0], y + 1 - cy - a[1]],
        [x - cx - a[0], y + 1 - cy - a[1]],
      ].map(([dx, dy]) => [iux * dx + iuy * dy, ivx * dx + ivy * dy]);
      const corners = outline === undefined ? square : clipConvex(square, outline);
      if (corners.length < 3) continue;
      const us = corners.map(([u]) => u);
      const vs = corners.map(([, v]) => v);
      const firstU = Math.max(0, Math.floor(Math.min(...us)));
      const lastU = Math.min(drawing.width - 1, Math.ceil(Math.max(...us)) - 1);
      const firstV = Math.max(0, Math.floor(Math.min(...vs)));
      const lastV = Math.min(drawing.height - 1, Math.ceil(Math.max(...vs)) - 1);
      let covered = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let dominant = 0;
      let dominantArea = 0;
      for (let v = firstV; v <= lastV; v++) {
        for (let u = firstU; u <= lastU; u++) {
          const colour = COLOUR_NUMBERS[(drawing.pixels[v * drawing.width + u] ?? 0) - 1];
          if (colour === undefined) continue;
          const area = ringArea(clipRing(corners, u, v, u + 1, v + 1));
          if (area <= 0) continue;
          covered += area * scale;
          red += ((colour >> 16) & 0xff) * area;
          green += ((colour >> 8) & 0xff) * area;
          blue += (colour & 0xff) * area;
          if (area > dominantArea) {
            dominantArea = area;
            dominant = colour;
          }
        }
      }
      if (covered <= 0) continue;
      const mixed = (Math.round(red / (covered / scale)) << 16) | (Math.round(green / (covered / scale)) << 8) | Math.round(blue / (covered / scale));
      // A drawing pixel only nicked at its edge would shift the mix by at
      // most a step, below what the picture can hold: take the drawing's own
      // colour there, so the pixel does not flicker as the face turns.
      const colour = withinOneStep(mixed, dominant) ? dominant : mixed;
      const index = ((y - box.top) * box.width + (x - box.left)) * 4;
      const share = Math.min(covered, 1 - (cover[index + 3] ?? 0));
      if (share <= 1e-9) continue;
      cover[index] = (cover[index] ?? 0) + ((colour >> 16) & 0xff) * share;
      cover[index + 1] = (cover[index + 1] ?? 0) + ((colour >> 8) & 0xff) * share;
      cover[index + 2] = (cover[index + 2] ?? 0) + (colour & 0xff) * share;
      cover[index + 3] = (cover[index + 3] ?? 0) + share;
    }
  }
}

/** The picture pixels one shape can reach: its faces' screen box, clipped to the picture. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * One shape over the picture: its faces (nearest first) are laid together first, so a pixel
 * their shared edge runs through shows the in-between shade of the two
 * drawings instead of a hairline of the glass under the shape, then painted
 * at once, each pixel the covered share of the colour they add up to.
 */
function paintShape(picture: Uint32Array, width: number, layout: SceneLayout, faces: readonly ProjectedFace[]): void {
  const { cx, cy } = layout.globe;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const face of faces) {
    for (const [x, y] of face.corners) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const box: Box = {
    left: Math.max(0, Math.floor(cx + left)),
    top: Math.max(0, Math.floor(cy + top)),
    width: 0,
    height: 0,
  };
  box.width = Math.max(0, Math.min(width, Math.ceil(cx + right) + 1) - box.left);
  box.height = Math.max(0, Math.min(layout.height, Math.ceil(cy + bottom) + 1) - box.top);
  if (box.width === 0 || box.height === 0) return;
  const cover = new Float64Array(box.width * box.height * 4);
  for (const face of faces) coverFace(cover, box, layout, face);
  for (let y = box.top; y < box.top + box.height; y++) {
    for (let x = box.left; x < box.left + box.width; x++) {
      const index = ((y - box.top) * box.width + (x - box.left)) * 4;
      const share = cover[index + 3] ?? 0;
      if (share <= 0) continue;
      const colour = (Math.round((cover[index] ?? 0) / share) << 16) | (Math.round((cover[index + 1] ?? 0) / share) << 8) | Math.round((cover[index + 2] ?? 0) / share);
      paintPixel(picture, y * width + x, colour, Math.min(1, share));
    }
  }
}

/**
 * The smooth shadow a shape casts on the floor to its right, away from the
 * disc at the top left: a stripe of shade along the floor under the shape,
 * running right and fading as it goes.
 */
function paintShadow(picture: Uint32Array, width: number, layout: SceneLayout, shape: GlobeShape, turn: number): void {
  const { cx, cy } = layout.globe;
  const [baseX, baseY] = projectPoint(shape.x, shape.z, 0, turn);
  const half = Math.max(shape.width, shape.depth) / 2 + 2;
  // It runs right of the shape's middle, so the shape itself hides its near end.
  const from = baseX + 2;
  const end = from + half + SHADOW_SHIFT;
  const first = baseY - 1;
  const last = first + SHADOW_TALL;
  const left = Math.max(0, Math.floor(cx + from));
  const right = Math.min(width - 1, Math.ceil(cx + end));
  const top = Math.max(0, Math.floor(cy + first));
  const bottom = Math.min(layout.height - 1, Math.ceil(cy + last));
  for (let y = top; y <= bottom; y++) {
    const dy = y + 0.5 - cy;
    // Every edge of the stripe takes its share of the pixel on the grid, so
    // the shadow slides with the turn instead of jumping a whole pixel.
    const across = edgeCoverage(cy + last, y) - edgeCoverage(cy + first, y);
    if (across <= 0) continue;
    for (let x = left; x <= right; x++) {
      const dx = x + 0.5 - cx;
      // The shadow lies on the floor disc and nowhere else.
      if (!onFloor(dx, dy)) continue;
      const along = 1 - edgeCoverage(cx + from, x);
      const fade = Math.min(1, Math.max(0, (end - dx) / SHADOW_SOFT));
      paintPixel(picture, y * width + x, SHADOW_INK, SHADOW_STRENGTH * across * along * fade);
    }
  }
}

/**
 * Draws `shapes` (all of globeShapes by default) turned by `turn`, nearer
 * shapes over farther ones, with their cast shadows on the floor, over
 * whatever `picture` (width art pixels across) already holds. Throws a
 * RangeError for a non-finite turn and then leaves the picture alone.
 */
export function drawShapes(
  picture: Uint32Array,
  width: number,
  layout: SceneLayout,
  phase: PhaseReading,
  turn: number,
  shapes: readonly GlobeShape[] = globeShapes,
): void {
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be a finite number of radians, got ${turn}`);
  // The shapes carry the sheets' own colours in every phase: only the glass tints.
  void phase;
  const t = wrapTurn(turn);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  // Far shapes first, so a nearer shape covers a farther one wherever they
  // overlap, whatever order the caller lists them in.
  const order = [...shapes].sort(
    (a, b) =>
      (a.x * sin + a.z * cos) - (b.x * sin + b.z * cos) ||
      a.x - b.x ||
      a.z - b.z ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      (a.design ?? 0) - (b.design ?? 0),
  );
  for (const shape of order) paintShadow(picture, width, layout, shape, t);
  for (const shape of order) paintShape(picture, width, layout, projectShape(shape, t));
}
