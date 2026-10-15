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
import { countdownFrame } from '../countdown/render.ts';

/** The globe's width in art pixels: twice GLOBE_RADIUS in scene/frame.ts. */
const GLOBE_WIDTH = 2 * 56;
/** The engine's MIN_HEIGHT in scene/frame.ts. */
const MIN_HEIGHT = 160;
/** The art pixels the widest countdown keeps free at each side of the picture. */
const SIDE_MARGIN = 4;

/** The widest and tallest countdown frame at a digit scale: three-digit days widen it, the greeting is the tallest. */
function countdownBox(digitScale: number): { width: number; height: number } {
  const frames = [
    countdownFrame({ christmasDay: false, days: 364, hours: 23, minutes: 59, seconds: 59 }, true, digitScale),
    countdownFrame({ christmasDay: false, days: 123, hours: 4, minutes: 5, seconds: 6 }, false, digitScale),
    countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true, digitScale),
  ];
  return {
    width: Math.max(...frames.map((frame) => frame.width)),
    height: Math.max(...frames.map((frame) => frame.height)),
  };
}

/** The digit scales the countdown may take, largest first, each with its widest frame; 1 needs no room check. */
const DIGIT_SCALES = [4, 3, 2].map((digitScale) => ({ digitScale, width: countdownBox(digitScale).width }));

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
}

/** The largest digit scale whose widest countdown leaves SIDE_MARGIN free at each side of a picture this wide; 1 when none does. */
function digitScaleFor(width: number): number {
  return DIGIT_SCALES.find((entry) => entry.width <= width - 2 * SIDE_MARGIN)?.digitScale ?? 1;
}

/**
 * The page's one art pixel size for a viewport and device pixel ratio: the
 * largest whole number of physical pixels per art pixel at which the globe's
 * width fits, never below 1, and the picture size that covers the window at
 * that size. The countdown's digit scale is the largest that fits the picture's
 * width. A device pixel ratio of zero, a negative number, NaN or an infinity is
 * read as 1; a zero-size (or nonsense) window gives the smallest picture, not
 * NaN or zero.
 */
export function pagePixels(viewport: { width: number; height: number }, dpr: number): PagePixels {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const across = physical(viewport.width, ratio);
  const down = physical(viewport.height, ratio);
  const scale = Math.max(1, Math.floor(Math.min(across / MIN_PICTURE.width, down / MIN_HEIGHT)));
  const width = Math.max(MIN_PICTURE.width, Math.ceil(across / scale));
  return {
    scale,
    width,
    height: Math.max(MIN_PICTURE.height, Math.ceil(down / scale)),
    digitScale: digitScaleFor(width),
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
