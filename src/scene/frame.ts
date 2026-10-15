// XMAS-31a "Scene core engine and reference pictures": the frame function.
// Inputs (time, drag, phase reading, seed, picture size in art pixels) give a
// frame whose picture is width * height colour numbers (0xRRGGBB). The top
// strip is the countdown's plain sky; sky bands, ground and stars are worked
// out in code, the disc comes from the Props sheet, phases only swap colour
// tables, and the globe is drawn over the ground on its base (globe.ts).
import { colours, masterColours, phaseColours, phaseOverrides } from '../../art/colours.ts';
import { mixHex, skyAndInk } from '../countdown/colours.ts';
import { countdownFrame } from '../countdown/render.ts';
import { drawings } from '../shared/art.generated.ts';
import { SKY_ABOVE } from '../shared/sky.ts';
import { drawOutsideSnow, type OutsideSnow } from './outside-snow.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { drawGlobe } from './globe.ts';
import type { ShapeParts } from './shapes-draw.ts';
import { paintHint } from './hint.ts';
import { MAX_LEAN } from './lean.ts';
import type { GlobeSnow } from './snow.ts';

/** The globe's radius in art pixels. */
export const GLOBE_RADIUS = 56;
/** The disc (moon by night, sun by day) is this many art pixels across. */
export const DISC_SIZE = 21;
/** The widest clear gap, in art pixels, between the disc and the picture's left edge: narrower where the disc would touch the globe. */
export const DISC_MARGIN = 6;
/** The shortest picture: the countdown area above the globe. */
export const MIN_HEIGHT = 160;
/** The base drawing's height in art pixels (art/objects.ts, the Base sheet): the globe sits on it on the ground. */
const BASE_HEIGHT = drawings['base']?.height ?? 22;
/**
 * The countdown's reserved height: the taller countdown frame, the Christmas Day
 * greeting, pushed down by the page's sky above it (SKY_ABOVE). The greeting's
 * last inked row is one above its frame's bottom, so the strip is the frame
 * plus SKY_ABOVE less that blank row.
 */
const COUNTDOWN_HEIGHT =
  Math.max(
    countdownFrame({ christmasDay: false, days: 123, hours: 4, minutes: 5, seconds: 6 }, true).height,
    countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true).height,
  ) +
  SKY_ABOVE -
  1;

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
  /** Globe turn angle in radians: 0 faces the visitor (the default), period 2π. */
  turn?: number;
  /** Globe lean in radians (XMAS-41b1): + leans the top toward +x; the base and ground stay put. Within ±MAX_LEAN. */
  lean?: number;
  /** Phase and blend share, from phaseAt on the shared clock. */
  phase: PhaseReading;
  /** The only source of randomness. */
  seed: number;
  /** Picture size in art pixels. */
  width: number;
  height: number;
  /** The globe's snow (XMAS-36b1); absent draws no flakes. */
  snow?: GlobeSnow;
  /** The outside snow (XMAS-36b2); absent draws none. */
  outsideSnow?: OutsideSnow;
  /** Whether the shapes' bodies are drawn (XMAS-80); absent or true draws them, false leaves them out and keeps their shadows. */
  shapeBodies?: boolean;
}

export interface SceneFrame {
  width: number;
  height: number;
  /** width * height colour numbers, 0xRRGGBB, row by row from the top left. */
  picture: Uint32Array;
  layout: SceneLayout;
}

/**
 * The edges of Dawn's first, banded drawing (five plain bands). Dawn no longer
 * paints by them, but the sky's runs still split at them, so the approved
 * pictures of the other phases stay exactly as drawn.
 */
const SKY_BANDS = 5;
/**
 * Every phase's sky ramp, from the countdown's plain sky (share 0, just under
 * the strip) down to the horizon (share 1). The hue turns along the ramp
 * instead of fading straight through grey: Purple night deepens from ink-blue
 * to indigo, Sunset runs plum, magenta and coral to a salmon horizon. Dawn is
 * the gentle first light between them: night indigo at the top, softening
 * through violet and a dusty lilac-rose to a pale apricot glow, lighter, more
 * golden and less saturated than Sunset's coral. Frosty morning is pale only
 * round the sun under the strip (the red ink needs a light sky there) and
 * settles into a clear, cold winter blue, so the snow stays the brightest
 * thing in the picture instead of the sky.
 */
