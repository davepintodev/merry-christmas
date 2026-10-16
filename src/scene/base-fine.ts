// XMAS-68 "Base lettering feel vs prototype": the globe's base drawn on the
// screen's own pixel grid, as the fine layer draws the shapes, so its lettering,
// gems and grooves turn smoothly, sliding by whole device pixels. It is pixel
// art all the same: every pixel is one hard master colour (no blends), the rows
// and the shading lie on the art pixel grid, and the red drum is shaded in
// dithered tone steps. A cylinder lit from the top left: a gold lip with gems
// and a highlight, a red drum with a light stripe, a darker rim, grooves, a
// lower gold trim with studs, the lettering wrapped round it (as it turns away from the front, each letter
// foreshortens by the cylinder's own mapping until it slides behind the edge), and a dark band at the bottom.
import { glyph, glyphWidth, GLYPH_HEIGHT } from '../shared/font.ts';

/** The base's box in art pixels: the Base sheet's size (art/objects.ts), which the picture's layout reserves. */
export const BASE_WIDTH = 112;
export const BASE_ROWS = 28;
/** The drum's radius, in art pixels: half the base's width. */
const RADIUS = BASE_WIDTH / 2;
/** Half the width of the lip's top row; the top widens to the full width over five rows (the prototype's trapezoid). */
const TOP_HALF = 42;
/** The drum's height down its middle; its bottom edge curves down three rows more at the middle than at the sides. */
const DRUM_BOTTOM = 25;
const CURVE = 3;
/** The gold lip's rows, and each row's tone added to the lip's (from the light to the lower edge). */
const LIP_ROWS = 4;
const LIP_SHADE: readonly number[] = [0.6, 0.2, -0.3, -0.9];
/** The lettering: its text, its first row in the base's box, the art pixels one font column covers across, and the art rows each font row covers. */
const LETTERING = 'FAM. PINTO MERRY CHRISTMAS';
const LETTER_Y = 7;
const LETTER_SX = 1.4;
const ROW_START: readonly number[] = [0, 2, 3, 5, 6, 8];
/**
 * Where the text's first letter stands at turn 0, as an angle from the front. The page opens at a turn of 0.5
 * (START_TURN in src/page/scene.ts), where the text then starts at -0.86 and its first line stands on the front;
 * at turn 0 it starts at F and shows the first words.
 */
const TEXT_START = -0.36;
/**
 * The grooves down the lower drum: how many go round it, so the gap between two is the drum's circumference over
 * that count (the pattern then repeats each whole turn), their width, and the first art row they reach.
 */
const GROOVE_COUNT = 59;
const GROOVE_GAP = (2 * Math.PI * RADIUS) / GROOVE_COUNT;
const GROOVE_WIDTH = 1.6;
const GROOVE_Y = 17;
/** The studs on the lower gold trim: how many go round the drum (the gap is the circumference over that), and their width. */
const STUD_COUNT = 39;
const STUD_GAP = (2 * Math.PI * RADIUS) / STUD_COUNT;
const STUD_WIDTH = 2;
/** The gems on the lip: how many round the base, and their width in art pixels. */
const GEM_COUNT = 12;
const GEM_WIDTH = 3;
/** The distance between the crosses that fill the blank of the drum behind the text, in art pixels along the drum. */
const CROSS_GAP = 34;
/** A small gold cross: a font-sized picture, five columns wide and symmetric. */
const CROSS: GlyphPicture = { width: 5, pixels: [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0] };

const colour = (hex: string): number => Number.parseInt(hex.slice(1), 16);
const GOLD_DARK = colour('#c4923a');
const GOLD = colour('#ffe08a');
const GOLD_LIGHT = colour('#fff3b0');
const ENGRAVING = colour('#3a0d2e');
/** The lip's golds from dark to light, the drum's reds from dark to light, and the gems (their light pixel after each colour). */
const LIP: readonly number[] = [GOLD_DARK, GOLD, GOLD_LIGHT];
const DRUM: readonly number[] = ['#3a0d2e', '#5a1f3a', '#7d2a2e', '#a83c3c', '#c24c47'].map(colour);
const GEMS: readonly (readonly [number, number])[] = [
  [colour('#c8102e'), colour('#ff8c7a')],
  [colour('#1f6f5c'), colour('#2c8f6f')],
];
/** The 4x4 ordered dither: thresholds in sixteenths. */
const BAYER: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

interface GlyphPicture {
  width: number;
  pixels: ArrayLike<number>;
}

/** One thing on the drum: its picture and where its first column lies in font columns from the text's start. */
interface Mark {
  picture: GlyphPicture;
  at: number;
}

const GLYPH_GAP = 1;
const FULL_TURN = 2 * Math.PI;

