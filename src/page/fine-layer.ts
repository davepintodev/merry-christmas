// XMAS-81 "Fine layer on the page: the shapes": the globe's turning shapes drawn
// on the screen's own pixel grid, over the scene canvas, which leaves their
// bodies out (SceneInput.shapeBodies false). Two canvases are laid exactly over
// the glass, where the scene canvas's picture is:
// - the shapes, at the screen's pixel size: each face is one image of its
//   drawing, with a one-pixel border of its own edge, under a canvas transform
//   with no smoothing, clipped to the face. A face's clip also takes the parts
//   of its border that lie inside a face drawn after it, so the nearer face
//   covers the overlap and no pair of antialiased edges leaves a half-clear
//   seam, whatever part of an edge the two share; the rows are then shifted by
//   the lean in whole art pixels, as leanGlass shifts glass;
// - over it, an art pixel canvas holding only what Santa drew in front of the
//   glass centre, so he still passes in front of the shapes.
// XMAS-84 "Snow inside the glass on the fine layer": the snow is drawn too as
// steps on the screen's own pixel grid. The flakes behind the glass centre, with
// Santa while he is behind it, go onto the shapes layer before its faces, so the
// shapes cover them; the flakes in front go on a layer of their own over Santa.
import { masterColours } from '../../art/colours.ts';
import type { Drawing } from '../shared/art.generated.ts';
import type { SceneLayout } from '../scene/frame.ts';
import { NO_FRONT } from '../scene/globe.ts';
import { leanBox, rowShift, type LeanBox } from '../scene/lean.ts';
import { shapeDrawList, type DrawStep } from '../scene/shape-draw-list.ts';
import { renderSnowSteps, type SnowStep } from '../scene/snow-draw-list.ts';

/** The master list's colours as numbers, so a drawing's colour number is a colour. */
const COLOUR_NUMBERS: readonly number[] = masterColours.map((colour) => Number.parseInt(colour.slice(1), 16));

/** The border of each bitmap, in drawing pixels: it repeats the drawing's edge, and it is all a gable's clip may reach past its drawing. */
const PAD = 1;
/** How far, in art pixels, a face's clip reaches past a side (the diagonal of an art pixel, so a corner pixel is covered). */
const GROW = 1.5;
/** How far, in art pixels, a band starts inside its side, so it overlaps the face it grows from. */
const OVERLAP = 0.25;
/** The most drawing pixels a face's edge is stretched by, however foreshortened the face (a clip is cut to the band anyway). */
const MAX_STRETCH = 64;

/** A convex ring of points in art units, in order round its edge. */
type Ring = [number, number][];

/** A face's clip: the rings it fills, and which of its sides (in the order of stretchBands) have a ring beyond them. */
interface Clip {
  rings: Ring[];
  grown: boolean[];
}

