// XMAS-30 "Contrast test and a stand-in colour table for Dawn": the countdown's
// one ink colour (digits, labels, greeting) reaches 4.5:1 against the sky behind
// it in every phase and at every tenth of every blend (spec 6.6). Goes through
// skyAndInk, so it checks the colours the page really draws. Snow is not counted.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colours, phaseColours } from '../../art/colours.ts';
import { phaseAt, type PhaseName } from '../shared/clock.ts';
import { skyAndInk } from './colours.ts';

const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
// The four blends; a test below checks this list against phaseAt.
const BLEND_PAIRS: [PhaseName, PhaseName][] = [
  ['purple-night', 'dawn'],
  ['dawn', 'frosty-morning'],
  ['frosty-morning', 'sunset'],
  ['sunset', 'purple-night'],
];
const TENTHS = Array.from({ length: 11 }, (_, i) => i / 10);
const MIN_RATIO = 4.5;

/** WCAG 2 relative luminance of a '#rrggbb' colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two '#rrggbb' colours, 1 to 21. */
function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function expectReadable(where: string, sky: string, ink: string): void {
  const ratio = contrast(sky, ink);
  expect(
    ratio,
    `${where}: ink ${ink} on sky ${sky} is ${ratio.toFixed(2)}:1, needs ${MIN_RATIO}:1`,
  ).toBeGreaterThanOrEqual(MIN_RATIO);
}

describe('contrast helper', () => {
  it('matches known WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrast('#ffffff', '#767676')).toBe(contrast('#767676', '#ffffff'));
  });
});

describe('countdown ink contrast (spec 6.6)', () => {
  it.each(PHASES)('reaches 4.5:1 on the steady %s sky', (phase) => {
    const { sky, ink } = skyAndInk({ from: phase, to: phase, share: 0 });
    expectReadable(phase, sky, ink);
  });

  const blendPoints = BLEND_PAIRS.flatMap(([from, to]) =>
    TENTHS.map((share) => [from, to, share] as [PhaseName, PhaseName, number]),
  );
  it.each(blendPoints)('reaches 4.5:1 on %s->%s at %s', (from, to, share) => {
    const { sky, ink } = skyAndInk({ from, to, share });
    expectReadable(`${from}->${to} at ${share}`, sky, ink);
  });

  it('uses one ink and one sky per reading, never a snow colour as the sky', () => {
    // Snow drifting over the digits is not counted, so no sky the countdown
    // sits on may be the snow colour itself.
    for (const p of PHASES) expect(phaseColours[p].sky, p).not.toBe(colours.snow);
  });

  it('covers exactly the blends the shared clock produces', () => {
    const seen: string[] = [];
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const r = phaseAt(new Date(2026, 11, 1, 0, minute, 0));
      if (r.from === r.to) continue;
      const key = `${r.from}->${r.to}`;
      if (!seen.includes(key)) seen.push(key);
    }
    const expected = BLEND_PAIRS.map(([f, t]) => `${f}->${t}`);
    expect([...seen].sort()).toEqual([...expected].sort());
  });
});

// Review finding (XMAS-30): tenths alone miss dips between them, so each blend is
// also walked one second at a time (30 minutes = 1800 steps).
const BLEND_SECONDS = 1800;
const FROSTY = (from: PhaseName, to: PhaseName) => from === 'frosty-morning' || to === 'frosty-morning';

function perSecond(from: PhaseName, to: PhaseName): { share: number; sky: string; ink: string }[] {
  return Array.from({ length: BLEND_SECONDS + 1 }, (_, i) => {
    const share = i / BLEND_SECONDS;
    return { share, ...skyAndInk({ from, to, share }) };
  });
}

describe('countdown ink contrast, every second of a blend', () => {
  it.each(BLEND_PAIRS)('reaches 4.5:1 at every second of %s->%s', (from, to) => {
    const low = perSecond(from, to)
      .map((p) => ({ ...p, ratio: contrast(p.sky, p.ink) }))
      .filter((p) => p.ratio < MIN_RATIO);
    const worst = low.reduce<(typeof low)[number] | undefined>((w, p) => (!w || p.ratio < w.ratio ? p : w), undefined);
    const message = worst
      ? `${from}->${to}: ${low.length} s below ${MIN_RATIO}:1 (first at ${low[0]!.share.toFixed(4)}); ` +
        `worst at ${worst.share.toFixed(4)}: ink ${worst.ink} on sky ${worst.sky} is ${worst.ratio.toFixed(2)}:1`
      : '';
    expect(low.length, message).toBe(0);
  });

  it.each(BLEND_PAIRS)('moves the %s->%s sky by at most 0.10 relative luminance per second', (from, to) => {
    const points = perSecond(from, to);
    let worst = { step: 0, at: 0 };
    for (let i = 1; i < points.length; i++) {
      const step = Math.abs(relativeLuminance(points[i]!.sky) - relativeLuminance(points[i - 1]!.sky));
      if (step > worst.step) worst = { step, at: i };
    }
    const at = worst.at;
    expect(
      worst.step,
      `${from}->${to}: sky ${points[at - 1]?.sky} -> ${points[at]?.sky} at ${(at / BLEND_SECONDS).toFixed(4)} ` +
        `moves ${worst.step.toFixed(3)} luminance in one second`,
    ).toBeLessThanOrEqual(0.1);
  });

  it.each(BLEND_PAIRS)('changes the %s->%s ink at most once (twice for a frosty-morning blend)', (from, to) => {
    const points = perSecond(from, to);
    const changes: string[] = [];
    for (let i = 1; i < points.length; i++) {
      if (points[i]!.ink !== points[i - 1]!.ink) {
        changes.push(`${points[i - 1]!.ink}->${points[i]!.ink} at ${points[i]!.share.toFixed(4)}`);
      }
    }
    const allowed = FROSTY(from, to) ? 2 : 1;
    expect(changes.length, `${from}->${to} ink changes: ${changes.slice(0, 5).join(', ')}`).toBeLessThanOrEqual(allowed);
  });
});

describe('dawn stand-in', () => {
  it('marks the dawn colours in art/colours.ts as a stand-in for the art pass', () => {
    const source = readFileSync(new URL('../../art/colours.ts', import.meta.url), 'utf8');
    const table = source.slice(source.indexOf('export const phaseColours'));
    const comment = source.slice(0, source.indexOf('export const phaseColours'));
    const lastComment = comment.slice(comment.lastIndexOf('// XMAS-'));
    expect(table.length, 'phaseColours table present').toBeGreaterThan(0);
    expect(lastComment).toMatch(/dawn/i);
    expect(lastComment).toMatch(/stand-in/i);
    expect(lastComment).toMatch(/art pass/i);
  });
});
