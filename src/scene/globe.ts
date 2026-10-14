// XMAS-32a "The globe", slice 1: glass, floor tint, base and sliding lettering.
// The glass (tinted by the phase, with its rim, frost and the window and disc
// reflections that travel round it with the turn), the floor seen through it,
// the Base sheet's drawing under it and the lettering "Fam. Pinto Merry
// Christmas" from the font glyphs, sliding smoothly over the base as the globe
// turns: the whole picture is worked out in code, except the base drawing and
// the font glyphs, which come from their packed sheets. Nothing outside the
// globe, its base and the base's cast shadow changes.
import { masterColours } from '../../art/colours.ts';
import { drawings, type Drawing } from '../shared/art.generated.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { glyph, glyphWidth, GLYPH_HEIGHT } from '../shared/font.ts';
import { blendShade, edgeCoverage } from './blend.ts';
import type { SceneLayout } from './frame.ts';
import { drawSanta, santaPlacement } from './santa.ts';
import { drawShapes } from './shapes-draw.ts';

/** A full turn in radians: the globe's period, negative and whole turns included. */
const FULL_TURN = 2 * Math.PI;
/** How much of the light direction lies across and down the glass: the light comes from the top left. */
const LIGHT_X = 0.4;
const LIGHT_Y = 0.6;
/** The rim's width inwards from the glass's edge, in art pixels. */
const RIM_WIDTH = 2.5;
/** Where the window and the disc reflection ride, as shares of the radius, and their offsets on that circle. */
const WINDOW_ORBIT = 0.62;
const WINDOW_OFFSET = -0.9;
const MIRROR_ORBIT = 0.52;
const MIRROR_OFFSET = 2.5;
/** The window reflection's half-length and half-width along its own axes, in art pixels. */
const WINDOW_LENGTH = 5.6;
const WINDOW_WIDTH = 1.6;
/** The disc reflection's radius in art pixels. */
const MIRROR_RADIUS = 4.2;
/** The cast shadow's reach right of the base and its depth down the ground, in art pixels. */
const SHADOW_REACH = 20;
const SHADOW_DEPTH = 8;
/** How much of the shadow shade the darkest point of the cast shadow reaches. */
const SHADOW_STRENGTH = 0.5;
/** The shade the ground falls to in the cast shadow: the darkest sky colour of the master list. */
const SHADOW_INK = 0x1a1433;
/**
 * How many steps the cast shadow's tone falls in. Flattening the falloff to
 * these steps keeps every pixel of one step the same colour, so a phase
 * remaps the shadow step by step instead of splitting a shade on rounding.
 */
const SHADOW_STEPS = 16;
/** The lettering on the base, in the font's uppercase glyphs. */
const LETTERING = 'FAM. PINTO MERRY CHRISTMAS';
/** The font's one-column gap after each glyph. */
const GLYPH_GAP = 1;
/** Each letter's first column in the text: the widths and gaps of the letters before it. */
const LETTER_STARTS: readonly number[] = ((): number[] => {
  const starts: number[] = [];
  let at = 0;
  for (const char of LETTERING) {
    starts.push(at);
    at += glyphWidth(char) + GLYPH_GAP;
  }
  return starts;
})();
/** The whole text's width in art pixels: its last glyph's last column plus one. */
const TEXT_WIDTH = (LETTER_STARTS.at(-1) ?? 0) + glyphWidth(LETTERING.at(-1) ?? '');
/** The lettering's first column in the base's box at turn 0, so the whole text faces the visitor. */
const LETTER_X = 2;
/** The lettering's first row in the base's box: the middle of the base's face. */
const LETTER_Y = 9;
/** One turn scrolls the lettering this far: the text and the clear gap to its next copy. */
const LETTER_PERIOD = 116;

/** The parts of the glass a phase paints; every colour is a master colour. */
type GlassPart = 'tint' | 'light' | 'floor' | 'frost' | 'rim' | 'mirror';
type Glass = Record<GlassPart, number>;
const GLASS_PARTS: readonly GlassPart[] = ['tint', 'light', 'floor', 'frost', 'rim', 'mirror'];