const SKY_RAMP: Record<PhaseName, readonly (readonly [number, string])[]> = {
  dawn: [[0, '#372b70'], [0.28, '#454389'], [0.5, '#6a5aa0'], [0.7, '#a874a8'], [0.86, '#e49aa6'], [1, '#ffd6a0']],
  'frosty-morning': [[0, '#d6e6f8'], [0.45, '#b0d6f4'], [1, '#97c6ee']],
  sunset: [[0, '#2a1a4a'], [0.3, '#5a2a6a'], [0.56, '#a03f78'], [0.8, '#e0637a'], [1, '#ffa07a']],
  'purple-night': [[0, '#1a1433'], [0.25, '#221a47'], [0.5, '#2b225c'], [0.75, '#372b70'], [1, '#463682']],
};
/**
 * Dawn's blends pass their middle through these ramps instead of the straight
 * mix, which runs Dawn's warm horizon against a cold one through grey. The pull
 * is full at mid-blend, none at either end (held high across most of the
 * blend, so its quarters do not slide back towards grey), and fades out towards the strip so
 * the sky still meets the countdown's own blend there.
 */
const BLEND_VIA: Partial<Record<`${PhaseName}>${PhaseName}`, readonly (readonly [number, string])[]>> = {
  'purple-night>dawn': [[0, '#221b48'], [0.5, '#4a3784'], [0.8, '#8a5c9c'], [1, '#c98aa0']],
  'dawn>frosty-morning': [[0, '#8c94c8'], [0.5, '#a4a8dc'], [0.8, '#d2bce4'], [1, '#f6cad6']],
};
/** Depth under the strip over which a blend's via pull fades in. */
const VIA_FADE = 0.25;
/** The ground's two bands per phase: a shadow where it meets the sky, then snow. Frosty morning's snow is a soft ice white, not paper white. */
const GROUND_SHADOW: Record<PhaseName, string> = {
  dawn: '#cdbde6',
  'frosty-morning': '#c4d8f0',
  sunset: '#e8b4c8',
  'purple-night': '#aab6e6',
};
const GROUND_SNOW: Record<PhaseName, string> = {
  dawn: '#fff0f6',
  'frosty-morning': '#e2f1fd',
  sunset: '#ffe9ee',
  'purple-night': '#dfe6ff',
};
const GROUND_SHADOW_ROWS = 3;
/** The star colour before each phase's strength is mixed in. */
const STAR_COLOUR = '#d9d2ff';
/** How much of the star colour each phase shows: none in Frosty morning, faint at Dawn and Sunset, full in Purple night (spec 7.6). */
const STAR_STRENGTH: Record<PhaseName, number> = {
  dawn: 0.25,
  'frosty-morning': 0,
  sunset: 0.35,
  'purple-night': 1,
};
/** The colour the sheet's disc warms towards: a moon at night, a sun by day. */
const SUN_COLOUR = '#fff3b0';
const SUN_SHARE: Record<PhaseName, number> = {
  dawn: 0.4,
  'frosty-morning': 0.75,
  sunset: 0.4,
  'purple-night': 0,
};
/** The disc body's colour each phase: a cool moon at Purple night, the sheet's warm sun at Frosty morning, in between at Dawn and Sunset. */
const DISC_BODY: Record<PhaseName, string> = {
  dawn: '#ffe9d0',
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

/**
 * The disc's left gap at row top: DISC_MARGIN where the disc clears the globe, else the
 * widest narrower gap that does, else 0 where even a flush disc overlaps the glass.
 */
function discGap(globe: Circle, top: number): number {
  for (let x = DISC_MARGIN; x > 0; x--) {
    if (discClears(globe, { x, y: top, width: DISC_SIZE, height: DISC_SIZE })) return x;
  }
  return 0;
}

/** Whether no pixel centre of the disc lies within the globe's radius: the centre nearest the globe's centre is the one that decides. */
function discClears(globe: Circle, disc: Rect): boolean {
  const px = nearestCentre(disc.x, disc.width, globe.cx);
  const py = nearestCentre(disc.y, disc.height, globe.cy);
  return (px - globe.cx) ** 2 + (py - globe.cy) ** 2 > globe.radius ** 2;
}

/** The centre of the pixel within lo to lo + size, along one axis, that lies nearest c. */
function nearestCentre(lo: number, size: number, c: number): number {
  return lo + Math.min(Math.max(Math.round(c - lo - 0.5), 0), size - 1) + 0.5;
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
  // The globe sits on its base on the ground, so the horizon is the globe's
  // bottom; the shortest pictures hold the whole base on the ground instead,
  // which raises the horizon and sinks the glass's foot into the base (its
  // lowest 16 rows at height 160, where cy stays 98).
  const groundTop = Math.min(height - BASE_HEIGHT, globe.cy + GLOBE_RADIUS);
  const disc: Rect = { x: discGap(globe, COUNTDOWN_HEIGHT), y: COUNTDOWN_HEIGHT, width: DISC_SIZE, height: DISC_SIZE };
  return { width, height, groundTop, countdown, globe, disc, stars: placeStars(width, groundTop, globe, disc, countdown, seed) };
}

/** A scene colour after the phase's overrides; Dawn deliberately uses the plain palette. */
function override(phase: PhaseName, colour: string): string {
  if (phase === 'dawn') return colour;
  return phaseOverrides[phase][colour] ?? colour;
}

/** One channel (0 red, 1 green, 2 blue) of a '#rrggbb' colour. */
function channelOf(hex: string, c: number): number {
  return Number.parseInt(hex.slice(1 + 2 * c, 3 + 2 * c), 16);
}

/**
 * The colour at share t (0..1) along a ramp's stops, on a smooth curve
 * through them (Catmull-Rom, channel by channel): straight lines between stops
 * would bend sharply at each one and show it as a bright or dark line.
 */
function along(stops: readonly (readonly [number, string])[], t: number): string {
  let i = 1;
  while (i < stops.length - 1 && t > (stops[i]?.[0] ?? 1)) i++;
  const at = (k: number): readonly [number, string] => stops[Math.min(stops.length - 1, Math.max(0, k))] ?? [0, '#000000'];
  const [t0, c0] = at(i - 1);
  const [t1, c1] = at(i);
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const slope = (k: number, c: number): number => {
    const [ta, ca] = at(k - 1);
    const [tb, cb] = at(k + 1);
    return ((channelOf(cb, c) - channelOf(ca, c)) / (tb - ta)) * (t1 - t0);
  };
  const out = [0, 1, 2].map((c) => {
    const p0 = channelOf(c0, c);
    const p1 = channelOf(c1, c);
    const h = u * u * (3 - 2 * u);
    const value = p0 + (p1 - p0) * h + slope(i - 1, c) * (u - 2 * u * u + u ** 3) + slope(i, c) * (u ** 3 - u * u);
    return Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0');
  });
  return `#${out.join('')}`;
}

/** The old Dawn band of one sky row, clamped to the last band. */
function dawnBandOf(row: number, groundTop: number): number {
  return Math.min(SKY_BANDS - 1, Math.floor((row * SKY_BANDS) / groundTop));
}

/** One run of sky rows that every phase paints one colour: its rows, its depth down the ramp (0 at the strip, 1 at the horizon), Dawn's band and Purple night's colour. */
interface SkyRun { start: number; end: number; depth: number; dawnBand: number; night: string }

/**
 * The sky's drawing under the countdown strip (top), down to groundTop.
 * Phases only swap colours, so Purple night, the base picture, sets the runs:
 * its ramp taken row by row, one run per colour, as fine as eight-bit colour
 * allows, so every ramp reads as a smooth gradient. A run never crosses one of
 * the edges of Dawn's old bands (kept so the approved pictures stay as drawn): where Purple night would carry a
 * colour across a band edge or out of the strip, the rows past the edge take
 * its next colour early.
 */
function skyRuns(top: number, groundTop: number): readonly SkyRun[] {
  const depth = (y: number): number => (y + 0.5 - top) / (groundTop - top);
  const night = Array.from({ length: groundTop - top }, (_, i) => along(SKY_RAMP['purple-night'], depth(top + i)));
  for (let i = 0; i < night.length; i++) {
    const y = top + i;
    const above = i === 0 ? phaseColours['purple-night'].sky : night[i - 1];
    if (night[i] !== above || (i > 0 && dawnBandOf(y, groundTop) === dawnBandOf(y - 1, groundTop))) continue;
    let next = i;
    while (next < night.length && night[next] === above && dawnBandOf(top + next, groundTop) === dawnBandOf(y, groundTop)) next++;
    const early = night[next];
    if (early === undefined || dawnBandOf(top + next, groundTop) !== dawnBandOf(y, groundTop)) continue;
    for (let j = i; j < next; j++) night[j] = early;
  }
  const runs: SkyRun[] = [];
  night.forEach((colour, i) => {
    const y = top + i;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.night === colour && last.dawnBand === dawnBandOf(y, groundTop)) {
      last.end = y + 1;
      return;
    }
    runs.push({ start: y, end: y + 1, depth: 0, dawnBand: dawnBandOf(y, groundTop), night: colour });
  });
  for (const run of runs) run.depth = depth((run.start + run.end - 1) / 2);
  return runs;
}

