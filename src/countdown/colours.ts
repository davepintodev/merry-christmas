// XMAS-27 "Countdown on a plain sky", part A: the countdown's colours, mixed
// through the 30-minute blends. The phase table lives in art/colours.ts, so
// the countdown and the scene always agree on a phase.
// XMAS-30 "Contrast test and a stand-in colour table for Dawn": a straight mix
// across a frosty-morning blend passes through mid-tones where neither phase
// ink reads (spec 6.6), so those two blends step the sky across that band in
// one tick and hold the ink in midnight while neither phase ink reaches the
// floor.
import type { PhaseReading } from '../shared/clock.ts';
import { colours, phaseColours } from '../../art/colours.ts';
import { contrast, MIN_CONTRAST_RATIO, relativeLuminance } from './contrast.ts';

/** A share, clamped to 0..1; a NaN counts as 0, so it cannot leak '#NaNNaNNaN'. */
function clampShare(share: number): number {
  return Number.isNaN(share) ? 0 : Math.min(1, Math.max(0, share));
}

/** One channel of a '#rrggbb' colour, as a 0-255 number. */
function channel(hex: string, at: number): number {
  return Number.parseInt(hex.slice(at, at + 2), 16);
}

/** Mixes two '#rrggbb' colours by share, rounding each channel. */
export function mixHex(a: string, b: string, share: number): string {
  const s = clampShare(share);
  const mixed = [1, 3, 5].map((at) => {
    const value = channel(a, at) * (1 - s) + channel(b, at) * s;
    return Math.round(value).toString(16).padStart(2, '0');
  });
  return `#${mixed.join('')}`;
}

const FROSTY_MORNING = 'frosty-morning';
/** The ink the frosty-morning blends fall back to while neither phase ink reads. */
const BRIDGE = colours.midnight; // '#0b1026'
/** Share of a frosty-morning blend where its sky steps across the band of sky
 *  luminance no ink reaches 4.5:1 on (spec 6.6); the step of 0.086 relative
 *  luminance sits under spec 8.11's 0.10 flash threshold. */
const STEP_SHARE = 0.4;
/** The brightest sky gold ink reads at 4.5:1 on: the band's dark edge. */
const DARK_EDGE = '#5c617f';
/** The darkest sky midnight ink reads at 4.5:1 on: the band's light edge. */
const LIGHT_EDGE = '#737da2';

/** The sky of a frosty-morning blend: a ramp to the band edge nearer `from`, a
 *  single step across the band, then a ramp out to the far end. */
function bridgeSky(from: string, to: string, share: number): string {
  const [near, far] =
    relativeLuminance(to) > relativeLuminance(from) ? [DARK_EDGE, LIGHT_EDGE] : [LIGHT_EDGE, DARK_EDGE];
  return share <= STEP_SHARE
    ? mixHex(from, near, share / STEP_SHARE)
    : mixHex(far, to, (share - STEP_SHARE) / (1 - STEP_SHARE));
}

/** The ink of a frosty-morning blend: a phase ink while it reads, else the bridge. */
function bridgeInk(from: string, to: string, sky: string): string {
  if (contrast(sky, from) >= MIN_CONTRAST_RATIO) return from;
  if (contrast(sky, to) >= MIN_CONTRAST_RATIO) return to;
  // Neither reads on this sky: stay with the nearer one until the bridge takes
  // over, so the ink swaps where the two contrast curves cross.
  const nearer = contrast(sky, from) >= contrast(sky, to) ? from : to;
  return contrast(sky, nearer) >= contrast(sky, BRIDGE) ? nearer : BRIDGE;
}

/** The sky and ink a phase reading asks for, both mixed by its share. */
export function skyAndInk(reading: PhaseReading): { sky: string; ink: string } {
  const from = phaseColours[reading.from];
  const to = phaseColours[reading.to];
  const share = clampShare(reading.share);
  if (reading.from === reading.to || share === 0) return { sky: from.sky, ink: from.ink };
  if (share === 1) return { sky: to.sky, ink: to.ink };
  if (reading.from !== FROSTY_MORNING && reading.to !== FROSTY_MORNING) {
    return { sky: mixHex(from.sky, to.sky, share), ink: mixHex(from.ink, to.ink, share) };
  }
  const sky = bridgeSky(from.sky, to.sky, share);
  return { sky, ink: bridgeInk(from.ink, to.ink, sky) };
}
