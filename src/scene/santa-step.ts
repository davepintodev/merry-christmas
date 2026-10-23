// XMAS-83 part A: Santa as one sprite draw step of the shapes' draw list, painted
// at any whole zoom. His drawing is placed on the picture's own pixel grid, so
// every picture pixel is one whole block of the sprite, never a blend, and at
// zoom 1 the picture is the one drawSanta paints.
import { masterColours } from '../../art/colours.ts';
import type { Drawing } from '../shared/art.generated.ts';
import type { SceneLayout } from './frame.ts';
import type { SantaDraw } from './shape-draw-list.ts';

/** The picture colour of each master colour, at index n - 1 for colour number n; a number past the list is black. */
const COLOUR_TABLE: readonly number[] = masterColours.map((c) => Number.parseInt(c.slice(1), 16));

/** The colour number a drawing's pixel n stands for (the master list); 0 is transparent and never reaches here. */
function colourOf(n: number): number {
  return COLOUR_TABLE[n - 1] ?? 0;
}

/** Colour blocks kept per sprite: a squeezed step has its own span, so a few are live at once. */
const BLOCKS_KEPT = 4;

/** The colour blocks, by sprite and then by (mirror, span, zoom). */
const blocks = new WeakMap<Drawing, Map<string, Uint8Array>>();

let blockBuilds = 0;

/** How many colour blocks have been built since module load; the tests read the deltas. */
export function santaBlockBuilds(): number {
  return blockBuilds;
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
 * The colour numbers of a block `span` columns wide and `rows` picture rows deep:
 * picture row r takes the drawing's row floor((r + 0.5) / zoom), as boxPixel reads
 * it, so painting reads the block instead of the sprite. Built once per (sprite,
 * mirror, span, zoom) and kept, so a repeat step builds none and a squeeze that
 * changes evicts the oldest.
 */
function santaBlock(sprite: Drawing, mirrored: boolean, span: number, zoom: number, rows: number): Uint8Array {
  let byKey = blocks.get(sprite);
  if (byKey === undefined) {
    byKey = new Map();
    blocks.set(sprite, byKey);
  }
  const key = `${mirrored}:${span}:${zoom}`;
  const kept = byKey.get(key);
  if (kept !== undefined) return kept;
  const count = Math.ceil(rows);
  const block = new Uint8Array(span * count);
  for (let r = 0; r < count; r++) {
    const row = Math.floor((r + 0.5) / zoom);
    for (let column = 0; column < span; column++) block[r * span + column] = boxPixel(sprite, row, span, column, mirrored);
  }
  blockBuilds += 1;
  if (byKey.size >= BLOCKS_KEPT) {
    const [oldest] = byKey.keys();
    byKey.delete(oldest);
  }
  byKey.set(key, block);
  return block;
}

/**
 * Where Santa's step lands on a picture `zoom` picture pixels to each art pixel: his
 * picture pixels from (left, top), `span` of them across and `rows` down. The centre
 * is rounded to the picture grid, and the width is squeezed to at least one picture pixel.
 */
export function santaBox(layout: SceneLayout, step: SantaDraw, zoom: number): { left: number; top: number; span: number; rows: number } {
  const { sprite } = step;
  const { cx, cy } = layout.globe;
  const span = Math.max(1, Math.round(sprite.width * step.squeeze * zoom));
  const rows = sprite.height * zoom;
  return { left: Math.round((cx + step.x) * zoom - span / 2), top: Math.round((cy + step.y) * zoom - rows / 2), span, rows };
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
  const { left, top, span, rows } = santaBox(layout, step, zoom);
  const block = santaBlock(sprite, mirrored, span, zoom, rows);
  for (let py = Math.max(0, top); py < Math.min(layout.height * zoom, top + rows); py++) {
    const dy = (py + 0.5) / zoom - cy;
    const blockRow = py - top;
    for (let px = Math.max(0, left); px < Math.min(side, left + span); px++) {
      const dx = (px + 0.5) / zoom - cx;
      if (dx * dx + dy * dy > radius * radius) continue;
      const n = block[blockRow * span + (px - left)];
      if (n === 0) continue;
      picture[py * side + px] = colourOf(n);
    }
  }
}
