// XMAS-68 "Base lettering feel vs prototype": the base drawn on the screen's own
// pixel grid (renderBase): a gold lip with gems, a red drum shaded in tone steps,
// grooves, a lower gold trim with studs and the lettering "FAM. PINTO MERRY
// CHRISTMAS" wrapped round the drum, which foreshortens each letter by the
// cylinder's own mapping until it slides behind the edge. Every pixel is one hard
// master colour. The checks read the picture only: the lettering's ink is the
// two golds in the letter rows, decoded back into font columns.
import { describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { glyph, glyphWidth, GLYPH_HEIGHT } from '../shared/font.ts';
import { BASE_ROWS, BASE_WIDTH, renderBase } from './base-fine.ts';
import { NO_FRONT } from './globe.ts';

const FULL = 2 * Math.PI;
/** The page opens at this turn (START_TURN in src/page/scene.ts). */
const START_TURN = 0.5;
const TEXT = 'FAM. PINTO MERRY CHRISTMAS';
const RADIUS = BASE_WIDTH / 2;

const hex = (h: string): number => Number.parseInt(h.slice(1), 16);
const GOLD = hex('#ffe08a');
const GOLD_DARK = hex('#c4923a');
const ENGRAVING = hex('#3a0d2e');
const MASTER = new Set(masterColours.map(hex));

/** The base's own colours: the gold lip, the red drum, the gems. */
const BASE_COLOURS = ['#c4923a', '#ffe08a', '#fff3b0', '#3a0d2e', '#5a1f3a', '#7d2a2e', '#a83c3c', '#c24c47', '#c8102e', '#ff8c7a', '#1f6f5c', '#2c8f6f'].map(hex);

/** The base at turn `turn`, k pixels to an art pixel, in a picture of its own size: NO_FRONT where nothing is drawn. */
function draw(turn: number, k = 1): Uint32Array {
  const out = new Uint32Array(BASE_WIDTH * k * BASE_ROWS * k).fill(NO_FRONT);
  renderBase(out, BASE_WIDTH * k, 0, 0, k, turn);
  return out;
}

const at = (p: Uint32Array, k: number, x: number, y: number): number => p[y * BASE_WIDTH * k + x] ?? Number.NaN;

/** The art rows the font's five rows land in the letter band (the lettering lies in rows 7 to 14 of the base's box). */
const FONT_ROW_SAMPLE = [7, 9, 10, 12, 13];
const LETTER_FIRST = 7;
const LETTER_LAST = 14;

/** Whether the pixel is lettering ink: gold or dark gold, in the letter rows (no other part of the drum is gold there). */
const isInk = (c: number): boolean => c === GOLD || c === GOLD_DARK;

/** A column's five font-row bits at the lettering's sample rows: 0 for a blank column. */
function columnBits(p: Uint32Array, k: number, x: number): number {
  let bits = 0;
  FONT_ROW_SAMPLE.forEach((row, i) => {
    if (isInk(at(p, k, x, row * k + Math.floor(k / 2)))) bits |= 1 << i;
  });
  return bits;
}

/** One letter (or squeezed part of one) as the picture shows it: the device columns it covers and its font columns, as bits. */
interface Run {
  first: number;
  last: number;
  columns: number[];
}

/** The lettering's runs left to right: stretches of inked columns between blank columns, repeats of one column folded. */
function runs(p: Uint32Array, k: number): Run[] {
  const out: Run[] = [];
  let open: Run | undefined;
  for (let x = 0; x < BASE_WIDTH * k; x++) {
    const bits = columnBits(p, k, x);
    if (bits === 0) {
      open = undefined;
      continue;
    }
    if (open === undefined) {
      open = { first: x, last: x, columns: [bits] };
      out.push(open);
    } else {
      open.last = x;
      if (open.columns.at(-1) !== bits) open.columns.push(bits);
    }
  }
  return out;
}

/** The font's glyph as its columns' bits, the same way. */
function glyphColumns(char: string): number[] {
  const g = glyph(char);
  const out: number[] = [];
  for (let c = 0; c < glyphWidth(char); c++) {
    let bits = 0;
    for (let r = 0; r < GLYPH_HEIGHT; r++) if ((g?.pixels[r * g.width + c] ?? 0) !== 0) bits |= 1 << r;
    out.push(bits);
  }
  return out;
}

/** The text's letters as the folded column lists a whole letter shows (repeats folded, as `runs` does). */
const LETTERS: Map<string, number[]> = ((): Map<string, number[]> => {
  const out = new Map<string, number[]>();
  for (const char of TEXT) {
    if (char === ' ') continue;
    const folded: number[] = [];
    for (const bits of glyphColumns(char)) if (folded.at(-1) !== bits) folded.push(bits);
    // The blank columns at a glyph's sides are the gaps between letters; a letter with a blank column inside would read as two runs (the font has none).
    while (folded[0] === 0) folded.shift();
    while (folded.at(-1) === 0) folded.pop();
    out.set(char, folded);
  }
  // The small gold cross that fills the back: its columns, folded, in the middle row and the middle column.
  out.set('+', [0b00100, 0b11111, 0b00100]);
  return out;
})();

const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
/** The letter (or '+', the cross) a run of columns spells, when it is a whole one. */
function spelled(run: Run): string | undefined {
  for (const [char, columns] of LETTERS) if (same(columns, run.columns)) return char;
  return undefined;
}
/** How far from the middle a device column lies, in radii (0 at the middle, 1 at the silhouette). */
const across = (x: number, k: number): number => Math.abs(((x + 0.5) / k - RADIUS) / RADIUS);

describe('renderBase: what it draws', () => {
  it('draws only hard master colours: every pixel is a colour of the master list, at the art grid and at zoom 5', () => {
    for (const k of [1, 5]) {
      for (const turn of [0, START_TURN, 1.9, 3.3, 5.5]) {
        const p = draw(turn, k);
        for (let i = 0; i < p.length; i++) if (p[i] !== NO_FRONT && !MASTER.has(p[i] ?? -1)) expect.fail(`k ${k} turn ${turn}: pixel ${i} is ${(p[i] ?? 0).toString(16)}, not a master colour`);
      }
    }
  });

  it('draws with the base\'s own twelve colours and no others, and the engraving dark is among them', () => {
    const used = new Set<number>();
    for (const turn of [0, 0.7, 1.9, 3.3, 4.4, 5.5]) for (const c of draw(turn)) if (c !== NO_FRONT) used.add(c);
    for (const c of used) expect(BASE_COLOURS, `colour ${c.toString(16)}`).toContain(c);
    expect(used.has(GOLD)).toBe(true);
    expect(used.has(GOLD_DARK)).toBe(true);
    expect(used.has(ENGRAVING)).toBe(true);
  });

  it('keeps the master list holding every colour the base uses', () => {
    for (const c of BASE_COLOURS) expect(MASTER.has(c), `colour ${c.toString(16)}`).toBe(true);
  });

  it('is a drum: every column is drawn in one stretch from its top row, the top rows lie further down toward the sides, the bottom edge curves', () => {
    const p = draw(START_TURN);
    const tops: number[] = [];
    const bottoms: number[] = [];
    for (let x = 0; x < BASE_WIDTH; x++) {
      let first = -1;
      let last = -1;
      for (let y = 0; y < BASE_ROWS; y++) {
        if (at(p, 1, x, y) === NO_FRONT) continue;
        if (first < 0) first = y;
        else if (last !== y - 1) expect.fail(`column ${x} has a hole above row ${y}`);
        last = y;
      }
      expect(first, `column ${x} is drawn`).toBeGreaterThanOrEqual(0);
      tops.push(first);
      bottoms.push(last);
    }
    expect(tops[RADIUS], 'the middle starts at the very top').toBe(0);
    expect(tops[0], 'the left edge starts lower').toBeGreaterThan(0);
    expect(tops[BASE_WIDTH - 1]).toBe(tops[0]);
    expect(bottoms[RADIUS], 'the bottom is deepest at the middle').toBe(BASE_ROWS - 1);
    expect(bottoms[0], 'and rises toward the sides').toBeLessThan(BASE_ROWS - 1);
    for (let x = 1; x <= RADIUS; x++) {
      expect(tops[RADIUS - x] ?? -1, `top row at ${x} left of the middle`).toBeGreaterThanOrEqual(tops[RADIUS - x + 1] ?? 99);
      expect(bottoms[RADIUS - x] ?? 99, `bottom row at ${x} left of the middle`).toBeLessThanOrEqual(bottoms[RADIUS - x + 1] ?? -1);
    }
  });

  it('keeps the silhouette the same at every turn: only the shading and the marks turn, not the outline', () => {
    const shape = (turn: number): boolean[] => Array.from(draw(turn), (c) => c !== NO_FRONT);
    const first = shape(0);
    for (const turn of [0.3, 1.7, 3.1, 5]) expect(shape(turn), `turn ${turn}`).toEqual(first);
  });

  it('writes only inside the base\'s box at its offset and leaves every other pixel as it was', () => {
    const side = 400;
    const rows = 120;
    const left = 37;
    const top = 11;
    const k = 2;
    const picture = new Uint32Array(side * rows).fill(0x123456);
    renderBase(picture, side, left, top, k, 1.3);
    let drawn = 0;
    const alone = draw(1.3, k);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < side; x++) {
        const c = picture[y * side + x];
        const inside = x >= left && x < left + BASE_WIDTH * k && y >= top && y < top + BASE_ROWS * k;
        if (!inside) {
          if (c !== 0x123456) expect.fail(`pixel ${x},${y} outside the box was written`);
          continue;
        }
        const want = alone[(y - top) * BASE_WIDTH * k + (x - left)];
        // Where the base draws nothing the picture keeps what it had; where it draws, it is the same base wherever it stands.
        if (want === NO_FRONT) expect(c).toBe(0x123456);
        else {
          expect(c).toBe(want);
          drawn++;
        }
      }
    }
    expect(drawn).toBeGreaterThan(BASE_WIDTH * k * 15 * k);
  });

  it('draws the same pixels for the same inputs, whatever the picture held before', () => {
    const a = draw(2.7, 3);
    const b = draw(2.7, 3);
    expect(Array.from(b)).toEqual(Array.from(a));
    const dirty = new Uint32Array(a.length).fill(0xabcdef);
    renderBase(dirty, BASE_WIDTH * 3, 0, 0, 3, 2.7);
    for (let i = 0; i < a.length; i++) if (a[i] !== NO_FRONT) expect(dirty[i]).toBe(a[i]);
  });

  it('puts every art row on whole device rows: the k device rows of an art row are the same', () => {
    const k = 4;
    const p = draw(1.1, k);
    for (let row = 0; row < BASE_ROWS; row++) {
      for (let dy = 1; dy < k; dy++) {
        for (let x = 0; x < BASE_WIDTH * k; x++) if (at(p, k, x, row * k + dy) !== at(p, k, x, row * k)) expect.fail(`art row ${row}: device row ${dy} differs at column ${x}`);
      }
    }
  });

  it('draws the lip, the studs and the red drum at the art grid: the silhouette and tone are the same at zoom 1 and zoom 3, scaled', () => {
    // The drum's top and bottom edges lie on art columns, so a zoom-3 column keeps its art column's rows.
    const one = draw(0.9, 1);
    const three = draw(0.9, 3);
    for (let x = 0; x < BASE_WIDTH * 3; x++) {
      const a = one[Math.floor(x / 3)] !== NO_FRONT;
      expect(three[x] !== NO_FRONT, `column ${x}`).toBe(a);
    }
  });
});

