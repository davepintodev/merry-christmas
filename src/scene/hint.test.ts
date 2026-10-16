// XMAS-41b1 "Drag model, scene side": the hint "DRAG TO SPIN AND STIR" under
// the globe, drawn from the Font sheet (3x5 glyphs, one column apart), centred
// under the base, in one ink that reads on the ground in every phase and blend.
// It does not turn, lean or change with the Christmas Day state.
// XMAS-68: the hint is switched off (HINT_ENABLED in hint.ts) while the owner
// looks at the page without it. The suites that describe the hint on screen run
// when the switch is on; the suite that holds it off runs while it is off.
import { describe, expect, it } from 'vitest';
import { masterColours, phaseColours } from '../../art/colours.ts';
import { contrast, MIN_CONTRAST_RATIO } from '../countdown/contrast.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { glyph, glyphWidth, GLYPH_HEIGHT } from '../shared/font.ts';
import { BASE_ROWS } from './base-fine.ts';
import { MIN_HEIGHT, sceneFrame, sceneLayout, type SceneFrame, type SceneInput } from './frame.ts';
import { BASE_SINK } from './globe.ts';
import { HINT_ENABLED, paintHint } from './hint.ts';
import { createGlobeSnow } from './snow.ts';

const HINT = 'DRAG TO SPIN AND STIR';
/** The base's rows below the horizon: its top BASE_SINK rows rise over the glass's foot. */
const BASE_HEIGHT = BASE_ROWS - BASE_SINK;
const GAP = 2;
const MARGIN = 1;
/** The cast shadow (globe.ts) tints rows belowBase .. belowBase + 6, under the base's middle; the hint starts under that. */
const SHADOW_ROWS = 7;
/** Free rows under the base that surely leave no room (the shadow's 6 rows or more, 2 gap, 5 text, 1 margin: fewer than 14), and that surely leave room (the shadow's rows too). The layout keeps 12 under the base at the shortest picture. */
const SURELY_HIDDEN_BELOW = 14;
const SURELY_SHOWN_FROM = SHADOW_ROWS + GAP + GLYPH_HEIGHT + MARGIN;
const SEED = 4242;

const HINT_WIDTH = [...HINT].reduce((sum, c) => sum + glyphWidth(c) + 1, -1);

function steady(phase: PhaseName): PhaseReading {
  return { from: phase, to: phase, share: 0 };
}

const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
const PAIRS = [
  ['purple-night', 'dawn'],
  ['dawn', 'frosty-morning'],
  ['frosty-morning', 'sunset'],
  ['sunset', 'purple-night'],
] as const;
const READINGS: PhaseReading[] = [
  ...PHASES.map(steady),
  ...PAIRS.flatMap(([from, to]) => Array.from({ length: 11 }, (_, i): PhaseReading => ({ from, to, share: i / 10 }))),
];

function input(over: Partial<SceneInput> = {}): SceneInput {
  return { time: 1_000_000, drag: 0, phase: steady('purple-night'), seed: SEED, width: 130, height: 260, backdrop: false, ...over };
}

function at(f: SceneFrame, x: number, y: number): number {
  return f.picture[y * f.width + x] ?? -1;
}

/** First row under the base. */
function belowBase(f: SceneFrame): number {
  return f.layout.groundTop + BASE_HEIGHT;
}

