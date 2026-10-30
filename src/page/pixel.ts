// XMAS-31b "Scene core", page runtime: one art pixel size across the page.
// pagePixels() picks the whole number of physical pixels per art pixel that
// the countdown and the scene both use, and the picture size in art pixels
// that fills the window at that size. The art pixel is chosen by the globe
// alone (MIN_PICTURE.width), so the globe fills the window; the countdown's
// digits get their own scale, the largest that fits the picture's width.
// The picture never stretches: sky and ground just get more art pixels in a
// bigger window.
//
// The scene engine's minimums are copied here as plain numbers, not imported:
// the countdown script imports this module, and it must not pull the engine
// (and the scene art it loads) into the page. pixel.test.ts pins the copies to
// scene/frame.ts's GLOBE_RADIUS and MIN_HEIGHT.
import type { TimeLeft } from '../shared/clock.ts';
import { SKY_ABOVE } from '../shared/sky.ts';
import { countdownFrame } from '../countdown/render.ts';

/** The globe's width in art pixels: twice GLOBE_RADIUS in scene/frame.ts. */
const GLOBE_WIDTH = 2 * 56;
/** The engine's MIN_HEIGHT in scene/frame.ts. */
const MIN_HEIGHT = 172;
/** The base's rows below the horizon in scene/frame.ts (BASE_BELOW: the Base drawing's 28 rows less BASE_SINK, 5). */
const BASE_BELOW = 28 - 5;
/** The engine's BASE_MARGIN in scene/frame.ts: the room under the base. */
const BASE_MARGIN = 12;
/** The art pixels the widest countdown keeps free at each side of the picture. */
const SIDE_MARGIN = 4;

/** The widest and tallest countdown frame at a digit scale: three-digit days widen it, the greeting is the tallest. */
function countdownBox(digitScale: number, tight = false): { width: number; height: number } {
  const frames = [
    countdownFrame({ christmasDay: false, days: 364, hours: 23, minutes: 59, seconds: 59 }, true, digitScale, tight),
    countdownFrame({ christmasDay: false, days: 123, hours: 4, minutes: 5, seconds: 6 }, false, digitScale, tight),
    countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true, digitScale, tight),
  ];
  return {
    width: Math.max(...frames.map((frame) => frame.width)),
    height: Math.max(...frames.map((frame) => frame.height)),
  };
}

/**
 * The digit scales the countdown may take, largest first, each with its widest
 * frame; 1 needs no room check. XMAS-128: a tight 3 sits between 3 and 2, so a
 * phone picture (112 to 125 art pixels across) that is just too narrow for 3
 * gets nearly its size instead of dropping to 2.
 */
const DIGIT_SCALES = [
  { digitScale: 4, tight: false },
  { digitScale: 3, tight: false },
  { digitScale: 3, tight: true },
  { digitScale: 2, tight: false },
].map((rung) => ({ ...rung, width: countdownBox(rung.digitScale, rung.tight).width }));

/** The smallest picture the page ever asks the engine for, in art pixels: the globe's width, and the countdown's height at digit scale 1 or the engine minimum. */
export const MIN_PICTURE = {
  width: GLOBE_WIDTH,
  height: Math.max(MIN_HEIGHT, countdownBox(1).height),
} as const;

/** A physical size in pixels: a nonsense measure contributes nothing. */
function physical(size: number, ratio: number): number {
  return Number.isFinite(size) && size > 0 ? size * ratio : 0;
}

export interface PagePixels {
  /** Physical pixels per art pixel; a whole number, at least 1. */
  scale: number;
  /** Picture width in art pixels: MIN_PICTURE.width or enough to cover the window. */
  width: number;
  /** Picture height in art pixels: MIN_PICTURE.height or enough to cover the window. */
  height: number;
  /** Art pixels per font pixel for the countdown's digits, 1..4. */
  digitScale: number;
  /** Whether the countdown's digits sit one art pixel closer together (countdownFrame's tight frame). */
  tight: boolean;
}

