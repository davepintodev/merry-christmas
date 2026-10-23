// XMAS-41b1 "Drag model, scene side": the hint "DRAG TO SPIN AND STIR" under
// the globe, drawn from the Font sheet (3x5 glyphs, one column apart), centred
// under the base, in one ink that reads on the ground in every phase and blend.
// It does not turn, lean or change with the Christmas Day state.
// XMAS-68: the hint is switched off (HINT_ENABLED in hint.ts) while the owner
// looks at the page without it; these tests hold it off. Its on-screen tests
// were removed with the switch off: bring them back from git history (before
// the test cleanup) if the hint is switched on again.
import { describe, expect, it } from 'vitest';
import { BASE_ROWS } from './base-fine.ts';
import { MIN_HEIGHT, sceneFrame, sceneLayout, type SceneFrame, type SceneInput } from './frame.ts';
import { BASE_SINK } from './globe.ts';
import { HINT_ENABLED, hintText, paintHint } from './hint.ts';
import { at } from '../../tests/helpers/scene.ts';
import { steady } from '../../tests/helpers/phase.ts';

const HINT = 'DRAG TO SPIN AND STIR';
/** The base's rows below the horizon: its top BASE_SINK rows rise over the glass's foot. */
const BASE_HEIGHT = BASE_ROWS - BASE_SINK;
/** The cast shadow (globe.ts) tints rows belowBase .. belowBase + 6, under the base's middle; the hint starts under that. */
const SHADOW_ROWS = 7;
const SEED = 4242;

function input(over: Partial<SceneInput> = {}): SceneInput {
  return { time: 1_000_000, drag: 0, phase: steady('purple-night'), seed: SEED, width: 130, height: 260, backdrop: false, ...over };
}

/** First row under the base. */
function belowBase(f: SceneFrame): number {
  return f.layout.groundTop + BASE_HEIGHT;
}

/** The hint's pixels: everything under the base and its cast shadow that is not the row's plain ground (read at column 0). */
function hintPixels(f: SceneFrame): { x: number; y: number; c: number }[] {
  const out: { x: number; y: number; c: number }[] = [];
  for (let y = belowBase(f) + SHADOW_ROWS; y < f.height; y++) {
    const ground = at(f, 0, y);
    for (let x = 0; x < f.width; x++) if (at(f, x, y) !== ground) out.push({ x, y, c: at(f, x, y) });
  }
  return out;
}

const whenOff = describe.skipIf(HINT_ENABLED);

whenOff('the hint while it is switched off', () => {
  it('draws nothing under the base at any height, in any phase', () => {
    for (let height = MIN_HEIGHT; height <= 330; height += 7) {
      for (const reading of [steady('purple-night'), steady('frosty-morning')]) {
        expect(hintPixels(sceneFrame(input({ height, phase: reading }))), `height ${height}`).toEqual([]);
      }
    }
  });

  it('leaves the picture untouched when paintHint is called, though the text would fit', () => {
    const layout = sceneLayout(130, 330, SEED);
    const picture = new Uint32Array(130 * 330).fill(0x123456);
    paintHint(picture, layout, BASE_HEIGHT);
    expect(picture.every((c) => c === 0x123456)).toBe(true);
  });
});

describe('the hint text', () => {
  it('changes to "SHAKE OR DRAG ME" only when shake is live', () => {
    expect(hintText(true)).toBe('SHAKE OR DRAG ME');
    expect(hintText(false)).toBe(HINT);
  });
});