/** A canvas re-sized only when its size changes, since a size change clears it. */
function sizeTo(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

/** A layer on the page after `after`, laid over it and never under the pointer. */
function layerAfter(after: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;z-index:0;pointer-events:none;image-rendering:pixelated';
  after.after(canvas);
  return canvas;
}

/** Puts a layer at CSS (x, y) with CSS size w x h, changing the style only when it moves. */
function place(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number): void {
  const style = canvas.style;
  if (style.left !== `${x}px`) style.left = `${x}px`;
  if (style.top !== `${y}px`) style.top = `${y}px`;
  if (style.width !== `${w}px`) style.width = `${w}px`;
  if (style.height !== `${h}px`) style.height = `${h}px`;
}

/** One layer: its canvas, and its 2d context, which is null where the page gives none. */
interface Layer {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
}

/** An image of one size for a layer, and a 32-bit view of its bytes; kept while the size holds. */
interface Pixels {
  image: ImageData;
  words: Uint32Array;
}

function pixelsFor(context: CanvasRenderingContext2D, width: number, height: number, kept: Pixels | null): Pixels {
  if (kept !== null && kept.image.width === width && kept.image.height === height) return kept;
  const image = context.createImageData(width, height);
  return { image, words: new Uint32Array(image.data.buffer) };
}

/** A colour number (0xRRGGBB) as the little-endian word of an opaque RGBA pixel. */
function opaqueWord(colour: number): number {
  return 0xff000000 | ((colour & 0xff) << 16) | (colour & 0xff00) | ((colour >> 16) & 0xff);
}

/**
 * A drawing as a canvas of its own, with one pixel of border on every side: its colour where
 * it has one, clear where it has none, and each border pixel repeats the drawing's nearest
 * edge pixel, so a clip that grows across an edge is filled with that edge's colours.
 */
function bitmapOf(drawing: Drawing): HTMLCanvasElement {
  const width = drawing.width + 2 * PAD;
  const height = drawing.height + 2 * PAD;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('a drawing needs a 2d context');
  const image = context.createImageData(width, height);
  const words = new Uint32Array(image.data.buffer);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(drawing.height - 1, Math.max(0, y - PAD));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(drawing.width - 1, Math.max(0, x - PAD));
      // Colour number 0 is clear: COLOUR_NUMBERS[-1] is undefined, as is any number the list lacks.
      const colour = COLOUR_NUMBERS[(drawing.pixels[sy * drawing.width + sx] ?? 0) - 1];
      words[y * width + x] = colour === undefined ? 0 : opaqueWord(colour);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** The bordered bitmap of a drawing, made once and kept: every face of it and every frame share it. */
function bitmapFor(bitmaps: Map<Drawing, HTMLCanvasElement>, drawing: Drawing): HTMLCanvasElement {
  let canvas = bitmaps.get(drawing);
  if (canvas === undefined) {
    canvas = bitmapOf(drawing);
    bitmaps.set(drawing, canvas);
  }
  return canvas;
}

/** The face's own region in art units: its parallelogram, or a gable's triangle. */
function regionOf(step: DrawStep): Ring {
  if (step.clip !== undefined) return step.clip.map(([x, y]): [number, number] => [x, y]);
  const { a, b, d } = step;
  return [
    [a[0], a[1]],
    [b[0], b[1]],
    [b[0] + d[0] - a[0], b[1] + d[1] - a[1]],
    [d[0], d[1]],
  ];
}

/** A face's drawing axes in art units: one drawing pixel across (ax, ay) and one down (bx, by). */
function axesOf({ drawing, a, b, d }: DrawStep): [number, number, number, number] {
  return [(b[0] - a[0]) / drawing.width, (b[1] - a[1]) / drawing.width, (d[0] - a[0]) / drawing.height, (d[1] - a[1]) / drawing.height];
}

/** The face's bitmap in art units: its drawing with PAD drawing pixels of border on every side. */
function bitmapRingOf(step: DrawStep): Ring {
  const [ax, ay, bx, by] = axesOf(step);
  const { drawing, a } = step;
  const at = (u: number, v: number): [number, number] => [a[0] + u * ax + v * bx, a[1] + u * ay + v * by];
  const { width: w, height: h } = drawing;
  return [at(-PAD, -PAD), at(w + PAD, -PAD), at(w + PAD, h + PAD), at(-PAD, h + PAD)];
}

/**
 * How far a parallelogram face's edge rows and columns are stretched past each side, in drawing
 * pixels across (su, the sides left and right) and down (sv, top and bottom), so GROW art pixels
 * lie beyond every side; ou and ov are the OVERLAP inside the sides, in the same units.
 */
function stretchOf(step: DrawStep): { su: number; sv: number; ou: number; ov: number } {
  const [ax, ay, bx, by] = axesOf(step);
  // A drawing pixel across moves area / |down| art units away from the sides it runs between, and one down area / |across|.
  const area = Math.abs(ax * by - bx * ay);
  const hypotA = Math.hypot(ax, ay);
  const hypotB = Math.hypot(bx, by);
  return {
    su: Math.min(MAX_STRETCH, (GROW * hypotB) / area),
    sv: Math.min(MAX_STRETCH, (GROW * hypotA) / area),
    ou: (OVERLAP * hypotB) / area,
    ov: (OVERLAP * hypotA) / area,
  };
}

/**
 * A parallelogram face's four bands beyond its sides, in art units and in the order of its sides
 * (top, right, bottom, left), each overlapping its side by OVERLAP and reaching GROW past it.
 */
function stretchBands(step: DrawStep): Ring[] {
  const [ax, ay, bx, by] = axesOf(step);
  const { drawing, a } = step;
  const { su, sv, ou, ov } = stretchOf(step);
  const { width: w, height: h } = drawing;
  const at = (u: number, v: number): [number, number] => [a[0] + u * ax + v * bx, a[1] + u * ay + v * by];
  return [
    [at(0, -sv), at(w, -sv), at(w, ov), at(0, ov)],
    [at(w - ou, -sv), at(w + su, -sv), at(w + su, h + sv), at(w - ou, h + sv)],
    [at(0, h - ov), at(w, h - ov), at(w, h + sv), at(0, h + sv)],
    [at(-su, -sv), at(ou, -sv), at(ou, h + sv), at(-su, h + sv)],
  ];
}

/** The box round a ring, as left, top, right and bottom. */
function boxOf(ring: Ring): [number, number, number, number] {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ring) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return [left, top, right, bottom];
}

/** The lowest and the highest distance of a ring's points along the axis `axis`, measured from `origin`. */
function extentOf(ring: Ring, origin: readonly [number, number], axis: readonly [number, number]): [number, number] {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ring) {
    const along = (x - origin[0]) * axis[0] + (y - origin[1]) * axis[1];
    low = Math.min(low, along);
    high = Math.max(high, along);
  }
  return [low, high];
}

