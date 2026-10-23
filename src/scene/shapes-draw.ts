// XMAS-32b "The globe", slice 2: drawing the turning shapes into the picture.
// drawGlobe calls drawShapes inside the glass, over the glass's own colours:
// nearer shapes cover farther ones, a shape's faces are laid together so its
// own edges show no seam, and every edge is drawn as the in-between shade of
// what lies beyond it, so the shapes slide on the fixed grid like the
// lettering, and each shape casts a flat shadow of its own silhouette on the
// floor to its right, away from the disc at the top left (XMAS-21 7.2-7.4).
import { masterColours } from '../../art/colours.ts';
import type { PhaseReading } from '../shared/clock.ts';
import { blendShade, edgeCoverage } from './blend.ts';
import type { SceneLayout } from './frame.ts';
import type { Drawing } from '../shared/art.generated.ts';
import { globeShapes, onFloor, projectPoint, projectShape, sheet, wrapTurn, type GlobeShape, type ProjectedFace } from './shapes.ts';

/** The master list's colours as numbers, so a drawing's pixel is a colour. */
const COLOUR_NUMBERS: readonly number[] = masterColours.map((colour) => Number.parseInt(colour.slice(1), 16));
/** A shape's shadow: each art pixel of height above the floor throws its shade this far right (the light is at the top left) and this far down the floor, so the shadow leans right and lies flat. */
export const SHADOW_LEAN = 0.5;
export const SHADOW_FLAT = 0.25;
/** The silhouette is sampled in bands this many art pixels tall, so an outline has half the corners a row-by-row one would, and each band's edges are its pixels' extremes. */
const SHADOW_BAND = 2;
/** XMAS-82: exported for the fine layer, which fills the same shade at the same strength. The shade is a deep night blue, so the snow stays cool instead of grey, and it only ever darkens the floor it falls on. */
export const SHADOW_STRENGTH = 0.32;
export const SHADOW_INK = 0x1d3350;

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

/**
 * One face's drawing in globe-centred art units: its sheet, its top left,
 * top right and bottom left corners `a`, `b` and `d`, and a gable's triangle
 * as the `clip` (absent for a four-corner face).
 */
export interface FaceDraw {
  drawing: Drawing;
  a: [number, number];
  b: [number, number];
  d: [number, number];
  clip?: readonly (readonly [number, number])[];
}

/**
 * Where a face's drawing lies on screen. A gable (three corners) shows the
 * drawing hung from its apex's level, cut to the triangle.
 */
export function faceAxes(show: ProjectedFace): FaceDraw {
  const drawing = sheet(show.drawing);
  const ring = show.corners;
  const [p, q, r, s] = ring;
  if (ring.length === 4 && p !== undefined && q !== undefined && s !== undefined) return { drawing, a: [p[0], p[1]], b: [q[0], q[1]], d: [s[0], s[1]] };
  if (ring.length !== 3 || p === undefined || q === undefined || r === undefined) throw new Error(`${show.drawing} needs three or four corners`);
  const lift: [number, number] = [q[0] - (p[0] + r[0]) / 2, q[1] - (p[1] + r[1]) / 2];
  const top: [number, number] = [p[0] + lift[0], p[1] + lift[1]];
  return { drawing, a: top, b: [r[0] + lift[0], r[1] + lift[1]], d: [top[0], top[1] + drawing.height], clip: ring };
}

