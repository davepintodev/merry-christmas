// XMAS-70 "Background too plain in every phase": the backdrop plan (clouds, hills,
// pines, scenery, floor details) is the same for the same layout, and keeps off
// the countdown's strip and the glass. Hand-built layouts, no mocks.
import { describe, expect, it } from 'vitest';
import { backdropFor, covered, makeBackdrop } from './backdrop.ts';
import { BIRD, BULB, OUTLINE, SMOKE, WINDOW } from './backdrop-codes.ts';
import { sceneFrame, sceneLayout, type SceneLayout } from './frame.ts';

const SIZES: [number, number][] = [[130, 260], [240, 180], [320, 200], [120, 420]];
const PHASES = ['dawn', 'frosty-morning', 'sunset', 'purple-night'] as const;

function plan(layout: SceneLayout): number[] {
  return Array.from(makeBackdrop(layout).codes);
}

describe('the backdrop scenery', () => {
  it('draws the cabin (lit window, smoke), the lit tree and the characters on a wide picture', () => {
    const { codes } = makeBackdrop(sceneLayout(300, 190, 31));
    for (const code of [OUTLINE, WINDOW, SMOKE, BULB, BIRD]) expect(codes.includes(code), `code ${code}`).toBe(true);
  });

  it('shows no birds at night and keeps them by day', () => {
    const layout = sceneLayout(300, 190, 31);
    const birds = (phase: 'purple-night' | 'frosty-morning'): number => {
      const plain = sceneFrame({ time: 0, drag: 0, phase: { from: phase, to: phase, share: 0 }, seed: 31, width: 300, height: 190, backdrop: false });
      const full = sceneFrame({ time: 0, drag: 0, phase: { from: phase, to: phase, share: 0 }, seed: 31, width: 300, height: 190 });
      const { codes } = makeBackdrop(layout);
      let shown = 0;
      codes.forEach((code, i) => {
        if (code === BIRD && full.picture[i] !== plain.picture[i]) shown++;
      });
      return shown;
    };
    expect(birds('purple-night')).toBe(0);
    expect(birds('frosty-morning')).toBeGreaterThan(0);
  });
});

describe('the backdrop plan', () => {
  it.each(SIZES)('is the same for the same layout and seed at %i x %i, and differs between seeds', (width, height) => {
    expect(plan(sceneLayout(width, height, 7))).toEqual(plan(sceneLayout(width, height, 7)));
    expect(plan(sceneLayout(width, height, 7))).not.toEqual(plan(sceneLayout(width, height, 8)));
  });

  it.each(SIZES)('draws something above and below the horizon at %i x %i', (width, height) => {
    const layout = sceneLayout(width, height, 7);
    const { codes } = makeBackdrop(layout);
    const rows = (from: number, to: number): number => codes.slice(from * width, to * width).filter((c) => c !== 0).length;
    expect(rows(layout.groundTop - 12, layout.groundTop)).toBeGreaterThan(width);
    expect(rows(layout.groundTop, height)).toBeGreaterThan(0);
  });

  it.each(SIZES)('keeps off the countdown strip and the glass in the sky rows at %i x %i', (width, height) => {
    const layout = sceneLayout(width, height, 7);
    const backdrop = backdropFor(layout);
    const { globe, countdown } = layout;
    for (let y = 0; y < layout.groundTop; y++) {
      for (let x = 0; x < width; x++) {
        if (!covered(backdrop, x, y)) continue;
        expect(y, `pixel ${x},${y} is on the strip`).toBeGreaterThanOrEqual(countdown.y + countdown.height);
        const dx = x + 0.5 - globe.cx;
        const dy = y + 0.5 - globe.cy;
        expect(dx * dx + dy * dy, `pixel ${x},${y} is inside the glass`).toBeGreaterThan(globe.radius ** 2);
      }
    }
  });

  it.each(PHASES)('leaves the countdown strip as plain sky in %s', (phase) => {
    const f = sceneFrame({ time: 0, drag: 0, phase: { from: phase, to: phase, share: 0 }, seed: 7, width: 130, height: 260 });
    const strip = f.layout.countdown.height;
    for (let y = 0; y < strip; y++) {
      for (let x = 1; x < f.width; x++) expect(f.picture[y * f.width + x]).toBe(f.picture[y * f.width]);
    }
  });
});
