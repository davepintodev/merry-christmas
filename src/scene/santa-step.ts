// XMAS-83 part A: Santa as one sprite draw step of the shapes' draw list, painted
// at any whole zoom. His drawing is placed on the picture's own pixel grid, so
// every picture pixel is one whole block of the sprite, never a blend, and at
// zoom 1 the picture is the one drawSanta paints.
import { masterColours } from '../../art/colours.ts';
import type { Drawing } from '../shared/art.generated.ts';
import type { SceneLayout } from './frame.ts';
import type { SantaDraw } from './shape-draw-list.ts';

/** The colour number a drawing's pixel n stands for (1 to 16, the master list); 0 is transparent and never reaches here. */
function colourOf(n: number): number {
  return Number.parseInt((masterColours[n - 1] ?? '#000000').slice(1), 16);
}

/**
 * The drawing's colour number that picture column `column` of `span` takes from
 * `row`, or 0 when its box holds no opaque pixel. The box is the source columns
 * the picture column covers (at least one). The opaque pixel nearest the box's
 * centre wins, a tie going to the left in the sprite's own columns. Mirror
 * flips the source columns first.
 */
function boxPixel(sprite: Drawing, row: number, span: number, column: number, mirrored: boolean): number {
  const width = sprite.width;
  const from = Math.floor((column * width) / span);
  const to = Math.max(from + 1, Math.floor(((column + 1) * width) / span));
  // Doubled and scaled by span, so the distances are whole numbers and a tie is exact.
  const centre = (2 * column + 1) * width;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAt = Number.POSITIVE_INFINITY;
  for (let c = from; c < Math.min(to, width); c++) {
    const at = mirrored ? width - 1 - c : c;
    const n = sprite.pixels[row * width + at] ?? 0;
    if (n === 0) continue;
    const distance = Math.abs((2 * c + 1) * span - centre);
    if (distance < bestDistance || (distance === bestDistance && at < bestAt)) {
      best = n;
      bestDistance = distance;
      bestAt = at;
    }
  }
  return best;
}

/**
 * Paints Santa's step into picture, which is `side` picture pixels across with
 * `zoom` of them to each art pixel, over what is there. The sprite's centre
 * is rounded to the picture grid, and its width is squeezed to at least one
 * picture pixel. Each picture pixel takes the opaque sprite pixel nearest the
 * centre of the source box it covers (rows are never scaled), so a thin
 * squeeze keeps every opaque part of him; a box with none leaves the picture
 * as it is. Colour 0 is transparent; the glass clips him.
 */
export function paintSantaStep(picture: Uint32Array, side: number, layout: SceneLayout, step: SantaDraw, zoom: number): void {
  const { sprite, mirrored } = step;
  const { cx, cy, radius } = layout.globe;
  const span = Math.max(1, Math.round(sprite.width * step.squeeze * zoom));
  const rows = sprite.height * zoom;
  const left = Math.round((cx + step.x) * zoom - span / 2);
  const top = Math.round((cy + step.y) * zoom - rows / 2);
  for (let py = Math.max(0, top); py < Math.min(layout.height * zoom, top + rows); py++) {
    const dy = (py + 0.5) / zoom - cy;
    const row = Math.floor((py - top + 0.5) / zoom);
    for (let px = Math.max(0, left); px < Math.min(side, left + span); px++) {
      const dx = (px + 0.5) / zoom - cx;
      if (dx * dx + dy * dy > radius * radius) continue;
      const n = boxPixel(sprite, row, span, px - left, mirrored);
      if (n === 0) continue;
      picture[py * side + px] = colourOf(n);
    }
  }
}
