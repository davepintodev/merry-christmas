// XMAS-32a "The globe", slice 1: in-between shades. blendShade mixes two
// 0xRRGGBB colours by a coverage share; edgeCoverage gives how much of one art
// pixel column lies left of an edge at a fractional x, so a sliding edge is
// drawn as an in-between shade on the grid instead of jumping whole pixels.
import { describe, expect, it } from 'vitest';
import { blendShade, edgeCoverage } from './blend.ts';

describe('blendShade', () => {
  it('gives the under shade at coverage 0 and the over shade at coverage 1', () => {
    expect(blendShade(0x1a1433, 0xffe08a, 0)).toBe(0x1a1433);
    expect(blendShade(0x1a1433, 0xffe08a, 1)).toBe(0xffe08a);
  });

  it('gives the in-between shade at the midpoint, channel by channel', () => {
    expect(blendShade(0x000000, 0xc8c8c8, 0.5)).toBe(0x646464);
    expect(blendShade(0x204060, 0x4080a0, 0.5)).toBe(0x306080);
  });

  it('mixes each channel on its own, to the nearest whole value', () => {
    // red 255 -> 0 at 0.25 is 191.25; blue 0 -> 255 is 63.75; green stays 0.
    expect(blendShade(0xff0000, 0x0000ff, 0.25)).toBe(0xbf0040);
  });

  it('moves towards over as coverage grows (never back)', () => {
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const red = (blendShade(0x100000, 0xf00000, i / 20) >> 16) & 255;
      expect(red).toBeGreaterThanOrEqual(last);
      last = red;
    }
  });

  it.each([
    [-0.5, 0x123456],
    [-Infinity, 0x123456],
    [1.5, 0xfedcba],
    [Infinity, 0xfedcba],
  ])('clamps coverage %s to 0..1', (coverage, want) => {
    expect(blendShade(0x123456, 0xfedcba, coverage)).toBe(want);
  });

  it('treats a NaN coverage as 0 (the under shade), like a NaN phase share', () => {
    expect(blendShade(0x123456, 0xfedcba, Number.NaN)).toBe(0x123456);
  });

  it('returns a whole 0xRRGGBB colour number for any coverage', () => {
    for (let i = 0; i <= 100; i++) {
      const c = blendShade(0x0b1026, 0xffffff, i / 100);
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('gives the same shade for the same inputs every time', () => {
    const a = blendShade(0x7d2a2e, 0xffffff, 0.37);
    for (let i = 0; i < 5; i++) expect(blendShade(0x7d2a2e, 0xffffff, 0.37)).toBe(a);
  });

  it('gives the shade itself when under and over are the same, at any coverage', () => {
    for (const c of [0, 0.3, 0.5, 1]) expect(blendShade(0x5a1f3a, 0x5a1f3a, c)).toBe(0x5a1f3a);
  });
});

describe('edgeCoverage(edge, column): the share of column..column+1 left of the edge', () => {
  it.each([
    [3.25, 3, 0.25],
    [3.75, 3, 0.75],
    [3.25, 2, 1],
    [3.25, 4, 0],
    [3, 3, 0],
    [4, 3, 1],
    [-0.75, -1, 0.25],
    [0.5, 0, 0.5],
  ])('edge %s over column %s covers %s', (edge, column, want) => {
    expect(edgeCoverage(edge, column)).toBeCloseTo(want, 12);
  });

  it('stays in 0..1 and never grows from column to column', () => {
    const edge = 10.4;
    let last = 1;
    for (let column = 0; column < 20; column++) {
      const c = edgeCoverage(edge, column);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(last);
      last = c;
    }
  });

  it('keeps a span\'s ink: the coverage between two edges, summed over columns, is the span\'s length', () => {
    for (const [a, b] of [[2.3, 5.3], [2.3, 2.9], [7, 10], [-1.6, 1.15]] as const) {
      let ink = 0;
      for (let column = -5; column < 15; column++) ink += edgeCoverage(b, column) - edgeCoverage(a, column);
      expect(ink).toBeCloseTo(b - a, 12);
    }
  });

  it('moves a fraction of a pixel when the edge moves a fraction of a pixel', () => {
    const before = edgeCoverage(5.2, 5);
    const after = edgeCoverage(5.21, 5);
    expect(after - before).toBeCloseTo(0.01, 12);
  });
});
