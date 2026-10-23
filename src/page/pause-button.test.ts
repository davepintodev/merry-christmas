// XMAS-45b "Pause button on the page": the button's sizes and drawings, as pure
// functions. The DOM wiring is checked in the browser (tests/browser/pause.spec.ts).
import { describe, expect, it } from 'vitest';
import { drawings } from '../shared/art.generated.ts';
import { buttonBox, pauseDrawing, TAP_MIN } from './pause-button.ts';

const PAUSE_ART = { width: 20, height: 10 };

describe('buttonBox', () => {
  it('takes the drawing width for the tap area when that is over 44 CSS pixels, and centres the drawing vertically', () => {
    // Scale 3 at ratio 1: the 20 by 10 drawing is 60 by 30 CSS pixels, so the tap area is 60 wide and 44 high.
    expect(buttonBox(PAUSE_ART, 3, 1)).toEqual({
      tap: { width: 60, height: 44 },
      drawing: { width: 60, height: 30, left: 0, top: 7 },
    });
  });

  it('centres a small drawing in the minimum tap area', () => {
    expect(buttonBox(PAUSE_ART, 1, 1)).toEqual({
      tap: { width: TAP_MIN, height: TAP_MIN },
      drawing: { width: 20, height: 10, left: 12, top: 17 },
    });
  });

  it('keeps the drawing and its corner on whole device pixels at a fractional ratio', () => {
    // At ratio 1.5 the drawing is 40 by 20 CSS pixels (60 by 30 device pixels); the tap area is 44 CSS pixels: 66 device pixels.
    expect(buttonBox(PAUSE_ART, 3, 1.5)).toEqual({
      tap: { width: 44, height: 44 },
      drawing: { width: 40, height: 20, left: 2, top: 12 },
    });
  });

  it('never takes a tap area under 44 CSS pixels, and always puts the drawing inside it on whole device pixels', () => {
    for (const ratio of [1, 1.25, 1.5, 2, 2.625, 3]) {
      for (let scale = 1; scale <= 8; scale++) {
        const box = buttonBox(PAUSE_ART, scale, ratio);
        expect(box.tap.width).toBeGreaterThanOrEqual(TAP_MIN);
        expect(box.tap.height).toBeGreaterThanOrEqual(TAP_MIN);
        expect(Math.abs(box.tap.width * ratio - Math.round(box.tap.width * ratio))).toBeLessThan(1e-9);
        expect(Math.abs(box.drawing.left * ratio - Math.round(box.drawing.left * ratio))).toBeLessThan(1e-9);
        expect(Math.abs(box.drawing.top * ratio - Math.round(box.drawing.top * ratio))).toBeLessThan(1e-9);
        expect(box.drawing.left).toBeGreaterThanOrEqual(0);
        expect(box.drawing.left + box.drawing.width).toBeLessThanOrEqual(box.tap.width + 1 / ratio);
        expect(box.drawing.top + box.drawing.height).toBeLessThanOrEqual(box.tap.height + 1 / ratio);
      }
    }
  });
});

describe('pauseDrawing', () => {
  it('shows the two bars while the scene moves and the triangle while it is paused', () => {
    expect(pauseDrawing(false)).toBe(drawings['pause-bars']);
    expect(pauseDrawing(true)).toBe(drawings['pause-triangle']);
  });
});
