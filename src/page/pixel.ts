// XMAS-31b "Scene core", page runtime: one art pixel size across the page.
// pagePixels() picks the whole number of physical pixels per art pixel that
// the countdown and the scene both use, and the picture size in art pixels
// that fills the window at that size. The smallest picture (MIN_PICTURE) is
// the countdown area above the globe, so it must fit; the picture never
// stretches: sky and ground just get more art pixels in a bigger window.
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

/** The widest and tallest countdown frame: three-digit days widen it, the greeting is the tallest. */
function countdownBox(): { width: number; height: number } {
  const frames = [
    countdownFrame({ christmasDay: false, days: 364, hours: 23, minutes: 59, seconds: 59 }, true),
    countdownFrame({ christmasDay: false, days: 123, hours: 4, minutes: 5, seconds: 6 }, false),
    countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true),
  ];
  return {
    width: Math.max(...frames.map((frame) => frame.width)),
    height: Math.max(...frames.map((frame) => frame.height)),
  };
}

const COUNTDOWN = countdownBox();

/** The smallest picture the page ever asks the engine for, in art pixels. */
export const MIN_PICTURE = {
  width: Math.max(GLOBE_WIDTH, COUNTDOWN.width),
  height: Math.max(MIN_HEIGHT, COUNTDOWN.height),
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
}

/**
 * The page's one art pixel size for a viewport and device pixel ratio: the
 * largest whole number of physical pixels per art pixel at which the smallest
 * picture fits, never below 1, and the picture size that covers the window at
 * that size. A device pixel ratio of zero, a negative number, NaN or an
 * infinity is read as 1; a zero-size (or nonsense) window gives the smallest
 * picture, not NaN or zero.
 */
export function pagePixels(viewport: { width: number; height: number }, dpr: number): PagePixels {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const across = physical(viewport.width, ratio);
  const down = physical(viewport.height, ratio);
  const scale = Math.max(1, Math.floor(Math.min(across / MIN_PICTURE.width, down / MIN_PICTURE.height)));
  return {
    scale,
    width: Math.max(MIN_PICTURE.width, Math.ceil(across / scale)),
    height: Math.max(MIN_PICTURE.height, Math.ceil(down / scale)),
  };
}
