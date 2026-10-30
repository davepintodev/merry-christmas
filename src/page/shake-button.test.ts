// XMAS-43b, XMAS-125: the shake button's name and its tap area, as pure functions. The sign's picture and place are
// checked in scene/shake-sign.test.ts, the DOM wiring in the browser (tests/browser/shake.spec.ts).
import { describe, expect, it } from 'vitest';
import { SHAKE_TEXT, tapArea } from './shake-button.ts';

describe('the shake button', () => {
  it('is named by its words, TAP TO SHAKE', () => {
    expect(SHAKE_TEXT).toBe('TAP TO SHAKE');
  });

  it("is 44 tall where the strip under the base is shorter, reaching up over the edge while the picture stays under it", () => {
    // 390x664@3: the base's bottom edge is art row 188, 10 device pixels an art pixel, 37.3 CSS pixels from the bottom.
    const tap = tapArea({ x: 32, y: 188, width: 55, height: 12 }, { scale: 10, ratio: 3, left: 0, windowHeight: 664 });
    expect(tap.height).toBeGreaterThanOrEqual(44);
    expect(tap.top + tap.height).toBeLessThanOrEqual(664);
    expect(tap.top).toBeLessThan(1880 / 3);
    expect(tap.top + tap.artTop).toBe(Math.ceil((1880 / 3) * 64) / 64);
    expect(tap.left).toBeCloseTo(106.667, 3);
    expect(tap.width).toBeGreaterThanOrEqual(44);
  });

  it('is 44 pixels tall where the window has the room', () => {
    const tap = tapArea({ x: 140, y: 160, width: 55, height: 2 }, { scale: 6, ratio: 1, left: 0, windowHeight: 1130 });
    expect(tap).toEqual({ left: 840, top: 960, width: 330, height: 44, artTop: 0 });
  });
});
