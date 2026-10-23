// XMAS-27 "Countdown on a plain sky", part A: each art pixel is a whole
// number of physical screen pixels, as large as fits the viewport.
import { describe, expect, it } from 'vitest';
import { fitScale } from './scale.ts';

const FRAME = { width: 100, height: 40 };

describe('fitScale', () => {
  it('returns the largest whole number that fits both width and height', () => {
    expect(fitScale(FRAME, { width: 1000, height: 1000 }, 1)).toBe(10); // width-bound
    expect(fitScale(FRAME, { width: 2000, height: 200 }, 1)).toBe(5); // height-bound
    expect(fitScale(FRAME, { width: 999, height: 1000 }, 1)).toBe(9); // just short of 10
  });

  it('allows an exact fit', () => {
    expect(fitScale(FRAME, { width: 300, height: 120 }, 1)).toBe(3);
  });

  it('counts physical pixels: the viewport is CSS pixels times the device pixel ratio', () => {
    expect(fitScale(FRAME, { width: 500, height: 500 }, 2)).toBe(10);
    expect(fitScale(FRAME, { width: 500, height: 500 }, 3)).toBe(15);
  });

  it.each([1.25, 1.5, 1.75, 2.625])('returns a whole number for a fractional dpr of %s', (dpr) => {
    const n = fitScale(FRAME, { width: 777, height: 555 }, dpr);
    expect(Number.isInteger(n)).toBe(true);
    expect(n * FRAME.width).toBeLessThanOrEqual(777 * dpr);
    expect(n * FRAME.height).toBeLessThanOrEqual(555 * dpr);
    expect((n + 1) * FRAME.width > 777 * dpr || (n + 1) * FRAME.height > 555 * dpr).toBe(true);
  });

  it('never goes below 1, even when the frame does not fit', () => {
    expect(fitScale(FRAME, { width: 50, height: 20 }, 1)).toBe(1);
    expect(fitScale(FRAME, { width: 0, height: 0 }, 1)).toBe(1);
    expect(fitScale(FRAME, { width: 99, height: 1000 }, 1)).toBe(1);
  });
});
