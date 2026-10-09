// XMAS-31a "Scene core engine and reference pictures": the frame function.
// Inputs (time, drag, phase reading, seed, picture size in art pixels) give a
// frame whose picture is width * height colour numbers (0xRRGGBB). The top
// strip is the countdown's plain sky; sky bands, ground and stars are worked
// out in code, the disc comes from the Props sheet, phases only swap colour
// tables, and the globe's place is reserved.
import { masterColours, phaseColours, phaseOverrides } from '../../art/colours.ts';
import { mixHex, skyAndInk } from '../countdown/colours.ts';
import { countdownFrame } from '../countdown/render.ts';
import { drawings } from '../shared/art.generated.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';

/** The globe's radius in art pixels. */
export const GLOBE_RADIUS = 56;
/** The disc (moon by night, sun by day) is this many art pixels across. */
export const DISC_SIZE = 13;
/** The shortest picture: the countdown area above the globe. */
export const MIN_HEIGHT = 160;
/** The countdown's reserved height: the taller countdown frame, the Christmas Day greeting. */
const COUNTDOWN_HEIGHT = Math.max(
  countdownFrame({ christmasDay: false, days: 123, hours: 4, minutes: 5, seconds: 6 }, true).height,
  countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true).height,
);

export interface Rect { x: number; y: number; width: number; height: number }
export interface Circle { cx: number; cy: number; radius: number }
export interface Star { x: number; y: number }

/** Where everything sits for one picture size and seed; the same in every phase. */
export interface SceneLayout {
  width: number;
  height: number;
  /** First ground row; rows above it are sky. */
  groundTop: number;
  /** The globe's reserved place; sky and ground paint through it, only stars leave it clear. */
  globe: Circle;
  /** The countdown's reserved strip: full width at the top, plain sky only. */
  countdown: Rect;
  /** The disc's box, at the top left of the sky below the countdown strip. */
  disc: Rect;
  /** Every star's one art pixel, from the seed alone. */
  stars: readonly Star[];
}

export interface SceneInput {
  /** Milliseconds; drives the twinkle. */
  time: number;
  /** Globe drag (turn); only the globe may change with it. */
  drag: number;
  /** Phase and blend share, from phaseAt on the shared clock. */
  phase: PhaseReading;
  /** The only source of randomness. */
  seed: number;
  /** Picture size in art pixels. */
  width: number;
  height: number;
}

export interface SceneFrame {
  width: number;
  height: number;
  /** width * height colour numbers, 0xRRGGBB, row by row from the top left. */
  picture: Uint32Array;
  layout: SceneLayout;
}

/** The sky's bands: the top one the countdown's plain sky, the last one the phase's floor. */
const SKY_BANDS = 5;
/** Where each phase's sky ramp ends; a stand-in, like the countdown tables, until the phase's art pass. */
const SKY_FLOOR: Record<PhaseName, string> = {
  dawn: '#463682',
  'frosty-morning': '#ffffff',
  sunset: '#ffa07a',
  'purple-night': '#463682',
};
/** The ground's two bands: a shadow where it meets the sky, then snow. */
const GROUND_SHADOW = '#aab6e6';
const GROUND_SNOW = '#dfe6ff';
const GROUND_SHADOW_ROWS = 3;
/** The star colour before each phase's strength is mixed in. */
const STAR_COLOUR = '#d9d2ff';
/** How much of the star colour each phase shows: none in Frosty morning, faint at Dawn and Sunset, full in Purple night (spec 7.6). */
const STAR_STRENGTH: Record<PhaseName, number> = {
  dawn: 0.35,
  'frosty-morning': 0,
  sunset: 0.35,
  'purple-night': 1,
};
/** The colour the sheet's disc warms towards: a moon at night, a sun by day. */
const SUN_COLOUR = '#fff3b0';
const SUN_SHARE: Record<PhaseName, number> = {
  dawn: 0.25,
  'frosty-morning': 0.75,
  sunset: 0.4,
  'purple-night': 0,
};
/** The disc body's colour each phase: a cool moon at Purple night, the sheet's warm sun at Frosty morning, in between at Dawn and Sunset. */
const DISC_BODY: Record<PhaseName, string> = {
  dawn: '#ffe9ee',
  'frosty-morning': SUN_COLOUR,
  sunset: '#ffd9c8',
  'purple-night': '#d6e6f8',
};
/** About one star per this many sky pixels, from the seed. */
const SKY_PER_STAR = 1200;
/** Star placement tries this many times per wanted star before giving up. */
const STAR_TRIES = 40;

