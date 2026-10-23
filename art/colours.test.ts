// XMAS-26 "Art build step and the rough Font sheet": the master colour list.
// Colour number n is masterColours[n - 1]; colour number 0 is transparent, so
// the list holds at most 255 colours to fit one byte per pixel.
import { describe, expect, it } from 'vitest';
import { colours, masterColours } from './colours.ts';

describe('masterColours', () => {
  it('holds only lowercase #rrggbb strings', () => {
    for (const c of masterColours) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('has no colour twice, so every colour has one colour number', () => {
    expect(new Set(masterColours).size).toBe(masterColours.length);
  });

  it('fits colour numbers 1..255 in one byte', () => {
    expect(masterColours.length).toBeLessThanOrEqual(255);
  });

  it('is started from the visual-direction prototype colours (at least 50 of them)', () => {
    expect(masterColours.length).toBeGreaterThanOrEqual(50);
  });

  it('includes snow white and the midnight background', () => {
    expect(masterColours).toContain('#ffffff');
    expect(masterColours).toContain('#0b1026');
  });

  it('includes every named colour the code already uses', () => {
    for (const [name, hex] of Object.entries(colours)) expect(masterColours, name).toContain(hex.toLowerCase());
  });
});
