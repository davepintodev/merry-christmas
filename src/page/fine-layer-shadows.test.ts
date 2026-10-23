// XMAS-82 "Shadows on the fine layer", split from fine-layer.test.ts so neither
// file runs long: the floor shadows the layer fills on the fake page (see
// tests/helpers/fine-page.ts), checked against the CPU renderer's shadows.
import { describe, expect, it } from 'vitest';
import { globeShapes, onFloor } from '../scene/shapes.ts';
import { renderShadowSteps, shadowDrawList } from '../scene/shape-draw-list.ts';
import { IDENTITY, type Point } from '../../tests/helpers/matrix.ts';
import { BH, BOX, BW, ctxOf, frame, fresh, H, LAYOUT, layersOf, near, setup, SITE, useFakePage, W, type FakeContext, type Fill } from '../../tests/helpers/fine-page.ts';

useFakePage();

// XMAS-82 "Shadows on the fine layer": each shape's floor shadow is a flat polygon filled on the shapes layer before the bodies,
// clipped to the floor disc, with today's shade and strength, on the device pixel grid.
/** Colour and strength a fill resolves to: the style's own alpha times the context's globalAlpha. */
function resolved(fill: Fill): { rgb: number; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(fill.style);
  if (hex) return { rgb: Number.parseInt(hex[1] ?? '0', 16), alpha: fill.alpha };
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(fill.style);
  if (!fn) return { rgb: -1, alpha: Number.NaN };
  return { rgb: (Number(fn[1]) << 16) | (Number(fn[2]) << 8) | Number(fn[3]), alpha: fill.alpha * (fn[4] === undefined ? 1 : Number(fn[4])) };
}

/** The device pixels (of a w x h canvas) a context's fills cover, after their clips. */
function covered(ctx: FakeContext, w: number, h: number): Set<number> {
  const out = new Set<number>();
  for (const fill of ctx.fills) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (fill.region(x + 0.5, y + 0.5) && fill.clips.every((c) => c(x + 0.5, y + 0.5))) out.add(y * w + x);
    }
  }
  return out;
}

