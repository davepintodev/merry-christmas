// XMAS-27 "Countdown on a plain sky", part A: the countdown frame as pure
// pixels (1 = ink, 0 = sky). Glyphs are found by matching scaled copies of
// the font's bitmaps, so the tests pin layout without fixing exact offsets.
import { describe, expect, it } from 'vitest';
import type { TimeLeft } from '../shared/clock.ts';
import { glyph, glyphWidth } from '../shared/font.ts';
import { countdownFrame, type Frame } from './render.ts';

const left = (days: number, hours: number, minutes: number, seconds: number): TimeLeft => ({
  christmasDay: false,
  days,
  hours,
  minutes,
  seconds,
});
const CHRISTMAS: TimeLeft = { christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
const ZERO = left(0, 0, 0, 0);

interface Box { x: number; y: number; w: number; h: number }

function at(f: Frame, x: number, y: number): number {
  return f.pixels[y * f.width + x] ?? -1;
}

/** True when the glyph for `ch`, scaled by `s`, sits exactly at (x, y). */
function matchesAt(f: Frame, ch: string, s: number, x: number, y: number): boolean {
  const g = glyph(ch);
  if (g === undefined) throw new Error(`no glyph ${ch}`);
  if (x < 0 || y < 0 || x + g.width * s > f.width || y + g.height * s > f.height) return false;
  for (let gy = 0; gy < g.height * s; gy++) {
    for (let gx = 0; gx < g.width * s; gx++) {
      const want = (g.pixels[Math.floor(gy / s) * g.width + Math.floor(gx / s)] ?? 0) !== 0 ? 1 : 0;
      if (at(f, x + gx, y + gy) !== want) return false;
    }
  }
  return true;
}

function findAll(f: Frame, ch: string, s: number): { x: number; y: number }[] {
  const hits: { x: number; y: number }[] = [];
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) if (matchesAt(f, ch, s, x, y)) hits.push({ x, y });
  return hits;
}

/** A glyph's own width in font pixels (M is 5, the rest 3). */
function widthOf(ch: string): number {
  return glyph(ch)?.width ?? 3;
}

/** A word drawn at scale s, each letter its own width plus a gap of 1 or 2 scaled pixels; its box, or undefined. */
function findWord(f: Frame, word: string, s: number): Box | undefined {
  const first = word[0] ?? '';
  for (const { x, y } of findAll(f, first, s)) {
    for (const gap of [1, 2]) {
      let cursor = x;
      let ok = true;
      for (const ch of word) {
        if (!matchesAt(f, ch, s, cursor, y)) {
          ok = false;
          break;
        }
        cursor += (widthOf(ch) + gap) * s;
      }
      if (ok) return { x, y, w: cursor - x - gap * s, h: 5 * s };
    }
  }
  return undefined;
}

function findWordAnyScale(f: Frame, word: string): Box & { s: number } {
  for (let s = 1; s <= 32; s++) {
    const box = findWord(f, word, s);
    if (box !== undefined) return { ...box, s };
  }
  throw new Error(`word ${word} not found in frame`);
}

/** The digit scale: the largest s >= 2 at which eight scaled zeros show in the all-zero frame. */
function digitScale(): number {
  const f = countdownFrame(ZERO, true);
  for (let s = 32; s >= 2; s--) if (findAll(f, '0', s).length >= 8) return s;
  throw new Error('no scaled digits found in the all-zero frame');
}

/** Digit cells (top-left corners) left to right, read from the all-zero frame. */
function digitCells(s: number): { x: number; y: number }[] {
  return findAll(countdownFrame(ZERO, true), '0', s).sort((a, b) => a.x - b.x);
}

function readDigits(f: Frame, s: number, cells: { x: number; y: number }[]): string {
  return cells
    .map(({ x, y }) => [...'0123456789'].find((d) => matchesAt(f, d, s, x, y)) ?? '?')
    .join('');
}

