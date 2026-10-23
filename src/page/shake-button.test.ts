// XMAS-43b: the shake button's picture, as a pure function. The DOM wiring is checked in the browser (tests/browser/shake.spec.ts).
import { describe, expect, it } from 'vitest';
import { drawings } from '../shared/art.generated.ts';
import { glyph, glyphWidth } from '../shared/font.ts';
import { SHAKE_TEXT, shakeButtonPicture } from './shake-button.ts';

const TEXT_WIDTH = [...SHAKE_TEXT].reduce((sum, c) => sum + glyphWidth(c) + 1, -1);

describe('shakeButtonPicture', () => {
  const frame = drawings['shake-frame']!;
  const pic = shakeButtonPicture();
  const at = (x: number, y: number) => pic.pixels[y * pic.width + x];

  it('reads TAP TO TURN ON SHAKE', () => {
    expect(SHAKE_TEXT).toBe('TAP TO TURN ON SHAKE');
  });

  it('keeps the frame height and ends, stretched wide enough for the 79-pixel text', () => {
    expect(pic.height).toBe(frame.height);
    expect(pic.width).toBeGreaterThanOrEqual(TEXT_WIDTH + 2);
    expect(pic.pixels.length).toBe(pic.width * pic.height);
    for (let y = 0; y < frame.height; y++) {
      expect(at(0, y), `left edge ${y}`).toBe(frame.pixels[y * frame.width]);
      expect(at(pic.width - 1, y), `right edge ${y}`).toBe(frame.pixels[y * frame.width + frame.width - 1]);
    }
  });

  it('draws the font glyphs of the text, one column apart, centred inside', () => {
    const left = Math.floor((pic.width - TEXT_WIDTH) / 2);
    const top = Math.floor((pic.height - 5) / 2);
    let x = 0;
    let lit = 0;
    for (const c of SHAKE_TEXT) {
      const g = glyph(c);
      if (g !== undefined) {
        g.pixels.forEach((n, i) => {
          if (n === 0) return;
          lit++;
          const px = at(left + x + (i % g.width), top + Math.floor(i / g.width));
          expect(px, `${c} pixel ${i}`).toBe(n);
        });
      }
      x += glyphWidth(c) + 1;
    }
    expect(lit).toBeGreaterThan(0);
  });
});