/** Twice the signed area of a ring (the shoelace sum): its sign is the ring's winding. */
function turnOf(ring: Ring): number {
  let sum = 0;
  for (let n = 0; n < ring.length; n++) {
    const p = ring[n];
    const q = ring[(n + 1) % ring.length];
    if (p === undefined || q === undefined) continue;
    sum += p[0] * q[1] - q[0] * p[1];
  }
  return sum;
}

/**
 * The part of the convex ring `subject` inside the convex ring `clip`, by Sutherland-Hodgman:
 * each edge of `clip` cuts the ring, keeping its side. Empty when they do not meet; `clip` must
 * have an area.
 */
function clipConvex(subject: Ring, clip: Ring): Ring {
  const sign = Math.sign(turnOf(clip));
  let out = subject;
  for (let n = 0; n < clip.length && out.length > 0; n++) {
    const p = clip[n];
    const q = clip[(n + 1) % clip.length];
    if (p === undefined || q === undefined) return [];
    // Positive inside this edge of the clip, negative outside it.
    const reach = (x: number, y: number): number => sign * ((q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]));
    const input = out;
    out = [];
    for (let m = 0; m < input.length; m++) {
      const s = input[m];
      const e = input[(m + 1) % input.length];
      if (s === undefined || e === undefined) continue;
      const rs = reach(s[0], s[1]);
      const re = reach(e[0], e[1]);
      if ((rs >= 0) !== (re >= 0)) {
        const t = rs / (rs - re);
        out.push([s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1])]);
      }
      if (re >= 0) out.push(e);
    }
  }
  return out;
}

/**
 * A convex ring swept across the segment from it to the same ring moved by (-dx, -dy): the convex
 * hull (counter-clockwise, monotone chain) of both copies, which is their Minkowski sum with the segment.
 */
function sweptOf(ring: Ring, dx: number, dy: number): Ring {
  const sorted: Ring = [];
  for (const [x, y] of ring) sorted.push([x, y], [x - dx, y - dy]);
  sorted.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const chain = (ordered: Ring): Ring => {
    const hull: Ring = [];
    for (const p of ordered) {
      for (;;) {
        const a = hull[hull.length - 2];
        const b = hull[hull.length - 1];
        if (a === undefined || b === undefined || (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) break;
        hull.pop();
      }
      hull.push(p);
    }
    hull.pop();
    return hull;
  };
  return [...chain(sorted), ...chain(sorted.slice().reverse())];
}

/** A side of a convex ring: its edge's two ends, its unit normal, pointing out of the ring, and its unit tangent, from `from` to `to`. */
interface Side {
  from: [number, number];
  to: [number, number];
  normal: [number, number];
  tangent: [number, number];
}

/** The sides of a convex ring, each with its outward normal; a zero-length edge has none. */
function sidesOf(ring: Ring): Side[] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x / ring.length;
    cy += y / ring.length;
  }
  const sides: Side[] = [];
  for (let n = 0; n < ring.length; n++) {
    const from = ring[n];
    const to = ring[(n + 1) % ring.length];
    if (from === undefined || to === undefined) continue;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length === 0) continue;
    let nx = (to[1] - from[1]) / length;
    let ny = -(to[0] - from[0]) / length;
    // Flipped when the middle of the edge lies on the inward side of the centre.
    if (nx * ((from[0] + to[0]) / 2 - cx) + ny * ((from[1] + to[1]) / 2 - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }
    sides.push({ from, to, normal: [nx, ny], tangent: [(to[0] - from[0]) / length, (to[1] - from[1]) / length] });
  }
  return sides;
}