describe('countdownFrame: shape of the frame', () => {
  it('is row-major with width*height pixels, each 0 (sky) or 1 (ink)', () => {
    for (const t of [ZERO, left(24, 13, 7, 42), left(150, 1, 2, 3), CHRISTMAS]) {
      const f = countdownFrame(t, true);
      expect(Number.isInteger(f.width) && f.width > 0).toBe(true);
      expect(Number.isInteger(f.height) && f.height > 0).toBe(true);
      expect(f.pixels).toBeInstanceOf(Uint8Array);
      expect(f.pixels.length).toBe(f.width * f.height);
      expect(f.pixels.every((p) => p === 0 || p === 1)).toBe(true);
      expect(f.pixels.some((p) => p === 1)).toBe(true);
    }
  });
});

describe('countdownFrame: layout', () => {
  it('draws four groups of two large digits, scaled by a whole number >= 2, on one row', () => {
    const s = digitScale();
    const cells = digitCells(s);
    expect(cells).toHaveLength(8);
    expect(new Set(cells.map((c) => c.y)).size).toBe(1);
    const pitchInGroup = (cells[1]?.x ?? 0) - (cells[0]?.x ?? 0);
    // Pairs share one pitch; the step between groups is wider (room for a colon).
    for (const i of [0, 2, 4, 6]) expect((cells[i + 1]?.x ?? 0) - (cells[i]?.x ?? 0)).toBe(pitchInGroup);
    for (const i of [1, 3, 5]) expect((cells[i + 1]?.x ?? 0) - (cells[i]?.x ?? 0)).toBeGreaterThan(pitchInGroup);
  });

  it('puts UNTIL CHRISTMAS above the digits, UNTIL first on the same line', () => {
    const f = countdownFrame(left(12, 3, 4, 5), true);
    const s = digitScale();
    const top = Math.min(...digitCells(s).map((c) => c.y));
    const until = findWordAnyScale(f, 'UNTIL');
    const christmas = findWordAnyScale(f, 'CHRISTMAS');
    expect(until.y + until.h).toBeLessThanOrEqual(top);
    expect(christmas.y).toBe(until.y);
    expect(christmas.s).toBe(until.s);
    expect(christmas.x).toBeGreaterThan(until.x + until.w);
  });

  it('labels each group DAYS, HRS, MIN, SEC at glyph scale 1, under its own group', () => {
    const f = countdownFrame(left(12, 3, 4, 5), true);
    const s = digitScale();
    const cells = digitCells(s);
    const bottom = (cells[0]?.y ?? 0) + 5 * s;
    ['DAYS', 'HRS', 'MIN', 'SEC'].forEach((label, g) => {
      const box = findWord(f, label, 1);
      expect(box, label).toBeDefined();
      if (box === undefined) return;
      expect(box.y, label).toBeGreaterThanOrEqual(bottom);
      const groupLeft = cells[2 * g]?.x ?? 0;
      const groupRight = (cells[2 * g + 1]?.x ?? 0) + 3 * s;
      // The label overlaps its own group's span and no other group's.
      expect(box.x < groupRight && box.x + box.w > groupLeft, label).toBe(true);
      for (let other = 0; other < 4; other++) {
        if (other === g) continue;
        const oL = cells[2 * other]?.x ?? 0;
        const oR = (cells[2 * other + 1]?.x ?? 0) + 3 * s;
        expect(box.x < oR && box.x + box.w > oL, `${label} vs group ${other}`).toBe(false);
      }
    });
  });

});

