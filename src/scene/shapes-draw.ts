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
import type { Drawing } from '../shared/art.generated.ts';
import { globeShapes, onFloor, projectPoint, projectShape, sheet, wrapTurn, type GlobeShape, type ProjectedFace } from './shapes.ts';

/** The master list's colours as numbers, so a drawing's pixel is a colour. */
const COLOUR_NUMBERS: readonly number[] = masterColours.map((colour) => Number.parseInt(colour.slice(1), 16));
/** The shadow runs this far right of a shape (the light is at the top left) and fades out over this many pixels. */
const SHADOW_SHIFT = 8;
const SHADOW_SOFT = 6;
/** How tall the shadow is on the floor, in art pixels, and how dark it gets: a deep night blue, so the shade on the snow stays cool instead of grey, and only ever darkens the floor it falls on. */
const SHADOW_TALL = 4;
const SHADOW_STRENGTH = 0.32;
const SHADOW_INK = 0x1d3350;

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
    // Hard-edged: a pixel is in the shadow or it is not, one flat shade.
    if (y + 0.5 < cy + first || y + 0.5 > cy + last) continue;
    for (let x = left; x <= right; x++) {
      const dx = x + 0.5 - cx;
      // The shadow lies on the floor disc and nowhere else.
      if (!onFloor(dx, dy)) continue;
      if (dx < from || dx > end - SHADOW_SOFT / 2) continue;
      paintPixel(picture, y * width + x, SHADOW_INK, SHADOW_STRENGTH);
    }
  }
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
      (a.x * sin + a.z * cos) - (b.x * sin + b.z * cos) ||
      a.x - b.x ||
      a.z - b.z ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      (a.design ?? 0) - (b.design ?? 0),
  );
}

/** Which of a shape's two layers to draw: its cast shadows, or both. */
export type ShapeParts = 'all' | 'shadows';

/**
 * Draws `shapes` (all of globeShapes by default) turned by `turn`, nearer
 * shapes over farther ones, with their cast shadows on the floor, over
 * whatever `picture` (width art pixels across) already holds. `parts` of
 * 'shadows' leaves out the bodies. Throws a RangeError for a non-finite turn and
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
  for (const shape of order) paintShadow(picture, width, layout, shape, t);
  if (parts !== 'shadows') for (const shape of order) paintShape(picture, width, layout, projectShape(shape, t).map((face) => faceAxes(face)));
}