/**
 * The band beyond a side, as a convex quad: the side pushed out by `depth` art units, and
 * stretched by the same along its line, so a corner's square beyond both its sides is in one band.
 * Its inner edge lies OVERLAP inside the side, so the band and the face share area rather than
 * an edge: two rings that only touch leave a hairline of the canvas's rounding between them.
 */
function bandOf({ from, to, normal: [nx, ny] }: Side, depth: number): Ring {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const tx = ((to[0] - from[0]) / length) * depth;
  const ty = ((to[1] - from[1]) / length) * depth;
  const ix = -OVERLAP * nx;
  const iy = -OVERLAP * ny;
  const ox = depth * nx;
  const oy = depth * ny;
  return [
    [from[0] - tx + ix, from[1] - ty + iy],
    [to[0] + tx + ix, to[1] + ty + iy],
    [to[0] + tx + ox, to[1] + ty + oy],
    [from[0] - tx + ox, from[1] - ty + oy],
  ];
}

/**
 * Each face's clip in art units, as the rings the layer fills: its own region, then, for each
 * side of it and each face drawn after it, the part of the band beyond that side (the bitmap's
 * edge stretched out, for a parallelogram) that the later face reaches when pushed back across
 * the band. So a shared side is covered along its whole length, and a corner where three faces
 * meet too; a later face's edge that stops short of the side is pushed over the gap it leaves.
 * The silhouette never grows: every ring lies in a band, inside a later face or pushed across the
 * band to one. `grown` marks the sides that have such a ring.
 */
function clipsOf(steps: readonly DrawStep[]): Clip[] {
  const regions = steps.map(regionOf);
  const boxes = regions.map(boxOf);
  return steps.map((step, i) => {
    const region = regions[i] ?? [];
    // An edge-on face is not drawn, so it has no clip.
    if (Math.abs(turnOf(region)) < 1e-9) return { rings: [], grown: [] };
    // Each piece winds as the face's own region does, so the nonzero fill adds them up instead of cancelling.
    const sign = Math.sign(turnOf(region)) || 1;
    const sides = sidesOf(region);
    // A parallelogram's bands are its stretched edges; a gable's are its sides' bands, cut to its bitmap.
    const bands = step.clip === undefined ? stretchBands(step) : sides.map((side) => clipConvex(bitmapRingOf(step), bandOf(side, GROW)));
    const rings: Ring[] = [region];
    const grown = sides.map(() => false);
    for (const [s, side] of sides.entries()) {
      const band = bands[s] ?? [];
      if (band.length < 3) continue;
      const bandArea = Math.abs(turnOf(band));
      const [nx, ny] = side.normal;
      const [tx, ty] = side.tangent;
      const [left, top, right, bottom] = boxOf(band);
      // The band's extent across the side and along it: a later face outside either range cannot reach it.
      const [acrossLow, acrossHigh] = extentOf(band, side.from, side.normal);
      const [alongLow, alongHigh] = extentOf(band, side.from, side.tangent);
      // A later face pushed back across the band by GROW covers all of it; once one does, the rest add nothing.
      for (let j = i + 1; j < steps.length; j++) {
        const later = regions[j];
        const [jl, jt, jr, jb] = boxes[j] ?? [0, 0, 0, 0];
        // Only a later face whose box, grown by GROW, meets the band's box can push across it.
        if (later === undefined || Math.abs(turnOf(later)) < 1e-9 || jr + GROW < left || jl - GROW > right || jb + GROW < top || jt - GROW > bottom) continue;
        // Pushed back across the band, a later face spans from GROW behind its near side to its far one.
        const [near, far] = extentOf(later, side.from, side.normal);
        const [lowAlong, highAlong] = extentOf(later, side.from, side.tangent);
        if (far < acrossLow || near - GROW > acrossHigh || highAlong < alongLow || lowAlong > alongHigh) continue;
        const pushed = sweptOf(later, GROW * nx, GROW * ny);
        const piece = clipConvex(band, pushed);
        const pieceArea = Math.abs(turnOf(piece));
        if (piece.length < 3 || pieceArea < 1e-9) continue;
        rings.push(Math.sign(turnOf(piece)) === sign ? piece : piece.reverse());
        grown[s] = true;
        if (pieceArea >= bandArea - 1e-9) break;
      }
    }
    return { rings, grown };
  });
}

