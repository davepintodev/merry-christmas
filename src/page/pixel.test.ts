// XMAS-31b "Scene core", page runtime: one art pixel size across the page.
// pagePixels() picks the whole number of physical pixels per art pixel that
// the countdown and the scene both use, and the picture size in art pixels
// that fills the window at that size. The smallest picture (MIN_PICTURE) is
// the countdown strip plus the globe's place, so it must fit; the picture
// never stretches: sky and ground just get more art pixels in a bigger window.
import { describe, expect, it } from 'vitest';
import { countdownFrame } from '../countdown/render.ts';
import { GLOBE_RADIUS, MIN_HEIGHT, sceneLayout } from '../scene/frame.ts';
import { MIN_PICTURE, pagePixels } from './pixel.ts';

type Viewport = { width: number; height: number };

/** True when the smallest picture fits the window at this many physical pixels per art pixel. */
function fits(viewport: Viewport, dpr: number, scale: number): boolean {
  return MIN_PICTURE.width * scale <= viewport.width * dpr && MIN_PICTURE.height * scale <= viewport.height * dpr;
}

const CASES: readonly [string, Viewport, number][] = [
  ['laptop', { width: 1280, height: 720 }, 1],
  ['laptop, retina', { width: 1440, height: 900 }, 2],
  ['phone, portrait', { width: 390, height: 844 }, 3],
  ['phone, landscape', { width: 844, height: 390 }, 3],
  ['ultrawide', { width: 3440, height: 1440 }, 1],
  ['fractional ratio', { width: 1366, height: 768 }, 1.25],
  ['odd ratio', { width: 1023, height: 611 }, 1.5],
];

describe('MIN_PICTURE', () => {
  it('is the engine minimum height', () => {
    expect(MIN_PICTURE.height).toBe(MIN_HEIGHT);
  });

  it('is wide enough for the globe and for the widest countdown frame', () => {
    const widest = Math.max(
      countdownFrame({ christmasDay: false, days: 364, hours: 23, minutes: 59, seconds: 59 }, true).width,
      countdownFrame({ christmasDay: false, days: 123, hours: 4, minutes: 5, seconds: 6 }, false).width,
      countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true).width,
    );
    expect(MIN_PICTURE.width).toBeGreaterThanOrEqual(2 * GLOBE_RADIUS);
    expect(MIN_PICTURE.width).toBeGreaterThanOrEqual(widest);
    expect(Number.isInteger(MIN_PICTURE.width)).toBe(true);
  });

  it('is a size the engine accepts', () => {
    expect(() => sceneLayout(MIN_PICTURE.width, MIN_PICTURE.height, 1)).not.toThrow();
  });
});