describe('renderBase: the lettering', () => {
  it('reads "FAM. PINTO MERRY" on the front at the page\'s opening turn: whole letters in order, F first, the front clear of cuts', () => {
    const letters: string[] = [];
    for (const run of runs(draw(START_TURN, 4), 4)) {
      // Near the sides a letter is squeezed and dark; the front, out to 90% of the radius, is where it reads. At this turn the text's F stands near the left.
      if (across(run.first, 4) < 0.9 && across(run.last, 4) < 0.9) {
        const char = spelled(run);
        expect(char, `a run of columns [${run.first}..${run.last}] on the front spells no letter`).toBeDefined();
        if (char !== '+') letters.push(char ?? '?');
      }
    }
    const text = letters.join('');
    // The first letter at the left of the front is the text's own F, and the text reads on from it, as written.
    expect(letters[0], `read "${text}"`).toBe('F');
    expect(text.startsWith('FAM.PINTOMERRY'), `read "${text}"`).toBe(true);
  });

  it('shows every letter of the text whole on the front at some turn: F A M . P I N T O M E R R Y C H R I S T M A S', () => {
    const seen = new Set<string>();
    for (let t = 0; t < FULL; t += 0.02) {
      for (const run of runs(draw(t, 4), 4)) {
        if (across(run.first, 4) < 0.6 && across(run.last, 4) < 0.6) {
          const char = spelled(run);
          if (char !== undefined) seen.add(char);
        }
      }
    }
    for (const char of new Set([...TEXT].filter((c) => c !== ' ' && glyph(c) !== undefined))) expect(seen.has(char), `letter ${char}`).toBe(true);
  });

  it('keeps the lettering on its rows: no gold or dark gold in the letter band outside rows 7 to 14, and none outside the drum\'s sides', () => {
    for (const turn of [0, START_TURN, 2.9, 4.8]) {
      const p = draw(turn);
      for (let y = 5; y <= 16; y++) {
        for (let x = 0; x < BASE_WIDTH; x++) {
          if (isInk(at(p, 1, x, y)) && (y < LETTER_FIRST || y > LETTER_LAST)) expect.fail(`turn ${turn}: ink at ${x},${y} outside the letter rows`);
        }
      }
    }
  });

  it('writes the letters in solid gold on the front and in the darker gold toward the sides, never a blend', () => {
    const p = draw(START_TURN, 4);
    let front = 0;
    let side = 0;
    for (let y = LETTER_FIRST * 4; y < (LETTER_LAST + 1) * 4; y++) {
      for (let x = 0; x < BASE_WIDTH * 4; x++) {
        const c = at(p, 4, x, y);
        if (!isInk(c)) continue;
        const u = across(x, 4);
        if (u <= 0.72) {
          expect(c, `ink at ${x},${y} on the front`).toBe(GOLD);
          front++;
        } else {
          expect(c, `ink at ${x},${y} toward the side`).toBe(GOLD_DARK);
          side++;
        }
      }
    }
    expect(front).toBeGreaterThan(200);
    expect(side).toBeGreaterThan(0);
  });

  it('engraves the letters: dark pixels under the ink of a letter, the engraving colour, where the drum would show', () => {
    const p = draw(START_TURN, 1);
    let engraved = 0;
    for (let y = LETTER_FIRST + 1; y < BASE_ROWS; y++) {
      for (let x = 0; x < BASE_WIDTH; x++) {
        if (at(p, 1, x, y) === ENGRAVING && isInk(at(p, 1, x, y - 1))) engraved++;
      }
    }
    expect(engraved).toBeGreaterThan(10);
  });

  it('never pops: consecutive small turns move every run on the front by a column or so, whole, and none appears or vanishes there', () => {
    const k = 4;
    const STEP = 0.004;
    for (const sign of [1, -1]) {
      let prev = runs(draw(0, k), k);
      for (let i = 1; i < 1600; i++) {
        const now = runs(draw(sign * i * STEP, k), k);
        for (const run of now) {
          if (across(run.first, k) > 0.75 || across(run.last, k) > 0.75) continue;
          const turn = sign * i * STEP;
          // The same letter a step ago: its ends are within a few device columns (a step moves them under one).
          const before = prev.find((r) => Math.abs(r.first - run.first) <= 3 && Math.abs(r.last - run.last) <= 3);
          expect(before, `turn ${turn.toFixed(3)}: run [${run.first}..${run.last}] has no run like it a step before`).toBeDefined();
        }
        // And the other way: a run on the front a step ago is still there (the letters do not blink out).
        for (const run of prev) {
          if (across(run.first, k) > 0.75 || across(run.last, k) > 0.75) continue;
          const after = now.find((r) => Math.abs(r.first - run.first) <= 3 && Math.abs(r.last - run.last) <= 3);
          expect(after, `turn ${(sign * i * STEP).toFixed(3)}: run [${run.first}..${run.last}] of a step before is gone`).toBeDefined();
        }
        prev = now;
      }
    }
  });

  it('narrows a letter monotonically as it travels from the middle to the edge, at every one of the first letter\'s turns', () => {
    const k = 8;
    // Follow the letter standing at the middle at turn t0 as the turn grows (the text moves left) and falls (it moves right): its width never grows on the way out.
    for (const t0 of [0.2, 1.4, 2.6, 3.8, 5.0]) {
      for (const sign of [1, -1]) {
        const middle = runs(draw(t0, k), k).find((r) => r.first <= (BASE_WIDTH * k) / 2 && r.last >= (BASE_WIDTH * k) / 2 - 12) ?? runs(draw(t0, k), k).find((r) => across(r.first, k) < 0.15);
        if (middle === undefined) continue;
        let width = middle.last - middle.first + 1;
        let at0 = middle;
        let steps = 0;
        for (let i = 1; i <= 300 && across(at0.first, k) < 0.97 && across(at0.last, k) < 0.97; i++) {
          const now = runs(draw(t0 + sign * i * 0.004, k), k);
          const next = now.find((r) => r.first <= at0.last + 6 && r.last >= at0.first - 6 && Math.abs((r.first + r.last) / 2 - (at0.first + at0.last) / 2) < 12);
          if (next === undefined) break;
          const w = next.last - next.first + 1;
          // Only the way out counts: once the letter's middle is past 0.4 of the radius, it never gets wider than a column more than before.
          const centre = across(Math.round((next.first + next.last) / 2), k);
          if (centre > 0.4) expect(w, `t0 ${t0} sign ${sign} step ${i}: width ${w} after ${width}`).toBeLessThanOrEqual(width + 1);
          width = Math.min(width, w);
          at0 = next;
          steps++;
        }
        expect(steps).toBeGreaterThan(5);
      }
    }
  });

  it('shows no partial letter on the visible part of the drum: every run lying wholly inside 85% of the radius spells one whole letter', () => {
    const bad: string[] = [];
    for (let t = 0; t < FULL; t += 0.037) {
      for (const run of runs(draw(t, 4), 4)) {
        if (across(run.first, 4) > 0.85 || across(run.last, 4) > 0.85) continue;
        if (spelled(run) === undefined) bad.push(`turn ${t.toFixed(3)} [${run.first}..${run.last}] ${run.columns.join(',')}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('leaves no lettering at all in the very last columns: the silhouette edge is the drum\'s, not a cut letter', () => {
    for (let t = 0; t < FULL; t += 0.05) {
      const p = draw(t, 4);
      // Within 1% of the radius of the silhouette, a letter is thinner than a device column's worth of font column.
      let ink = 0;
      for (let x = 0; x < BASE_WIDTH * 4; x++) if (across(x, 4) > 0.995 && columnBits(p, 4, x) !== 0) ink++;
      expect(ink, `turn ${t.toFixed(2)}`).toBeLessThanOrEqual(2);
    }
  });

  it('repeats the text and covers the back with crosses: from every turn some lettering or cross is on the front', () => {
    // No blank half: whatever the turn, the front (the middle 60% of the radius) shows ink in the letter rows.
    for (let t = 0; t < FULL; t += 0.1) {
      const p = draw(t, 2);
      let ink = 0;
      for (let x = 0; x < BASE_WIDTH * 2; x++) if (across(x, 2) < 0.6 && columnBits(p, 2, x) !== 0) ink++;
      expect(ink, `turn ${t.toFixed(2)}: ink columns on the front`).toBeGreaterThan(10);
    }
  });

  it('draws crosses on the back: some turn shows a whole small cross on the front, in the gold', () => {
    let crosses = 0;
    for (let t = 0; t < FULL; t += 0.02) {
      for (const run of runs(draw(t, 4), 4)) {
        if (across(run.first, 4) < 0.5 && across(run.last, 4) < 0.5 && spelled(run) === '+') crosses++;
      }
    }
    expect(crosses, 'frames in which a cross is on the front').toBeGreaterThan(0);
  });

  it('slides the lettering with the turn: a turn of 0.3 puts every letter somewhere else, the same letters in the same order', () => {
    const read = (turn: number): string =>
      runs(draw(turn, 4), 4)
        .filter((r) => across(r.first, 4) < 0.6 && across(r.last, 4) < 0.6)
        .map((r) => spelled(r) ?? '?')
        .filter((c) => c !== '+')
        .join('');
    const a = read(0.2);
    const b = read(0.5);
    expect(a.length).toBeGreaterThan(3);
    expect(b.length).toBeGreaterThan(3);
    expect(a).not.toBe(b);
    // The text runs the same way round: a window of the text shows in both, shifted along.
    const whole = 'FAM.PINTOMERRYCHRISTMAS';
    expect(whole.includes(a), `read "${a}"`).toBe(true);
    expect(whole.includes(b), `read "${b}"`).toBe(true);
  });

  it('turns the text the way the globe turns: a growing turn moves the lettering left across the front', () => {
    const centreOf = (turn: number): number => {
      const found = runs(draw(turn, 4), 4).filter((r) => across(r.first, 4) < 0.5 && across(r.last, 4) < 0.5);
      return found.length === 0 ? Number.NaN : (found[0]?.first ?? 0);
    };
    const a = centreOf(0.2);
    const b = centreOf(0.205);
    expect(b).toBeLessThanOrEqual(a);
  });
});

describe('renderBase: the turn', () => {
  it('draws the same base a whole turn on: turns t, t + 2π, t - 2π and t + 20π are one picture', () => {
    for (const t of [0, START_TURN, 1.3, 4]) {
      const a = Array.from(draw(t));
      for (const m of [1, -1, 10]) expect(Array.from(draw(t + m * FULL)), `turn ${t} + ${m} whole turns`).toEqual(a);
    }
  });

  it('keeps the lettering and the gems periodic in the whole turn, whatever the grooves and studs do', () => {
    // The letters and the gems are laid evenly round the drum.
    const only = (p: Uint32Array): number[] => Array.from(p, (c, i) => (isInk(c) || c === hex('#c8102e') || c === hex('#1f6f5c') ? i : -1)).filter((i) => i >= 0);
    for (const t of [0, START_TURN, 1.3, 4]) expect(only(draw(t + FULL)), `turn ${t}`).toEqual(only(draw(t)));
  });

  it('slides the gems with the turn: the same gems on the lip a little to the side after a small turn', () => {
    const red = hex('#c8102e');
    const green = hex('#1f6f5c');
    const columns = (turn: number): number[] => {
      const p = draw(turn, 4);
      const out: number[] = [];
      for (let x = 0; x < BASE_WIDTH * 4; x++) if ([red, green].includes(at(p, 4, x, 1 * 4 + 1)) || [red, green].includes(at(p, 4, x, 2 * 4 + 1))) out.push(x);
      return out;
    };
    const a = columns(1);
    const b = columns(1.02);
    expect(a.length).toBeGreaterThan(8);
    expect(b.length).toBeGreaterThan(8);
    expect(b).not.toEqual(a);
    // The turn is 0.02 rad, 1.1 art pixels at the middle: the gems at the middle moved left by about that.
    const near = (x: number): number => Math.abs(x - BASE_WIDTH * 2);
    const mid = (list: number[]): number => list.reduce((best, x) => (near(x) < near(best) ? x : best), list[0] ?? 0);
    expect(mid(b)).toBeLessThan(mid(a) + 1);
  });

  it('slides the grooves with the turn: the dark stripes of the lower drum are not in the same columns after a quarter turn', () => {
    // Row 19 lies in the grooves' rows: the groove columns are darker than the drum beside them.
    const stripes = (turn: number): number[] => {
      const p = draw(turn, 1);
      return Array.from({ length: BASE_WIDTH }, (_, x) => at(p, 1, x, 19));
    };
    expect(stripes(0.8)).not.toEqual(stripes(0.8 + FULL / 4));
    expect(new Set(stripes(0.8)).size, 'the row holds the drum and its darker grooves').toBeGreaterThanOrEqual(2);
  });

  it('turns the drum smoothly: a turn of 0.01 rad changes less than a third of the base\'s pixels', () => {
    const k = 1;
    for (const t of [0, START_TURN, 2.2, 5.1]) {
      const a = draw(t, k);
      const b = draw(t + 0.01, k);
      let changed = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
      expect(changed, `turn ${t}`).toBeGreaterThan(0);
      expect(changed, `turn ${t}`).toBeLessThan(a.length / 3);
    }
  });
});