/** One phase's glass colours: the body tint, the lit top left, the floor seen through it, the frost at the foot, the rim, and the moon or sun mirrored in the glass. */
const PHASE_GLASS: Record<PhaseName, Record<GlassPart, string>> = {
  dawn: {
    tint: '#8f8ad0',
    light: '#f0c0d8',
    floor: '#463682',
    frost: '#f0cfe0',
    rim: '#ffe9d0',
    mirror: '#ffe9d0',
  },
  'frosty-morning': {
    tint: '#b0d6f4',
    light: '#e2f1fd',
    floor: '#97c6ee',
    frost: '#ffffff',
    rim: '#c9e4f9',
    mirror: '#fff3b0',
  },
  sunset: {
    tint: '#9c2a66',
    light: '#ffa07a',
    floor: '#5a2a6a',
    frost: '#ffd9e6',
    rim: '#ffe9d0',
    mirror: '#ffd9c8',
  },
  'purple-night': {
    tint: '#16283f',
    light: '#5f86b0',
    floor: '#0c2a33',
    frost: '#9fb8dc',
    rim: '#7fb6e6',
    mirror: '#d6e6f8',
  },
};

/** A '#rrggbb' colour as its 0xRRGGBB number. */
function colourNumber(colour: string): number {
  return Number.parseInt(colour.slice(1), 16);
}

/** One reading's glass: each phase colour mixed by the blend's share. */
function glassOf(reading: PhaseReading): Glass {
  const from = PHASE_GLASS[reading.from];
  const to = PHASE_GLASS[reading.to];
  const out = {} as Glass;
  for (const part of GLASS_PARTS) out[part] = blendShade(colourNumber(from[part]), colourNumber(to[part]), reading.share);
  return out;
}

