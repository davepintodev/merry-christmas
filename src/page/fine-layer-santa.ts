// XMAS-83 part B: Santa's step painted onto the fine layer's shapes canvas at
// device pixels. His pixels are whole blocks on the screen's grid, copied over
// the faces drawn before him, and the clear ones pass what is under them.
import type { SceneLayout } from '../scene/frame.ts';
import { NO_FRONT } from '../scene/globe.ts';
import { paintSantaStep, santaBox } from '../scene/santa-step.ts';
import type { SantaDraw } from '../scene/shape-draw-list.ts';
import { opaqueWord, restoreCanvas, saveCanvas, setShear, type Pixels, type Shear } from './fine-layer-pixels.ts';
import type { FineTrace } from './frame-trace.ts';

/** Santa's step painted at device pixels: his picture is the layer's box, and his colours are copied onto a context whole. */
export interface SantaSprite {
  /** The scratch layer his pixels are put on, before they are copied onto the context they go over. */
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  /** Colour numbers as paintSantaStep writes them, NO_FRONT where he is not. */
  colours: Uint32Array;
  pixels: Pixels;
  /** The box's own layout: the globe's centre moved to the box's top left corner. */
  layout: SceneLayout;
  /** The picture's width in device pixels, and device pixels to each art pixel. */
  side: number;
  zoom: number;
}

/** The box a sprite's last paint covered, keyed by the words it wrote (XMAS-107). Only a traced paint keeps it; an untraced one forgets it. */
const lastPaint = new WeakMap<Uint32Array, { left: number; top: number; right: number; bottom: number }>();

/**
 * Paints Santa's step over `ctx` under `shear` (XMAS-90), where the step's own pixels are whole device blocks:
 * they are drawn by paintSantaStep into the scratch layer and copied on top, clear pixels passing through what
 * is under them. Only his box (santaBox, held to the layer) is cleared, read and copied: he is drawn nowhere
 * else, so the rest is not touched. Smoothing is off, so each device pixel takes the colour under its centre.
 * Returns the drawImage calls made on ctx (XMAS-102): 1, or 0 when his box holds nothing. With `trace` it adds
 * the time spent, the paint and whether it repeats the last one exactly (XMAS-107); without it nothing extra is done.
 */
export function paintSantaOver(ctx: CanvasRenderingContext2D, step: SantaDraw, sprite: SantaSprite, shear: Shear, trace?: FineTrace): number {
  const at = trace === undefined ? 0 : performance.now();
  const calls = paintSanta(ctx, step, sprite, shear, trace);
  if (trace !== undefined) trace.santaMs += performance.now() - at;
  return calls;
}

function paintSanta(ctx: CanvasRenderingContext2D, step: SantaDraw, sprite: SantaSprite, shear: Shear, trace?: FineTrace): number {
  const { canvas, context, colours, pixels, layout, side, zoom } = sprite;
  const box = santaBox(layout, step, zoom);
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  const right = Math.min(side, box.left + box.span);
  const bottom = Math.min(canvas.height, box.top + box.rows);
  if (right <= left || bottom <= top) return 0;
  for (let y = top; y < bottom; y++) colours.fill(NO_FRONT, y * side + left, y * side + right);
  paintSantaStep(colours, side, layout, step, zoom);
  const words = pixels.words;
  // A traced paint checks each word against the one it overwrites, so the box must be the last paint's and every word the same.
  // The words are unsigned, so the new word is compared as unsigned (opaqueWord's value is signed). Untraced, nothing is looked up or read.
  const last = trace === undefined ? undefined : lastPaint.get(words);
  let repeat = last !== undefined && last.left === left && last.top === top && last.right === right && last.bottom === bottom;
  for (let y = top; y < bottom; y++) {
    for (let i = y * side + left; i < y * side + right; i++) {
      const colour = colours[i] ?? NO_FRONT;
      const word = colour === NO_FRONT ? 0 : opaqueWord(colour);
      if (repeat && words[i] !== word >>> 0) repeat = false;
      words[i] = word;
    }
  }
  if (trace === undefined) {
    lastPaint.delete(words);
  } else {
    lastPaint.set(words, { left, top, right, bottom });
    trace.santaPaints += 1;
    if (repeat) trace.santaSame += 1;
  }
  context.putImageData(pixels.image, 0, 0, left, top, right - left, bottom - top);
  const tally = trace?.canvas;
  saveCanvas(ctx, tally);
  setShear(ctx, shear, undefined, tally);
  const copyAt = tally === undefined ? 0 : performance.now();
  ctx.drawImage(canvas, left, top, right - left, bottom - top, left, top, right - left, bottom - top);
  if (tally !== undefined) {
    tally.drawImages += 1;
    tally.drawImageMs += performance.now() - copyAt;
  }
  restoreCanvas(ctx, tally);
  return 1;
}
