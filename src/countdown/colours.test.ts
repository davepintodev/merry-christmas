// XMAS-27 "Countdown on a plain sky", part A: sky and ink per phase, mixed
// through the 30-minute blends. Every pure phase colour is a master colour.
import { describe, expect, it } from 'vitest';
import { masterColours, phaseColours } from '../../art/colours.ts';
import { phaseAt, type PhaseName } from '../shared/clock.ts';
import { mixHex, skyAndInk } from './colours.ts';

const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
const DARK: PhaseName[] = ['dawn', 'sunset', 'purple-night'];
const BLEND_PAIRS: [PhaseName, PhaseName][] = [
  ['purple-night', 'dawn'],
  ['dawn', 'frosty-morning'],
  ['frosty-morning', 'sunset'],
  ['sunset', 'purple-night'],
];
const TENTHS = Array.from({ length: 11 }, (_, i) => i / 10);

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

  // XMAS-30: only the two dark-to-dark blends are pinned to a plain linear mix.
  // The blends into and out of frosty-morning may bend the mix (a bridge colour
  // or an ink swap) so the countdown keeps 4.5:1; contrast.test.ts holds them.
  it.each(
    (['purple-night->dawn', 'sunset->purple-night'] as const).flatMap((pair) =>
      TENTHS.map((share) => [...(pair.split('->') as [PhaseName, PhaseName]), share] as [PhaseName, PhaseName, number]),
    ),
  )('mixes sky and ink linearly from %s to %s by share %s', (from, to, share) => {
    const a = phaseColours[from];
    const b = phaseColours[to];
    expect(skyAndInk({ from, to, share })).toEqual({
      sky: mixHex(a.sky, b.sky, share),
      ink: mixHex(a.ink, b.ink, share),
    });
  });

  it.each(BLEND_PAIRS)('gives the exact table colours at share 0 and 1 of %s -> %s', (from, to) => {
    expect(skyAndInk({ from, to, share: 0 })).toEqual(phaseColours[from]);
    expect(skyAndInk({ from, to, share: 1 })).toEqual(phaseColours[to]);
  });

  it.each(BLEND_PAIRS)('gives a lowercase #rrggbb sky and ink at every tenth of %s -> %s', (from, to) => {
    for (const share of TENTHS) {
      const { sky, ink } = skyAndInk({ from, to, share });
      expect(sky, `${from}->${to} sky at ${share}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(ink, `${from}->${to} ink at ${share}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('works on readings from the shared clock', () => {
    expect(skyAndInk(phaseAt(new Date(2026, 11, 1, 12, 0, 0)))).toEqual(phaseColours['frosty-morning']);
    expect(skyAndInk(phaseAt(new Date(2026, 11, 1, 23, 0, 0)))).toEqual(phaseColours['purple-night']);
    // 06:30 is the centre of the purple-night -> dawn blend, a plain linear mix.
    const mid = skyAndInk(phaseAt(new Date(2026, 11, 1, 6, 30, 0)));
    expect(mid.sky).toBe(mixHex(phaseColours['purple-night'].sky, phaseColours.dawn.sky, 0.5));
    // 08:00 is the centre of the dawn -> frosty-morning blend; its shape is free.
    expect(skyAndInk(phaseAt(new Date(2026, 11, 1, 8, 0, 0)))).toEqual(
      skyAndInk({ from: 'dawn', to: 'frosty-morning', share: 0.5 }),
    );
  });
});