/** The last sky drawing worked out, kept because one picture size asks for the same one every frame. */
let lastRuns: { top: number; groundTop: number; runs: readonly SkyRun[] } | undefined;

function cachedSkyRuns(top: number, groundTop: number): readonly SkyRun[] {
  if (lastRuns?.top !== top || lastRuns.groundTop !== groundTop) lastRuns = { top, groundTop, runs: skyRuns(top, groundTop) };
  return lastRuns.runs;
}

/** 0 at 0, 1 from 1 on, on a smooth S between, so a fade shows no corner. */
function fadeIn(x: number): number {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
}

/** One sky run's colour in a steady phase: Purple night's own colour, or the phase's ramp at the run's depth. */
function skyColour(phase: PhaseName, run: SkyRun): string {
  if (phase === 'purple-night') return run.night;
  return along(SKY_RAMP[phase], run.depth);
}

/** colour moved by k times the step from a to b, channel by channel, kept in 0..255. */
function shifted(colour: string, a: string, b: string, k: number): string {
  const out = [1, 3, 5].map((at) => {
    const ch = (hex: string): number => Number.parseInt(hex.slice(at, at + 2), 16);
    const value = Math.round(ch(colour) + k * (ch(b) - ch(a)));
    return Math.min(255, Math.max(0, value)).toString(16).padStart(2, '0');
  });
  return `#${out.join('')}`;
}