describe('makeFineLayer: the shadows', () => {
  const k = SITE.scale;

  it('fills all the shadows in one path and one fill (a pixel under two takes the shade once), in the shadow ink at the shadow strength, before the first face', () => {
    const { main, layer } = setup();
    for (const turn of [0.4, 2.2]) {
      layer.draw(frame({ turn }), SITE);
      const ctx = ctxOf(layersOf(main).shapes);
      const { fills } = ctx;
      expect(fills.length).toBe(1);
      expect(fills.length).toBeLessThanOrEqual(globeShapes.length);
      for (const fill of fills) {
        const { rgb, alpha } = resolved(fill);
        expect(rgb).toBe(0x1d3350);
        expect(alpha).toBeCloseTo(0.32, 9);
      }
      // The shadows are under the shapes.
      expect(Math.max(...fills.map((f) => f.seq))).toBeLessThan(Math.min(...ctx.drawAt));
      ctx.fills.length = 0;
      ctx.drawAt.length = 0;
    }
  });

  it('covers the device pixels renderShadowSteps covers at the same scale: the same shadow on the screen\'s grid, disc clip included', () => {
    for (const turn of [0.4, 1.7, 3.0, 5.9]) {
      const { main, layer } = fresh();
      layer.draw(frame({ turn }), SITE);
      const dw = BW * k;
      const dh = BH * k;
      const mine = covered(ctxOf(layersOf(main).shapes), dw, dh);
      // The CPU renderer at zoom k over the whole picture; the layer is its box at (BOX.left, BOX.top).
      const picture = new Uint32Array(W * k * H * k);
      renderShadowSteps(picture, W, LAYOUT, shadowDrawList(turn), k);
      const want = new Set<number>();
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) if (picture[(y + BOX.top * k) * W * k + x + BOX.left * k] !== 0) want.add(y * dw + x);
      }
      expect(want.size).toBeGreaterThan(200);
      let mismatches = 0;
      for (const i of want) if (!mine.has(i)) mismatches += 1;
      for (const i of mine) if (!want.has(i)) mismatches += 1;
      expect(mismatches).toBeLessThanOrEqual(Math.ceil(want.size * 0.01));
    }
  });

  for (const site of [SITE, { scale: 5, ratio: 2, left: 0 }, { scale: 2, ratio: 1, left: 9 }]) {
    it(`puts no shadow pixel outside the floor disc, at scale ${site.scale} and several turns`, () => {
      const { cx, cy } = LAYOUT.globe;
      for (const turn of [0, 0.4, 2.5, 4.4]) {
        const { main, layer } = fresh();
        layer.draw(frame({ turn }), site);
        const dw = BW * site.scale;
        const cover = covered(ctxOf(layersOf(main).shapes), dw, BH * site.scale);
        expect(cover.size).toBeGreaterThan(0);
        const outside: number[] = [];
        for (const i of cover) {
          const ax = BOX.left + (((i % dw) + 0.5) / site.scale) - cx;
          const ay = BOX.top + (Math.floor(i / dw) + 0.5) / site.scale - cy;
          // A device pixel centre on the disc's rim may go either way by float; the disc is only 1 / scale wider.
          if (!onFloorLoose(ax, ay, 1 / site.scale)) outside.push(i);
        }
        expect(outside, `device pixels outside the disc, scale ${site.scale}, turn ${turn}`).toEqual([]);
      }
    }, 30000);
  }

  it('puts the disc clip around the fills: unclipped, the shadows would reach outside the disc', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    // Each fill is made inside a clip (the disc), and at least one polygon alone reaches past it.
    for (const fill of ctx.fills) expect(fill.clips.length).toBeGreaterThan(0);
    const cutBy = (fills: Fill[]): number => {
      let cut = 0;
      for (const fill of fills) {
        for (let y = 0; y < BH * k; y++) for (let x = 0; x < BW * k; x++) if (fill.region(x + 0.5, y + 0.5) && !fill.clips.every((c) => c(x + 0.5, y + 0.5))) cut += 1;
      }
      return cut;
    };
    // Some shape stands near the rim for at least one turn: sweep and require the clip to have cut something.
    let cut = cutBy(ctx.fills);
    for (const turn of [1.0, 2.0, 3.0, 4.0, 5.0]) {
      ctx.fills.length = 0;
      layer.draw(frame({ turn }), SITE);
      cut += cutBy(ctx.fills);
    }
    expect(cut).toBeGreaterThan(0);
  });

  it('moves with the shapes on the device grid: a small turn moves a polygon vertex by a fraction of an art pixel, not a whole one', () => {
    const { main, layer } = setup();
    const ox = (LAYOUT.globe.cx - BOX.left) * k;
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    const before = ctx.fills.splice(0).map((f) => f.points);
    layer.draw(frame({ turn: 0.403 }), SITE);
    const after = ctx.fills.splice(0).map((f) => f.points);
    expect(after).toHaveLength(before.length);
    // The distance from (x, y) to the nearest edge of the points: the fill's rings are flat here, so the edges between them count too, which can only shorten a distance.
    const outlineDistance = (pts: readonly Point[], x: number, y: number): number => {
      let best = Number.POSITIVE_INFINITY;
      pts.forEach(([ax = 0, ay = 0], i) => {
        const [bx = 0, by = 0] = pts[(i + 1) % pts.length] ?? [];
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
      });
      return best;
    };
    let moved = 0;
    let offGrid = 0;
    before.forEach((pts, n) => {
      pts.forEach(([x, y]) => {
        const d = outlineDistance(after[n] ?? [], x, y);
        if (d > 1e-9) moved += 1;
        expect(d).toBeLessThan(k); // under a whole art pixel
        // Not on the art pixel grid: the vertex is not a whole number of art pixels from the globe's centre.
        const art = (x - ox) / k;
        if (Math.abs(art - Math.round(art)) > 1e-6) offGrid += 1;
      });
    });
    expect(moved).toBeGreaterThan(0);
    expect(offGrid).toBeGreaterThan(0);
  });

  it('draws the same shadows for a whole turn more, and a negative turn', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    const base = ctx.fills.splice(0).map((f) => f.points);
    for (const turn of [0.4 + 2 * Math.PI, 0.4 - 2 * Math.PI]) {
      layer.draw(frame({ turn }), SITE);
      const again = ctx.fills.splice(0).map((f) => f.points);
      expect(again).toHaveLength(base.length);
      again.forEach((pts, n) => pts.forEach((p, i) => expect(near(p, base[n]?.[i] ?? [])).toBe(true)));
    }
  });

  it('does not keep last frame\'s shadows (the layer is cleared before the fills of a frame), and restores the context so the disc clip does not leak', () => {
    const { main, layer } = setup();
    layer.draw(frame({ turn: 0.4 }), SITE);
    const ctx = ctxOf(layersOf(main).shapes);
    const clears = ctx.clears.length;
    const fills = ctx.fills.length;
    layer.draw(frame({ turn: 0.9 }), SITE);
    expect(ctx.clears.length).toBeGreaterThan(clears);
    expect(ctx.fills.length).toBeGreaterThan(fills);
    expect(ctx.fills[fills]?.seq).toBeGreaterThan(-1);
    expect(ctx.restores).toBe(ctx.saves);
    expect(ctx.matrix).toEqual(IDENTITY);
  });
});

/** The floor disc test, allowing the rim to be `slack` art units off (a device pixel's own width). */
function onFloorLoose(x: number, y: number, slack: number): boolean {
  return onFloor(x, y) || [[slack, 0], [-slack, 0], [0, slack], [0, -slack]].some(([dx = 0, dy = 0]) => onFloor(x + dx, y + dy));
}