/** The turn folded into [0, 2π): negative turns and whole turns draw the same picture as turn 0. */
function wrapTurn(turn: number): number {
  return ((turn % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/** 0 at 0 and below, 1 at 1 and above, on a straight share. */
function clamp(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** The glass: a smooth tint lit from the top left, the floor and frost showing through, and the rim catching the light, all inside the globe's circle. */
function paintGlass(picture: Uint32Array, width: number, layout: SceneLayout, glass: Glass): void {
  const { cx, cy, radius } = layout.globe;
  const inner = radius - 0.5;
  const rimInner = radius - RIM_WIDTH;
  const top = Math.max(0, Math.floor(cy - radius));
  const bottom = Math.min(layout.height - 1, Math.ceil(cy + radius));
  const left = Math.max(0, Math.floor(cx - radius));
  const right = Math.min(width - 1, Math.ceil(cx + radius));
  for (let y = top; y <= bottom; y++) {
    const dy = y + 0.5 - cy;
    const floor = clamp((dy - 0.1 * radius) / (0.9 * radius));
    const frost = clamp((dy - 0.55 * radius) / (0.45 * radius));
    for (let x = left; x <= right; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.hypot(dx, dy);
      if (d > inner) continue;
      // The body: the light comes from the top left, so the glass falls away
      // towards the bottom right. The light's two terms only ever grow left to
      // right and top to bottom, so no 2 x 2 block can come out as a dither.
      const lit = clamp((radius - (dx * LIGHT_X + dy * LIGHT_Y)) / (2 * radius));
      let colour = blendShade(glass.tint, glass.light, lit);
      // The floor shows through the lower half, and frost gathers at the foot.
      colour = blendShade(colour, glass.floor, floor);
      colour = blendShade(colour, glass.frost, frost);
      // The rim: a solid edge, brightest where the light lands.
      if (d > rimInner) colour = blendShade(glass.tint, glass.rim, lit);
      picture[y * width + x] = colour;
    }
  }
}

/**
 * The two reflections that travel round the glass with the turn: a bright
 * window bar and the phase's moon or sun mirrored on the far side. Both stay
 * well inside the glass, so they never draw past the circle, and each pixel
 * takes the in-between shade between the glass under it and the reflection
 * where the reflection's edge crosses it, so they slide on the fixed grid
 * like the lettering.
 */
function paintReflections(picture: Uint32Array, width: number, layout: SceneLayout, glass: Glass, turn: number): void {
  const { cx, cy, radius } = layout.globe;
  const sheen = blendShade(glass.light, 0xffffff, 0.55);
  const angle = turn + WINDOW_OFFSET;
  const wx = cx + Math.sin(angle) * WINDOW_ORBIT * radius;
  const wy = cy - Math.cos(angle) * WINDOW_ORBIT * radius;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const half = Math.ceil(WINDOW_LENGTH + WINDOW_WIDTH);
  for (let y = Math.floor(wy - half); y <= wy + half; y++) {
    if (y < 0 || y >= layout.height) continue;
    const dy = y + 0.5 - wy;
    for (let x = Math.floor(wx - half); x <= wx + half; x++) {
      if (x < 0 || x >= width) continue;
      const dx = x + 0.5 - wx;
      const along = dx * cos + dy * sin;
      const across = -dx * sin + dy * cos;
      const coverage = clamp(WINDOW_LENGTH + 0.5 - Math.abs(along)) * clamp(WINDOW_WIDTH + 0.5 - Math.abs(across));
      if (coverage <= 0) continue;
      picture[y * width + x] = blendShade(picture[y * width + x] ?? 0, sheen, coverage);
    }
  }
  const mirrorAngle = turn + MIRROR_OFFSET;
  const mx = cx + Math.sin(mirrorAngle) * MIRROR_ORBIT * radius;
  const my = cy - Math.cos(mirrorAngle) * MIRROR_ORBIT * radius;
  const reach = Math.ceil(MIRROR_RADIUS);
  for (let y = Math.floor(my - reach); y <= my + reach; y++) {
    if (y < 0 || y >= layout.height) continue;
    const dy = y + 0.5 - my;
    for (let x = Math.floor(mx - reach); x <= mx + reach; x++) {
      if (x < 0 || x >= width) continue;
      const dx = x + 0.5 - mx;
      const coverage = clamp(MIRROR_RADIUS + 0.5 - Math.hypot(dx, dy));
      if (coverage <= 0) continue;
      picture[y * width + x] = blendShade(picture[y * width + x] ?? 0, glass.mirror, coverage);
    }
  }
}

/**
 * The globe and its base cast a shadow on the ground to the right, away from
 * the disc at the top left: a smooth tone falling off from the base's right
 * foot. It only writes ground rows right of the base (the base's box and the
 * sky stay as they are) and does not change with the turn.
 */
function paintCastShadow(picture: Uint32Array, width: number, layout: SceneLayout, right: number, foot: number): void {
  const firstRow = Math.max(layout.groundTop, Math.floor(foot - 2 * SHADOW_DEPTH));
  const lastRow = Math.min(layout.height - 1, Math.ceil(foot + 2 * SHADOW_DEPTH));
  const lastColumn = Math.min(width - 1, Math.ceil(right + SHADOW_REACH));
  for (let y = firstRow; y <= lastRow; y++) {
    const dy = (y + 0.5 - foot) / SHADOW_DEPTH;
    for (let x = Math.max(0, right); x <= lastColumn; x++) {
      const dx = (x + 0.5 - right) / SHADOW_REACH;
      const coverage = clamp((1 - Math.hypot(dx, dy)) * 2) * SHADOW_STRENGTH;
      const tone = Math.round(coverage * SHADOW_STEPS) / SHADOW_STEPS;
      if (tone <= 0) continue;
      picture[y * width + x] = blendShade(picture[y * width + x] ?? 0, SHADOW_INK, tone);
    }
  }
}

/** The text's lit pixels as runs of columns, one base row each: [base row, first column, past the last]. */
const LETTER_RUNS: readonly (readonly [number, number, number])[] = ((): (readonly [number, number, number])[] => {
  const lit = (row: number, column: number): boolean => {
    let index = 0;
    while ((LETTER_STARTS[index + 1] ?? Infinity) <= column) index++;
    const stroke = glyph(LETTERING[index] ?? '');
    const x = column - (LETTER_STARTS[index] ?? 0);
    if (stroke === undefined || x >= stroke.width) return false;
    return (stroke.pixels[row * stroke.width + x] ?? 0) !== 0;
  };
  const runs: (readonly [number, number, number])[] = [];
  for (let row = 0; row < GLYPH_HEIGHT; row++) {
    let start = -1;
    for (let column = 0; column <= TEXT_WIDTH; column++) {
      if (column < TEXT_WIDTH && lit(row, column)) {
        if (start < 0) start = column;
        continue;
      }
      if (start >= 0) runs.push([LETTER_Y + row, start, column]);
      start = -1;
    }
  }
  return runs;
})();

/** The font's one ink colour, as the glyph sheet draws it. */
const FONT_INK = ((): number => {
  for (const char of LETTERING) {
    const stroke = glyph(char);
    const n = stroke?.pixels.find((p) => p !== 0) ?? 0;
    if (n !== 0) return colourNumber(masterColours[n - 1] ?? '#000000');
  }
  return 0;
})();

/**
 * The lettering over the base's face. The text slides as the globe turns and
 * copies follow it round the base, so one turn scrolls the text exactly one
 * period. Each lit font pixel covers one column of its run, drawn as the
 * in-between shade between the base pixel and the font ink that the covered
 * share asks for, which keeps the sliding edges on the fixed grid.
 */
function paintLettering(picture: Uint32Array, width: number, base: Drawing, boxX: number, boxY: number, turn: number): void {
  const shift = LETTER_X - (turn / FULL_TURN) * LETTER_PERIOD;
  for (let copy = -1; copy <= 1; copy++) {
    const from = shift + copy * LETTER_PERIOD;
    if (from >= base.width || from + TEXT_WIDTH <= 0) continue;
    for (const [row, start, end] of LETTER_RUNS) {
      const left = from + start;
      const right = from + end;
      if (right <= 0 || left >= base.width) continue;
      const first = Math.max(0, Math.floor(left));
      const last = Math.min(base.width, Math.ceil(right));
      for (let x = first; x < last; x++) {
        const coverage = edgeCoverage(right, x) - edgeCoverage(left, x);
        if (coverage <= 0) continue;
        const n = base.pixels[row * base.width + x] ?? 0;
        if (n === 0) continue;
        const under = colourNumber(masterColours[n - 1] ?? '#000000');
        picture[(boxY + row) * width + boxX + x] = blendShade(under, FONT_INK, coverage);
      }
    }
  }
}

/** The base drawing at (boxX, boxY), its lettering over the face. */
function paintBase(picture: Uint32Array, width: number, base: Drawing, boxX: number, boxY: number, turn: number): void {
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const n = base.pixels[y * base.width + x] ?? 0;
      if (n === 0) continue;
      picture[(boxY + y) * width + boxX + x] = colourNumber(masterColours[n - 1] ?? '#000000');
    }
  }
  paintLettering(picture, width, base, boxX, boxY, turn);
}

/** Draws the globe centred on layout.globe, Santa flying round inside it at `time` (ms), and its base under it, into picture (width art pixels across). */
export function drawGlobe(picture: Uint32Array, width: number, layout: SceneLayout, phase: PhaseReading, turn: number, time: number): void {
  const base = drawings['base'];
  if (base === undefined) throw new Error('the Base sheet has no base drawing');
  const spin = wrapTurn(turn);
  const glass = glassOf(phase);
  const boxX = layout.globe.cx - base.width / 2;
  const boxY = layout.groundTop;
  const behind = santaPlacement(spin, time).depth <= 0;
  paintGlass(picture, width, layout, glass);
  if (behind) drawSanta(picture, width, layout, spin, time);
  drawShapes(picture, width, layout, phase, spin);
  if (!behind) drawSanta(picture, width, layout, spin, time);
  paintReflections(picture, width, layout, glass, spin);
  paintCastShadow(picture, width, layout, boxX + base.width, boxY + base.height - 2);
  paintBase(picture, width, base, boxX, boxY, spin);
}