/** The disc's drawn colour n of a steady phase: the body takes the phase's moon or sun colour, the rim and highlights warm from the sheet's sun. */
function discColour(phase: PhaseName, n: number): string {
  const drawn = masterColours[n - 1] ?? '#000000';
  if (drawn === SUN_COLOUR) return DISC_BODY[phase];
  // Snow white is the disc's brightest highlight, not part of the body: it
  // stays white in every phase, as the base's lettering ink does.
  if (drawn === colours.snow) return drawn;
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

/** Each lit star's one art pixel: the colour of the sky row it sits on (sky holds one colour per row), mixed towards the phase's star colour. */
function paintStars(picture: Uint32Array, layout: SceneLayout, input: SceneInput, share: number, sky: readonly string[]): void {
  const strength = (1 - share) * STAR_STRENGTH[input.phase.from] + share * STAR_STRENGTH[input.phase.to];
  if (strength === 0) return;
  const target = mixHex(override(input.phase.from, STAR_COLOUR), override(input.phase.to, STAR_COLOUR), share);
  layout.stars.forEach((star, index) => {
    if (!twinkles(index, input.time)) return;
    const row = sky[star.y] ?? STAR_COLOUR;
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
  const top = countdown.height;
  // The countdown strip is the plain sky the digits sit on, whatever the bands do below it.
  const strip = skyAndInk(input.phase).sky;
  // A frosty-morning blend steps the strip along the countdown's bridge, off
  // the straight mix; the ramp under it carries that offset and lets it fade
  // out towards the horizon, so the strip never sits on the sky as a slab.
  const straight = mixHex(phaseColours[from].sky, phaseColours[to].sky, share);
  const sky = Array.from({ length: groundTop }, () => strip);
  for (const run of cachedSkyRuns(top, groundTop)) {
    const a = skyColour(from, run);
    const b = skyColour(to, run);
    let mixed = mixHex(a, b, share);
    const via = BLEND_VIA[`${from}>${to}`];
    if (via !== undefined) {
      const pull = (1 - (1 - 2 * share) ** 4) * fadeIn(run.depth / VIA_FADE);
      mixed = shifted(mixed, mixHex(a, b, 0.5), along(via, run.depth), pull);
    }
    sky.fill(shifted(mixed, straight, strip, 1 - run.depth), run.start, run.end);
  }
  const shadow = colourNumber(mixHex(GROUND_SHADOW[from], GROUND_SHADOW[to], share));
  const snow = colourNumber(mixHex(GROUND_SNOW[from], GROUND_SNOW[to], share));

  for (let y = 0; y < groundTop; y++) picture.fill(colourNumber(sky[y] ?? strip), y * width, (y + 1) * width);
  for (let y = groundTop; y < height; y++) {
    picture.fill(y < groundTop + GROUND_SHADOW_ROWS ? shadow : snow, y * width, (y + 1) * width);
  }
  // The outside snow falls behind the globe, so the glass and objects cover it.
  if (input.outsideSnow !== undefined) drawOutsideSnow(picture, width, layout, input.outsideSnow, input.time);
  // The stars lie behind the globe too: a leaning glass covers them and shows them where it has left.
  paintStars(picture, layout, input, share, sky);
  // The globe sits on the ground's first row, on its base.
  const parts: ShapeParts = input.shapeBodies === false ? 'shadows' : 'all';
  drawGlobe(picture, width, layout, input.phase, input.turn ?? 0, input.time, input.snow, input.lean ?? 0, parts);
  paintDisc(picture, layout, input.phase, share);
  paintHint(picture, layout, BASE_HEIGHT);
}

export function sceneFrame(input: SceneInput, target?: Uint32Array, layout?: SceneLayout): SceneFrame {
  if (!Number.isFinite(input.time)) {
    throw new RangeError(`time must be a finite number of milliseconds, got ${input.time}`);
  }
  if (input.turn !== undefined && !Number.isFinite(input.turn)) {
    throw new RangeError(`turn must be a finite number of radians, got ${input.turn}`);
  }
  if (input.lean !== undefined && !(Math.abs(input.lean) <= MAX_LEAN)) {
    throw new RangeError(`lean must be a finite number of radians within ±${MAX_LEAN}, got ${input.lean}`);
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
