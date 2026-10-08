// XMAS-27 "Countdown on a plain sky", part A: the countdown's colours, mixed
// through the 30-minute blends. The phase table lives in art/colours.ts, so
// the countdown and the scene always agree on a phase.
import type { PhaseReading } from '../shared/clock.ts';
import { phaseColours } from '../../art/colours.ts';

/** One channel of a '#rrggbb' colour, as a 0-255 number. */
function channel(hex: string, at: number): number {
  return Number.parseInt(hex.slice(at, at + 2), 16);
}

/** Mixes two '#rrggbb' colours by share, rounding each channel. */
export function mixHex(a: string, b: string, share: number): string {
  const s = Math.min(1, Math.max(0, share));
  const mixed = [1, 3, 5].map((at) => {
    const value = channel(a, at) * (1 - s) + channel(b, at) * s;
    return Math.round(value).toString(16).padStart(2, '0');
  });
  return `#${mixed.join('')}`;
}

/** The sky and ink a phase reading asks for, both mixed by its share. */
export function skyAndInk(reading: PhaseReading): { sky: string; ink: string } {
  const from = phaseColours[reading.from];
  const to = phaseColours[reading.to];
  return {
    sky: mixHex(from.sky, to.sky, reading.share),
    ink: mixHex(from.ink, to.ink, reading.share),
  };
}