/**
 * Traces `rings` as one clip in device pixels, as the path of the context's current transform,
 * which is the identity here: the union of the rings, the first being the face's own region.
 */
function traceRings(ctx: CanvasRenderingContext2D, rings: readonly Ring[], k: number, ox: number, oy: number): void {
  ctx.beginPath();
  for (const ring of rings) {
    for (let n = 0; n < ring.length; n++) {
      const point = ring[n];
      if (point === undefined) continue;
      if (n === 0) ctx.moveTo(ox + k * point[0], oy + k * point[1]);
      else ctx.lineTo(ox + k * point[0], oy + k * point[1]);
    }
    ctx.closePath();
  }
  ctx.clip();
}

/**
 * A parallelogram's edges past its drawing, for the sides `grown` marks: each side's edge row or
 * column stretched out to where its clip may grow, in the colours the bitmap's border repeats.
 * Called under the face's transform, so the coordinates are the bitmap's own pixels.
 */
function stretchEdges(ctx: CanvasRenderingContext2D, bitmap: HTMLCanvasElement, step: DrawStep, grown: readonly boolean[]): void {
  const { drawing } = step;
  const { su, sv, ou, ov } = stretchOf(step);
  const { width: w, height: h } = drawing;
  const high = h + 2 * PAD;
  if (grown[0]) ctx.drawImage(bitmap, PAD, PAD, w, 1, PAD, PAD - sv, w, sv + ov);
  if (grown[1]) ctx.drawImage(bitmap, PAD + w - 1, 0, 1, high, PAD + w - ou, PAD - sv, su + ou, h + 2 * sv);
  if (grown[2]) ctx.drawImage(bitmap, PAD, PAD + h - 1, w, 1, PAD, PAD + h - ov, w, sv + ov);
  if (grown[3]) ctx.drawImage(bitmap, PAD, 0, 1, high, PAD - su, PAD - sv, su + ou, h + 2 * sv);
}

/**
 * Paints `steps` in order onto `ctx`, each face one image of its drawing under the face's
 * transform, clipped to its `clips` (from clipsOf). (ox, oy) is the globe's centre and k the
 * device pixels to each art pixel, so the faces land on the screen's pixel grid under the same
 * numbers the glass uses. The bordered bitmap starts one drawing pixel up and left of the
 * face's corner.
 */
function paintFaces(ctx: CanvasRenderingContext2D, steps: readonly DrawStep[], clips: readonly Clip[], k: number, ox: number, oy: number, bitmaps: Map<Drawing, HTMLCanvasElement>): void {
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step === undefined) continue;
    const { drawing, a } = step;
    // The affine map from the drawing's pixels to art units: its columns are the
    // width and height steps, and the origin is the top left corner.
    const [ax, ay, bx, by] = axesOf(step);
    // An edge-on face has no area on the screen: nothing of it shows, so it is not drawn.
    if (Math.abs(ax * by - bx * ay) < 1e-9) continue;
    const bitmap = bitmapFor(bitmaps, drawing);
    const clip = clips[i];
    ctx.save();
    // The clip is built under the identity transform, in device pixels.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    traceRings(ctx, clip?.rings ?? [], k, ox, oy);
    ctx.setTransform(k * ax, k * ay, k * bx, k * by, ox + k * (a[0] - ax - bx), oy + k * (a[1] - ay - by));
    ctx.drawImage(bitmap, 0, 0);
    if (step.clip === undefined && clip !== undefined) stretchEdges(ctx, bitmap, step, clip.grown);
    ctx.restore();
  }
}

/** A colour-number buffer of `size` numbers, kept while the size holds. */
function colourBuffer(kept: Uint32Array<ArrayBuffer>, size: number): Uint32Array<ArrayBuffer> {
  return kept.length === size ? kept : new Uint32Array(size);
}