describe('countdownFrame: digits', () => {
  it.each([
    ['all zero shows 00 in every group', left(0, 0, 0, 0), '00000000'],
    ['single-digit units are padded with a leading 0', left(5, 4, 3, 2), '05040302'],
    ['a unit at zero still shows 00 among others', left(12, 0, 34, 0), '12003400'],
    ['the largest two-digit value', left(99, 23, 59, 59), '99235959'],
    ['mixed values', left(24, 13, 7, 42), '24130742'],
  ])('%s', (_name, t, want) => {
    const s = digitScale();
    const cells = digitCells(s);
    for (const colonOn of [true, false]) expect(readDigits(countdownFrame(t, colonOn), s, cells)).toBe(want);
  });

  it('grows days to three digits at 100+ and keeps the other groups in order', () => {
    const s = digitScale();
    const cells = digitCells(s);
    const pitch = (cells[1]?.x ?? 0) - (cells[0]?.x ?? 0);
    const f = countdownFrame(left(100, 1, 2, 3), true);
    const hits = [...'0123456789']
      .flatMap((d) => findAll(f, d, s).map((p) => ({ ...p, d })))
      .filter((h) => h.y === cells[0]?.y)
      .sort((a, b) => a.x - b.x);
    expect(hits.map((h) => h.d).join('')).toBe('100010203');
    // The three days digits sit one in-group pitch apart.
    expect((hits[1]?.x ?? 0) - (hits[0]?.x ?? 0)).toBe(pitch);
    expect((hits[2]?.x ?? 0) - (hits[1]?.x ?? 0)).toBe(pitch);
  });
});

describe('countdownFrame: layout never jumps', () => {
  const TWO_DIGIT_DAYS = [
    left(0, 0, 0, 0),
    left(99, 23, 59, 59),
    left(1, 1, 1, 1),
    left(11, 11, 11, 11),
    left(88, 8, 8, 8),
    left(7, 0, 59, 0),
    left(42, 19, 0, 37),
  ];

  it('gives the same width and height for every value with days <= 99, colon on or off', () => {
    const base = countdownFrame(ZERO, true);
    for (const t of TWO_DIGIT_DAYS) {
      for (const colonOn of [true, false]) {
        const f = countdownFrame(t, colonOn);
        expect([f.width, f.height], JSON.stringify({ t, colonOn })).toEqual([base.width, base.height]);
      }
    }
  });

  it('keeps every digit cell in place for every value with days <= 99', () => {
    const s = digitScale();
    const cells = digitCells(s);
    for (const t of TWO_DIGIT_DAYS) {
      const f = countdownFrame(t, true);
      expect(readDigits(f, s, cells), JSON.stringify(t)).not.toContain('?');
    }
  });

  it('with 100+ days grows the width by exactly one digit pitch and keeps the height', () => {
    const s = digitScale();
    const cells = digitCells(s);
    const pitch = (cells[1]?.x ?? 0) - (cells[0]?.x ?? 0);
    const two = countdownFrame(left(99, 23, 59, 59), true);
    for (const t of [left(100, 0, 0, 0), left(364, 23, 59, 59), left(123, 4, 5, 6)]) {
      for (const colonOn of [true, false]) {
        const f = countdownFrame(t, colonOn);
        expect(f.width, JSON.stringify(t)).toBe(two.width + pitch);
        expect(f.height, JSON.stringify(t)).toBe(two.height);
      }
    }
  });
});

describe('countdownFrame: colon blink', () => {
  function diff(a: Frame, b: Frame): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) out.push({ x: i % a.width, y: Math.floor(i / a.width) });
    return out;
  }

  it('keeps the frame size and changes only colon pixels, which are ink when on and sky when off', () => {
    const t = left(24, 13, 7, 42);
    const on = countdownFrame(t, true);
    const off = countdownFrame(t, false);
    expect([off.width, off.height]).toEqual([on.width, on.height]);
    const changed = diff(on, off);
    expect(changed.length).toBeGreaterThan(0);
    for (const { x, y } of changed) {
      expect(at(on, x, y)).toBe(1);
      expect(at(off, x, y)).toBe(0);
    }
  });

  it('draws one colon in each of the three gaps between groups, beside the digits', () => {
    const s = digitScale();
    const cells = digitCells(s);
    const t = left(24, 13, 7, 42);
    const changed = diff(countdownFrame(t, true), countdownFrame(t, false));
    const top = cells[0]?.y ?? 0;
    const gaps = [1, 3, 5].map((i) => [(cells[i]?.x ?? 0) + 3 * s, cells[i + 1]?.x ?? 0] as const);
    for (const { x, y } of changed) {
      expect(gaps.some(([a, b]) => x >= a && x < b), `x=${x}`).toBe(true);
      expect(y >= top && y < top + 5 * s, `y=${y}`).toBe(true);
    }
    for (const [a, b] of gaps) expect(changed.some(({ x }) => x >= a && x < b)).toBe(true);
  });

  it('blinks the colons with 100+ days too, without moving anything', () => {
    const t = left(150, 1, 2, 3);
    const on = countdownFrame(t, true);
    const off = countdownFrame(t, false);
    expect([off.width, off.height]).toEqual([on.width, on.height]);
    const changed = diff(on, off);
    expect(changed.length).toBeGreaterThan(0);
    for (const { x, y } of changed) expect([at(on, x, y), at(off, x, y)]).toEqual([1, 0]);
  });
});