/** A seeded PRNG (mulberry32); the only randomness the scene has. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when one of the eight neighbours of (x, y) already holds a star. */
function touches(taken: ReadonlySet<number>, width: number, x: number, y: number): boolean {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || nx >= width || ny < 0) continue;
      if (taken.has(ny * width + nx)) return true;
    }
  }
  return false;
}

/** The stars' one art pixel each: below the countdown strip, above the ground, off the disc, clear of the globe by radius + 1, never touching. */
function placeStars(width: number, groundTop: number, globe: Circle, disc: Rect, countdown: Rect, seed: number): Star[] {
  const top = countdown.y + countdown.height;
  const wanted = Math.max(8, Math.round((width * (groundTop - top)) / SKY_PER_STAR));
  const rand = random(seed);
  const stars: Star[] = [];
  const taken = new Set<number>();
  for (let tries = 0; tries < wanted * STAR_TRIES && stars.length < wanted; tries++) {
    const x = Math.floor(rand() * width);
    const y = top + Math.floor(rand() * (groundTop - top));
    if (x >= disc.x && x < disc.x + disc.width && y >= disc.y && y < disc.y + disc.height) continue;
    const dx = x + 0.5 - globe.cx;
    const dy = y + 0.5 - globe.cy;
    if (dx * dx + dy * dy <= (GLOBE_RADIUS + 1) ** 2) continue;
    if (touches(taken, width, x, y)) continue;
    taken.add(y * width + x);
    stars.push({ x, y });
  }
  return stars;
}

export function sceneLayout(width: number, height: number, seed: number): SceneLayout {
  if (!Number.isInteger(width) || width < 2 * GLOBE_RADIUS) {
    throw new RangeError(`a picture needs a whole width of at least ${2 * GLOBE_RADIUS} art pixels, got ${width}`);
  }
  if (!Number.isInteger(height) || height < MIN_HEIGHT) {
    throw new RangeError(`a picture needs a whole height of at least ${MIN_HEIGHT} art pixels, got ${height}`);
  }
  if (!Number.isFinite(seed)) throw new RangeError(`seed must be a finite number, got ${seed}`);
  const countdown: Rect = { x: 0, y: 0, width, height: COUNTDOWN_HEIGHT };
  const globe: Circle = {
    cx: Math.round(width / 2),
    cy: Math.min(Math.max(Math.round(height * 0.56), COUNTDOWN_HEIGHT + GLOBE_RADIUS), height - GLOBE_RADIUS),
    radius: GLOBE_RADIUS,
  };
  // The globe sits on the ground, so the horizon follows it down for taller pictures.
  const groundTop = Math.min(height - 1, globe.cy + GLOBE_RADIUS + 3);
  const disc: Rect = { x: 2, y: COUNTDOWN_HEIGHT, width: DISC_SIZE, height: DISC_SIZE };
  return { width, height, groundTop, countdown, globe, disc, stars: placeStars(width, groundTop, globe, disc, countdown, seed) };
}

/** A scene colour after the phase's overrides; Dawn's stand-in is the plain palette. */
function override(phase: PhaseName, colour: string): string {
  if (phase === 'dawn') return colour;
  return phaseOverrides[phase][colour] ?? colour;
}

/** One sky band of a steady phase, from the countdown's sky down to the phase's floor. */
function skyBand(phase: PhaseName, band: number): string {
  return mixHex(phaseColours[phase].sky, SKY_FLOOR[phase], band / (SKY_BANDS - 1));
}

/** The sky band index of one row, clamped to the last band. */
function bandOf(row: number, groundTop: number): number {
  return Math.min(SKY_BANDS - 1, Math.floor((row * SKY_BANDS) / groundTop));
}

/** The disc's drawn colour n of a steady phase: the body takes the phase's moon or sun colour, the rim and highlights warm from the sheet's sun. */
function discColour(phase: PhaseName, n: number): string {
  const drawn = masterColours[n - 1] ?? '#000000';
  if (drawn === SUN_COLOUR) return DISC_BODY[phase];
  return mixHex(drawn, SUN_COLOUR, SUN_SHARE[phase]);
}

