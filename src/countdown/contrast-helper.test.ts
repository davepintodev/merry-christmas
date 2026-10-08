// XMAS-30: the WCAG 2 contrast maths in contrast.ts, checked on known values.
import { describe, expect, it } from 'vitest';
import { contrast, MIN_CONTRAST_RATIO, relativeLuminance } from './contrast.ts';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('weights green over red over blue', () => {
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 4);
  });

  it('uses the linear segment below the sRGB knee', () => {
    // 0x0a / 255 = 0.0392 sits on the linear segment: c / 12.92.
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 8);
  });
});

describe('contrast', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 8);
    expect(contrast('#c8102e', '#c8102e')).toBeCloseTo(1, 10);
  });

  it('does not depend on argument order', () => {
    expect(contrast('#ffe08a', '#2b225c')).toBe(contrast('#2b225c', '#ffe08a'));
  });

  it('puts #767676 on white just over the 4.5:1 floor', () => {
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(MIN_CONTRAST_RATIO).toBe(4.5);
  });
});
