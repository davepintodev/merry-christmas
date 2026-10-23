// XMAS-42a: the share-preview picture, 1200 by 630, drawn by the fine layer.
// The owner approves the picture by eye on the frames page; the layout test
// below pins the globe's centring and the central 630 square.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sceneLayout } from '../src/scene/frame.ts';
import { BASE_WIDTH } from '../src/scene/base-fine.ts';
import { referenceProblems, updateReferences } from './frames.ts';
import { decodePng } from './png.ts';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, PREVIEW_ZOOM, renderPreview } from './preview-image.ts';
import { useTempDirs } from '../tests/helpers/temp.ts';

const tempDir = useTempDirs('xmas-preview-');

describe('renderPreview', () => {
  const bytes = renderPreview();

  it('is a PNG of exactly 1200 by 630, every pixel opaque', () => {
    expect([PREVIEW_WIDTH, PREVIEW_HEIGHT]).toEqual([1200, 630]);
    const png = decodePng(bytes);
    expect([png.width, png.height]).toEqual([1200, 630]);
    for (let i = 3; i < png.rgba.length; i += 4) if (png.rgba[i] !== 255) expect.fail(`pixel ${(i - 3) / 4} is not opaque`);
  });

  it('draws at a whole-number zoom that divides both sides, with hard edges: almost every zoom block is one colour', () => {
    expect(Number.isInteger(PREVIEW_ZOOM) && PREVIEW_ZOOM >= 1).toBe(true);
    expect(PREVIEW_WIDTH % PREVIEW_ZOOM).toBe(0);
    expect(PREVIEW_HEIGHT % PREVIEW_ZOOM).toBe(0);
    const { rgba } = decodePng(bytes);
    const at = (x: number, y: number) => (y * PREVIEW_WIDTH + x) * 4;
    // The fine layer's flakes sit at fractional places, so a few blocks are mixed by design.
    let mixed = 0;
    let blocks = 0;
    for (let by = 0; by < PREVIEW_HEIGHT; by += PREVIEW_ZOOM) {
      for (let bx = 0; bx < PREVIEW_WIDTH; bx += PREVIEW_ZOOM) {
        blocks++;
        const c = at(bx, by);
        let same = true;
        for (let y = by; y < by + PREVIEW_ZOOM; y++)
          for (let x = bx; x < bx + PREVIEW_ZOOM; x++) {
            const o = at(x, y);
            if (rgba[o] !== rgba[c] || rgba[o + 1] !== rgba[c + 1] || rgba[o + 2] !== rgba[c + 2]) same = false;
          }
        if (!same) mixed++;
      }
    }
    expect(mixed / blocks).toBeLessThan(0.05); // measured 2.05%; a smoothed upscale blurs every edge block
  });

  it('gives identical bytes on every call', () => {
    expect(Buffer.from(renderPreview()).equals(Buffer.from(bytes))).toBe(true);
  });

  it('centres the globe and keeps it and its base inside the central 630 square (columns 285 to 915)', () => {
    const { globe } = sceneLayout(PREVIEW_WIDTH / PREVIEW_ZOOM, PREVIEW_HEIGHT / PREVIEW_ZOOM, 31);
    expect(Math.abs(globe.cx * PREVIEW_ZOOM - PREVIEW_WIDTH / 2)).toBeLessThanOrEqual(PREVIEW_ZOOM);
    const lo = 285;
    const hi = 915;
    expect((globe.cx - globe.radius) * PREVIEW_ZOOM).toBeGreaterThanOrEqual(lo);
    expect((globe.cx + globe.radius) * PREVIEW_ZOOM).toBeLessThanOrEqual(hi);
    expect((globe.cx - BASE_WIDTH / 2) * PREVIEW_ZOOM).toBeGreaterThanOrEqual(lo);
    expect((globe.cx + BASE_WIDTH / 2) * PREVIEW_ZOOM).toBeLessThanOrEqual(hi);
  });

  it('is not a flat picture: it has several colours', () => {
    const { rgba } = decodePng(bytes);
    const seen = new Set<number>();
    for (let i = 0; i < rgba.length; i += 4) seen.add(((rgba[i] ?? 0) << 16) | ((rgba[i + 1] ?? 0) << 8) | (rgba[i + 2] ?? 0));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('preview as a reference picture', () => {
  it('updateReferences writes preview.png equal to renderPreview, and the check then passes', () => {
    const dir = tempDir();
    const written = updateReferences(dir).map((f) => path.basename(f));
    expect(written).toContain('preview.png');
    expect(Buffer.from(readFileSync(path.join(dir, 'preview.png'))).equals(Buffer.from(renderPreview()))).toBe(true);
    expect(referenceProblems(dir)).toEqual([]);
  });
});
