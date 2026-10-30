// XMAS-125 "Shake button covers the base lettering": the shake button's picture is a small wooden sign standing in the
// snow. On a picture taller than wide (the phone) it stands under the base, right of the sound and pause buttons, on two
// stakes where the snow strip is deep enough and on the snow where it is not, with the scene's bunny sitting at its
// right end looking at it; on a wide picture it stands on stakes midway between the base and the right edge. Its place
// is worked out here in art pixels, from the layout alone, so the page's button and the scene's bunny agree on it.
// Its colours are master colours per phase, mixed through a phase blend as the backdrop mixes its own.
import { mixHex } from '../countdown/colours.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { glyph, glyphWidth, GLYPH_HEIGHT } from '../shared/font.ts';
import type { Rect, SceneLayout } from './frame.ts';
import type { BunnySpot } from './scenery.ts';

/** The sign's words: the button's screen reader name, and the text on its board. */
export const SHAKE_TEXT = 'TAP TO SHAKE';

/** The base's rows under groundTop (frame.ts BASE_BELOW): its bottom edge is the first row under it. */
const BASE_BELOW = 23;
/** Half the base drawing's width (112). */
const BASE_HALF = 56;
/** Clear columns between the board's lit edge and the words, on each side. */
const PAD = 3;
/** The font's one-column gap after each glyph. */
const GLYPH_GAP = 1;
const TEXT_WIDTH = [...SHAKE_TEXT].reduce((sum, char) => sum + glyphWidth(char) + GLYPH_GAP, -GLYPH_GAP);
/** The board: an outline, a lit row and column, the words with PAD each side, a shaded row and column. */
export const BOARD = { width: TEXT_WIDTH + 2 * PAD + 2, height: GLYPH_HEIGHT + 4 } as const;
/** The bunny facing left is 14 columns wide; its left column is the board's right outline, its nose behind the board. */
const BUNNY_WIDTH = 14;
const BUNNY_TALL = 13;
const BUNNY_SHORT = 11;
/** Art pixels kept clear right of the buttons, at the picture's right edge, and under the sign's foot. */
const GAP = 3;
/** The stakes on a wide picture, in rows between the board and the foot. */
const WIDE_STAKE = 5;

/** Where the sign goes, in art pixels of the scene picture. */
export interface SignPlace {
  /** The sign's picture: the board, its snow, its stakes and drifts. On the phone its top is the base's bottom edge. */
  box: Rect;
  /** The board's top left corner. */
  board: { x: number; y: number };
  /** The stakes' last row, or null where the board sits on the snow. */
  foot: number | null;
  /** Where the scene's bunny sits at the sign's end (the phone), or null: it stays home. */
  bunny: BunnySpot | null;
}

/**
 * The sign's place on a picture of `layout`, with the sound and pause buttons covering art columns up to
 * `buttonsRight` (exclusive) at the bottom left. Nothing of it, nor the bunny, rises above the base's bottom edge on
 * the phone; on a wide picture it stands clear of the base to its right.
 */
export function signPlace(layout: SceneLayout, buttonsRight: number): SignPlace {
  const { width, height, globe, groundTop } = layout;
  const baseBottom = groundTop + BASE_BELOW;
  if (height > width) {
    const group = BOARD.width + BUNNY_WIDTH - 1;
    const lo = buttonsRight + GAP;
    const x = Math.max(lo, lo + Math.floor((width - GAP - lo - group) / 2));
    const bottom = height - GAP;
    const room = bottom - baseBottom + 1;
    const stake = room >= BOARD.height + 6 ? Math.min(4, room - BOARD.height - 2) : 0;
    // The board's snow cap rises one row over it: that row stays at or under the base's edge.
    const y = Math.max(baseBottom + 1, bottom - stake - BOARD.height + 1);
    const tall = room >= BUNNY_TALL;
    const bunnyBottom = tall ? bottom : Math.max(bottom, baseBottom + BUNNY_SHORT - 1);
    return {
      box: { x, y: baseBottom, width: BOARD.width, height: height - baseBottom },
      board: { x, y },
      foot: stake > 0 ? bottom : null,
      bunny: { x: x + BOARD.width - 1, bottom: bunnyBottom, short: !tall },
    };
  }
  const baseRight = globe.cx + BASE_HALF;
  const x = Math.min(Math.round((baseRight + width) / 2) - Math.floor(BOARD.width / 2), width - 1 - GAP - BOARD.width);
  const foot = baseBottom - 2;
  const y = foot - WIDE_STAKE - BOARD.height + 1;
  return { box: { x, y: y - 1, width: BOARD.width, height: foot + 2 - (y - 1) }, board: { x, y }, foot, bunny: null };
}