describe('countdownFrame: Christmas Day', () => {
  it('shows MERRY over CHRISTMAS in one font scale', () => {
    const f = countdownFrame(CHRISTMAS, true);
    const merry = findWordAnyScale(f, 'MERRY');
    const christmas = findWordAnyScale(f, 'CHRISTMAS');
    expect(christmas.s).toBe(merry.s);
    expect(christmas.y).toBeGreaterThanOrEqual(merry.y + merry.h);
    // MERRY sits over CHRISTMAS: their spans overlap horizontally.
    expect(merry.x < christmas.x + christmas.w && merry.x + merry.w > christmas.x).toBe(true);
  });

  it('has no digits, no labels and no UNTIL line', () => {
    const f = countdownFrame(CHRISTMAS, true);
    const s = digitScale();
    // '0' and '5' share their bitmaps with 'O' and 'S', so they are left out here.
    for (const d of '12346789') expect(findAll(f, d, s), d).toHaveLength(0);
    for (const word of ['DAYS', 'HRS', 'MIN', 'SEC']) expect(findWord(f, word, 1), word).toBeUndefined();
    for (let k = 1; k <= 32; k++) expect(findWord(f, 'UNTIL', k), `UNTIL at ${k}`).toBeUndefined();
  });

  it('ignores the colon flag and the time fields while christmasDay is true', () => {
    const a = countdownFrame(CHRISTMAS, true);
    const b = countdownFrame(CHRISTMAS, false);
    const c = countdownFrame({ christmasDay: true, days: 120, hours: 5, minutes: 6, seconds: 7 }, true);
    for (const f of [b, c]) {
      expect([f.width, f.height]).toEqual([a.width, a.height]);
      expect(Array.from(f.pixels)).toEqual(Array.from(a.pixels));
    }
  });

  it('differs from the all-zero countdown (zero is not Christmas Day)', () => {
    const xmas = countdownFrame(CHRISTMAS, true);
    const zero = countdownFrame(ZERO, true);
    expect(findAll(zero, '0', digitScale()).length).toBe(8);
    expect(xmas.width === zero.width && xmas.height === zero.height && xmas.pixels.every((p, i) => p === zero.pixels[i])).toBe(false);
  });
});

// XMAS-34 "5-wide M": text advances by each glyph's own width plus one
// blank font pixel. The agreed widths and M's pattern are written out here,
// so these checks do not lean on the font module being right.
const AGREED_WIDTH = (ch: string): number => (ch === 'M' ? 5 : 3);
const M_PATTERN = ['#...#', '##.##', '#.#.#', '#...#', '#...#'];

/** The agreed drawn width of text at scale s: sum(width + 1) - 1, scaled. */
function agreedTextWidth(text: string, s: number): number {
  return ([...text].reduce((sum, ch) => sum + AGREED_WIDTH(ch) + 1, 0) - 1) * s;
}