/**
 * The largest digit scale whose countdown leaves SIDE_MARGIN free at each side
 * of a picture this wide: below 4, for the reading shown when given (XMAS-128:
 * two-digit days fit a size up on a phone), else for the widest reading; 1 when
 * none does.
 */
function digitScaleFor(width: number, left?: TimeLeft): { digitScale: number; tight: boolean } {
  const room = width - 2 * SIDE_MARGIN;
  // The full size 4 still needs room for the widest reading: it only sits under the window's top on a wide
  // window, and a two-digit day there must not grow the frame into the globe (a 600 px tablet).
  const rung = DIGIT_SCALES.find((entry) =>
    (left === undefined || entry.digitScale === 4 ? entry.width : countdownFrame(left, true, entry.digitScale, entry.tight).width) <= room);
  return rung === undefined ? { digitScale: 1, tight: false } : { digitScale: rung.digitScale, tight: rung.tight };
}

/** The countdown strip's height in scene/frame.ts (COUNTDOWN_HEIGHT): the tallest frame at full size and the sky above it. */
const STRIP_HEIGHT = countdownBox(4).height + SKY_ABOVE;
/** The sky band kept between the strip and the globe's top before the strip starts to move down, in art pixels. */
const STRIP_DROP_AFTER = 8;

/**
 * XMAS-128: how far the countdown strip moves down from the picture's top, in
 * art pixels, on a picture this tall. A tall phone's spare sky above the globe
 * is shared above and below the countdown instead of lying in one band under
 * it; a short picture or a desktop keeps 0. The globe's centre is
 * scene/frame.ts's sceneLayout rule, copied here (the countdown script must not
 * load the engine).
 */
export function countdownDrop(height: number): number {
  const lowest = Math.max(STRIP_HEIGHT + GLOBE_WIDTH / 2, height - GLOBE_WIDTH / 2 - BASE_BELOW - BASE_MARGIN);
  const cy = Math.min(Math.max(Math.round(height * 0.56), STRIP_HEIGHT + GLOBE_WIDTH / 2), height - GLOBE_WIDTH / 2, lowest);
  const spare = cy - GLOBE_WIDTH / 2 - STRIP_HEIGHT;
  return Math.max(0, Math.floor((spare - STRIP_DROP_AFTER) / 2));
}

/**
 * The page's one art pixel size for a viewport and device pixel ratio: the
 * largest whole number of physical pixels per art pixel at which the globe's
 * width fits, never below 1, and the picture size that covers the window at
 * that size. The countdown's digit scale is the largest that fits the picture's
 * width. A device pixel ratio of zero, a negative number, NaN or an infinity is
 * read as 1; a zero-size (or nonsense) window gives the smallest picture, not
 * NaN or zero. Given the reading on show, the digit scale fits that reading.
 */
export function pagePixels(viewport: { width: number; height: number }, dpr: number, left?: TimeLeft): PagePixels {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const across = physical(viewport.width, ratio);
  const down = physical(viewport.height, ratio);
  const scale = Math.max(1, Math.floor(Math.min(across / MIN_PICTURE.width, down / MIN_HEIGHT)));
  const width = Math.max(MIN_PICTURE.width, Math.ceil(across / scale));
  return {
    scale,
    width,
    height: Math.max(MIN_PICTURE.height, Math.ceil(down / scale)),
    ...digitScaleFor(width, left),
  };
}

/**
 * The picture's left edge in CSS pixels: `width` art pixels at `scale` physical
 * pixels each, centred in a window `windowWidth` CSS pixels across. The edge
 * lands on a whole device pixel, so every art pixel stays a whole number of
 * device pixels (crisp at fractional ratios); the scene canvas and the fine
 * layer both place themselves by it.
 */
export function pictureLeft(windowWidth: number, width: number, scale: number, ratio: number): number {
  return Math.round(((windowWidth - (width * scale) / ratio) / 2) * ratio) / ratio;
}