/** The sign's colours. */
export interface SignInks {
  outline: string;
  board: string;
  lit: string;
  shade: string;
  text: string;
  snow: string;
  ground: string;
}

/** Each phase's master colours: wood toned like the backdrop's logs, its snow and floor shade, warm words. */
const INKS: Record<PhaseName, SignInks> = {
  dawn: { outline: '#2a1a4a', board: '#8a5a58', lit: '#a87462', shade: '#6a3c48', text: '#fff3b0', snow: '#fff0f6', ground: '#f0cfe0' },
  'frosty-morning': { outline: '#380d2a', board: '#9a6448', lit: '#b8805a', shade: '#74463a', text: '#fff3b0', snow: '#ffffff', ground: '#c9e4f9' },
  sunset: { outline: '#2a1638', board: '#7a3a4c', lit: '#9a5060', shade: '#5a2840', text: '#fff3b0', snow: '#ffd9c8', ground: '#f4cfe0' },
  'purple-night': { outline: '#0b1026', board: '#5a4060', lit: '#74567a', shade: '#40304c', text: '#ffe08a', snow: '#c4d8f0', ground: '#c3cef2' },
};

/** The sign's colours in a phase reading: each mixed from the one phase to the next by the blend's share (mixHex, as the backdrop). */
export function signInks(reading: PhaseReading): SignInks {
  const a = INKS[reading.from];
  const b = INKS[reading.to];
  const mix = (key: keyof SignInks): string => (reading.share <= 0 || reading.from === reading.to ? a[key] : mixHex(a[key], b[key], reading.share));
  return { outline: mix('outline'), board: mix('board'), lit: mix('lit'), shade: mix('shade'), text: mix('text'), snow: mix('snow'), ground: mix('ground') };
}

/** The sign's picture: one colour per art pixel of `place.box`, row by row; '' is clear. */
export interface SignPicture {
  width: number;
  height: number;
  colours: string[];
}

/** Draws the sign of `place` in `inks`: the board with its snow and words, and its stakes in little drifts or its shadow on the snow. */
export function signPicture(place: SignPlace, ink: SignInks): SignPicture {
  const { box, board: at, foot } = place;
  const colours = new Array<string>(box.width * box.height).fill('');
  const put = (x: number, y: number, colour: string): void => {
    const dx = x - box.x;
    const dy = y - box.y;
    if (dx >= 0 && dx < box.width && dy >= 0 && dy < box.height) colours[dy * box.width + dx] = colour;
  };
  const { width: w, height: h } = BOARD;
  if (foot === null) {
    for (let dx = 2; dx < w - 1; dx++) put(at.x + dx, at.y + h, ink.ground);
  } else {
    for (const sx of [at.x + 6, at.x + w - 9]) {
      for (let y = at.y + h; y <= foot; y++) {
        put(sx, y, ink.outline);
        put(sx + 1, y, ink.shade);
        put(sx + 2, y, ink.outline);
      }
      for (let dx = -2; dx <= 4; dx++) put(sx + dx, foot + 1, ink.ground);
      put(sx - 1, foot, ink.snow);
      put(sx + 3, foot, ink.snow);
    }
  }
  // The board: lit top and left, shaded bottom and right, one dark outline with its corners cut.
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const rim = dy === 0 || dy === h - 1;
      const side = dx === 0 || dx === w - 1;
      if (rim && side) continue;
      let colour = ink.board;
      if (rim || side) colour = ink.outline;
      else if (dy === 1 || dx === 1) colour = ink.lit;
      else if (dy === h - 2 || dx === w - 2) colour = ink.shade;
      put(at.x + dx, at.y + dy, colour);
    }
  }
  // Snow lying along the top, two lumps over it, and a nail at each end.
  for (let dx = 1; dx < w - 1; dx++) put(at.x + dx, at.y + 1, ink.snow);
  for (const [a, b] of [[4, 9], [w - 14, w - 6]] as const) {
    for (let dx = a; dx <= b; dx++) {
      put(at.x + dx, at.y, ink.snow);
      put(at.x + dx, at.y - 1, ink.outline);
    }
    put(at.x + a - 1, at.y, ink.outline);
    put(at.x + b + 1, at.y, ink.outline);
  }
  for (const nx of [at.x + 2, at.x + w - 3]) {
    put(nx, at.y + 3, ink.outline);
    put(nx, at.y + 6, ink.outline);
  }
  let tx = at.x + 1 + PAD;
  for (const char of SHAKE_TEXT) {
    const stroke = glyph(char);
    stroke?.pixels.forEach((n, i) => {
      if (n !== 0) put(tx + (i % stroke.width), at.y + 2 + Math.floor(i / stroke.width), ink.text);
    });
    tx += glyphWidth(char) + GLYPH_GAP;
  }
  return { width: box.width, height: box.height, colours };
}