/** True when the 5-wide M pattern, scaled by s, sits exactly at (x, y). */
function mAt(f: Frame, s: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + 5 * s > f.width || y + 5 * s > f.height) return false;
  for (let gy = 0; gy < 5 * s; gy++) {
    for (let gx = 0; gx < 5 * s; gx++) {
      const want = M_PATTERN[Math.floor(gy / s)]?.[Math.floor(gx / s)] === '#' ? 1 : 0;
      if (at(f, x + gx, y + gy) !== want) return false;
    }
  }
  return true;
}

/** Columns [x0, x1) of the frame rows [y0, y1) that hold ink: first and past-the-last. */
function inkSpan(f: Frame, y0: number, y1: number): [number, number] {
  let lo = f.width;
  let hi = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < f.width; x++) {
      if (at(f, x, y) === 1) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
  }
  return [lo, hi + 1];
}

/** True when the column band [x, x + w) of rows [y, y + h) is all sky. */
function blank(f: Frame, x: number, y: number, w: number, h: number): boolean {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (at(f, xx, yy) !== 0) return false;
  return true;
}

/** Checks `word` is drawn from (x, y) at scale s with the agreed advance, M as the 5-wide pattern, one blank column after each letter. */
function expectWordAt(f: Frame, word: string, s: number, x: number, y: number): void {
  let cursor = x;
  for (const [i, ch] of [...word].entries()) {
    if (ch === 'M') expect(mAt(f, s, cursor, y), `${word}: 5-wide M at x=${cursor}`).toBe(true);
    else if (ch !== ' ') expect(matchesAt(f, ch, s, cursor, y), `${word}: ${ch} at x=${cursor}`).toBe(true);
    cursor += AGREED_WIDTH(ch) * s;
    if (i < word.length - 1) expect(blank(f, cursor, y, s, 5 * s), `${word}: gap after ${ch} at x=${cursor}`).toBe(true);
    cursor += s;
  }
}

/** Finds the left edge of `word` at scale s on rows y: the first x where its first glyph matches and the whole word follows. */
function locate(f: Frame, word: string, s: number, y: number): number | undefined {
  const first = word[0] ?? '';
  for (let x = 0; x < f.width; x++) {
    const head = first === 'M' ? mAt(f, s, x, y) : matchesAt(f, first, s, x, y);
    if (!head) continue;
    let cursor = x;
    let ok = true;
    for (const ch of word) {
      const hit = ch === 'M' ? mAt(f, s, cursor, y) : ch === ' ' || matchesAt(f, ch, s, cursor, y);
      if (!hit) {
        ok = false;
        break;
      }
      cursor += (AGREED_WIDTH(ch) + 1) * s;
    }
    if (ok) return x;
  }
  return undefined;
}

