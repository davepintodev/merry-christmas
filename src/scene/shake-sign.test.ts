// XMAS-125 "Shake button covers the base lettering": the shake sign's placement in art pixels, its picture and its
// colours, and the scene's bunny sitting at its end. The DOM button is checked in the browser (tests/browser/shake.spec.ts).
import { describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { mixHex } from '../countdown/colours.ts';
import { pagePixels } from '../page/pixel.ts';
import type { PhaseName } from '../shared/clock.ts';
import { glyph, glyphWidth } from '../shared/font.ts';
import { backdropFor, covered } from './backdrop.ts';
import { sceneLayout } from './frame.ts';
import { BOARD, SHAKE_TEXT, signInks, signPicture, signPlace } from './shake-sign.ts';

const layoutAt = (width: number, height: number, dpr: number) => {
  const p = pagePixels({ width, height }, dpr);
  return sceneLayout(p.width, p.height, 1);
};
const baseBottom = (layout: { groundTop: number }) => layout.groundTop + 23;
const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];

describe('signPlace', () => {
  it('on the shortest strip (390x664@3) the board sits on the snow right of the buttons, under the base, with the short bunny at its end', () => {
    const layout = layoutAt(390, 664, 3);
    const at = signPlace(layout, 29);
    expect(at.box.y).toBeGreaterThanOrEqual(baseBottom(layout));
    expect(at.box.y + at.box.height).toBeLessThanOrEqual(layout.height);
    expect(at.box.x).toBeGreaterThanOrEqual(29 + 3);
    expect(at.foot).toBeNull();
    expect(at.bunny).toEqual({ x: at.board.x + BOARD.width - 1, bottom: expect.any(Number), short: true });
    expect(at.bunny!.bottom - 10).toBeGreaterThanOrEqual(baseBottom(layout));
    expect(at.bunny!.x + 13).toBeLessThan(layout.width);
  });

  it('on a deep strip (320x568@2) the board stands on stakes and the bunny keeps its full ears, still under the base', () => {
    const layout = layoutAt(320, 568, 2);
    const at = signPlace(layout, 39);
    expect(at.foot).not.toBeNull();
    expect(at.box.y).toBeGreaterThanOrEqual(baseBottom(layout));
    expect(at.bunny!.short).toBe(false);
    expect(at.bunny!.bottom - 12).toBeGreaterThanOrEqual(baseBottom(layout));
  });

  it('on a wide window the sign stands on stakes midway between the base and the right edge, and the bunny stays home', () => {
    const layout = layoutAt(1920, 1130, 1);
    const at = signPlace(layout, 16);
    const baseRight = layout.globe.cx + 56;
    expect(at.box.x).toBeGreaterThan(baseRight);
    expect(at.box.x + at.box.width).toBeLessThan(layout.width);
    expect(Math.abs(at.board.x + BOARD.width / 2 - (baseRight + layout.width) / 2)).toBeLessThanOrEqual(1);
    expect(at.foot).toBe(baseBottom(layout) - 2);
    expect(at.bunny).toBeNull();
  });
});

describe('signPicture', () => {
  it('reads TAP TO SHAKE in the 3x5 font, in the text ink, on a board as wide as the words and its padding', () => {
    expect(SHAKE_TEXT).toBe('TAP TO SHAKE');
    const textWidth = [...SHAKE_TEXT].reduce((sum, c) => sum + glyphWidth(c) + 1, -1);
    expect(BOARD).toEqual({ width: textWidth + 8, height: 9 });
    const layout = layoutAt(390, 664, 3);
    const at = signPlace(layout, 29);
    const inks = signInks({ from: 'purple-night', to: 'purple-night', share: 0 });
    const pic = signPicture(at, inks);
    expect(pic.width).toBe(at.box.width);
    expect(pic.height).toBe(at.box.height);
    let x = at.board.x - at.box.x + 4;
    const y = at.board.y - at.box.y + 2;
    for (const c of SHAKE_TEXT) {
      const g = glyph(c);
      g?.pixels.forEach((n, i) => {
        const px = pic.colours[(y + Math.floor(i / g.width)) * pic.width + x + (i % g.width)];
        expect(px, `${c} pixel ${i}`).toBe(n === 0 ? inks.board : inks.text);
      });
      x += glyphWidth(c) + 1;
    }
  });
});

describe('signInks', () => {
  it('every phase draws in at most ten master colours, and a blend mixes the two phases as the backdrop does', () => {
    const master = new Set(masterColours);
    for (const phase of PHASES) {
      const inks = Object.values(signInks({ from: phase, to: phase, share: 0 }));
      expect(inks.filter((c) => !master.has(c)), phase).toEqual([]);
      expect(new Set(inks).size).toBeLessThanOrEqual(10);
    }
    const a = signInks({ from: 'sunset', to: 'sunset', share: 0 });
    const b = signInks({ from: 'purple-night', to: 'purple-night', share: 0 });
    const mid = signInks({ from: 'sunset', to: 'purple-night', share: 0.25 });
    expect(mid.board).toBe(mixHex(a.board, b.board, 0.25));
    expect(mid.text).toBe(mixHex(a.text, b.text, 0.25));
  });
});

describe('the scene bunny by the sign', () => {
  it('sits at the spot it is given, facing left, and leaves its home patch; without a spot it stays home', () => {
    const layout = layoutAt(390, 664, 3);
    const spot = signPlace(layout, 29).bunny!;
    const homeX = layout.globe.cx + 8;
    const homeBottom = layout.height - 3;
    const home = backdropFor(layout);
    expect(covered(home, homeX + 6, homeBottom - 3)).toBe(true);
    const moved = backdropFor(layout, spot);
    expect(covered(moved, homeX + 6, homeBottom - 3)).toBe(false);
    // Facing left: the tail puff (light fur) is at its right end, the nose at its left.
    expect(covered(moved, spot.x + 12, spot.bottom - 2)).toBe(true);
    expect(covered(moved, spot.x + 6, spot.bottom - 3)).toBe(true);
    for (let x = 0; x < layout.width; x++) {
      for (let y = 0; y < baseBottom(layout); y++) if (covered(moved, x, y)) expect(covered(home, x, y), `${x},${y}`).toBe(true);
    }
    expect(backdropFor(layout).codes).toEqual(home.codes);
  });
});