/** A rectangle of device pixels, from (left, top) up to but not including (right, bottom): the part of a layer that holds anything. */
interface Dirty {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The rectangle `a` and `b` cover together; either may be null for nothing. */
function unionOf(a: Dirty | null, b: Dirty | null): Dirty | null {
  if (a === null) return b;
  if (b === null) return a;
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}

/** Shapes with their arms moved to their own rows' shifts, by shape and the shifts of the rows above and below the centre's, so a leaning frame makes none anew. */
const armShapes = new WeakMap<SnowStep['shape'], Map<string, SnowStep['shape']>>();

/** `shape` with each arm above the centre row moved by `up` and each below it by `down`, whole art pixels. */
function armsShifted(shape: SnowStep['shape'], up: number, down: number): SnowStep['shape'] {
  if (up === 0 && down === 0) return shape;
  const kept = armShapes.get(shape) ?? new Map<string, SnowStep['shape']>();
  armShapes.set(shape, kept);
  const key = `${up},${down}`;
  let moved = kept.get(key);
  if (moved === undefined) {
    moved = shape.map(([dx, dy]) => [dx + (dy < 0 ? up : dy > 0 ? down : 0), dy] as const);
    kept.set(key, moved);
  }
  return moved;
}

/**
 * `steps` moved by the lean's row shifts, as the glass is, written into `into` (its step objects are reused).
 * Each flake's centre takes its own row's shift and each arm its own row's, so an arm on the next band
 * is not off by an art pixel; (cy) is the globe's centre row in art px.
 */
function leanedSteps(into: SnowStep[], steps: readonly SnowStep[], lean: number, bottom: number, cy: number): SnowStep[] {
  steps.forEach((step, n) => {
    const row = Math.floor(cy + step.y);
    const here = rowShift(lean, bottom, row);
    const moved = into[n] ?? { x: 0, y: 0, colour: 0, shape: step.shape, depth: 0 };
    moved.x = step.x + here;
    moved.y = step.y;
    moved.colour = step.colour;
    moved.depth = step.depth;
    moved.shape = armsShifted(step.shape, rowShift(lean, bottom, row - 1) - here, rowShift(lean, bottom, row + 1) - here);
    into[n] = moved;
  });
  into.length = steps.length;
  return into;
}

/** The rectangle the flakes `steps` can reach in an image `side` x `rows` device pixels, at k device pixels to an art pixel; (gx, gy) is the globe's centre in art px of the image. Null when there are none. */
function snowDirty(steps: readonly SnowStep[], gx: number, gy: number, k: number, side: number, rows: number): Dirty | null {
  if (steps.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const step of steps) {
    const x = Math.floor((gx + step.x) * k);
    const y = Math.floor((gy + step.y) * k);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  // A shape reaches one art pixel (k device pixels) either way from a flake's own pixel.
  left = Math.max(0, left - k);
  top = Math.max(0, top - k);
  right = Math.min(side, right + k + 1);
  bottom = Math.min(rows, bottom + k + 1);
  return left < right && top < bottom ? { left, top, right, bottom } : null;
}

/**
 * Writes Santa's `picture` (NO_FRONT where he drew nothing) over the colour numbers `colours` of the box, each art pixel a k x k block.
 * Returns the rectangle he covers, or null when he drew nothing.
 */
function overlayFigures(colours: Uint32Array, picture: Uint32Array, width: number, box: LeanBox, bw: number, k: number): Dirty | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let y = box.top; y < box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      const colour = picture[y * width + x] ?? NO_FRONT;
      if (colour === NO_FRONT) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (let dy = 0; dy < k; dy++) {
        const row = ((y - box.top) * k + dy) * bw * k;
        for (let dx = 0; dx < k; dx++) colours[row + (x - box.left) * k + dx] = colour;
      }
    }
  }
  if (left > right) return null;
  return { left: (left - box.left) * k, top: (top - box.top) * k, right: (right - box.left + 1) * k, bottom: (bottom - box.top + 1) * k };
}

/** The colour numbers of `dirty` as the opaque words of an image `side` pixels across: NO_FRONT, where nothing was drawn, is clear. */
function wordsFrom(colours: Uint32Array, words: Uint32Array, side: number, dirty: Dirty): void {
  for (let y = dirty.top; y < dirty.bottom; y++) {
    for (let i = y * side + dirty.left; i < y * side + dirty.right; i++) {
      const colour = colours[i] ?? NO_FRONT;
      words[i] = colour === NO_FRONT ? 0 : opaqueWord(colour);
    }
  }
}

/** The pixels of `dirty` put onto the canvas, which is cleared first; the rest of the image is not read. */
function putDirty(context: CanvasRenderingContext2D, image: ImageData, dirty: Dirty | null): void {
  if (dirty !== null) context.putImageData(image, 0, 0, dirty.left, dirty.top, dirty.right - dirty.left, dirty.bottom - dirty.top);
}