describe('countdownFrame: the 5-wide M (XMAS-34)', () => {
  const s = (): number => digitScale();

  it('sizes the Christmas Day frame by CHRISTMAS at the agreed advance: sum(width + 1) - 1 font pixels, scaled', () => {
    const f = countdownFrame(CHRISTMAS, true);
    expect(f.width).toBe(agreedTextWidth('CHRISTMAS', s()));
  });

  it('draws MERRY and CHRISTMAS with the 5-wide M, each letter one blank column apart, centred over each other', () => {
    const f = countdownFrame(CHRISTMAS, true);
    const k = s();
    const line = 5 * k + 1;
    const merryY = 0;
    const christmasY = line;
    const merryX = locate(f, 'MERRY', k, merryY);
    const christmasX = locate(f, 'CHRISTMAS', k, christmasY);
    expect(merryX, 'MERRY with a 5-wide M').toBeDefined();
    expect(christmasX, 'CHRISTMAS with a 5-wide M').toBeDefined();
    expectWordAt(f, 'MERRY', k, merryX ?? 0, merryY);
    expectWordAt(f, 'CHRISTMAS', k, christmasX ?? 0, christmasY);
    expect(blank(f, 0, 5 * k, f.width, 1), 'a fully blank row between the two lines').toBe(true);
    expect(merryX).toBe((f.width - agreedTextWidth('MERRY', k)) >> 1);
    expect(christmasX).toBe((f.width - agreedTextWidth('CHRISTMAS', k)) >> 1);
  });

  it('keeps the M of MERRY off the E: one blank scaled column, then E starts six font pixels after M', () => {
    const f = countdownFrame(CHRISTMAS, true);
    const k = s();
    const x = locate(f, 'MERRY', k, 0);
    expect(x).toBeDefined();
    const mx = x ?? 0;
    expect(mAt(f, k, mx, 0)).toBe(true);
    expect(blank(f, mx + 5 * k, 0, k, 5 * k), 'column after M').toBe(true);
    expect(matchesAt(f, 'E', k, mx + 6 * k, 0)).toBe(true);
  });

  it('draws exactly the ink of the greeting: every letter its glyph ink, M with 13 lit pixels, scaled', () => {
    const f = countdownFrame(CHRISTMAS, true);
    const k = s();
    const inkOf = (ch: string): number => (ch === 'M' ? 13 : (glyph(ch)?.pixels.filter((p) => p !== 0).length ?? 0));
    const want = [...'MERRYCHRISTMAS'].reduce((sum, ch) => sum + inkOf(ch), 0) * k * k;
    expect(f.pixels.reduce((sum, p) => sum + p, 0)).toBe(want);
  });

  it('draws UNTIL CHRISTMAS at scale 1 with the 5-wide M, its ink spanning the agreed width, centred in the frame', () => {
    const f = countdownFrame(left(12, 3, 4, 5), true);
    const x = locate(f, 'UNTIL CHRISTMAS', 1, 0);
    expect(x, 'UNTIL CHRISTMAS with a 5-wide M').toBeDefined();
    expectWordAt(f, 'UNTIL CHRISTMAS', 1, x ?? 0, 0);
    const [lo, hi] = inkSpan(f, 0, 5);
    expect(hi - lo).toBe(agreedTextWidth('UNTIL CHRISTMAS', 1));
    expect(lo).toBe((f.width - agreedTextWidth('UNTIL CHRISTMAS', 1)) >> 1);
  });

  it('draws the MIN label with the 5-wide M, I one blank column after it, under the minutes group', () => {
    const f = countdownFrame(left(12, 3, 4, 5), true);
    const k = s();
    const cells = digitCells(k);
    const labelsTop = (cells[0]?.y ?? 0) + 5 * k + 2;
    const x = locate(f, 'MIN', 1, labelsTop);
    expect(x, 'MIN with a 5-wide M').toBeDefined();
    expectWordAt(f, 'MIN', 1, x ?? 0, labelsTop);
    const groupLeft = cells[4]?.x ?? 0;
    const groupRight = (cells[5]?.x ?? 0) + 3 * k;
    expect(x ?? 0).toBeGreaterThanOrEqual(groupLeft);
    expect((x ?? 0) + agreedTextWidth('MIN', 1)).toBeLessThanOrEqual(groupRight);
    // Centred under its group, as the other labels are.
    expect(x).toBe(groupLeft + ((groupRight - groupLeft - agreedTextWidth('MIN', 1)) >> 1));
  });

  it('keeps the digits and colons at their fixed pitch: the countdown frame width is unchanged by the wider M', () => {
    const k = s();
    const digitPair = (2 * 4 - 1) * k;
    const colon = 3 * k;
    expect(countdownFrame(ZERO, true).width).toBe(4 * digitPair + 3 * colon);
    expect(countdownFrame(left(123, 4, 5, 6), true).width).toBe(4 * digitPair + 4 * k + 3 * colon);
  });
});