/** The art units a face's drawing can reach: the extent of its parallelogram, which holds a gable's triangle too. */
function faceExtent(face: FaceDraw): { left: number; right: number; top: number; bottom: number } {
  const { a, b, d } = face;
  const xs = [a[0], b[0], d[0], b[0] + d[0] - a[0]];
  const ys = [a[1], b[1], d[1], b[1] + d[1] - a[1]];
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/**
 * One face laid into a shape's scratch: the drawing's own pixels over the
 * face's corners. Each drawing pixel covering a picture pixel is taken by its
 * share of that pixel, so a pixel an edge between two drawing pixels runs
 * through shows the in-between shade between them. A face only adds what the
 * faces laid before it (the nearer ones) left of a pixel, so a nearer face
 * hides a farther one while two faces meeting along an edge still blend.
 * `zoom` picture pixels span each art pixel; the box is in picture pixels.
 */
function coverFace(cover: Float64Array, box: Box, layout: SceneLayout, face: FaceDraw, zoom = 1): void {
  const { drawing, a, b, d, clip } = face;
  const { cx, cy } = layout.globe;
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
  const extent = faceExtent(face);
  // One picture pixel of slack either side: the per-pixel test below decides what shows.
  const left = Math.max(box.left, Math.floor((cx + extent.left) * zoom) - 1);
  const right = Math.min(box.left + box.width - 1, Math.ceil((cx + extent.right) * zoom) + 1);
  const top = Math.max(box.top, Math.floor((cy + extent.top) * zoom) - 1);
  const bottom = Math.min(box.top + box.height - 1, Math.ceil((cy + extent.bottom) * zoom) + 1);
  const toDrawing = ([px, py]: readonly [number, number]): [number, number] => [iux * (px - a[0]) + iuy * (py - a[1]), ivx * (px - a[0]) + ivy * (py - a[1])];
  const outline = clip?.map(toDrawing);
  const slack = 1e-9;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      // The drawing pixel under the picture pixel's centre, taken whole: no
      // in-between shades, so every pixel the face shows is one of the sheet's
      // own colours and the picture stays crisp at any turn.
      const dx = (x + 0.5) / zoom - cx - a[0];
      const dy = (y + 0.5) / zoom - cy - a[1];
      const u = iux * dx + iuy * dy;
      const v = ivx * dx + ivy * dy;
      if (u < -slack || v < -slack || u >= drawing.width + slack || v >= drawing.height + slack) continue;
      if (outline !== undefined && !insideConvex(outline, u, v)) continue;
      const colour = COLOUR_NUMBERS[(drawing.pixels[Math.min(drawing.height - 1, Math.max(0, Math.floor(v))) * drawing.width + Math.min(drawing.width - 1, Math.max(0, Math.floor(u)))] ?? 0) - 1];
      if (colour === undefined) continue;
      const index = ((y - box.top) * box.width + (x - box.left)) * 4;
      if ((cover[index + 3] ?? 0) >= 1) continue;
      cover[index] = (colour >> 16) & 0xff;
      cover[index + 1] = (colour >> 8) & 0xff;
      cover[index + 2] = colour & 0xff;
      cover[index + 3] = 1;
    }
  }
}

/** Whether (u, v) lies inside a convex ring of either winding, a hair's width out counted in. */
function insideConvex(ring: readonly (readonly [number, number])[], u: number, v: number): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i] ?? [0, 0];
    const [bx, by] = ring[(i + 1) % ring.length] ?? [0, 0];
    const side = (bx - ax) * (v - ay) - (by - ay) * (u - ax);
    if (Math.abs(side) < 1e-9) continue;
    const s = side > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
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
 * at once, each pixel the covered share of the colour they add up to. `width`
 * is the picture's width in picture pixels, `zoom` of them to each art pixel.
 */
export function paintShape(picture: Uint32Array, width: number, layout: SceneLayout, faces: readonly FaceDraw[], zoom = 1): void {
  const { cx, cy } = layout.globe;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const face of faces) {
    const extent = faceExtent(face);
    left = Math.min(left, extent.left);
    right = Math.max(right, extent.right);
    top = Math.min(top, extent.top);
    bottom = Math.max(bottom, extent.bottom);
  }
  // Picture pixels: `zoom` per art pixel, one pixel of slack as coverFace has.
  const box: Box = {
    left: Math.max(0, Math.floor((cx + left) * zoom) - 1),
    top: Math.max(0, Math.floor((cy + top) * zoom) - 1),
    width: 0,
    height: 0,
  };
  box.width = Math.max(0, Math.min(width, Math.ceil((cx + right) * zoom) + 2) - box.left);
  box.height = Math.max(0, Math.min(layout.height * zoom, Math.ceil((cy + bottom) * zoom) + 2) - box.top);
  if (box.width === 0 || box.height === 0) return;
  const cover = new Float64Array(box.width * box.height * 4);
  for (const face of faces) coverFace(cover, box, layout, face, zoom);
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

/** One row of a silhouette: its centre `y` (in the units its rows are in) and the `left` and `right` edges it fills there. */
export interface ShadowRow {
  y: number;
  left: number;
  right: number;
}

