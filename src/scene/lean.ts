// XMAS-41b1 "Drag model, scene side": the globe leans. The glass and all inside
// it shear sideways about the ground line, rows higher moving more, while the
// base, the ground, the sky and the stars stay put. The grid never moves: each
// row of the glass is redrawn from the glass's own pixels, rounded to whole art
// pixels, over the backdrop the glass was painted on.
import type { SceneLayout } from './frame.ts';

/** The largest lean in radians (either way); the top of the glass moves no more than half its height above the ground line. */
export const MAX_LEAN = 0.5;

/** The rows and columns one lean can move: the globe's box, widened by the largest shear. */
export interface LeanBox {
  left: number;
  right: number;
  top: number;
  /** First row under the glass's shear: the ground line. */
  bottom: number;
}

/** The backdrop and glass copies are kept between frames, so a frame does not allocate them again. */
let backdrop: Uint32Array<ArrayBuffer> = new Uint32Array(0);
let glass: Uint32Array<ArrayBuffer> = new Uint32Array(0);
/** The layout and width keepBackdrop last kept the backdrop for; leanGlass takes them and throws without a match. */
let keptLayout: SceneLayout | undefined;
let keptWidth = 0;

/** The box the glass and all in it can reach at any lean in ±MAX_LEAN, for a picture `width` art pixels across. */
export function leanBox(width: number, layout: SceneLayout): LeanBox {
  const { cx, cy, radius } = layout.globe;
  const top = Math.max(0, Math.floor(cy - radius));
  const bottom = layout.groundTop;
  const reach = Math.ceil(MAX_LEAN * (bottom - top)) + 1;
  return {
    left: Math.max(0, Math.floor(cx - radius) - reach),
    right: Math.min(width - 1, Math.ceil(cx + radius) + reach),
    top,
    bottom,
  };
}

/** How far a point at the height `centre` (art pixels down the picture) moves under `lean`, in whole art pixels: the lean times its height above the ground line `bottom`, rounded. */
export function shiftAt(lean: number, bottom: number, centre: number): number {
  return Math.round(lean * (bottom - centre));
}

/** How far row y moves under `lean`, in whole art pixels: the shift at the row's middle. */
export function rowShift(lean: number, bottom: number, y: number): number {
  return shiftAt(lean, bottom, y + 0.5);
}

/** `buffer` when it holds `size` colour numbers, else a new one. */
function holding(buffer: Uint32Array<ArrayBuffer>, size: number): Uint32Array<ArrayBuffer> {
  return buffer.length >= size ? buffer : new Uint32Array(size);
}

/** Copies the box's rows of the picture into `into`, box width a row. */
function copyBox(picture: Uint32Array, width: number, box: LeanBox, into: Uint32Array): void {
  const boxWidth = box.right - box.left + 1;
  for (let y = box.top; y < box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) into[(y - box.top) * boxWidth + x - box.left] = picture[y * width + x] ?? 0;
  }
}

/** Keeps what lies under the glass, so a leaning glass can show it where the glass has left. Call before the glass is painted; leanGlass needs it for the same layout and width. `under`, when given, is kept instead of the picture: the same picture with the backdrop also painted where the glass stands (XMAS-70), which the painted glass never shows. */
export function keepBackdrop(picture: Uint32Array, width: number, layout: SceneLayout, under: Uint32Array = picture): void {
  const box = leanBox(width, layout);
  backdrop = holding(backdrop, (box.right - box.left + 1) * (box.bottom - box.top));
  copyBox(under, width, box, backdrop);
  keptLayout = layout;
  keptWidth = width;
}

/**
 * Shears the glass and all in it by `lean` (radians, + toward +x), each row by
 * the lean times its height above the ground line, rounded to whole art pixels.
 * A row's glass is the globe's circle at its unsheared place, as paintGlass
 * paints it, plus anything a glass layer drew beyond that edge; where the glass
 * has left, the backdrop kept by keepBackdrop shows. Rows from the ground line
 * down are not touched. Call after the glass is painted, with the same layout.
 * Throws when keepBackdrop was not called last for this layout and width.
 */
export function leanGlass(picture: Uint32Array, width: number, layout: SceneLayout, lean: number): void {
  if (keptLayout !== layout || keptWidth !== width) {
    throw new Error('leanGlass needs keepBackdrop for the same layout and width first');
  }
  keptLayout = undefined;
  const box = leanBox(width, layout);
  const boxWidth = box.right - box.left + 1;
  glass = holding(glass, boxWidth * (box.bottom - box.top));
  copyBox(picture, width, box, glass);
  const { cx, cy, radius } = layout.globe;
  // paintGlass paints pixel centres up to half a pixel inside the radius.
  const inner = radius - 0.5;
  for (let y = box.top; y < box.bottom; y++) {
    const shift = rowShift(lean, box.bottom, y);
    // The painted circle's half width on this row, measured on pixel centres; a row it does not reach has none.
    const dy = y + 0.5 - cy;
    const half = Math.abs(dy) < inner ? Math.sqrt(inner * inner - dy * dy) : -1;
    const row = (y - box.top) * boxWidth;
    for (let x = box.left; x <= box.right; x++) {
      const from = x - shift;
      const source = row + from - box.left;
      // A source pixel is glass when it lies in the painted circle, or when a glass layer drew it outside that
      // circle; an outside snowflake in the rim, which the glass never painted, stays where it is.
      const inGlass =
        from >= box.left && from <= box.right && (Math.abs(from + 0.5 - cx) <= half || glass[source] !== backdrop[source]);
      picture[y * width + x] = inGlass ? (glass[source] ?? 0) : (backdrop[row + x - box.left] ?? 0);
    }
  }
}
