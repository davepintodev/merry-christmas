// XMAS-81 "Fine layer on the page: the shapes": the globe's turning shapes drawn
// on the screen's own pixel grid, over the scene canvas, which leaves their
// bodies and floor shadows out (SceneInput.shapeBodies false). Two canvases are
// laid exactly over the glass, where the scene canvas's picture is:
// - the shapes, at the screen's pixel size: first each shape's floor shadow
//   (XMAS-82), a flat shade clipped to the floor disc, over the flakes behind
//   and under the bodies; then each face is one image of its
//   drawing, with a one-pixel border of its own edge, under a canvas transform
//   with no smoothing, clipped to the face. A face's clip also takes the parts
//   of its border that lie inside a face drawn after it, so the nearer face
//   covers the overlap and no pair of antialiased edges leaves a half-clear
//   seam, whatever part of an edge the two share. While leaning, the shadows, the
//   faces with their clips, and Santa are drawn under one smooth shear in screen
//   pixels (XMAS-90), so no drawing row is torn and nothing is copied in bands.
//   Santa's step is among the faces in the draw list's order (XMAS-83), so the
//   shapes cover or pass in front of him by depth, and the lean shears him with them.
// XMAS-84 "Snow inside the glass on the fine layer": the snow is drawn too as
// steps on the screen's own pixel grid. The flakes behind the glass centre go on
// a layer of their own under the shapes (XMAS-89), so the shapes are not redrawn
// while only the snow moves; the flakes in front go on a layer of their own over
// all of them.
// XMAS-92b "The glass as one smooth shear on its own layer": with a glass, the glass is drawn on a canvas of its own,
// between the scene canvas and the shapes, from its colour numbers, under the same shear as the shapes.
import { masterColours } from '../../art/colours.ts';
import type { Drawing } from '../shared/art.generated.ts';
import type { SceneLayout } from '../scene/frame.ts';
import type { GlassLayer } from '../scene/glass-layer.ts';
import { BASE_ROWS, BASE_WIDTH, renderBase } from '../scene/base-fine.ts';
import { BASE_SINK, NO_FRONT } from '../scene/globe.ts';
import { leanBox } from '../scene/lean.ts';
import { drawListOf, shadowDrawList, turnBodies, type SantaDraw, type ShadowStep, type TurnBodies } from '../scene/shape-draw-list.ts';
import { SHADOW_INK, SHADOW_STRENGTH, type FaceDraw } from '../scene/shapes-draw.ts';
import { floorDiscRing } from '../scene/shapes.ts';
import { flakeSize, type SnowStep } from '../scene/snow-draw-list.ts';
import { freeHalves, makeHalves, sameKey, type Halves, type Layer, type ShapesKey } from './fine-layer-halves.ts';
import { paintSantaOver, type SantaSprite } from './fine-layer-santa.ts';
import { opaqueWord, restoreCanvas, saveCanvas, setShear, type Pixels, type Shear } from './fine-layer-pixels.ts';
import { blankFineTrace, type CanvasCalls, type FineTrace } from './frame-trace.ts';

/** The master list's colours as numbers, so a drawing's colour number is a colour. */
const COLOUR_NUMBERS: readonly number[] = masterColours.map((colour) => Number.parseInt(colour.slice(1), 16));

/** The floor disc's rim as a polygon of this many points: its clip for the shadows, within about a hundredth of an art pixel of the disc. */
const DISC_POINTS = 128;
const FLOOR_RING = floorDiscRing(DISC_POINTS);
/** The shadow's fill: the shadow ink, as the canvas's colour style. */
const SHADOW_STYLE = `#${SHADOW_INK.toString(16).padStart(6, '0')}`;

/** The border of each bitmap, in drawing pixels: it repeats the drawing's edge, and it is all a gable's clip may reach past its drawing. */
const PAD = 1;
/*
 * The clip margins are in screen pixels, so each reaches the same distance on the screen at any scale k (screen pixels
 * to an art pixel) and is turned into art units by it.
 */
/** How far a face's clip reaches past a side, in screen pixels: a band beyond the side that a later face pushed across it covers. */
const GROW_PX = 7.5;
/** How far a band starts inside its side, in screen pixels, so it overlaps the face it grows from. */
const OVERLAP_PX = 1.25;
/** How far a face's clip reaches past each side, in screen pixels: half a pixel, so an edge pixel the CPU fills is covered whole. */
const HALF_PIXEL_PX = 0.5;
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

/** What the shapes canvas last drew, with the numbers that drew it: a frame that would draw the same again is skipped (XMAS-89). */
interface ShapesDrawn {
  turn: number;
  k: number;
  lean: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
  /** Whether Santa was on it, which a frame without him wipes by drawing the shapes once more. */
  santa: boolean;
}