/**
 * The shadow a shape casts on the floor to its right, away from the disc at
 * the top left, before the floor disc clip: the shape's silhouette as drawn at
 * this turn, cast onto the floor (see shadowRing). So a tree throws a pointed
 * shadow, a present a skewed box and the snowman a run of round blobs. Its
 * corners are globe-centred art units.
 */
export function shadowPolygon(shape: GlobeShape, turn: number): [number, number][] {
  const foot = projectPoint(shape.x, shape.z, 0, turn)[1];
  return shadowRing(silhouetteRows(projectShape(shape, turn).map((face) => faceAxes(face))), foot);
}

/**
 * The silhouette of `faces` as bands of SHADOW_BAND art pixels: each opaque
 * drawing pixel lands at its screen centre, and its band takes the pixel's
 * width on each side. A gable's pixels outside its triangle are passed over, as
 * coverFace passes them over. The bands come in no particular order; an empty
 * drawing gives none.
 */
function silhouetteRows(faces: readonly FaceDraw[]): ShadowRow[] {
  const rows = new Map<number, ShadowRow>();
  for (const { drawing, a, b, d, clip } of faces) {
    const { width, height, pixels } = drawing;
    // One drawing pixel's step across and down the screen.
    const ax = (b[0] - a[0]) / width;
    const ay = (b[1] - a[1]) / width;
    const bx = (d[0] - a[0]) / height;
    const by = (d[1] - a[1]) / height;
    for (let v = 0; v < height; v++) {
      for (let u = 0; u < width; u++) {
        if (pixels[v * width + u] === 0) continue;
        const x = a[0] + (u + 0.5) * ax + (v + 0.5) * bx;
        const y = a[1] + (u + 0.5) * ay + (v + 0.5) * by;
        if (clip !== undefined && !insideConvex(clip, x, y)) continue;
        const key = Math.floor(y / SHADOW_BAND);
        const row = rows.get(key) ?? { y: (key + 0.5) * SHADOW_BAND, left: x - 0.5, right: x + 0.5 };
        row.left = Math.min(row.left, x - 0.5);
        row.right = Math.max(row.right, x + 0.5);
        rows.set(key, row);
      }
    }
  }
  return [...rows.values()];
}

/**
 * The ring that `rows` cast on the floor, where `foot` is the floor's line under
 * them: a point `h` art pixels above the foot (never less, so nothing falls
 * back towards the light) lands at x + SHADOW_LEAN * h, foot + SHADOW_FLAT * h.
 * The left edges run down the ring and the right edges back up, so it is one
 * simple polygon turning the same way for every silhouette.
 */
export function shadowRing(rows: readonly ShadowRow[], foot: number): [number, number][] {
  const ordered = [...rows].sort((p, q) => p.y - q.y);
  const cast = (x: number, y: number): [number, number] => {
    const height = Math.max(0, foot - y);
    return [x + SHADOW_LEAN * height, foot + SHADOW_FLAT * height];
  };
  return withoutStraight([...ordered.map((row) => cast(row.left, row.y)), ...[...ordered].reverse().map((row) => cast(row.right, row.y))]);
}

/** The ring without the corners that lie on the line through their two neighbours (within a thousandth of an art pixel), so a straight edge is one edge. */
function withoutStraight(ring: [number, number][]): [number, number][] {
  return ring.filter((point, n) => {
    const prev = ring[(n + ring.length - 1) % ring.length] ?? point;
    const next = ring[(n + 1) % ring.length] ?? point;
    const length = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    if (length === 0) return false;
    return Math.abs(turnOf(prev, point, next)) / length > 1e-3;
  });
}

