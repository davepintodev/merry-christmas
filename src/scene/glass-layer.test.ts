// XMAS-92a: the upright glass as a layer of its own (glassLayer), and sceneFrame's
// `glassApart` that leaves the glass out of the picture and shows the open backdrop
// where it stood. Fixtures follow lean.test.ts.
import { describe, expect, it } from 'vitest';
import { sceneFrame, type SceneInput } from './frame.ts';
import { BASE_SINK } from './globe.ts';
import { glassLayer } from './glass-layer.ts';
import { pictureWithOpenBackdrop } from './backdrop-lean.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';

const W = 400;
const H = 260;
const T = 1_000_000;
const SEED = 99;

function steady(phase: PhaseName): PhaseReading {
  return { from: phase, to: phase, share: 0 };
}

function input(over: Partial<SceneInput> = {}): SceneInput {
  return { time: T, drag: 0, phase: steady('purple-night'), seed: SEED, width: W, height: H, backdrop: true, shapeBodies: false, ...over };
}

/** Distance of a pixel's centre from the globe's centre, in art pixels. */
function dist(cx: number, cy: number, x: number, y: number): number {
  return Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
}

describe('glassLayer', () => {
  const frame = sceneFrame(input());
  const { cx, cy, radius } = frame.layout.globe;
  const phase = steady('purple-night');

  it.each([0, 1.3])('holds the colours the glass paints in the picture, at turn %s', (turn) => {
    const layer = glassLayer(frame.layout, phase, turn);
    expect(layer.pixels.length).toBe(layer.width * layer.height);
    // shapeBodies false leaves out Santa, the shapes and their shadows, so above the base the picture at a
    // glass pixel is the glass itself; the base and the cast shadow lie over the bottom rows, which are skipped.
    const picture = sceneFrame(input({ turn })).picture;
    const lastRow = frame.layout.groundTop - BASE_SINK;
    let compared = 0;
    for (let row = 0; row < layer.height; row++) {
      const y = layer.top + row;
      if (y >= lastRow) continue;
      for (let col = 0; col < layer.width; col++) {
        const colour = layer.pixels[row * layer.width + col] ?? 0;
        if (colour === 0) continue;
        compared++;
        if (picture[y * W + layer.left + col] !== colour) expect.fail(`layer pixel ${layer.left + col},${y} differs from the picture`);
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });

  it('has a box that holds the globe circle', () => {
    const layer = glassLayer(frame.layout, phase, 0);
    expect(layer.left).toBeLessThanOrEqual(Math.floor(cx - radius));
    expect(layer.left + layer.width).toBeGreaterThanOrEqual(Math.ceil(cx + radius));
    expect(layer.top).toBeLessThanOrEqual(Math.floor(cy - radius));
    expect(layer.top + layer.height).toBeGreaterThanOrEqual(Math.ceil(cy + radius));
  });

  it('is 0 outside the circle and non-zero on its centre row', () => {
    const layer = glassLayer(frame.layout, phase, 0);
    let middle = 0;
    for (let row = 0; row < layer.height; row++) {
      for (let col = 0; col < layer.width; col++) {
        const colour = layer.pixels[row * layer.width + col] ?? 0;
        const x = layer.left + col;
        const y = layer.top + row;
        if (dist(cx, cy, x, y) > radius && colour !== 0) expect.fail(`pixel ${x},${y} outside the circle is painted`);
        if (y === Math.floor(cy) && colour !== 0) middle++;
      }
    }
    expect(middle).toBeGreaterThan(radius);
  });

  it('turns the reflections: another turn gives another layer', () => {
    expect(glassLayer(frame.layout, phase, 2).pixels).not.toEqual(glassLayer(frame.layout, phase, 0).pixels);
  });
});

describe('sceneFrame with glassApart', () => {
  const shared = { turn: 0.8 };
  const glass = sceneFrame(input(shared));
  const apart = sceneFrame(input({ ...shared, glassApart: true }));
  const { cx, cy, radius } = glass.layout.globe;

  it('equals the picture with the glass outside the circle, and shows the open backdrop inside it', () => {
    const open = pictureWithOpenBackdrop(apart.picture, apart.layout, 'purple-night', 'purple-night', 0);
    const lastRow = glass.layout.groundTop - BASE_SINK;
    let differing = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = dist(cx, cy, x, y);
        const i = y * W + x;
        if (d > radius + 2 && apart.picture[i] !== glass.picture[i]) expect.fail(`pixel ${x},${y} outside the glass differs`);
        if (d < radius - 2 && y < lastRow) {
          if (apart.picture[i] !== open[i]) expect.fail(`pixel ${x},${y} inside the glass is not the open backdrop`);
          if (apart.picture[i] !== glass.picture[i]) differing++;
        }
      }
    }
    // The glass is really left out: much of the inside differs from the picture with the glass.
    expect(differing).toBeGreaterThan(2000);
  });

  it('shows the open backdrop, with hills and clouds, in the ring between the glass edge and the backdrop clip', () => {
    const open = pictureWithOpenBackdrop(apart.picture, apart.layout, 'purple-night', 'purple-night', 0);
    const lastRow = glass.layout.groundTop - BASE_SINK;
    let differing = 0;
    for (let y = 0; y < lastRow; y++) {
      for (let x = 0; x < W; x++) {
        const d = dist(cx, cy, x, y);
        if (d <= radius - 0.5 || d > radius + 1) continue;
        const i = y * W + x;
        if (apart.picture[i] !== open[i]) expect.fail(`ring pixel ${x},${y} is not the open backdrop`);
        if (apart.picture[i] !== glass.picture[i]) differing++;
      }
    }
    expect(differing).toBeGreaterThanOrEqual(30);
  });

  it.each([0.1, -0.16])('gives the same picture at lean %s as at lean 0, with Santa and the shapes drawn', (lean) => {
    const bodies = { ...shared, glassApart: true, shapeBodies: true };
    expect(sceneFrame(input({ ...bodies, lean })).picture).toEqual(sceneFrame(input({ ...bodies, lean: 0 })).picture);
  });

  it('draws the glass for glassApart false exactly as for a missing glassApart', () => {
    expect(sceneFrame(input({ ...shared, glassApart: false })).picture).toEqual(glass.picture);
    expect(apart.picture).not.toEqual(glass.picture);
  });
});