/** What one frame is drawn with: the scene frame's layout, width, turn, lean and the figures and snow of the layers. */
export interface FineFrame {
  layout: SceneLayout;
  /** The picture's width in art pixels. */
  width: number;
  turn: number;
  lean: number;
  /** The scene frame's front layer: what Santa drew in front of the glass centre, NO_FRONT where he drew nothing. */
  front: Uint32Array;
  /** The scene frame's behind layer: what Santa drew behind the glass centre, NO_FRONT where he drew nothing; absent draws none. */
  behind?: Uint32Array;
  /** The flakes behind the glass centre, as draw steps (snowDrawList, XMAS-84); absent draws none. */
  snowBehind?: readonly SnowStep[];
  /** The flakes in front of the glass centre, as draw steps; absent draws none. */
  snowFront?: readonly SnowStep[];
}

/** How the picture sits on the screen: physical pixels per art pixel, the device pixel ratio, and the picture's left edge in CSS pixels. */
export interface FineSite {
  scale: number;
  ratio: number;
  left: number;
}

export interface FineLayer {
  /**
   * Draws the shapes and the front over the scene canvas. Returns false, and draws nothing,
   * when a layer gets no 2d context: the scene canvas then has to keep the shapes' bodies.
   */
  draw(frame: FineFrame, site: FineSite): boolean;
}