/** The reading's share, clamped; a steady reading (or a NaN share) is zero. */
function shareOf(reading: PhaseReading): number {
  const share = Number.isNaN(reading.share) ? 0 : Math.min(1, Math.max(0, reading.share));
  return reading.from === reading.to ? 0 : share;
}

function colourNumber(colour: string): number {
  return Number.parseInt(colour.slice(1), 16);
}

/** The disc from the Props sheet, over the sky its clear pixels show through. */
function paintDisc(picture: Uint32Array, layout: SceneLayout, reading: PhaseReading, share: number): void {
  const disc = drawings['disc'];
  if (disc === undefined) throw new Error('the Props sheet has no disc drawing');
  const { x: dx, y: dy } = layout.disc;
  for (let y = 0; y < disc.height; y++) {
    for (let x = 0; x < disc.width; x++) {
      const n = disc.pixels[y * disc.width + x] ?? 0;
      if (n === 0) continue;
      const colour = mixHex(discColour(reading.from, n), discColour(reading.to, n), share);
      picture[(dy + y) * layout.width + dx + x] = colourNumber(colour);
    }
  }
}

/** Each lit star's one art pixel: the colour of the sky row it sits on, mixed towards the phase's star colour. */
function paintStars(picture: Uint32Array, layout: SceneLayout, input: SceneInput, share: number, sky: readonly string[]): void {
  const strength = (1 - share) * STAR_STRENGTH[input.phase.from] + share * STAR_STRENGTH[input.phase.to];
  if (strength === 0) return;
  const target = mixHex(override(input.phase.from, STAR_COLOUR), override(input.phase.to, STAR_COLOUR), share);
  layout.stars.forEach((star, index) => {
    if (!twinkles(index, input.time)) return;
    const row = sky[bandOf(star.y, layout.groundTop)] ?? STAR_COLOUR;
    picture[star.y * layout.width + star.x] = colourNumber(mixHex(row, target, strength));
  });
}

/** True while a star is lit: one change a second, offset per star, so no flash can build up. */
function twinkles(index: number, time: number): boolean {
  return Math.floor(time / 1000 + index * 0.37) % 2 === 0;
}

/** Writes every pixel: sky bands, ground, the disc, then the lit stars. */
function paint(picture: Uint32Array, layout: SceneLayout, input: SceneInput): void {
  const { width, height, groundTop, countdown } = layout;
  const share = shareOf(input.phase);
  const { from, to } = input.phase;
  const sky: string[] = [skyAndInk(input.phase).sky];
  for (let band = 1; band < SKY_BANDS; band++) sky.push(mixHex(skyBand(from, band), skyBand(to, band), share));
  const skyNumbers = sky.map(colourNumber);
  const shadow = colourNumber(mixHex(override(from, GROUND_SHADOW), override(to, GROUND_SHADOW), share));
  const snow = colourNumber(mixHex(override(from, GROUND_SNOW), override(to, GROUND_SNOW), share));

  for (let y = 0; y < groundTop; y++) {
    // The countdown strip is the plain sky the digits sit on, whatever the bands do below it.
    const band = y < countdown.height ? 0 : bandOf(y, groundTop);
    picture.fill(skyNumbers[band] ?? 0, y * width, (y + 1) * width);
  }
  for (let y = groundTop; y < height; y++) {
    picture.fill(y < groundTop + GROUND_SHADOW_ROWS ? shadow : snow, y * width, (y + 1) * width);
  }
  paintDisc(picture, layout, input.phase, share);
  paintStars(picture, layout, input, share, sky);
}

export function sceneFrame(input: SceneInput, target?: Uint32Array, layout?: SceneLayout): SceneFrame {
  if (!Number.isFinite(input.time)) {
    throw new RangeError(`time must be a finite number of milliseconds, got ${input.time}`);
  }
  // The caller may keep a layout for one size and seed and hand it back in
  // (src/page/frames.ts), so the stars are not placed again every frame.
  const used = layout ?? sceneLayout(input.width, input.height, input.seed);
  const size = used.width * used.height;
  if (target !== undefined && target.length !== size) {
    throw new RangeError(`target must hold ${size} colour numbers, got ${target.length}`);
  }
  const picture = target ?? new Uint32Array(size);
  paint(picture, used, input);
  return { width: used.width, height: used.height, picture, layout: used };
}
