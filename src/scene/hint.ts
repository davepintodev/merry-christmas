// XMAS-41b1 "Drag model, scene side": the hint "DRAG TO SPIN AND STIR" under
// the base, drawn from the font glyphs one column apart and centred under the
// base, in the one table ink that reads on the snow in every phase and blend.
// It does not turn, lean or change with the Christmas Day state.
import { phaseColours } from '../../art/colours.ts';
import { glyph, glyphWidth, GLYPH_HEIGHT } from '../shared/font.ts';
import type { SceneLayout } from './frame.ts';

/** The one switch for the hint: false leaves it out on every screen (the owner wants to see the page without it for now); true brings it back where it fits. */
export const HINT_ENABLED = false;
const TEXT = 'DRAG TO SPIN AND STIR';
/** The font's one-column gap after each glyph. */
const GLYPH_GAP = 1;
/** The cast shadow reaches seven rows under the base (globe.ts); the hint starts two plain rows lower. */
const SHADOW_ROWS = 7;
const GAP = 2;
/** One plain row is kept at the bottom of the picture. */
const MARGIN = 1;
/** The frosty-morning ink: the only table ink that reaches 4.5:1 on the snow in every phase and blend. */
const INK = Number.parseInt(phaseColours['frosty-morning'].ink.slice(1), 16);
/** The text's width in art pixels: its last glyph's last column plus one. */
const TEXT_WIDTH = [...TEXT].reduce((sum, char) => sum + glyphWidth(char) + GLYPH_GAP, -GLYPH_GAP);

/**
 * Draws the hint under the base, centred on the globe, when all of it fits
 * above the bottom margin; otherwise draws nothing, so the text is never cut.
 * `baseHeight` is the base drawing's height in art pixels.
 */
export function paintHint(picture: Uint32Array, layout: SceneLayout, baseHeight: number): void {
  if (!HINT_ENABLED) return;
  const top = layout.groundTop + baseHeight + SHADOW_ROWS + GAP;
  if (top + GLYPH_HEIGHT > layout.height - MARGIN) return;
  let left = Math.round(layout.globe.cx - TEXT_WIDTH / 2);
  for (const char of TEXT) {
    const stroke = glyph(char);
    if (stroke !== undefined) {
      for (let row = 0; row < stroke.height; row++) {
        for (let column = 0; column < stroke.width; column++) {
          if ((stroke.pixels[row * stroke.width + column] ?? 0) !== 0) picture[(top + row) * layout.width + left + column] = INK;
        }
      }
    }
    left += glyphWidth(char) + GLYPH_GAP;
  }
}
