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

  it('is the globe width: the countdown no longer sets the picture width (visual-reset-1)', () => {
    expect(MIN_PICTURE.width).toBe(2 * GLOBE_RADIUS);
    expect(MIN_PICTURE.width).toBe(112);
  });

  it('is at least as tall as the smallest countdown (digitScale 1) and the engine minimum', () => {
    const smallest = countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true, 1).height;
    const countdown = countdownFrame({ christmasDay: false, days: 123, hours: 4, minutes: 5, seconds: 6 }, true, 1).height;
    expect(MIN_PICTURE.height).toBe(Math.max(MIN_HEIGHT, smallest, countdown));
  });

  it('is a size the engine accepts', () => {
    expect(() => sceneLayout(MIN_PICTURE.width, MIN_PICTURE.height, 1)).not.toThrow();
  });
});

/** The widest countdown frame (three-digit days, the greeting, the title) at a digit scale. */
function widest(digitScale: number): number {
  return Math.max(
    countdownFrame({ christmasDay: false, days: 364, hours: 23, minutes: 59, seconds: 59 }, true, digitScale).width,
    countdownFrame({ christmasDay: false, days: 123, hours: 4, minutes: 5, seconds: 6 }, false, digitScale).width,
    countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true, digitScale).width,
  );
}

/** The largest digit scale in 1..4 whose widest frame leaves 4 art pixels free at each side; 1 at least. */
function expectedDigitScale(width: number): number {
  for (const d of [4, 3, 2]) if (widest(d) <= width - 8) return d;
  return 1;
}

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
    // Width-bound (700 / 112 = 6.25, 1000 / 160 = 6.25), so extra height cannot raise the scale.
    const short = pagePixels({ width: 700, height: 1000 }, 1);
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
    expect(pagePixels({ width: 100, height: 90 }, 1)).toEqual({ scale: 1, width: MIN_PICTURE.width, height: MIN_PICTURE.height, digitScale: expectedDigitScale(MIN_PICTURE.width) });
  });

  it('a zero-size window (minimised, or not laid out yet) gives the minimum picture, not NaN or zero', () => {
    expect(pagePixels({ width: 0, height: 0 }, 1)).toEqual({ scale: 1, width: MIN_PICTURE.width, height: MIN_PICTURE.height, digitScale: expectedDigitScale(MIN_PICTURE.width) });
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

describe('pagePixels: scale is chosen by the globe only (visual-reset-1)', () => {
  it('a 360x700 phone at ratio 2 gets scale 6 and a 120-wide picture', () => {
    expect(pagePixels({ width: 360, height: 700 }, 2)).toMatchObject({ scale: 6, width: 120, height: Math.ceil(1400 / 6) });
  });

  it('a 1920x1130 laptop at ratio 1 gets scale 7', () => {
    expect(pagePixels({ width: 1920, height: 1130 }, 1)).toMatchObject({ scale: 7, width: Math.ceil(1920 / 7), height: Math.ceil(1130 / 7) });
  });

  it.each(CASES)('%s: scale is floor(min(across / 112, down / MIN_HEIGHT))', (_name, viewport, dpr) => {
    const want = Math.max(1, Math.floor(Math.min((viewport.width * dpr) / 112, (viewport.height * dpr) / MIN_HEIGHT)));
    expect(pagePixels(viewport, dpr).scale).toBe(want);
  });

  it('the globe fills over 80% of a 360 wide window at every ratio (it no longer waits for the countdown)', () => {
    for (const dpr of [1, 2, 3]) {
      const { scale } = pagePixels({ width: 360, height: 700 }, dpr);
      expect((112 * scale) / (360 * dpr)).toBeGreaterThan(0.8);
    }
  });

  it('the digits never raise or lower the scale: a window too narrow for any big countdown keeps the globe scale', () => {
    const { scale, digitScale } = pagePixels({ width: 360, height: 700 }, 2);
    expect(scale).toBe(6);
    expect(digitScale).toBeLessThan(4);
  });
});

describe('pagePixels: digitScale', () => {
  it('360x700 at ratio 2 gives 2: 3 would be 123 wide in a 120 wide picture', () => {
    expect(widest(2)).toBe(82);
    expect(widest(3)).toBe(123);
    expect(pagePixels({ width: 360, height: 700 }, 2).digitScale).toBe(2);
  });

  it('1920x1130 at ratio 1 gives 4', () => {
    expect(pagePixels({ width: 1920, height: 1130 }, 1).digitScale).toBe(4);
  });

  it.each(CASES)('%s: the largest digit scale whose widest frame fits within width - 8', (_name, viewport, dpr) => {
    const { width, digitScale } = pagePixels(viewport, dpr);
    expect(digitScale).toBe(expectedDigitScale(width));
    expect(Number.isInteger(digitScale)).toBe(true);
    expect(digitScale).toBeGreaterThanOrEqual(1);
    expect(digitScale).toBeLessThanOrEqual(4);
  });

  it('the 4 free art pixels at each side are respected at the boundary', () => {
    const need = widest(4) + 8; // 172 art pixels wide
    const scale1 = (w: number) => pagePixels({ width: w, height: 5000 }, 1);
    expect(scale1(need).width).toBe(need);
    expect(scale1(need).digitScale).toBe(4);
    expect(scale1(need - 1).width).toBe(need - 1);
    expect(scale1(need - 1).digitScale).toBe(3);
  });

  it('is never above 4 however big the window is', () => {
    expect(pagePixels({ width: 8000, height: 5000 }, 3).digitScale).toBe(4);
  });

  it('is at least 1 when nothing fits: tiny, zero and nonsense windows', () => {
    for (const viewport of [{ width: 50, height: 50 }, { width: 0, height: 0 }, { width: Number.NaN, height: Number.NaN }, { width: -5, height: 10 }]) {
      const { digitScale } = pagePixels(viewport, 1);
      expect(Number.isInteger(digitScale)).toBe(true);
      expect(digitScale).toBeGreaterThanOrEqual(1);
      expect(digitScale).toBeLessThanOrEqual(expectedDigitScale(MIN_PICTURE.width));
    }
  });

  it.each([1, 2, 3, 1.25, 1.5, 2.625])('at ratio %s: every size is finite and the whole picture is at least the minimum', (dpr) => {
    for (const viewport of [{ width: 320, height: 480 }, { width: 360, height: 700 }, { width: 768, height: 1024 }, { width: 4000, height: 2000 }]) {
      const p = pagePixels(viewport, dpr);
      expect(Number.isFinite(p.digitScale)).toBe(true);
      expect(p.digitScale).toBe(expectedDigitScale(p.width));
      expect(p.width).toBeGreaterThanOrEqual(MIN_PICTURE.width);
    }
  });

  it('a nonsense ratio is read as 1, digitScale included', () => {
    for (const dpr of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pagePixels({ width: 360, height: 700 }, dpr).digitScale).toBe(pagePixels({ width: 360, height: 700 }, 1).digitScale);
      expect(Number.isFinite(pagePixels({ width: 360, height: 700 }, dpr).digitScale)).toBe(true);
    }
  });
});
