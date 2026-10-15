// XMAS-83 part B: Santa's step painted onto the fine layer's shapes canvas at
// device pixels. His pixels are whole blocks on the screen's grid, copied over
// the faces drawn before him, and the clear ones pass what is under them.
import type { SceneLayout } from '../scene/frame.ts';
import { NO_FRONT } from '../scene/globe.ts';
import { paintSantaStep } from '../scene/santa-step.ts';
import type { SantaDraw } from '../scene/shape-draw-list.ts';
import { opaqueWord, type Pixels } from './fine-layer-pixels.ts';

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

/**
 * Paints Santa's step over `ctx` under the identity transform, where the step's own pixels
 * are whole device blocks: they are drawn by paintSantaStep into the scratch layer and copied
 * on top, clear pixels passing through what is under them.
 */
export function paintSantaOver(ctx: CanvasRenderingContext2D, step: SantaDraw, sprite: SantaSprite): void {
  const { canvas, context, colours, pixels, layout, side, zoom } = sprite;
  colours.fill(NO_FRONT);
  paintSantaStep(colours, side, layout, step, zoom);
  const words = pixels.words;
  for (let i = 0; i < colours.length; i++) {
    const colour = colours[i] ?? NO_FRONT;
    words[i] = colour === NO_FRONT ? 0 : opaqueWord(colour);
  }
  context.putImageData(pixels.image, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();
}
