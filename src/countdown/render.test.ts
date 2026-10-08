// XMAS-27 "Countdown on a plain sky", part A: the countdown frame as pure
// pixels (1 = ink, 0 = sky). Glyphs are found by matching scaled copies of
// the font's bitmaps, so the tests pin layout without fixing exact offsets.
import { describe, expect, it } from 'vitest';
import type { TimeLeft } from '../shared/clock.ts';
import { glyph } from '../shared/font.ts';
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

/** A word drawn at scale s with a letter gap of 1 or 2 scaled pixels; its box, or undefined. */
function findWord(f: Frame, word: string, s: number): Box | undefined {
  const first = word[0] ?? '';
  for (const { x, y } of findAll(f, first, s)) {
    for (const gap of [1, 2]) {
      const step = (3 + gap) * s;
      if ([...word].every((ch, i) => matchesAt(f, ch, s, x + i * step, y))) {
        return { x, y, w: (word.length - 1) * step + 3 * s, h: 5 * s };
      }
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