function freeRows(f: SceneFrame): number {
  return f.height - belowBase(f);
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

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** The lit pixels the font gives the hint text, as offsets from its top left. */
function expectedOffsets(): Set<string> {
  const lit = new Set<string>();
  let x = 0;
  for (const c of HINT) {
    const g = glyph(c);
    if (g !== undefined) {
      for (let row = 0; row < g.height; row++) {
        for (let col = 0; col < g.width; col++) if ((g.pixels[row * g.width + col] ?? 0) !== 0) lit.add(`${x + col},${row}`);
      }
    }
    x += glyphWidth(c) + 1;
  }
  return lit;
}

const whenOn = describe.skipIf(!HINT_ENABLED);
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

whenOn('the hint under the globe', () => {
  it('draws exactly the font glyphs of "DRAG TO SPIN AND STIR", one column apart', () => {
    const f = sceneFrame(input());
    const px = hintPixels(f);
    expect(px.length).toBeGreaterThan(0);
    const left = Math.min(...px.map((p) => p.x));
    const top = Math.min(...px.map((p) => p.y));
    const found = new Set(px.map((p) => `${p.x - left},${p.y - top}`));
    expect(found).toEqual(expectedOffsets());
  });

  it('centres the text under the base, within a column', () => {
    for (const [width, height] of [[130, 260], [112, 260], [201, 300], [400, 280]] as const) {
      const f = sceneFrame(input({ width, height }));
      const px = hintPixels(f);
      const left = Math.min(...px.map((p) => p.x));
      const right = Math.max(...px.map((p) => p.x));
      expect(right - left + 1, `${width}: text width`).toBe(HINT_WIDTH);
      expect(Math.abs(left + HINT_WIDTH / 2 - f.layout.globe.cx), `${width}: off centre`).toBeLessThanOrEqual(1);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThan(width);
    }
  });

  it('sits at least 2 rows under the base and leaves at least 1 row at the bottom', () => {
    for (const height of [230, 260, 300]) {
      const f = sceneFrame(input({ height }));
      const ys = hintPixels(f).map((p) => p.y);
      expect(Math.min(...ys), `${height}: too near the shadow`).toBeGreaterThanOrEqual(belowBase(f) + SHADOW_ROWS + GAP);
      expect(Math.max(...ys), `${height}: too near the bottom`).toBeLessThanOrEqual(f.height - 1 - MARGIN);
      expect(Math.max(...ys) - Math.min(...ys) + 1).toBe(GLYPH_HEIGHT);
    }
  });

  it('is hidden at the shortest picture, where only the base margin is left under the base', () => {
    const f = sceneFrame(input({ width: 130, height: MIN_HEIGHT }));
    expect(freeRows(f)).toBe(12);
    // Every row under the base is plain ground or its shadow: no room for the text.
    expect(hintPixels(f)).toEqual([]);
  });

  it('hides when under 14 rows are free under the base and shows from 15 free rows', () => {
    let shown = 0;
    let hidden = 0;
    for (let height = MIN_HEIGHT; height <= 330; height++) {
      const f = sceneFrame(input({ height }));
      const px = hintPixels(f);
      if (freeRows(f) >= SURELY_SHOWN_FROM) {
        shown++;
        expect(px.length, `height ${height} (${freeRows(f)} free rows) should show the hint`).toBeGreaterThan(0);
      } else if (freeRows(f) < SURELY_HIDDEN_BELOW) {
        hidden++;
        expect(px, `height ${height} (${freeRows(f)} free rows) should hide the hint`).toEqual([]);
      }
    }
    expect(shown).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
  });

  it('never draws a partial hint: whole text or none, at every height', () => {
    for (let height = MIN_HEIGHT; height <= 330; height++) {
      const n = hintPixels(sceneFrame(input({ height }))).length;
      expect([0, expectedOffsets().size], `height ${height}`).toContain(n);
    }
  });

  it('has 35 free rows at 130 x 260, so the hint shows', () => {
    const f = sceneFrame(input());
    expect(freeRows(f)).toBe(35);
    expect(hintPixels(f).length).toBeGreaterThan(0);
  });

  it('fits the narrowest picture whole', () => {
    const f = sceneFrame(input({ width: 112 }));
    expect(hintPixels(f).length).toBe(expectedOffsets().size);
  });

  it('draws every hint pixel in one colour, from the master list', () => {
    for (const reading of READINGS) {
      const colours = new Set(hintPixels(sceneFrame(input({ phase: reading }))).map((p) => hex(p.c)));
      expect(colours.size, `${reading.from} -> ${reading.to} at ${reading.share}`).toBe(1);
      for (const c of colours) expect(masterColours).toContain(c);
    }
  });

  it('uses an ink of the phase colour table, the same one in every phase and blend', () => {
    const inks = new Set<string>();
    for (const reading of READINGS) for (const p of hintPixels(sceneFrame(input({ phase: reading })))) inks.add(hex(p.c));
    expect(inks.size).toBe(1);
    const [ink] = [...inks];
    expect(Object.values(phaseColours).map((p) => p.ink)).toContain(ink);
  });

  it('reaches 4.5:1 against the ground it sits on in all four phases and every tenth of each blend', () => {
    const failures: string[] = [];
    for (const reading of READINGS) {
      const f = sceneFrame(input({ phase: reading }));
      const px = hintPixels(f);
      if (px.length === 0) failures.push(`${reading.from} -> ${reading.to} at ${reading.share}: no hint`);
      for (const p of px) {
        const ratio = contrast(hex(p.c), hex(at(f, 0, p.y)));
        if (ratio < MIN_CONTRAST_RATIO) failures.push(`${reading.from} -> ${reading.to} at ${reading.share}: ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('draws the same hint pixels in every phase', () => {
    const where = (r: PhaseReading): string[] => hintPixels(sceneFrame(input({ phase: r }))).map((p) => `${p.x},${p.y}`);
    const first = where(steady('dawn'));
    for (const r of READINGS) expect(where(r)).toEqual(first);
  });
});

whenOn('what the hint ignores', () => {
  const underBase = (f: SceneFrame): Uint32Array => f.picture.slice(belowBase(f) * f.width);

  it('does not turn with the globe', () => {
    const flat = underBase(sceneFrame(input()));
    expect(flat.length).toBeGreaterThan(0);
    for (const turn of [0.5, Math.PI, -2, 100]) expect(underBase(sceneFrame(input({ turn })))).toEqual(flat);
  });

  it('does not lean with the globe', () => {
    const flat = underBase(sceneFrame(input()));
    for (const lean of [0.5, -0.5, 0.1]) expect(underBase(sceneFrame(input({ lean })))).toEqual(flat);
  });

  it('does not change with the Christmas Day state of the globe snow', () => {
    const ordinary = sceneFrame(input({ snow: createGlobeSnow(3, false) }));
    const christmas = sceneFrame(input({ snow: createGlobeSnow(3, true) }));
    expect(underBase(christmas)).toEqual(underBase(ordinary));
    expect(hintPixels(christmas).length).toBeGreaterThan(0);
  });

  it('does not change with the seed or the time', () => {
    const flat = underBase(sceneFrame(input()));
    expect(underBase(sceneFrame(input({ seed: 1, time: 5_000 })))).toEqual(flat);
  });

  it('keeps the cast shadow of the base clear of the hint: 2 plain rows between them', () => {
    const f = sceneFrame(input());
    for (let y = belowBase(f) + SHADOW_ROWS; y < belowBase(f) + SHADOW_ROWS + GAP; y++) {
      for (let x = 0; x < f.width; x++) expect(at(f, x, y), `gap pixel ${x},${y}`).toBe(at(f, 0, y));
    }
  });
});
