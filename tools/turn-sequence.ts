// XMAS-85 "Fine layer: reference pictures and the owner's turn review": a whole
// turn of the globe for the owner to look at. The purple-night snow-calm
// reference input is drawn through tools/fine-frames.ts at each 5 degree step,
// and written to a folder as numbered PNGs, a contact sheet of them (scaled
// down by a whole factor, nearest neighbour, to at most MAX_SHEET_WIDTH pixels
// across) and an index listing the frames in order with their turn in degrees.
// Usage: node tools/turn-sequence.ts <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fineFrame, type FineRgba } from './fine-frames.ts';
import { referenceFrames } from './frames.ts';
import { encodePng } from './png.ts';

const STEP_DEGREES = 5;
/** The contact sheet's frames across; the rows follow from the frame count. */
const COLUMNS = 9;
/** The contact sheet is never wider than this many pixels. */
const MAX_SHEET_WIDTH = 4000;
/** The white space between the sheet's frames, in sheet pixels. */
const GUTTER = 4;

/** The smallest whole factor that keeps `columns` frames of `width` pixels, with their gutters, within MAX_SHEET_WIDTH. */
function sheetScale(width: number, columns: number): number {
  let scale = 1;
  while ((columns * width) / scale + (columns - 1) * GUTTER > MAX_SHEET_WIDTH) scale++;
  return scale;
}

/** The frames as one sheet, each scaled down by the same whole factor, nearest neighbour, in rows of COLUMNS. */
function contactSheet(frames: readonly FineRgba[]): FineRgba {
  const first = frames[0];
  if (first === undefined) throw new RangeError('a contact sheet needs at least one frame');
  const columns = Math.min(COLUMNS, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const scale = sheetScale(first.width, columns);
  const cellWidth = Math.floor(first.width / scale);
  const cellHeight = Math.floor(first.height / scale);
  const width = columns * cellWidth + (columns - 1) * GUTTER;
  const height = rows * cellHeight + (rows - 1) * GUTTER;
  // Opaque white, so the gutters show between the frames.
  const rgba = new Uint8Array(width * height * 4).fill(0xff);
  frames.forEach((frame, n) => {
    const left = (n % columns) * (cellWidth + GUTTER);
    const top = Math.floor(n / columns) * (cellHeight + GUTTER);
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        const from = (y * scale * frame.width + x * scale) * 4;
        rgba.set(frame.rgba.subarray(from, from + 4), ((top + y) * width + left + x) * 4);
      }
    }
  });
  return { width, height, rgba };
}

const dir = process.argv[2];
if (dir === undefined) {
  console.error('usage: node tools/turn-sequence.ts <dir>');
  process.exit(1);
}
const calm = referenceFrames.find((ref) => ref.name === 'snow-calm');
if (calm === undefined) throw new Error('no snow-calm reference to turn');

mkdirSync(dir, { recursive: true });
const frames: FineRgba[] = [];
const index: string[] = [];
for (let n = 0; n < 360 / STEP_DEGREES; n++) {
  const degrees = n * STEP_DEGREES;
  const frame = fineFrame({ ...calm.input, turn: (degrees * Math.PI) / 180 });
  const name = `frame-${String(n).padStart(2, '0')}.png`;
  writeFileSync(path.join(dir, name), encodePng(frame.width, frame.height, frame.rgba));
  frames.push(frame);
  index.push(`${name} ${degrees}`);
}
const sheet = contactSheet(frames);
writeFileSync(path.join(dir, 'contact-sheet.png'), encodePng(sheet.width, sheet.height, sheet.rgba));
writeFileSync(path.join(dir, 'index.txt'), `${index.join('\n')}\n`);
console.log(`${frames.length} frames, contact-sheet.png and index.txt in ${dir}`);