/** The cross product of a - o and b - o: positive when o, a and b turn left, negative when they turn right. */
function turnOf(o: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Whether (x, y) lies inside `polygon`, which may bend: a ray to the right of
 * the point crosses its edges an odd number of times. A point exactly on an
 * edge may fall either way. A polygon with no corners holds nothing.
 */
export function insidePolygon(polygon: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi = 0, yi = 0] = polygon[i] ?? [];
    const [xj = 0, yj = 0] = polygon[j] ?? [];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Paints the shadow `polygons` (see shadowPolygon) over `picture`, `width`
 * picture pixels across at `zoom` picture pixels to each art pixel: one flat
 * shade on every pixel whose centre lies in one of them and on the floor disc.
 * A pixel under several shadows takes the shade once, so overlapping shadows
 * never stack into one denser block.
 */
export function paintShadows(picture: Uint32Array, width: number, layout: SceneLayout, polygons: readonly (readonly (readonly [number, number])[])[], zoom = 1): void {
  const { cx, cy } = layout.globe;
  const xs = polygons.flatMap((polygon) => polygon.map(([x]) => x));
  const ys = polygons.flatMap((polygon) => polygon.map(([, y]) => y));
  const left = Math.max(0, Math.floor((cx + Math.min(...xs)) * zoom));
  const right = Math.min(width - 1, Math.ceil((cx + Math.max(...xs)) * zoom));
  const top = Math.max(0, Math.floor((cy + Math.min(...ys)) * zoom));
  const bottom = Math.min(layout.height * zoom - 1, Math.ceil((cy + Math.max(...ys)) * zoom));
  // A pixel is tested only against the shadows whose box holds it: a shadow's corners are many, a box test is not.
  const boxes = polygons.map((polygon) => ({
    polygon,
    left: Math.min(...polygon.map(([x]) => x)),
    right: Math.max(...polygon.map(([x]) => x)),
    top: Math.min(...polygon.map(([, y]) => y)),
    bottom: Math.max(...polygon.map(([, y]) => y)),
  }));
  for (let y = top; y <= bottom; y++) {
    const dy = (y + 0.5) / zoom - cy;
    for (let x = left; x <= right; x++) {
      const dx = (x + 0.5) / zoom - cx;
      // The shadow lies on the floor disc and nowhere else.
      if (!onFloor(dx, dy) || !boxes.some((box) => dx >= box.left && dx <= box.right && dy >= box.top && dy <= box.bottom && insidePolygon(box.polygon, dx, dy))) continue;
      paintPixel(picture, y * width + x, SHADOW_INK, SHADOW_STRENGTH);
    }
  }
}

/** A shape's nearness to the visitor at the turn whose cosine and sine these are, in art pixels: larger is nearer. */
export function nearness(shape: GlobeShape, cos: number, sin: number): number {
  return shape.x * sin + shape.z * cos;
}

/**
 * The shapes in the order they are painted at `turn`: far shapes first, so a
 * nearer shape covers a farther one wherever they overlap, whatever order the
 * caller lists them in.
 */
export function shapesFarFirst(shapes: readonly GlobeShape[], turn: number): GlobeShape[] {
  const t = wrapTurn(turn);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [...shapes].sort(
    (a, b) =>
      nearness(a, cos, sin) - nearness(b, cos, sin) ||
      a.x - b.x ||
      a.z - b.z ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      (a.design ?? 0) - (b.design ?? 0),
  );
}

/** Which of a shape's two layers to draw: both, only its cast shadows, or neither (XMAS-82: the fine layer draws the shadows too). */
export type ShapeParts = 'all' | 'shadows' | 'none';

/**
 * Draws `shapes` (all of globeShapes by default) turned by `turn`, nearer
 * shapes over farther ones, with their cast shadows on the floor, over
 * whatever `picture` (width art pixels across) already holds. `parts` of
 * 'shadows' leaves out the bodies, 'none' the shadows too. Throws a RangeError for a non-finite turn and
 * then leaves the picture alone.
 */
export function drawShapes(
  picture: Uint32Array,
  width: number,
  layout: SceneLayout,
  phase: PhaseReading,
  turn: number,
  shapes: readonly GlobeShape[] = globeShapes,
  parts: ShapeParts = 'all',
): void {
  if (!Number.isFinite(turn)) throw new RangeError(`turn must be a finite number of radians, got ${turn}`);
  // The shapes carry the sheets' own colours in every phase: only the glass tints.
  void phase;
  const t = wrapTurn(turn);
  const order = shapesFarFirst(shapes, t);
  if (parts === 'none') return;
  paintShadows(picture, width, layout, order.map((shape) => shadowPolygon(shape, t)));
  if (parts === 'all') for (const shape of order) paintShape(picture, width, layout, projectShape(shape, t).map((face) => faceAxes(face)));
}