// visual-reset-1: the digit scale is a parameter, so the countdown can shrink on a narrow page.
describe('countdownFrame: digitScale', () => {
  const SCALES = [1, 2, 3, 4];
  /** "UNTIL CHRISTMAS" at scale 1: each letter's width plus one gap, less the last gap. */
  const TITLE = [...'UNTIL CHRISTMAS'].reduce((sum, ch) => sum + glyphWidth(ch) + 1, 0) - 1;
  const row = (days: number, d: number): number => (days >= 100 ? 41 : 37) * d;

  it('the default is 4, byte for byte', () => {
    for (const t of [ZERO, left(123, 4, 5, 6), left(364, 23, 59, 59), CHRISTMAS]) {
      for (const colon of [true, false]) {
        const a = countdownFrame(t, colon);
        const b = countdownFrame(t, colon, 4);
        expect(a.width).toBe(b.width);
        expect(a.height).toBe(b.height);
        expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
      }
    }
    expect(countdownFrame(ZERO, true).width).toBe(148);
    expect(countdownFrame(ZERO, true).height).toBe(34);
  });

  it.each(SCALES)('digitScale %i: the countdown frame is as wide and tall as the layout says', (d) => {
    const f = countdownFrame(ZERO, true, d);
    expect(f.width).toBe(Math.max(row(0, d), TITLE));
    expect(f.height).toBe(5 + 2 + 5 * d + 2 + 5);
    expect(f.pixels.length).toBe(f.width * f.height);
    const wide = countdownFrame(left(364, 23, 59, 59), true, d);
    expect(wide.width).toBe(Math.max(row(364, d), TITLE));
  });

  it.each([2, 3, 4])('digitScale %i: eight digits and three colons at that scale; colons blink away when off', (d) => {
    const on = countdownFrame(ZERO, true, d);
    expect(findAll(on, '0', d).length).toBe(8);
    expect(findAll(on, ':', d).length).toBe(3);
    expect(findAll(countdownFrame(ZERO, false, d), ':', d).length).toBe(0);
  });

  it.each([2, 3, 4])('digitScale %i: the title and unit labels stay at scale 1', (d) => {
    const f = countdownFrame(ZERO, true, d);
    expect(findWord(f, 'UNTIL', 1)).toBeDefined();
    expect(findWord(f, 'CHRISTMAS', 1)).toBeDefined();
    for (const label of ['DAYS', 'HRS', 'MIN', 'SEC']) expect(findWord(f, label, 1), label).toBeDefined();
    expect(f.height - 5).toBe(7 + 5 * d + 2); // the label row is 5 high whatever the digit scale
  });

  it('digitScale 1: the whole frame is the font at scale 1', () => {
    const f = countdownFrame(left(12, 3, 45, 6), true, 1);
    expect(findAll(f, '1', 1).length).toBeGreaterThanOrEqual(1);
    expect(findAll(f, ':', 1).length).toBe(3);
  });

  it('a smaller digitScale gives a strictly smaller frame', () => {
    const sizes = SCALES.map((d) => countdownFrame(left(12, 3, 45, 6), true, d));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!.width).toBeGreaterThan(sizes[i - 1]!.width);
      expect(sizes[i]!.height).toBeGreaterThan(sizes[i - 1]!.height);
    }
  });

  it('the colon slot follows the digit scale: width is four pairs + three colon slots at that scale', () => {
    for (const d of [2, 3]) {
      expect(countdownFrame(ZERO, true, d).width).toBe(4 * 7 * d + 3 * 3 * d);
    }
  });

  it.each(SCALES)('digitScale %i: the greeting is MERRY over CHRISTMAS at that scale', (d) => {
    const f = countdownFrame(CHRISTMAS, true, d);
    expect(f.width).toBe(37 * d);
    expect(f.height).toBe(10 * d + 2);
    const merry = findWord(f, 'MERRY', d);
    const xmas = findWord(f, 'CHRISTMAS', d);
    expect(merry).toBeDefined();
    expect(xmas).toBeDefined();
    expect(xmas!.y).toBe(5 * d + 1);
    expect(blank(f, 0, 5 * d, f.width, 1), 'a fully blank row between the two lines').toBe(true);
    expect(blank(f, 0, 10 * d, f.width, 1), 'last ink row is row 10d').toBe(false);
    expect(blank(f, 0, 10 * d + 1, f.width, 1), 'row below the ink is blank').toBe(true);
    expect(Array.from(countdownFrame(CHRISTMAS, false, d).pixels)).toEqual(Array.from(f.pixels));
  });
});
