// XMAS-28: the single object list. Every drawing on every sheet is named,
// placed and sized here; the build cuts each one out at exactly this size, so
// a sheet redrawn at the wrong size stops the build. Sizes are in art pixels.
export interface ArtObject {
  name: string;
  sheet: 'house' | 'santa' | 'props' | 'base' | 'buttons';
  width: number;
  height: number;
}

export const objects: readonly ArtObject[] = [
  { name: 'house-wall-front', sheet: 'house', width: 28, height: 15 },
  { name: 'house-wall-back', sheet: 'house', width: 28, height: 15 },
  { name: 'house-wall-left', sheet: 'house', width: 18, height: 15 },
  { name: 'house-wall-right', sheet: 'house', width: 18, height: 15 },
  { name: 'house-roof-front', sheet: 'house', width: 30, height: 14 },
  { name: 'house-roof-back', sheet: 'house', width: 30, height: 14 },
  { name: 'house-chimney', sheet: 'house', width: 5, height: 8 },
  { name: 'santa-trot-1', sheet: 'santa', width: 48, height: 12 },
  { name: 'santa-trot-2', sheet: 'santa', width: 48, height: 12 },
  { name: 'pine-1', sheet: 'props', width: 17, height: 30 },
  { name: 'pine-2', sheet: 'props', width: 15, height: 25 },
  { name: 'pine-3', sheet: 'props', width: 13, height: 21 },
  { name: 'snowman-body', sheet: 'props', width: 10, height: 18 },
  { name: 'snowman-face', sheet: 'props', width: 3, height: 3 },
  { name: 'snowman-arms', sheet: 'props', width: 16, height: 5 },
  { name: 'snowman-scarf', sheet: 'props', width: 8, height: 3 },
  { name: 'snowman-buttons', sheet: 'props', width: 1, height: 5 },
  { name: 'lamp-post', sheet: 'props', width: 5, height: 24 },
  { name: 'present-1-top', sheet: 'props', width: 7, height: 7 },
  { name: 'present-1-side', sheet: 'props', width: 7, height: 7 },
  { name: 'present-2-top', sheet: 'props', width: 6, height: 6 },
  { name: 'present-2-side', sheet: 'props', width: 6, height: 6 },
  { name: 'present-3-top', sheet: 'props', width: 5, height: 5 },
  { name: 'present-3-side', sheet: 'props', width: 5, height: 5 },
  { name: 'present-4-top', sheet: 'props', width: 7, height: 7 },
  { name: 'present-4-side', sheet: 'props', width: 7, height: 7 },
  { name: 'disc', sheet: 'props', width: 21, height: 21 },
  { name: 'base', sheet: 'base', width: 112, height: 28 },
  { name: 'speaker-muted', sheet: 'buttons', width: 20, height: 10 },
  { name: 'speaker-on', sheet: 'buttons', width: 20, height: 10 },
  { name: 'pause-bars', sheet: 'buttons', width: 20, height: 10 },
  { name: 'pause-triangle', sheet: 'buttons', width: 20, height: 10 },
  { name: 'shake-frame', sheet: 'buttons', width: 60, height: 12 },
];

/** The rough-art cap on distinct colours in one drawing, checked by tests/repo/rough-art.test.ts. */
export const maxColoursPerObject: number = 10;
