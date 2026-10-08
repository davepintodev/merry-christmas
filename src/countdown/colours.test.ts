// XMAS-27 "Countdown on a plain sky", part A: sky and ink per phase, mixed
// through the 30-minute blends. Every pure phase colour is a master colour.
import { describe, expect, it } from 'vitest';
import { masterColours, phaseColours } from '../../art/colours.ts';
import { phaseAt, type PhaseName } from '../shared/clock.ts';
import { mixHex, skyAndInk } from './colours.ts';

const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
const DARK: PhaseName[] = ['dawn', 'sunset', 'purple-night'];

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('phaseColours', () => {
  it('has sky and ink for each of the four phases, as lowercase #rrggbb master colours', () => {
    expect(Object.keys(phaseColours).sort()).toEqual([...PHASES].sort());
    for (const p of PHASES) {
      for (const key of ['sky', 'ink'] as const) {
        const c = phaseColours[p]?.[key];
        expect(c, `${p}.${key}`).toMatch(/^#[0-9a-f]{6}$/);
        expect(masterColours, `${p}.${key}`).toContain(c);
      }
    }
  });

  it('uses one gold ink on the dark phases (dawn, sunset, purple-night)', () => {
    const inks = DARK.map((p) => phaseColours[p]?.ink);
    expect(new Set(inks).size).toBe(1);
    const [r, g, b] = rgb(inks[0] ?? '#000000');
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThan(b);
    expect(g).toBeGreaterThanOrEqual(0.6 * r);
    expect(r).toBeGreaterThan(180);
  });

  it('uses red ink on frosty-morning, different from the gold', () => {
    const ink = phaseColours['frosty-morning']?.ink ?? '#000000';
    expect(ink).not.toBe(phaseColours.dawn?.ink);
    const [r, g, b] = rgb(ink);
    expect(r).toBeGreaterThan(120);
    expect(g).toBeLessThan(0.35 * r);
    expect(b).toBeLessThan(0.45 * r);
  });

  it('gives frosty-morning a lighter sky than each dark phase', () => {
    const light = luminance(phaseColours['frosty-morning']?.sky ?? '#000000');
    for (const p of DARK) expect(light, p).toBeGreaterThan(luminance(phaseColours[p]?.sky ?? '#ffffff'));
  });
});

describe('mixHex', () => {
  it('returns a at share 0 and b at share 1', () => {
    expect(mixHex('#0b1026', '#ffe08a', 0)).toBe('#0b1026');
    expect(mixHex('#0b1026', '#ffe08a', 1)).toBe('#ffe08a');
  });

  it('mixes each RGB channel on its own and rounds to the nearest integer', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080'); // 127.5 rounds up
    expect(mixHex('#ff0000', '#0000ff', 0.25)).toBe('#bf0040'); // 191.25 -> 191, 63.75 -> 64
    expect(mixHex('#102030', '#302010', 0.5)).toBe('#202020');
  });

  it('pads each channel to two lowercase hex digits', () => {
    expect(mixHex('#000000', '#0a0a0a', 0.5)).toBe('#050505');
    expect(mixHex('#000000', '#ffffff', 0.7)).toBe('#b3b3b3');
  });
});

describe('skyAndInk', () => {
  it('returns the table entry for a steady phase', () => {
    for (const p of PHASES) expect(skyAndInk({ from: p, to: p, share: 0 }), p).toEqual(phaseColours[p]);
  });

  it('returns the from colours at share 0 and the to colours at share 1', () => {
    expect(skyAndInk({ from: 'dawn', to: 'frosty-morning', share: 0 })).toEqual(phaseColours.dawn);
    expect(skyAndInk({ from: 'dawn', to: 'frosty-morning', share: 1 })).toEqual(phaseColours['frosty-morning']);
  });

  it.each([
    ['purple-night', 'dawn', 0.5],
    ['dawn', 'frosty-morning', 0.5],
    ['frosty-morning', 'sunset', 0.25],
    ['sunset', 'purple-night', 0.9],
  ] as [PhaseName, PhaseName, number][])('mixes sky and ink from %s to %s by share %s', (from, to, share) => {
    const a = phaseColours[from];
    const b = phaseColours[to];
    expect(skyAndInk({ from, to, share })).toEqual({
      sky: mixHex(a.sky, b.sky, share),
      ink: mixHex(a.ink, b.ink, share),
    });
  });

  it('mixes the ink between gold and red across the frosty-morning blends', () => {
    const mid = skyAndInk({ from: 'dawn', to: 'frosty-morning', share: 0.5 }).ink;
    expect(mid).not.toBe(phaseColours.dawn.ink);
    expect(mid).not.toBe(phaseColours['frosty-morning'].ink);
  });

  it('works on readings from the shared clock', () => {
    expect(skyAndInk(phaseAt(new Date(2026, 11, 1, 12, 0, 0)))).toEqual(phaseColours['frosty-morning']);
    expect(skyAndInk(phaseAt(new Date(2026, 11, 1, 23, 0, 0)))).toEqual(phaseColours['purple-night']);
    // 08:00 is the centre of the dawn -> frosty-morning blend.
    const mid = skyAndInk(phaseAt(new Date(2026, 11, 1, 8, 0, 0)));
    expect(mid.sky).toBe(mixHex(phaseColours.dawn.sky, phaseColours['frosty-morning'].sky, 0.5));
  });
});