describe('pagePixels', () => {
  it.each(CASES)('%s: the art pixel is a whole number of physical pixels, the largest that fits', (_name, viewport, dpr) => {
    const { scale } = pagePixels(viewport, dpr);
    expect(Number.isInteger(scale)).toBe(true);
    expect(scale).toBeGreaterThanOrEqual(1);
    expect(fits(viewport, dpr, scale)).toBe(true);
    expect(fits(viewport, dpr, scale + 1)).toBe(false);
  });

  it.each(CASES)('%s: the picture covers the window by less than one art pixel, at whole art pixels', (_name, viewport, dpr) => {
    const { scale, width, height } = pagePixels(viewport, dpr);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    // Covers the window: no strip of bare page at the right or bottom.
    expect(width * scale).toBeGreaterThanOrEqual(viewport.width * dpr);
    expect(height * scale).toBeGreaterThanOrEqual(viewport.height * dpr);
    // ...and no more than one art pixel past it: nothing is stretched or padded.
    expect((width - 1) * scale).toBeLessThan(viewport.width * dpr);
    expect((height - 1) * scale).toBeLessThan(viewport.height * dpr);
  });

  it.each(CASES)('%s: the picture is never smaller than the minimum', (_name, viewport, dpr) => {
    const { width, height } = pagePixels(viewport, dpr);
    expect(width).toBeGreaterThanOrEqual(MIN_PICTURE.width);
    expect(height).toBeGreaterThanOrEqual(MIN_PICTURE.height);
  });

  it('a wider window keeps the art pixel size and adds sky and ground across', () => {
    const narrow = pagePixels({ width: 1280, height: 720 }, 1);
    const wide = pagePixels({ width: 2560, height: 720 }, 1);
    expect(wide.scale).toBe(narrow.scale);
    expect(wide.height).toBe(narrow.height);
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it('a taller window keeps the art pixel size and adds rows; the globe keeps its size', () => {
    // Width-bound, so extra height cannot raise the scale.
    const short = pagePixels({ width: 700, height: 800 }, 1);
    const tall = pagePixels({ width: 700, height: 1400 }, 1);
    expect(tall.scale).toBe(short.scale);
    expect(tall.width).toBe(short.width);
    expect(tall.height).toBeGreaterThan(short.height);
    const a = sceneLayout(short.width, short.height, 7);
    const b = sceneLayout(tall.width, tall.height, 7);
    expect(b.globe.radius).toBe(a.globe.radius);
    expect(b.countdown.height).toBe(a.countdown.height);
    expect(b.groundTop).toBeGreaterThan(a.groundTop);
  });

  it('the boundary: exactly twice the minimum gives 2, one CSS pixel less gives 1', () => {
    const exact = { width: MIN_PICTURE.width * 2, height: MIN_PICTURE.height * 2 };
    expect(pagePixels(exact, 1).scale).toBe(2);
    expect(pagePixels({ width: exact.width - 1, height: exact.height }, 1).scale).toBe(1);
    expect(pagePixels({ width: exact.width, height: exact.height - 1 }, 1).scale).toBe(1);
    // At devicePixelRatio 2 the same CSS window has twice the physical pixels.
    expect(pagePixels(exact, 2).scale).toBe(4);
  });

  it('counts physical pixels: the same CSS window at a higher ratio gives a larger whole scale, the same picture', () => {
    const viewport = { width: MIN_PICTURE.width * 8, height: MIN_PICTURE.height * 4 }; // height-bound at 4
    const one = pagePixels(viewport, 1);
    const two = pagePixels(viewport, 2);
    expect(one.scale).toBe(4);
    expect(two.scale).toBe(one.scale * 2);
    expect(two.width).toBe(one.width);
    expect(two.height).toBe(one.height);
  });

  it('a window smaller than the minimum picture still gives scale 1 and the minimum picture (cropped)', () => {
    expect(pagePixels({ width: 100, height: 90 }, 1)).toEqual({ scale: 1, width: MIN_PICTURE.width, height: MIN_PICTURE.height });
  });

  it('a zero-size window (minimised, or not laid out yet) gives the minimum picture, not NaN or zero', () => {
    expect(pagePixels({ width: 0, height: 0 }, 1)).toEqual({ scale: 1, width: MIN_PICTURE.width, height: MIN_PICTURE.height });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('a devicePixelRatio of %s is read as 1', (dpr) => {
    const viewport = { width: 1280, height: 720 };
    expect(pagePixels(viewport, dpr)).toEqual(pagePixels(viewport, 1));
  });

  it('a fractional ratio still gives a whole scale (1366x768 at 1.25 is 1707.5 x 960 physical pixels)', () => {
    const { scale, width, height } = pagePixels({ width: 1366, height: 768 }, 1.25);
    expect(scale).toBe(Math.floor(Math.min((1366 * 1.25) / MIN_PICTURE.width, (768 * 1.25) / MIN_PICTURE.height)));
    expect(width).toBe(Math.ceil((1366 * 1.25) / scale));
    expect(height).toBe(Math.ceil((768 * 1.25) / scale));
  });
});