/** The letters in their places, then five crosses across the blank half way round the drum from the text's middle. */
const MARKS: readonly Mark[] = ((): Mark[] => {
  const marks: Mark[] = [];
  let at = 0;
  for (const char of LETTERING) {
    const picture = glyph(char);
    if (picture !== undefined && char !== ' ') marks.push({ picture, at });
    at += glyphWidth(char) + GLYPH_GAP;
  }
  const textEnd = TEXT_START + (at * LETTER_SX) / RADIUS;
  const middle = (textEnd + (TEXT_START + FULL_TURN)) / 2;
  for (let k = -2; k <= 2; k++) marks.push({ picture: CROSS, at: ((middle - TEXT_START) * RADIUS + k * CROSS_GAP) / LETTER_SX - CROSS.width / 2 });
  return marks;
})();

function wrapAngle(a: number): number {
  return a - FULL_TURN * Math.floor((a + Math.PI) / FULL_TURN);
}
const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
const smooth = (lo: number, hi: number, v: number): number => {
  const t = clamp((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
const wrapped = (distance: number, gap: number): number => ((distance % gap) + gap) % gap;

/** What the drum's shape is at one art column, the same at every turn and zoom: its edges, its lip's light and its rim and stud flags. */
interface ArtColumn {
  rim: boolean;
  stud: boolean;
  topRow: number;
  bottom: number;
  lightA: number;
  /** The lip's tone before its row's shade (LIP_SHADE): the light across the lip, less the darkening toward the right. */
  lipTone: number;
}

const ART_COLUMNS: readonly ArtColumn[] = Array.from({ length: BASE_WIDTH }, (_, col) => {
  const ua = (col + 0.5 - RADIUS) / RADIUS;
  const artHalf = Math.abs(col + 0.5 - RADIUS);
  const h = Math.exp(-(((ua + 0.42) / 0.4) ** 2));
  return {
    rim: Math.abs(ua) > 0.94,
    stud: Math.abs(ua) < 0.9,
    topRow: artHalf <= TOP_HALF ? 0 : Math.ceil(((artHalf - TOP_HALF) / (RADIUS - TOP_HALF)) * 5),
    bottom: DRUM_BOTTOM + Math.round(Math.sqrt(1 - ua * ua) * CURVE),
    lightA: -0.507 * ua + 0.862 * Math.sqrt(1 - ua * ua),
    lipTone: 0.9 + 1.5 * h - 1.2 * smooth(0.15, 0.95, ua),
  };
});

/** The angle of each device column across the base at one zoom, as the drum's sine (`u`) and its angle from the front (`phi`). Kept for the last zoom drawn. */
let deviceColumns: { k: number; u: Float64Array; phi: Float64Array } | null = null;
function columnsAt(k: number): { u: Float64Array; phi: Float64Array } {
  if (deviceColumns === null || deviceColumns.k !== k) {
    const n = BASE_WIDTH * k;
    const u = new Float64Array(n);
    const phi = new Float64Array(n);
    for (let xd = 0; xd < n; xd++) {
      u[xd] = ((xd + 0.5) / k - RADIUS) / RADIUS;
      phi[xd] = Math.asin(u[xd] ?? 0);
    }
    deviceColumns = { k, u, phi };
  }
  return deviceColumns;
}

/** A tone value (steps from the darkest) turned into a step number by ordered dither at an art pixel: whole steps, with the in-between values dithered across the middle half of each. */
function step(value: number, col: number, row: number, top: number): number {
  const base = Math.floor(value);
  const frac = value - base;
  const up = frac > 0.75 - (0.5 * (BAYER[row & 3]?.[col & 3] ?? 0)) / 15 ? 1 : 0;
  return clamp(base + up, 0, top);
}

/** A letter or cross on the drum: its picture, and its left and right edges as angles from the front. It shows where those angles are in front, narrowing as the drum turns it away. */
interface Standing {
  picture: GlyphPicture;
  from: number;
  to: number;
}

/** Every letter and cross on the drum at `turn`, with its angles. */
function standing(turn: number): Standing[] {
  return MARKS.map((mark) => {
    const from = wrapAngle(TEXT_START + (mark.at * LETTER_SX) / RADIUS - turn);
    return { picture: mark.picture, from, to: from + (mark.picture.width * LETTER_SX) / RADIUS };
  });
}

/** The first device column whose angle from the front is at least `angle`: the angles rise with the columns, so this is a binary search. */
function firstAtLeast(phi: Float64Array, angle: number): number {
  let lo = 0;
  let hi = phi.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((phi[mid] ?? 0) < angle) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Whether the letter standing over a column lights the font row there (false outside the letter or the font's rows). */
function litAt(mark: Standing | undefined, markColumn: number, fontRow: number): boolean {
  if (mark === undefined || fontRow < 0 || fontRow >= GLYPH_HEIGHT) return false;
  return (mark.picture.pixels[fontRow * mark.picture.width + markColumn] ?? 0) !== 0;
}

/** The font row an art row of the base's box falls in, or -1 outside the lettering. */
const FONT_ROW: readonly number[] = Array.from({ length: BASE_ROWS }, (_, y) => {
  const rel = y - LETTER_Y;
  for (let r = 0; r < GLYPH_HEIGHT; r++) if (rel >= (ROW_START[r] ?? 0) && rel < (ROW_START[r + 1] ?? 0)) return r;
  return -1;
});

/**
 * Draws the base into `picture` (`side` pixels across; k pixels to an art pixel) with its box's top left at
 * pixel (left, top): only the pixels the base covers are written. Same inputs, same pixels.
 */
export function renderBase(picture: Uint32Array, side: number, left: number, top: number, k: number, turn: number): void {
  const marks = standing(turn);
  const columns = BASE_WIDTH * k;
  const gemGap = (FULL_TURN * RADIUS) / GEM_COUNT;
  const device = columnsAt(k);
  // The letter over each device column: the first letter in the list whose angles hold it (the first one wins where two overlap).
  const owner = new Int32Array(columns).fill(-1);
  for (let m = 0; m < marks.length; m++) {
    const s = marks[m]!;
    const end = firstAtLeast(device.phi, s.to);
    for (let xd = firstAtLeast(device.phi, s.from); xd < end; xd++) if (owner[xd] === -1) owner[xd] = m;
  }
  for (let xd = 0; xd < columns; xd++) {
    // The art pixel column this device column lies in: the silhouette and the shading are fixed to the art grid.
    const col = Math.floor(xd / k);
    const art = ART_COLUMNS[col]!;
    const { topRow, bottom, lightA, rim } = art;
    // The turning drum: this device column's angle from the front, how far it lies round the drum, and how foreshortened it is.
    const u = device.u[xd] ?? 0;
    const phi = device.phi[xd] ?? 0;
    const along = (phi + turn) * RADIUS;
    const bar = wrapped(along, GROOVE_GAP) < GROOVE_WIDTH;
    const stud = art.stud && wrapped(along, STUD_GAP) < STUD_WIDTH;
    const gemAt = wrapped(along, gemGap);
    const gemOffset = gemAt > gemGap / 2 ? gemAt - gemGap : gemAt;
    const gem = GEMS[Math.floor((along + gemGap / 2) / gemGap) % 2 === 0 ? 0 : 1] ?? GEMS[0]!;
    const gemHere = Math.abs(gemOffset) < GEM_WIDTH / 2;
    const gemEdge = gemOffset < -0.5;
    // The letter standing over this column, if any.
    const mark: Standing | undefined = owner[xd] === -1 ? undefined : marks[owner[xd]!];
    const markColumn = mark === undefined ? 0 : Math.min(mark.picture.width - 1, Math.max(0, Math.floor(((phi - mark.from) * RADIUS) / LETTER_SX)));
    // The ink goes to the darker gold toward either side, where the drum turns the letters away.
    const ink = Math.abs(u) > 0.72 ? GOLD_DARK : GOLD;
    const trim = bottom - 4;
    for (let row = topRow; row < bottom; row++) {
      let c: number;
      if (row < LIP_ROWS) {
        // The gold lip in dithered tones: bright where it faces the light, darker toward its lower edge and the right.
        const value = art.lipTone + LIP_SHADE[row]!;
        c = LIP[step(value, col, row, 2)] ?? GOLD;
        if (gemHere && row >= 1 && row <= 2) c = row === 1 && gemEdge ? gem[1] : gem[0];
      } else if (row >= bottom - 2) {
        c = DRUM[row === bottom - 1 ? 0 : 1] ?? ENGRAVING;
      } else if (row === 4) {
        c = ENGRAVING;
      } else {
        // The red drum in dithered tone steps: lighter toward the top, shaded under the lip, a darker rim, a light stripe.
        const value = lightA * 5 + 0.45 * (1 - (row - 5) / (bottom - 5)) - (row === 5 ? 0.9 : row === 6 ? 0.4 : 0) - (row === bottom - 3 ? 0.7 : 0);
        let level = step(value, col, row, 4);
        if (rim) level = Math.max(0, level - 1);
        if (bar && row >= GROOVE_Y && row < trim - 1) level = Math.max(0, level - (row === GROOVE_Y || row === trim - 2 ? 1 : 2));
        c = DRUM[level] ?? ENGRAVING;
        if (row === trim) c = GOLD_DARK;
        if (stud && (row === trim - 1 || row === trim)) c = row === trim - 1 ? GOLD_LIGHT : GOLD;
        const fontRow = FONT_ROW[row] ?? -1;
        if (litAt(mark, markColumn, fontRow)) c = ink;
        else if (mark !== undefined && row > LETTER_Y && litAt(mark, markColumn, FONT_ROW[row - 1] ?? -1) && fontRow !== FONT_ROW[row - 1]) c = ENGRAVING;
        else if (mark !== undefined && row === LETTER_Y + (ROW_START[GLYPH_HEIGHT] ?? 0) && litAt(mark, markColumn, GLYPH_HEIGHT - 1)) c = ENGRAVING;
      }
      const at = (top + row * k) * side + left + xd;
      for (let dy = 0; dy < k; dy++) picture[at + dy * side] = c;
    }
  }
}
