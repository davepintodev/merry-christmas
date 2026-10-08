// XMAS-27 "Countdown on a plain sky", part A: the countdown frame as pure
// pixels (1 = ink, 0 = sky). Glyphs come from the shared bitmap font at a
// whole art-pixel scale; the layout is fixed, so only a third day digit
// widens the frame.
import type { TimeLeft } from '../shared/clock.ts';
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyph } from '../shared/font.ts';

export interface Frame { width: number; height: number; pixels: Uint8Array }

const DIGIT_SCALE = 4; // art pixels per font pixel for the digits and greeting
const LETTER_STEP = GLYPH_WIDTH + 1; // one blank art pixel between letters
const LINE_GAP = 2; // blank art pixels between the title, digits and labels
const COLON_STEP = GLYPH_WIDTH * DIGIT_SCALE; // the colon's slot between groups

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
  return text.length * LETTER_STEP * scale - scale;
}

/** Draws one glyph, each font pixel a whole scale of art pixels. */
function drawGlyph(frame: Frame, char: string, scale: number, x: number, y: number): void {
  const shape = glyph(char);
  if (shape === undefined) return; // a character the font has no glyph for draws nothing
  for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
    for (let gx = 0; gx < GLYPH_WIDTH; gx++) {
      if ((shape.pixels[gy * GLYPH_WIDTH + gx] ?? 0) === 0) continue;
      for (let py = 0; py < scale; py++) {
        const row = (y + gy * scale + py) * frame.width + x + gx * scale;
        for (let px = 0; px < scale; px++) frame.pixels[row + px] = 1;
      }
    }
  }
}

/** Draws text left to right at a scale; a space is a blank letter slot. */
function drawText(frame: Frame, text: string, scale: number, x: number, y: number): void {
  let at = x;
  for (const char of text) {
    drawGlyph(frame, char, scale, at, y);
    at += LETTER_STEP * scale;
  }
}

/** "UNTIL CHRISTMAS" with labels, four digit groups and the blinking colons. */
function countdown(t: TimeLeft, colonOn: boolean): Frame {
  const parts = groups(t);
  const top = 'UNTIL CHRISTMAS';
  const row = parts.reduce((sum, group) => sum + textWidth(group.digits, DIGIT_SCALE), 0) + 3 * COLON_STEP;
  const width = Math.max(row, textWidth(top, 1));
  const digitsTop = GLYPH_HEIGHT + LINE_GAP;
  const labelsTop = digitsTop + GLYPH_HEIGHT * DIGIT_SCALE + LINE_GAP;
  const height = labelsTop + GLYPH_HEIGHT;
  const frame: Frame = { width, height, pixels: new Uint8Array(width * height) };

  drawText(frame, top, 1, (width - textWidth(top, 1)) >> 1, 0);
  let x = (width - row) >> 1;
  for (const [i, group] of parts.entries()) {
    const digits = textWidth(group.digits, DIGIT_SCALE);
    drawText(frame, group.digits, DIGIT_SCALE, x, digitsTop);
    drawText(frame, group.label, 1, x + ((digits - textWidth(group.label, 1)) >> 1), labelsTop);
    x += digits;
    if (i < parts.length - 1) {
      if (colonOn) drawGlyph(frame, ':', DIGIT_SCALE, x, digitsTop);
      x += COLON_STEP;
    }
  }
  return frame;
}

/** Christmas Day: MERRY over CHRISTMAS in the countdown's own font. */
function greeting(): Frame {
  const lines = ['MERRY', 'CHRISTMAS'];
  const line = GLYPH_HEIGHT * DIGIT_SCALE;
  const width = Math.max(...lines.map((text) => textWidth(text, DIGIT_SCALE)));
  const height = line * lines.length + LINE_GAP * (lines.length - 1);
  const frame: Frame = { width, height, pixels: new Uint8Array(width * height) };
  lines.forEach((text, i) => {
    drawText(frame, text, DIGIT_SCALE, (width - textWidth(text, DIGIT_SCALE)) >> 1, i * (line + LINE_GAP));
  });
  return frame;
}

export function countdownFrame(t: TimeLeft, colonOn: boolean): Frame {
  return t.christmasDay ? greeting() : countdown(t, colonOn);
}
