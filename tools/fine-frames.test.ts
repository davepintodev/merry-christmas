// XMAS-85: fineFrame, the fine layer's picture of a scene input without a browser.
import { describe, expect, it } from 'vitest';
import { sceneFrame } from '../src/scene/frame.ts';
import { fineFrame } from './fine-frames.ts';
import { referenceFrames } from './frames.ts';

const input = (name: string) => {
  const ref = referenceFrames.find((r) => r.name === name);
  if (ref === undefined) throw new Error(`no reference ${name}`);
  return ref.input;
};
const base = input('purple-night');

describe('fineFrame', () => {
  it.each([0, 2.5, -1, 1.0000001, NaN, Infinity])('throws a RangeError for zoom %s', (zoom) => {
    expect(() => fineFrame(base, zoom)).toThrow(RangeError);
  });

  it.each([Infinity, -Infinity, NaN])('throws for a turn of %s', (turn) => {
    expect(() => fineFrame({ ...base, turn }, 1)).toThrow();
  });

  it.each([0.5, -0.5, 3])('throws a RangeError for a lean of %s', (lean) => {
    expect(() => fineFrame({ ...base, lean }, 1)).toThrow(RangeError);
  });

  it('accepts a lean of exactly 0', () => {
    expect(() => fineFrame({ ...base, lean: 0 }, 1)).not.toThrow();
  });

  it('is 650 x 1300 opaque RGBA at the default zoom of 5', () => {
    const f = fineFrame(base);
    expect([f.width, f.height]).toEqual([650, 1300]);
    expect(f.rgba.length).toBe(650 * 1300 * 4);
    for (let i = 3; i < f.rgba.length; i += 4 * 997) expect(f.rgba[i]).toBe(255);
    expect(f.rgba[f.rgba.length - 1]).toBe(255);
  });

  it.each([1, 2, 3, 5])('scales with zoom %s', (zoom) => {
    const f = fineFrame(base, zoom);
    expect([f.width, f.height]).toEqual([130 * zoom, 260 * zoom]);
    expect(f.rgba.length).toBe(f.width * f.height * 4);
  });

  it('gives the same picture for the same input twice', () => {
    const a = fineFrame(base, 2);
    const b = fineFrame(base, 2);
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true);
  });

  it('does not change its input', () => {
    const before = JSON.stringify({ ...base, snow: undefined });
    fineFrame({ ...base, turn: 1 }, 1);
    expect(JSON.stringify({ ...base, snow: undefined })).toBe(before);
  });

  it('draws a turned input differently from turn 0, and different turns differently from each other', () => {
    const at = (turn: number) => Buffer.from(fineFrame({ ...base, turn }, 1).rgba);
    expect(at(0).equals(at(1.5))).toBe(false);
    expect(at(1.5).equals(at(2.5))).toBe(false);
    // A whole turn is the same picture as none.
    expect(at(0).equals(at(2 * Math.PI))).toBe(true);
  });

  it('draws snow where there is snow and none where there is not', () => {
    const snowy = input('snow-calm');
    expect(snowy.snow).toBeDefined();
    const withSnow = Buffer.from(fineFrame(snowy, 2).rgba);
    const without = Buffer.from(fineFrame({ ...snowy, snow: undefined }, 2).rgba);
    expect(withSnow.equals(without)).toBe(false);
  });

  it('carries fine-layer content: at zoom 5 it differs from the coarse picture scaled up, inside the glass only', () => {
    const turned = input('purple-night-turn-45');
    const zoom = 5;
    const coarse = sceneFrame(turned); // with the bodies, at the art's own pixels
    const fine = fineFrame(turned, zoom);
    const { cx, cy, radius } = coarse.layout.globe;
    let differ = 0;
    for (let y = 0; y < fine.height; y++) {
      for (let x = 0; x < fine.width; x++) {
        const c = coarse.picture[Math.floor(y / zoom) * coarse.width + Math.floor(x / zoom)] ?? 0;
        const i = (y * fine.width + x) * 4;
        const same = fine.rgba[i] === ((c >> 16) & 255) && fine.rgba[i + 1] === ((c >> 8) & 255) && fine.rgba[i + 2] === (c & 255);
        if (same) continue;
        differ++;
        const ax = x / zoom;
        const ay = y / zoom;
        const onBase = ay >= coarse.layout.groundTop;
        if (!onBase && (ax - cx) ** 2 + (ay - cy) ** 2 > (radius + 2) ** 2) expect.fail(`pixel ${x},${y} differs from the coarse picture outside the glass`);
      }
    }
    expect(differ, 'pixels where the fine edges differ from the blocky ones').toBeGreaterThan(200);
  });

  it('is built of the art pixel grid outside the glass: the sky is whole zoom x zoom blocks', () => {
    const zoom = 5;
    const f = fineFrame(base, zoom);
    for (const [ax, ay] of [[2, 2], [10, 5], [120, 8]] as const) {
      const at = (dx: number, dy: number) => (( ay * zoom + dy) * f.width + ax * zoom + dx) * 4;
      for (let dy = 0; dy < zoom; dy++) {
        for (let dx = 0; dx < zoom; dx++) {
          for (let k = 0; k < 3; k++) expect(f.rgba[at(dx, dy) + k]).toBe(f.rgba[at(0, 0) + k]);
        }
      }
    }
  });
});