/** The fine layer over the scene canvas `main`; nothing is made on the page until the first draw. */
export function makeFineLayer(main: HTMLCanvasElement): FineLayer {
  let shapes: Layer | null = null;
  let fronts: Layer | null = null;
  /** The flakes in front, on the screen's pixel grid, over Santa's front layer. */
  let snowFronts: Layer | null = null;
  /** The colour numbers of the box at the screen's size, kept while the size holds: the snow and Santa are drawn into them, then made into words. */
  let colours: Uint32Array<ArrayBuffer> = new Uint32Array(0);
  /** The flakes and Santa behind the glass centre, at the screen's size: put onto the shapes (or their flat copy) under the faces. */
  let behindPixels: Pixels | null = null;
  let snowPixels: Pixels | null = null;
  /** The flakes in front as a leaning frame moves them, kept between frames. */
  const leaned: SnowStep[] = [];
  /** The unleaned faces, drawn here first when the lean moves the rows of the shapes. Not on the page. */
  let flat: Layer | null = null;
  /** The bordered bitmap of each drawing, shared by every face and every frame. */
  const bitmaps = new Map<Drawing, HTMLCanvasElement>();
  let frontPixels: Pixels | null = null;
  /** The draw list for the last turn drawn, and its clips, so a still picture makes neither anew. */
  let stepsTurn = Number.NaN;
  let steps: DrawStep[] = [];
  let clips: Clip[] = [];

  return {
    draw({ layout, width, turn, lean, front, behind, snowBehind = [], snowFront = [] }, { scale: k, ratio, left }): boolean {
      // Made once, on the first draw; a layer with no 2d context is kept too, so the page gets no new canvas each frame.
      shapes ??= { canvas: layerAfter(main), context: null };
      shapes.context ??= shapes.canvas.getContext('2d');
      fronts ??= { canvas: layerAfter(shapes.canvas), context: null };
      fronts.context ??= fronts.canvas.getContext('2d');
      snowFronts ??= { canvas: layerAfter(fronts.canvas), context: null };
      snowFronts.context ??= snowFronts.canvas.getContext('2d');
      const shapesContext = shapes.context;
      const frontsContext = fronts.context;
      const snowContext = snowFronts.context;
      if (shapesContext === null || frontsContext === null || snowContext === null) return false;
      const leaning = lean !== 0;
      if (leaning) {
        flat ??= { canvas: document.createElement('canvas'), context: null };
        flat.context ??= flat.canvas.getContext('2d');
        if (flat.context === null) return false;
      }
      const box = leanBox(width, layout);
      const { cx, cy } = layout.globe;
      const bw = box.right - box.left + 1;
      const bh = box.bottom - box.top;
      const css = k / ratio;
      // The box's top left on the screen: the picture's own left edge (on whole device pixels) and the top of the window.
      const x0 = left + box.left * css;
      const y0 = box.top * css;
      // The globe's centre in device pixels, within the box.
      const ox = (cx - box.left) * k;
      const oy = (cy - box.top) * k;

      if (turn !== stepsTurn) {
        steps = shapeDrawList(turn);
        clips = clipsOf(steps);
        stepsTurn = turn;
      }

      // The shapes: drawn straight onto the layer, or, while leaning, onto the flat copy
      // and then copied row by row, each row moved by its own whole art pixel shift.
      sizeTo(shapes.canvas, bw * k, bh * k);
      shapesContext.clearRect(0, 0, bw * k, bh * k);
      // The flakes behind the glass centre, and Santa while he is behind it, lie under the faces: they are drawn first, unshifted,
      // into an image of the box at the screen's size, so a leaning frame moves them with the rows of the flat copy.
      const boxLayout: SceneLayout = { ...layout, height: bh, globe: { ...layout.globe, cx: cx - box.left, cy: cy - box.top } };
      colours = colourBuffer(colours, bw * k * bh * k);
      colours.fill(NO_FRONT);
      renderSnowSteps(colours, bw, boxLayout, snowBehind, k);
      const behindDirty = unionOf(snowDirty(snowBehind, cx - box.left, cy - box.top, k, bw * k, bh * k), behind === undefined ? null : overlayFigures(colours, behind, width, box, bw, k));
      behindPixels = pixelsFor(shapesContext, bw * k, bh * k, behindPixels);
      if (behindDirty !== null) wordsFrom(colours, behindPixels.words, bw * k, behindDirty);
      if (!leaning) {
        putDirty(shapesContext, behindPixels.image, behindDirty);
        paintFaces(shapesContext, steps, clips, k, ox, oy, bitmaps);
      } else {
        const flatLayer = flat as Layer;
        const flatContext = flatLayer.context as CanvasRenderingContext2D;
        sizeTo(flatLayer.canvas, bw * k, bh * k);
        flatContext.clearRect(0, 0, bw * k, bh * k);
        putDirty(flatContext, behindPixels.image, behindDirty);
        paintFaces(flatContext, steps, clips, k, ox, oy, bitmaps);
        shapesContext.imageSmoothingEnabled = false;
        for (let y = box.top; y < box.bottom; y++) {
          const row = (y - box.top) * k;
          shapesContext.drawImage(flatLayer.canvas, 0, row, bw * k, k, rowShift(lean, box.bottom, y) * k, row, bw * k, k);
        }
      }
      place(shapes.canvas, x0, y0, bw * css, bh * css);

      // Santa in front: what he drew, sheared by the same row shifts as the glass.
      sizeTo(fronts.canvas, bw, bh);
      frontPixels = pixelsFor(frontsContext, bw, bh, frontPixels);
      const frontWords = frontPixels.words;
      frontWords.fill(0);
      for (let y = box.top; y < box.bottom; y++) {
        const shift = rowShift(lean, box.bottom, y);
        for (let x = box.left; x <= box.right; x++) {
          const colour = front[y * width + x] ?? NO_FRONT;
          if (colour === NO_FRONT) continue;
          const to = x + shift - box.left;
          if (to < 0 || to >= bw) continue;
          frontWords[(y - box.top) * bw + to] = opaqueWord(colour);
        }
      }
      frontsContext.putImageData(frontPixels.image, 0, 0);
      place(fronts.canvas, x0, y0, bw * css, bh * css);

      // The flakes in front, on the screen's pixel grid over Santa: each one moved by its row's whole art pixel shift, as the glass is.
      // A whole art pixel shift is a whole number of screen pixels, so the flake's own screen pixel moves by the same amount.
      const frontSteps = lean === 0 ? snowFront : leanedSteps(leaned, snowFront, lean, box.bottom, cy);
      sizeTo(snowFronts.canvas, bw * k, bh * k);
      snowPixels = pixelsFor(snowContext, bw * k, bh * k, snowPixels);
      snowContext.clearRect(0, 0, bw * k, bh * k);
      const frontDirty = snowDirty(frontSteps, cx - box.left, cy - box.top, k, bw * k, bh * k);
      if (frontDirty !== null) {
        colours.fill(NO_FRONT);
        renderSnowSteps(colours, bw, boxLayout, frontSteps, k);
        wordsFrom(colours, snowPixels.words, bw * k, frontDirty);
        putDirty(snowContext, snowPixels.image, frontDirty);
      }
      place(snowFronts.canvas, x0, y0, bw * css, bh * css);
      return true;
    },
  };
}
