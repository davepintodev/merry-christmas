// XMAS-108 "The shapes cached below and above Santa": with Santa on and the shapes otherwise unchanged, the shapes are drawn once
// onto two canvases of their own, the shadows and the faces before him below, the faces after him above. Each frame then blits
// the two with him painted between them, so only his sprite is drawn. The key holds every input the shapes' pixels depend on,
// so a half drawn for a key holds what a direct draw with those inputs paints.

/** One layer: its canvas, and its 2d context, which is null where the page gives none. */
export interface Layer {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
}

/** The inputs the shapes are drawn with: two draws with the same ones paint the same pixels (XMAS-108). */
export interface ShapesKey {
  turn: number;
  k: number;
  lean: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
  /** Santa's index in the draw list: the faces before it lie below him, and those after it above. */
  split: number;
}

/** Whether two keys draw the same pixels. */
export function sameKey(a: ShapesKey, b: ShapesKey): boolean {
  return a.turn === b.turn && a.k === b.k && a.lean === b.lean && a.ox === b.ox && a.oy === b.oy && a.width === b.width && a.height === b.height && a.split === b.split;
}

/** The two halves, and the key they were last drawn for: null until the first draw. */
export interface Halves {
  below: Layer;
  above: Layer;
  key: ShapesKey | null;
}

/** The two halves, made off the page, so the page never lays them over anything. */
export function makeHalves(): Halves {
  return { below: layerOffPage(), above: layerOffPage(), key: null };
}

/** Frees both halves' pixels: each canvas goes to no size and the key goes, so the next build sizes and draws them anew. */
export function freeHalves(halves: Halves): void {
  halves.below.canvas.width = 0;
  halves.below.canvas.height = 0;
  halves.above.canvas.width = 0;
  halves.above.canvas.height = 0;
  halves.key = null;
}

function layerOffPage(): Layer {
  const canvas = document.createElement('canvas');
  return { canvas, context: canvas.getContext('2d') };
}