function pixelsFor(context: CanvasRenderingContext2D, width: number, height: number, kept: Pixels | null): Pixels {
  if (kept !== null && kept.image.width === width && kept.image.height === height) return kept;
  const image = context.createImageData(width, height);
  return { image, words: new Uint32Array(image.data.buffer) };
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

/**
 * Writes the glass's colour numbers onto `canvas` as an image of its box: 0 paints nothing, any other number is opaque in its colour.
 * The canvas is resized only when the box changes, and the image is kept while its size holds, so a new glass reuses both.
 */
function paintGlass(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, kept: Pixels | null, glass: GlassLayer): Pixels {
  sizeTo(canvas, glass.width, glass.height);
  const pixels = pixelsFor(context, glass.width, glass.height, kept);
  glass.pixels.forEach((colour, i) => {
    pixels.words[i] = colour === 0 ? 0 : opaqueWord(colour);
  });
  context.putImageData(pixels.image, 0, 0);
  return pixels;
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
function regionOf(step: FaceDraw): Ring {
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
function axesOf({ drawing, a, b, d }: FaceDraw): [number, number, number, number] {
  return [(b[0] - a[0]) / drawing.width, (b[1] - a[1]) / drawing.width, (d[0] - a[0]) / drawing.height, (d[1] - a[1]) / drawing.height];
}

/** The face's bitmap in art units: its drawing with PAD drawing pixels of border on every side. */
function bitmapRingOf(step: FaceDraw): Ring {
  const [ax, ay, bx, by] = axesOf(step);
  const { drawing, a } = step;
  const at = (u: number, v: number): [number, number] => [a[0] + u * ax + v * bx, a[1] + u * ay + v * by];
  const { width: w, height: h } = drawing;
  return [at(-PAD, -PAD), at(w + PAD, -PAD), at(w + PAD, h + PAD), at(-PAD, h + PAD)];
}

/**
 * How far a parallelogram face's edge rows and columns are stretched past each side, in drawing
 * pixels across (su, the sides left and right) and down (sv, top and bottom), so GROW_PX screen
 * pixels lie beyond every side at scale k; ou and ov are the OVERLAP_PX inside the sides, in the same units.
 */
function stretchOf(step: FaceDraw, k: number): { su: number; sv: number; ou: number; ov: number } {
  const [ax, ay, bx, by] = axesOf(step);
  // A drawing pixel across moves area / |down| art units away from the sides it runs between, and one down area / |across|.
  const area = Math.abs(ax * by - bx * ay);
  const hypotA = Math.hypot(ax, ay);
  const hypotB = Math.hypot(bx, by);
  const grow = GROW_PX / k;
  const overlap = OVERLAP_PX / k;
  // The bitmap already fills the face's interior, so an edge strip overlaps at most one border pixel inward.
  return {
    su: Math.min(MAX_STRETCH, (grow * hypotB) / area),
    sv: Math.min(MAX_STRETCH, (grow * hypotA) / area),
    ou: Math.min(PAD, (overlap * hypotB) / area),
    ov: Math.min(PAD, (overlap * hypotA) / area),
  };
}

/**
 * A parallelogram face's four bands beyond its sides, in art units and in the order of its sides
 * (top, right, bottom, left), each overlapping its side by OVERLAP_PX and reaching GROW_PX past it, at scale k.
 */
function stretchBands(step: FaceDraw, k: number): Ring[] {
  const [ax, ay, bx, by] = axesOf(step);
  const { drawing, a } = step;
  const { su, sv, ou, ov } = stretchOf(step, k);
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
 * Its inner edge lies `overlap` inside the side, so the band and the face share area rather than
 * an edge: two rings that only touch leave a hairline of the canvas's rounding between them.
 */
function bandOf({ from, to, normal: [nx, ny] }: Side, depth: number, overlap: number): Ring {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length === 0) return [];
  const tx = ((to[0] - from[0]) / length) * depth;
  const ty = ((to[1] - from[1]) / length) * depth;
  const ix = -overlap * nx;
  const iy = -overlap * ny;
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
 * side of it and each solid face of the same shape drawn after it, the part of the band beyond
 * that side (the bitmap's edge stretched out, for a parallelogram) that the later face reaches
 * when pushed back across the band. So a shared side is covered along its whole length, and a
 * corner where three faces meet too; a later face's edge that stops short of the side is pushed
 * over the gap it leaves. Cutout drawings do not grow or push. `grown` marks the sides that have
 * such a ring.
 */
function clipsOf({ faces: steps, shapes }: TurnBodies, k: number): Clip[] {
  const regions = steps.map(regionOf);
  const boxes = regions.map(boxOf);
  // A cutout (a drawing with clear pixels) is never stretched: its edge would paint clear pixels as colour.
  const solid = steps.map((step) => !step.drawing.pixels.includes(0));
  // The faces of a face's own shape run from it to the next shape's first face; a shape's faces never cover another's band.
  const ends = steps.map((_, i) => {
    const at = shapes.findIndex((shape, s) => shape.start <= i && (shapes[s + 1]?.start ?? steps.length) > i);
    return at === -1 ? i + 1 : (shapes[at + 1]?.start ?? steps.length);
  });
  // How far a later face is pushed back across a band: both overlaps, so the pushed face reaches the far side of the seam.
  const grow = GROW_PX / k;
  const overlap = OVERLAP_PX / k;
  const half = HALF_PIXEL_PX / k;
  const sweep = 2 * overlap;
  return steps.map((step, i) => {
    const region = regions[i] ?? [];
    // An edge-on face is not drawn, so it has no clip.
    if (Math.abs(turnOf(region)) < 1e-9) return { rings: [], grown: [] };
    // Each piece winds as the face's own region does, so the nonzero fill adds them up instead of cancelling.
    const sign = Math.sign(turnOf(region)) || 1;
    const sides = sidesOf(region);
    // A parallelogram's bands are its stretched edges; a gable's are its sides' bands, cut to its bitmap.
    const bands = step.clip === undefined ? stretchBands(step, k) : sides.map((side) => {
      const band = bandOf(side, grow, overlap);
      return band.length < 3 ? [] : clipConvex(bitmapRingOf(step), band);
    });
    const rings: Ring[] = [region];
    const grown = sides.map(() => false);
    const end = ends[i] ?? i + 1;
    if (solid[i]) {
      for (const [s, side] of sides.entries()) {
        const band = bands[s] ?? [];
        if (band.length < 3) continue;
        const bandArea = Math.abs(turnOf(band));
        const [nx, ny] = side.normal;
        const [left, top, right, bottom] = boxOf(band);
        // The band's extent across the side and along it: a later face outside either range cannot reach it.
        const [acrossLow, acrossHigh] = extentOf(band, side.from, side.normal);
        const [alongLow, alongHigh] = extentOf(band, side.from, side.tangent);
        // A later face of the same shape pushed back across the band covers it; once one covers all of it, the rest add nothing.
        for (let j = i + 1; j < end; j++) {
          if (!solid[j]) continue;
          const later = regions[j];
          const [jl, jt, jr, jb] = boxes[j] ?? [0, 0, 0, 0];
          // Only a later face whose box, grown by sweep, meets the band's box can push across it.
          if (later === undefined || Math.abs(turnOf(later)) < 1e-9 || jr + sweep < left || jl - sweep > right || jb + sweep < top || jt - sweep > bottom) continue;
          // Pushed back across the band, a later face spans from sweep behind its near side to its far one.
          const [near, far] = extentOf(later, side.from, side.normal);
          const [lowAlong, highAlong] = extentOf(later, side.from, side.tangent);
          if (far < acrossLow || near - sweep > acrossHigh || highAlong < alongLow || lowAlong > alongHigh) continue;
          const pushed = sweptOf(later, sweep * nx, sweep * ny);
          const piece = clipConvex(band, pushed);
          const pieceArea = Math.abs(turnOf(piece));
          if (piece.length < 3 || pieceArea < 1e-9) continue;
          rings.push(Math.sign(turnOf(piece)) === sign ? piece : piece.reverse());
          grown[s] = true;
          if (pieceArea >= bandArea - 1e-9) break;
        }
      }
    }
    // Every side also reaches half a screen pixel past its edge, so an edge pixel the CPU fills is covered whole.
    for (const { from, to, normal: [nx, ny] } of sides) {
      const [ix, iy] = [-overlap * nx, -overlap * ny];
      const [ox, oy] = [half * nx, half * ny];
      const edge = clipConvex(bitmapRingOf(step), [
        [from[0] + ix, from[1] + iy],
        [to[0] + ix, to[1] + iy],
        [to[0] + ox, to[1] + oy],
        [from[0] + ox, from[1] + oy],
      ]);
      if (edge.length < 3) continue;
      rings.push(Math.sign(turnOf(edge)) === sign ? edge : edge.reverse());
    }
    return { rings, grown };
  });
}

/**
 * Traces `rings` as the context's path in device pixels, under the context's current transform (the shear, in the draw): the union of the rings.
 * (XMAS-82: the rings may be a shadow's polygon as well as a face's clip.)
 */
function tracePath(ctx: CanvasRenderingContext2D, rings: readonly (readonly (readonly [number, number])[])[], k: number, ox: number, oy: number, tally?: CanvasCalls): void {
  const at = tally === undefined ? 0 : performance.now();
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
  if (tally !== undefined) {
    tally.pathMs += performance.now() - at;
    tally.paths += 1;
  }
}

/** Traces `rings` as one clip in device pixels, the first being the face's own region. */
function traceRings(ctx: CanvasRenderingContext2D, rings: readonly Ring[], k: number, ox: number, oy: number, tally?: CanvasCalls): void {
  tracePath(ctx, rings, k, ox, oy, tally);
  const at = tally === undefined ? 0 : performance.now();
  ctx.clip();
  if (tally !== undefined) {
    tally.clipMs += performance.now() - at;
    tally.clips += 1;
  }
}

/**
 * Fills the shadows' polygons in the shadow ink at its strength, under `shear`, clipped to the
 * floor disc, before any face is drawn: the bodies then cover the shade where they stand. All the polygons go in
 * one path and are filled once, so a pixel under several shadows takes the shade once, as paintShadows' does.
 * The context's state is restored after. `trace` is the frame's, which times and counts its canvas calls (XMAS-113).
 */
function paintShadows(ctx: CanvasRenderingContext2D, shadows: readonly ShadowStep[], k: number, ox: number, oy: number, shear: Shear, trace?: FineTrace): void {
  const tally = trace?.canvas;
  const at = trace === undefined ? 0 : performance.now();
  saveCanvas(ctx, tally);
  setShear(ctx, shear, undefined, tally);
  traceRings(ctx, [FLOOR_RING], k, ox, oy, tally);
  ctx.fillStyle = SHADOW_STYLE;
  ctx.globalAlpha = SHADOW_STRENGTH;
  tracePath(ctx, shadows.map((shadow) => shadow.polygon), k, ox, oy, tally);
  ctx.fill();
  restoreCanvas(ctx, tally);
  // XMAS-113 phase 2: the shadows' time, whichever canvas the redraw paints them on (the lower half or the shapes).
  if (trace !== undefined) trace.shadowsMs += performance.now() - at;
}

/** Draws `image` at the origin of `ctx`, timed and counted in `tally` when there is one (XMAS-113). */
function drawOrigin(ctx: CanvasRenderingContext2D, image: CanvasImageSource, tally?: CanvasCalls): void {
  const at = tally === undefined ? 0 : performance.now();
  ctx.drawImage(image, 0, 0);
  if (tally !== undefined) {
    tally.drawImages += 1;
    tally.drawImageMs += performance.now() - at;
  }
}

/**
 * A parallelogram's edges past its drawing, for the sides `grown` marks: each side's edge row or
 * column stretched out to where its clip may grow, in the colours the bitmap's border repeats.
 * Called under the face's transform, so the coordinates are the bitmap's own pixels.
 * Returns the drawImage calls made on ctx (XMAS-102): one for each side grown.
 */
function stretchEdges(ctx: CanvasRenderingContext2D, bitmap: HTMLCanvasElement, step: FaceDraw, grown: readonly boolean[], k: number): number {
  const { drawing } = step;
  const { su, sv, ou, ov } = stretchOf(step, k);
  const { width: w, height: h } = drawing;
  const high = h + 2 * PAD;
  let calls = 0;
  if (grown[0]) { ctx.drawImage(bitmap, PAD, PAD, w, 1, PAD, PAD - sv, w, sv + ov); calls += 1; }
  if (grown[1]) { ctx.drawImage(bitmap, PAD + w - 1, 0, 1, high, PAD + w - ou, PAD - sv, su + ou, h + 2 * sv); calls += 1; }
  if (grown[2]) { ctx.drawImage(bitmap, PAD, PAD + h - 1, w, 1, PAD, PAD + h - ov, w, sv + ov); calls += 1; }
  if (grown[3]) { ctx.drawImage(bitmap, PAD, 0, 1, high, PAD - su, PAD - sv, su + ou, h + 2 * sv); calls += 1; }
  return calls;
}

/**
 * Paints `list` in order onto `ctx`, each face one image of its drawing under the face's
 * transform, clipped to its `clips` (from clipsOf, one per face, in the list's face order), and
 * Santa's step, when the list has one, as paintSantaOver draws it. (ox, oy) is the globe's centre
 * and k the device pixels to each art pixel, so the faces land on the screen's pixel grid under
 * the same numbers the glass uses. The bordered bitmap starts one drawing pixel up and left of
 * the face's corner. `shear` goes in front of each face's transform, so the faces, their clips and
 * Santa lean together (XMAS-90). Returns the drawImage calls made on ctx (XMAS-102). `trace` is the
 * frame's: Santa's paint fills it (XMAS-107), and so do the faces' clip and draw times (XMAS-108).
 */
function paintFaces(ctx: CanvasRenderingContext2D, list: readonly (FaceDraw | SantaDraw)[], clips: readonly Clip[], k: number, ox: number, oy: number, bitmaps: Map<Drawing, HTMLCanvasElement>, sprite: SantaSprite | null, shear: Shear, trace?: FineTrace): number {
  const at = trace === undefined ? 0 : performance.now();
  ctx.imageSmoothingEnabled = false;
  const tally = trace?.canvas;
  let face = 0;
  let calls = 0;
  for (const step of list) {
    if ('sprite' in step) {
      if (sprite !== null) calls += paintSantaOver(ctx, step, sprite, shear, trace);
      continue;
    }
    const clip = clips[face];
    face += 1;
    const { drawing, a } = step;
    // The affine map from the drawing's pixels to art units: its columns are the
    // width and height steps, and the origin is the top left corner.
    const [ax, ay, bx, by] = axesOf(step);
    // An edge-on face has no area on the screen: nothing of it shows, so it is not drawn.
    if (Math.abs(ax * by - bx * ay) < 1e-9) continue;
    const bitmap = bitmapFor(bitmaps, drawing);
    // Each ring of the clip is drawn under its own clip: the antialiased edges of overlapping rings would otherwise
    // leave a pixel that one ring covers whole a few per cent clear.
    for (const ring of clip?.rings ?? []) {
      saveCanvas(ctx, tally);
      // The clip is built under the shear, in device pixels; the face's own transform then goes in front of the shear.
      setShear(ctx, shear, undefined, tally);
      const clipAt = trace === undefined ? 0 : performance.now();
      traceRings(ctx, [ring], k, ox, oy, tally);
      if (trace !== undefined) trace.shapesClipMs += performance.now() - clipAt;
      setShear(ctx, shear, [k * ax, k * ay, k * bx, k * by, ox + k * (a[0] - ax - bx), oy + k * (a[1] - ay - by)], tally);
      const drawAt = trace === undefined ? 0 : performance.now();
      drawOrigin(ctx, bitmap, tally);
      calls += 1;
      if (trace !== undefined) trace.shapesDrawMs += performance.now() - drawAt;
      restoreCanvas(ctx, tally);
    }
    if (step.clip === undefined && clip !== undefined) {
      saveCanvas(ctx, tally);
      setShear(ctx, shear, undefined, tally);
      const clipAt = trace === undefined ? 0 : performance.now();
      traceRings(ctx, clip.rings, k, ox, oy, tally);
      if (trace !== undefined) trace.shapesClipMs += performance.now() - clipAt;
      setShear(ctx, shear, [k * ax, k * ay, k * bx, k * by, ox + k * (a[0] - ax - bx), oy + k * (a[1] - ay - by)], tally);
      const drawAt = trace === undefined ? 0 : performance.now();
      const edgesAt = tally === undefined ? 0 : performance.now();
      const drawn = stretchEdges(ctx, bitmap, step, clip.grown, k);
      calls += drawn;
      if (tally !== undefined) {
        tally.drawImages += drawn;
        tally.drawImageMs += performance.now() - edgesAt;
      }
      if (trace !== undefined) trace.shapesDrawMs += performance.now() - drawAt;
      restoreCanvas(ctx, tally);
    }
  }
  // XMAS-113 phase 2: the call's time adds to the faces of the redraw, Santa's paint included where he is drawn among them.
  if (trace !== undefined) trace.facesMs += performance.now() - at;
  return calls;
}

/** The sections of the trace that are timed (XMAS-102). */
type Section = 'glassMs' | 'behindMs' | 'shapesMs' | 'frontMs' | 'baseMs';

/** Sets a section's milliseconds since `from`, and returns the clock now, where the next section starts (XMAS-102). */
function lapInto(trace: FineTrace, section: Section, from: number): number {
  const now = performance.now();
  trace[section] = now - from;
  return now;
}

/** A rectangle of device pixels, from (left, top) up to but not including (right, bottom): the part of a layer that holds anything. */
interface Dirty {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * `steps` moved by the lean's shear, written into `into` (its step objects are reused). Each flake moves as one block:
 * its left moves by the shear at its own centre, rounded to a whole screen pixel, and its arms go with it (XMAS-90).
 * `layout` is the box's own layout, so its globe's centre is the centre in the box, and k the device pixels to each art pixel.
 * The moved position is given as the middle of its screen pixel, so the art rounding in renderSnowSteps cannot move it by one.
 */
function leanedSteps(into: SnowStep[], steps: readonly SnowStep[], lean: number, layout: SceneLayout, k: number): SnowStep[] {
  const { cx, cy } = layout.globe;
  const height = layout.height * k;
  steps.forEach((step, n) => {
    // The block starts at the floored top row and is flakeSize(k) device pixels tall, so its middle is half a block below that.
    const centre = Math.floor((cy + step.y) * k) + flakeSize(k) / 2;
    const left = Math.floor((cx + step.x) * k) + Math.round(lean * (height - centre));
    const moved = into[n] ?? { x: 0, y: 0, colour: 0, shape: step.shape, depth: 0 };
    moved.x = (left + 0.5) / k - cx;
    moved.y = step.y;
    moved.colour = step.colour;
    moved.depth = step.depth;
    moved.shape = step.shape;
    into[n] = moved;
  });
  into.length = steps.length;
  return into;
}

/** A colour-number buffer of `size` numbers, kept while the size holds. */
function colourBuffer(kept: Uint32Array<ArrayBuffer>, size: number): Uint32Array<ArrayBuffer> {
  return kept.length === size ? kept : new Uint32Array(size);
}

/** The CSS colour of each colour number the snow is drawn in, made once per number so a flake makes no string (XMAS-106). */
const snowStyles = new Map<number, string>();

/** A colour number as the canvas's colour style, '#rrggbb', from the snow's cache. */
function snowStyle(colour: number): string {
  let style = snowStyles.get(colour);
  if (style === undefined) {
    style = `#${colour.toString(16).padStart(6, '0')}`;
    snowStyles.set(colour, style);
  }
  return style;
}

/**
 * Draws `steps` over the canvas `context` in order, at `k` device pixels to an art pixel: each cell of a step's shape is a square of
 * flakeSize(k) pixels on the pixels renderSnowSteps would pick, but drawn as whole rectangles, so nothing is antialiased (XMAS-106).
 * `layout` is the box's own layout, as renderSnowSteps takes it. The caller clears the canvas first.
 */
function paintSnow(context: CanvasRenderingContext2D, steps: readonly SnowStep[], layout: SceneLayout, k: number, trace?: FineTrace): void {
  const { cx, cy } = layout.globe;
  const size = flakeSize(k);
  // Squares bigger than a pixel space their arms by their side so they stay joined, as renderSnowSteps does.
  const reach = size > 1 ? size : k;
  const tally = trace?.canvas;
  for (const step of steps) {
    const x = Math.floor((cx + step.x) * k);
    const y = Math.floor((cy + step.y) * k);
    context.fillStyle = snowStyle(step.colour);
    for (const [dx, dy] of step.shape) {
      const at = tally === undefined ? 0 : performance.now();
      context.fillRect(x + dx * reach, y + dy * reach, size, size);
      if (tally !== undefined) {
        tally.fillRects += 1;
        tally.fillRectMs += performance.now() - at;
      }
    }
  }
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

/** What one frame is drawn with: the scene frame's layout, width, turn and lean, Santa's time and the flakes. */
export interface FineFrame {
  layout: SceneLayout;
  /** The picture's width in art pixels. */
  width: number;
  turn: number;
  lean: number;
  /** Santa's time in milliseconds (XMAS-83); with it the shapes canvas holds him, in the draw list's order; absent draws none. */
  santaTimeMs?: number;
  /** The flakes behind the glass centre, as draw steps (snowDrawList, XMAS-84); absent draws none. */
  snowBehind?: readonly SnowStep[];
  /** The flakes in front of the glass centre, as draw steps; absent draws none. */
  snowFront?: readonly SnowStep[];
  /** The glass as its own layer (XMAS-92b, glassLayer); absent draws none, and leaves the glass layer clear. */
  glass?: GlassLayer;
}

/** How the picture sits on the screen: physical pixels per art pixel, the device pixel ratio, and the picture's left edge in CSS pixels. */
export interface FineSite {
  scale: number;
  ratio: number;
  left: number;
  /** Filled by each draw with its section times and draw counts (XMAS-102); absent, the clock is not read. */
  trace?: FineTrace;
}

export interface FineLayer {
  /**
   * Draws the shapes, Santa and the snow over the scene canvas. Returns false, and draws nothing,
   * when a layer gets no 2d context: the scene canvas then has to keep the shapes' bodies.
   */
  draw(frame: FineFrame, site: FineSite): boolean;
}

/** The fine layer over the scene canvas `main`; nothing is made on the page until the first draw. */
export function makeFineLayer(main: HTMLCanvasElement): FineLayer {
  let shapes: Layer | null = null;
  /** The flakes behind the glass centre, on the screen's pixel grid, under the shapes (XMAS-89): cleared and drawn each frame. */
  let snowBehinds: Layer | null = null;
  /** The shapes as they were last drawn, kept while the picture they make holds (XMAS-89). */
  let shapesDrawn: ShapesDrawn | null = null;
  /** The flakes in front, on the screen's pixel grid, over the shapes and Santa. */
  let snowFronts: Layer | null = null;
  /** The base, on the screen's pixel grid over all of them (XMAS-68), kept while its turn, size and scale hold. */
  let baseLayer: Layer | null = null;
  let baseColours: Uint32Array<ArrayBuffer> = new Uint32Array(0);
  let basePixels: Pixels | null = null;
  let baseKept: { turn: number; k: number } | null = null;
  /** The flakes in front as a leaning frame moves them, kept between frames. */
  const leaned: SnowStep[] = [];
  /** The flakes behind the glass centre as a leaning frame moves them, kept between frames (apart from the front ones). */
  const leanedBehind: SnowStep[] = [];
  /** The bordered bitmap of each drawing, shared by every face and every frame. */
  const bitmaps = new Map<Drawing, HTMLCanvasElement>();
  /** The bodies of the last turn drawn their clips and their shadows, so a still picture makes neither anew. */
  let kept: { turn: number; k: number; bodies: TurnBodies; clips: Clip[]; shadows: ShadowStep[] } | null = null;
  /** The shapes below and above Santa, made by the first frame with him and the same shapes as the last (XMAS-108). */
  let halves: Halves | null = null;
  /** Santa's scratch layer, made by the first frame with a time, and the buffers his pixels go through, kept while their size holds. */
  let santa: Layer | null = null;
  let santaColours: Uint32Array | null = null;
  let santaPixels: Pixels | null = null;
  /** The glass's own layer, between the scene canvas and the shapes (XMAS-92b), made by the first frame with a glass. */
  let glassCanvas: Layer | null = null;
  /** The offscreen canvas the glass is written onto, and its image: made by the first frame with a glass and kept for every glass after. */
  let glassBitmap: Layer | null = null;
  let glassPixels: Pixels | null = null;
  /** The glass last written onto the bitmap: a new glass object is written again, the same one is not. */
  let glassKept: GlassLayer | null = null;

  return {
    draw({ layout, width, turn, lean, santaTimeMs, snowBehind = [], snowFront = [], glass }, { scale: k, ratio, left, trace }): boolean {
      // XMAS-113 phase 2: the draw's whole time starts here, so the phases and the remainder add up to it.
      const begun = trace === undefined ? 0 : performance.now();
      // XMAS-102: the trace is cleared first, so a draw that returns early reports nothing drawn.
      if (trace !== undefined) Object.assign(trace, blankFineTrace());
      // XMAS-113: the draw's canvas calls are timed and counted in this frame's trace, when there is one.
      const tally = trace?.canvas;
      // The draw list comes first, so a turn or a time that is not finite throws before anything is drawn. The bodies are kept per turn;
      // Santa's step moves every frame, so a frame with a time splices him into them by depth.
      // The clips depend on the scale too, through the margins in screen pixels, so a new scale makes them anew.
      if (kept === null || turn !== kept.turn || k !== kept.k) {
        const bodies = turnBodies(turn);
        kept = { turn, k, bodies, clips: clipsOf(bodies, k), shadows: shadowDrawList(turn) };
      }
      const { bodies, clips } = kept;
      const list = drawListOf(bodies, santaTimeMs);

      // Made once, on the first draw; a layer with no 2d context is kept too, so the page gets no new canvas each frame.
      // The flakes behind go right after the scene canvas, and the shapes after them, so the glass layer made later goes in before both.
      snowBehinds ??= { canvas: layerAfter(main), context: null };
      snowBehinds.context ??= snowBehinds.canvas.getContext('2d');
      shapes ??= { canvas: layerAfter(snowBehinds.canvas), context: null };
      shapes.context ??= shapes.canvas.getContext('2d');
      snowFronts ??= { canvas: layerAfter(shapes.canvas), context: null };
      snowFronts.context ??= snowFronts.canvas.getContext('2d');
      baseLayer ??= { canvas: layerAfter(snowFronts.canvas), context: null };
      baseLayer.context ??= baseLayer.canvas.getContext('2d');
      // The glass's layer goes in right after the scene canvas, so it lies under the shapes whenever it is made.
      if (glass !== undefined) {
        glassCanvas ??= { canvas: layerAfter(main), context: null };
        glassBitmap ??= { canvas: document.createElement('canvas'), context: null };
      }
      if (glassCanvas !== null) glassCanvas.context ??= glassCanvas.canvas.getContext('2d');
      if (glassBitmap !== null) glassBitmap.context ??= glassBitmap.canvas.getContext('2d');
      const baseContext = baseLayer.context;
      const behindContext = snowBehinds.context;
      const shapesContext = shapes.context;
      const snowContext = snowFronts.context;
      const glassContext = glassCanvas?.context ?? null;
      const bitmapContext = glassBitmap?.context ?? null;
      if (behindContext === null || shapesContext === null || snowContext === null || baseContext === null) return false;
      if (glass !== undefined && (glassContext === null || bitmapContext === null)) return false;
      if (santaTimeMs !== undefined) {
        santa ??= { canvas: document.createElement('canvas'), context: null };
        santa.context ??= santa.canvas.getContext('2d');
        if (santa.context === null) return false;
      }
      const leaning = lean !== 0;
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
      // The lean as a shear of the box's device pixels (XMAS-90): the shadows, the faces and Santa are drawn under it.
      const shear: Shear = { lean, height: bh * k };

      // The box's own layout: the globe's centre moved to the box's top left corner, the picture's size the box's.
      const boxLayout: SceneLayout = { ...layout, height: bh, globe: { ...layout.globe, cx: cx - box.left, cy: cy - box.top } };
      // Santa's picture is the box's own: his step is drawn at the box's device size.
      let sprite: SantaSprite | null = null;
      if (santaTimeMs !== undefined && santa?.context) {
        sizeTo(santa.canvas, bw * k, bh * k);
        if (santaColours === null || santaColours.length !== bw * k * bh * k) santaColours = new Uint32Array(bw * k * bh * k);
        santaPixels = pixelsFor(santa.context, bw * k, bh * k, santaPixels);
        sprite = { canvas: santa.canvas, context: santa.context, colours: santaColours, pixels: santaPixels, layout: boxLayout, side: bw * k, zoom: k };
      }

      // XMAS-102: the trace times each section from here, the glass first, and each section's end is where the next one starts.
      let at = trace === undefined ? 0 : performance.now();
      if (trace !== undefined) trace.inputsMs = at - begun;
      // The glass (XMAS-92b): cleared each frame, then drawn as one image of its bitmap under the shapes' shear, so it leans with
      // them and no row of it is copied. A frame with no glass leaves the layer clear.
      if (glassCanvas !== null && glassBitmap !== null && glassContext !== null && bitmapContext !== null) {
        sizeTo(glassCanvas.canvas, bw * k, bh * k);
        glassContext.clearRect(0, 0, bw * k, bh * k);
        if (glass !== undefined) {
          if (glassKept !== glass) {
            glassPixels = paintGlass(glassBitmap.canvas, bitmapContext, glassPixels, glass);
            glassKept = glass;
            if (trace !== undefined) trace.glassPainted = true;
          }
          glassContext.imageSmoothingEnabled = false;
          saveCanvas(glassContext, tally);
          setShear(glassContext, shear, undefined, tally);
          const glassAt = tally === undefined ? 0 : performance.now();
          glassContext.drawImage(glassBitmap.canvas, (glass.left - box.left) * k, (glass.top - box.top) * k, glass.width * k, glass.height * k);
          if (tally !== undefined) {
            tally.drawImages += 1;
            tally.drawImageMs += performance.now() - glassAt;
          }
          restoreCanvas(glassContext, tally);
        }
        place(glassCanvas.canvas, x0, y0, bw * css, bh * css);
      }
      if (trace !== undefined) at = lapInto(trace, 'glassMs', at);

      // The flakes behind the glass centre lie under the shadows, the faces and Santa, on their own layer under the shapes (XMAS-89):
      // a leaning frame moves each one as one block by the shear at its centre. They are drawn straight onto the layer, cleared
      // first, as whole rectangles; no colour buffer or putImageData, which blinked on a phone (XMAS-106).
      sizeTo(snowBehinds.canvas, bw * k, bh * k);
      behindContext.clearRect(0, 0, bw * k, bh * k);
      const behind = leaning ? leanedSteps(leanedBehind, snowBehind, lean, boxLayout, k) : snowBehind;
      if (trace !== undefined) trace.behindFlakes = behind.length;
      paintSnow(behindContext, behind, boxLayout, k, trace);
      place(snowBehinds.canvas, x0, y0, bw * css, bh * css);
      if (trace !== undefined) at = lapInto(trace, 'behindMs', at);

      // The shapes: the shadows, then each face and Santa, drawn straight onto the layer in the list's order. While leaning,
      // all of it is drawn under the lean's shear, so no drawing row is copied apart (XMAS-90). It is drawn again only when its
      // picture changes (XMAS-89): the turn, the scale, the lean, the box's size or the globe's place in it, or Santa, who is drawn
      // every frame, and the frame after him draws the shapes once more to wipe him. With Santa and the same inputs as the last
      // redraw, the shapes come from the two halves, below and above him, blitted with him painted between them (XMAS-108).
      const held = shapesDrawn;
      // The last redraw's inputs are the same as these: a redraw then came only from Santa, or the frame after him (XMAS-108).
      const same = held !== null && held.turn === turn && held.k === k && held.lean === lean &&
        held.ox === ox && held.oy === oy && held.width === bw * k && held.height === bh * k;
      const unchanged = same && santaTimeMs === undefined && !held.santa;
      if (!unchanged) {
        sizeTo(shapes.canvas, bw * k, bh * k);
        shapesContext.clearRect(0, 0, bw * k, bh * k);
        const split = list.findIndex((step) => 'sprite' in step);
        const cut = santaTimeMs !== undefined && same ? (halves ??= makeHalves()) : null;
        const lower = cut?.below.context ?? null;
        const upper = cut?.above.context ?? null;
        const santa = list[split];
        let calls = 0;
        if (cut !== null && lower !== null && upper !== null && sprite !== null && santa !== undefined && 'sprite' in santa) {
          const key: ShapesKey = { turn, k, lean, ox, oy, width: bw * k, height: bh * k, split };
          // The halves are drawn only for a key they do not hold yet: the faces before Santa below, those after him above.
          let built = 0;
          if (cut.key === null || !sameKey(cut.key, key)) {
            sizeTo(cut.below.canvas, bw * k, bh * k);
            sizeTo(cut.above.canvas, bw * k, bh * k);
            lower.clearRect(0, 0, bw * k, bh * k);
            upper.clearRect(0, 0, bw * k, bh * k);
            paintShadows(lower, kept.shadows, k, ox, oy, shear, trace);
            built += paintFaces(lower, list.slice(0, split), clips, k, ox, oy, bitmaps, null, shear, trace);
            built += paintFaces(upper, list.slice(split + 1), clips.slice(split), k, ox, oy, bitmaps, null, shear, trace);
            cut.key = key;
          }
          drawOrigin(shapesContext, cut.below.canvas, tally);
          const santaCalls = paintSantaOver(shapesContext, santa, sprite, shear, trace);
          drawOrigin(shapesContext, cut.above.canvas, tally);
          calls = 2 + santaCalls + built;
        } else {
          // A frame without Santa frees the halves, two canvases of the picture's size: the next build sizes and draws them anew (XMAS-108).
          if (halves !== null && santaTimeMs === undefined) freeHalves(halves);
          paintShadows(shapesContext, kept.shadows, k, ox, oy, shear, trace);
          calls = paintFaces(shapesContext, list, clips, k, ox, oy, bitmaps, sprite, shear, trace);
        }
        shapesDrawn = { turn, k, lean, ox, oy, width: bw * k, height: bh * k, santa: santaTimeMs !== undefined };
        if (trace !== undefined) {
          trace.shapesRedrawn = true;
          trace.shapesCalls = calls;
          trace.shapesSameInputs = same ? 1 : 0;
        }
      }
      place(shapes.canvas, x0, y0, bw * css, bh * css);
      if (trace !== undefined) {
        at = lapInto(trace, 'shapesMs', at);
        trace.shapesRestMs = trace.shapesMs - trace.shadowsMs - trace.facesMs;
      }

      // The flakes in front, on the screen's pixel grid over the shapes and Santa: each one moved as one block by the lean's shear at its centre.
      const frontSteps = lean === 0 ? snowFront : leanedSteps(leaned, snowFront, lean, boxLayout, k);
      if (trace !== undefined) trace.frontFlakes = frontSteps.length;
      sizeTo(snowFronts.canvas, bw * k, bh * k);
      snowContext.clearRect(0, 0, bw * k, bh * k);
      paintSnow(snowContext, frontSteps, boxLayout, k, trace);
      place(snowFronts.canvas, x0, y0, bw * css, bh * css);
      if (trace !== undefined) at = lapInto(trace, 'frontMs', at);

      // The base over everything, at the screen's pixel size: worked out again only when the turn or the scale changes.
      const baseW = BASE_WIDTH * k;
      const baseH = BASE_ROWS * k;
      const resized = baseLayer.canvas.width !== baseW || baseLayer.canvas.height !== baseH;
      sizeTo(baseLayer.canvas, baseW, baseH);
      if (resized || baseKept === null || baseKept.turn !== turn || baseKept.k !== k) {
        baseColours = colourBuffer(baseColours, baseW * baseH);
        baseColours.fill(NO_FRONT);
        renderBase(baseColours, baseW, 0, 0, k, turn);
        basePixels = pixelsFor(baseContext, baseW, baseH, basePixels);
        wordsFrom(baseColours, basePixels.words, baseW, { left: 0, top: 0, right: baseW, bottom: baseH });
        baseContext.putImageData(basePixels.image, 0, 0);
        baseKept = { turn, k };
        if (trace !== undefined) trace.baseBuilt = true;
      }
      place(baseLayer.canvas, left + (cx - BASE_WIDTH / 2) * css, (layout.groundTop - BASE_SINK) * css, BASE_WIDTH * css, BASE_ROWS * css);
      if (trace !== undefined) {
        lapInto(trace, 'baseMs', at);
        trace.width = bw * k;
        trace.height = bh * k;
        trace.baseWidth = baseW;
        trace.baseHeight = baseH;
        trace.totalMs = performance.now() - begun;
      }
      return true;
    },
  };
}
