// XMAS-27 "Countdown on a plain sky", part A: the countdown frame as pure
// pixels (0 = sky, and one value per ink role or shadow below). Glyphs come
// from the shared bitmap font at a whole art-pixel scale; the layout is fixed,
// so only a third day digit widens the frame.
import type { TimeLeft } from '../shared/clock.ts';
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyph, glyphWidth } from '../shared/font.ts';

export interface Frame { width: number; height: number; pixels: Uint8Array }

export const SKY_PIXEL = 0;
export const DIGIT_PIXEL = 1; // digits, greeting and blinking colons
export const LABEL_PIXEL = 2; // DAYS HRS MIN SEC
export const TITLE_PIXEL = 3; // UNTIL CHRISTMAS
export const SHADOW_PIXEL = 4; // drop shadow under the digits and greeting

const LETTER_GAP = 1; // blank art pixels between letters
const LINE_GAP = 2; // blank art pixels between the title, digits and labels
const GREETING_GAP = 1; // blank art pixels between MERRY and CHRISTMAS
const SHADOW_OFFSET = 1; // drop-shadow offset right and down, in art pixels

interface Group { digits: string; label: string }

/** A value in the two digits a countdown unit always shows, e.g. 7 -> "07". */
function two(value: number): string {
  return String(value).padStart(2, '0');
}

/** The four groups left to right; days grow to three digits at 100. */
function groups(t: TimeLeft): Group[] {
  return [
    { digits: two(t.days), label: 'DAYS' },
    { digits: two(t.hours), label: 'HRS' },
    { digits: two(t.minutes), label: 'MIN' },
    { digits: two(t.seconds), label: 'SEC' },
  ];
}

/** The drawn width of text, its letters one blank art pixel apart. */
function textWidth(text: string, scale: number): number {
  let width = 0;
  for (const char of text) width += (glyphWidth(char) + LETTER_GAP) * scale;
  return Math.max(0, width - LETTER_GAP * scale);
}

/** Draws one glyph, each font pixel a whole scale of art pixels. */
function drawGlyph(frame: Frame, char: string, scale: number, x: number, y: number, role = DIGIT_PIXEL): void {
  const shape = glyph(char);
  if (shape === undefined) return; // a character the font has no glyph for draws nothing
  for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
    for (let gx = 0; gx < shape.width; gx++) {
      if ((shape.pixels[gy * shape.width + gx] ?? 0) === 0) continue;
      for (let py = 0; py < scale; py++) {
        const row = (y + gy * scale + py) * frame.width + x + gx * scale;
        for (let px = 0; px < scale; px++) frame.pixels[row + px] = role;
      }
    }
  }
}

/** Draws text left to right at a scale; a space is a blank letter slot. */
function drawText(frame: Frame, text: string, scale: number, x: number, y: number, role = DIGIT_PIXEL): void {
  let at = x;
  for (const char of text) {
    drawGlyph(frame, char, scale, at, y, role);
    at += (glyphWidth(char) + LETTER_GAP) * scale;
  }
}

/** Draws text with a one-art-pixel drop shadow first, then digit ink on top. */
function drawShadowedText(frame: Frame, text: string, scale: number, x: number, y: number): void {
  drawText(frame, text, scale, x + SHADOW_OFFSET, y + SHADOW_OFFSET, SHADOW_PIXEL);
  drawText(frame, text, scale, x, y, DIGIT_PIXEL);
}

/** "UNTIL CHRISTMAS" with labels, four digit groups and the blinking colons. */
function countdown(t: TimeLeft, colonOn: boolean, digitScale: number): Frame {
  const parts = groups(t);
  const top = 'UNTIL CHRISTMAS';
  const colonStep = GLYPH_WIDTH * digitScale; // the colon's slot between groups
  const row = parts.reduce((sum, group) => sum + textWidth(group.digits, digitScale), 0) + 3 * colonStep;
  const width = Math.max(row + SHADOW_OFFSET, textWidth(top, 1));
  const digitsTop = GLYPH_HEIGHT + LINE_GAP;
  const labelsTop = digitsTop + GLYPH_HEIGHT * digitScale + LINE_GAP;
  const height = labelsTop + GLYPH_HEIGHT;
  const frame: Frame = { width, height, pixels: new Uint8Array(width * height) };

  drawText(frame, top, 1, (width - textWidth(top, 1)) >> 1, 0, TITLE_PIXEL);
  let x = (width - row) >> 1;
  for (const [i, group] of parts.entries()) {
    const digits = textWidth(group.digits, digitScale);
    drawShadowedText(frame, group.digits, digitScale, x, digitsTop);
    // A label wider than its group (DAYS at digit scale 2) starts at the frame's edge, not left of it.
    drawText(frame, group.label, 1, x + Math.max(0, (digits - textWidth(group.label, 1)) >> 1), labelsTop, LABEL_PIXEL);
    x += digits;
    if (i < parts.length - 1) {
      if (colonOn) drawGlyph(frame, ':', digitScale, x, digitsTop, DIGIT_PIXEL);
      x += colonStep;
    }
  }
  return frame;
}

/**
 * Christmas Day: MERRY over CHRISTMAS in the countdown's own font. CHRISTMAS
 * sits one blank row under MERRY, not two, and the frame keeps its height, so
 * its last inked row is one row above the frame's bottom and its drop shadow
 * sits on the bottom row. The page's two-row sky offset above the countdown
 * then puts that shadow row on the last row of the scene's reserved strip.
 */
function greeting(digitScale: number): Frame {
  const lines = ['MERRY', 'CHRISTMAS'];
  const line = GLYPH_HEIGHT * digitScale;
  const width = Math.max(...lines.map((text) => textWidth(text, digitScale))) + SHADOW_OFFSET;
  const height = line * lines.length + LINE_GAP * (lines.length - 1);
  const frame: Frame = { width, height, pixels: new Uint8Array(width * height) };
  lines.forEach((text, i) => {
    drawShadowedText(frame, text, digitScale, (width - textWidth(text, digitScale)) >> 1, i * (line + GREETING_GAP));
  });
  return frame;
}

/**
 * The countdown (or the greeting on Christmas Day) as pixels. digitScale is the
 * art pixels per font pixel for the digits, colons and greeting, 1 to 4; the
 * title and unit labels always stay at 1. The default, 4, is the full size.
 */
export function countdownFrame(t: TimeLeft, colonOn: boolean, digitScale = 4): Frame {
  return t.christmasDay ? greeting(digitScale) : countdown(t, colonOn, digitScale);
}
