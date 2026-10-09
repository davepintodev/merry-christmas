// XMAS-32a "The globe", slice 1: the glass (tinted by phase, rim, frost,
// reflections that travel round with the turn), the floor tint, the base from
// the Base sheet under the globe, and the lettering "Fam. Pinto Merry
// Christmas" from the font glyphs, sliding smoothly (blended on the grid) as
// the globe turns. sceneFrame draws it after the ground, centred on
// layout.globe; nothing outside the globe and its base changes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { drawings } from '../shared/art.generated.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { glyph, GLYPH_HEIGHT } from '../shared/font.ts';
import { GLOBE_RADIUS, sceneFrame, sceneLayout, type SceneFrame, type SceneInput, type SceneLayout } from './frame.ts';
import { drawGlobe } from './globe.ts';

// The XMAS-31 picture (sky, ground, disc, stars, no globe) is sceneFrame with
// drawGlobe switched off; every other test draws the real globe.
const globeOn = vi.hoisted(() => ({ value: true }));
vi.mock('./globe.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./globe.ts')>();
  return {
    ...actual,
    drawGlobe: (...args: Parameters<typeof actual.drawGlobe>): void => {
      if (globeOn.value) actual.drawGlobe(...args);
    },
  };
});

const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
const READINGS: [string, PhaseReading][] = [
  ...PHASES.map((p): [string, PhaseReading] => [p, { from: p, to: p, share: 0 }]),
  ['purple-night -> dawn at 0.5', { from: 'purple-night', to: 'dawn', share: 0.5 }],
  ['frosty-morning -> sunset at 0.25', { from: 'frosty-morning', to: 'sunset', share: 0.25 }],
];
const W = 240;
const H = 180;
const SEED = 12345;
const T = 1_000_000;
const SIZES: [number, number][] = [
  [W, H],
  [320, 180],
  [240, 300],
  [161, 160],
  [2 * GLOBE_RADIUS, 160],
];
const TEXT = 'FAM. PINTO MERRY CHRISTMAS';

afterEach(() => {
  globeOn.value = true;
  vi.restoreAllMocks();
});

function steady(phase: PhaseName): PhaseReading {
  return { from: phase, to: phase, share: 0 };
}

function input(over: Partial<SceneInput> = {}): SceneInput {
  return { time: T, drag: 0, phase: steady('purple-night'), seed: SEED, width: W, height: H, ...over };
}

/** The XMAS-31 picture for the same input: sky, ground, disc and stars, no globe. */
function baseline(over: Partial<SceneInput> = {}): SceneFrame {
  globeOn.value = false;
  try {
    return sceneFrame(input(over));
  } finally {
    globeOn.value = true;
  }
}

function hexNum(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function rgb(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function distance(a: number, b: number): number {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}

function at(f: SceneFrame, x: number, y: number): number {
  return f.picture[y * f.width + x] ?? -1;
}

/** Pixel centre within radius + margin of the globe's centre. */
function inCircle(l: SceneLayout, x: number, y: number, margin: number): boolean {
  const dx = x + 0.5 - l.globe.cx;
  const dy = y + 0.5 - l.globe.cy;
  return dx * dx + dy * dy <= (l.globe.radius + margin) ** 2;
}

const BASE = drawings['base'];
if (BASE === undefined) throw new Error('the Base sheet has no base drawing');

/** The base drawing's own colour number at (x, y) of its box. */
function baseColour(x: number, y: number): number {
  const n = BASE?.pixels[y * BASE.width + x] ?? 0;
  return hexNum(masterColours[n - 1] ?? '#000000');
}

/** The font's one ink colour, as the glyph sheet draws it. */
const FONT = ((): number => {
  const a = glyph('A');
  const n = a?.pixels.find((p) => p !== 0) ?? 0;
  return hexNum(masterColours[n - 1] ?? '#000000');
})();

/** Lit pixels of the uppercase lettering, the ink it carries when wholly shown. */
const TEXT_INK = [...TEXT].reduce((sum, ch) => sum + (glyph(ch)?.pixels.filter((p) => p !== 0).length ?? 0), 0);

interface Box { x: number; y: number }

/** True when the base drawing's row `row` shows exactly, its own colours, at (ox, oy + row). */
function rowMatches(f: SceneFrame, ox: number, oy: number, row: number): boolean {
  const bw = BASE?.width ?? 0;
  for (let x = 0; x < bw; x++) if (at(f, ox + x, oy + row) !== baseColour(x, row)) return false;
  return true;
}

/**
 * Where the base drawing sits in the picture: the offset whose top and
 * bottom rows (never lettered) show the drawing exactly and where most of
 * its other pixels show their own colour (the lettering covers a few rows).
 * The two edge rows reject almost every offset at their first pixel, so a
 * search is about one comparison per picture pixel.
 */
function findBase(f: SceneFrame): Box | undefined {
  const bw = BASE?.width ?? 0;
  const bh = BASE?.height ?? 0;
  const allowed = Math.floor(bw * bh * 0.3);
  let best: Box | undefined;
  let bestMiss = allowed + 1;
  for (let oy = 0; oy + bh <= f.height; oy++) {
    for (let ox = 0; ox + bw <= f.width; ox++) {
      if (!rowMatches(f, ox, oy, 0) || !rowMatches(f, ox, oy, bh - 1)) continue;
      let miss = 0;
      for (let y = 0; y < bh && miss < bestMiss; y++) {
        for (let x = 0; x < bw && miss < bestMiss; x++) if (at(f, ox + x, oy + y) !== baseColour(x, y)) miss++;
      }
      if (miss < bestMiss) {
        bestMiss = miss;
        best = { x: ox, y: oy };
      }
    }
  }
  return best;
}

function mustFindBase(f: SceneFrame): Box {
  const box = findBase(f);
  if (box === undefined) expect.fail('the base drawing is not in the picture');
  return box;
}

function inBox(box: Box, x: number, y: number): boolean {
  return x >= box.x && x < box.x + (BASE?.width ?? 0) && y >= box.y && y < box.y + (BASE?.height ?? 0);
}

/** The glass: pixel centres well inside the circle, off the base. */
function glassPixels(f: SceneFrame, box: Box): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) if (inCircle(f.layout, x, y, -2) && !inBox(box, x, y)) out.push([x, y]);
  }
  return out;
}

/**
 * How much font ink a base pixel carries: its colour's share of the way from
 * the base drawing's colour to the font colour; undefined when it is not on
 * that line (some other colour got onto the base).
 */
function inkAt(observed: number, under: number): number | undefined {
  const o = rgb(observed);
  const u = rgb(under);
  const v = rgb(FONT);
  let c = 0;
  let span = 0;
  for (let i = 0; i < 3; i++) {
    const d = (v[i] ?? 0) - (u[i] ?? 0);
    if (Math.abs(d) > Math.abs(span)) {
      span = d;
      c = ((o[i] ?? 0) - (u[i] ?? 0)) / d;
    }
  }
  if (span === 0) return observed === under ? 0 : undefined;
  if (c < -0.01 || c > 1.01) return undefined;
  for (let i = 0; i < 3; i++) {
    const want = (u[i] ?? 0) + c * ((v[i] ?? 0) - (u[i] ?? 0));
    if (Math.abs((o[i] ?? 0) - want) > 1.5) return undefined;
  }
  return Math.min(1, Math.max(0, c));
}

/** Every pixel outside the circle (radius + 1) and the base box that differs from the bare XMAS-31 picture. */
function outsideChanges(f: SceneFrame, b: SceneFrame, box: Box): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      if (inCircle(f.layout, x, y, 1) || inBox(box, x, y)) continue;
      if (at(f, x, y) !== at(b, x, y)) out.push([x, y]);
    }
  }
  return out;
}

function brightness(n: number): number {
  const [r, g, b] = rgb(n);
  return r + g + b;
}

/** Fails unless sceneFrame draws a globe at all (so the other checks are not passing on a bare sky). */
function expectGlobeDrawn(over: Partial<SceneInput> = {}): void {
  const f = sceneFrame(input(over));
  const b = baseline(over);
  const { cx, cy } = f.layout.globe;
  let changed = 0;
  for (let y = cy - 40; y < cy + 40; y++) for (let x = cx - 40; x < cx + 40; x++) if (at(f, x, y) !== at(b, x, y)) changed++;
  expect(changed, 'pixels inside the globe that differ from the bare sky').toBeGreaterThan(0);
}

describe('sceneFrame: the globe in the picture', () => {
  it('draws the globe: inside the circle the picture is not the bare XMAS-31 sky', () => {
    for (const [, phase] of READINGS) expectGlobeDrawn({ phase });
  });

  it.each(SIZES)('changes nothing outside the circle (radius 56 + 1) and the base but the cast shadow: ground only, darker, never left of the base, at %s x %s', (width, height) => {
    for (const [name, phase] of READINGS) {
      for (const turn of [0, 1.3, 4]) {
        const f = sceneFrame(input({ width, height, phase, turn }));
        const b = baseline({ width, height, phase, turn });
        const box = mustFindBase(f);
        for (const [x, y] of outsideChanges(f, b, box)) {
          const where = `${name} turn ${turn}: pixel ${x},${y} outside the globe and base changed`;
          if (y < f.layout.groundTop) expect.fail(`${where} above the ground`);
          if (x < box.x) expect.fail(`${where} left of the base (the light is top left)`);
          if (brightness(at(f, x, y)) >= brightness(at(b, x, y))) expect.fail(`${where} and is not darker`);
        }
      }
    }
  });

  it.each(SIZES)('keeps the glass at radius 56 at %s x %s: the rim band just inside the circle is drawn all round the top', (width, height) => {
    const f = sceneFrame(input({ width, height }));
    const b = baseline({ width, height });
    expect(f.layout.globe.radius).toBe(GLOBE_RADIUS);
    let band = 0;
    let drawn = 0;
    for (let y = 0; y < f.layout.globe.cy; y++) {
      for (let x = 0; x < width; x++) {
        if (!inCircle(f.layout, x, y, -0.5) || inCircle(f.layout, x, y, -1.5)) continue;
        band++;
        if (at(f, x, y) !== at(b, x, y)) drawn++;
      }
    }
    expect(band).toBeGreaterThan(100);
    expect(drawn / band, 'share of the rim band that is drawn').toBeGreaterThanOrEqual(0.9);
  });

  it('tints the glass in every phase: most glass pixels differ from the bare sky', () => {
    for (const [name, phase] of READINGS) {
      const f = sceneFrame(input({ phase }));
      const b = baseline({ phase });
      const glass = glassPixels(f, mustFindBase(f));
      const tinted = glass.filter(([x, y]) => at(f, x, y) !== at(b, x, y)).length;
      expect(tinted / glass.length, `${name}: tinted share of the glass`).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('draws no checkerboard dither: no 2 x 2 block of two alternating colours on the glass', () => {
    for (const [name, phase] of READINGS) {
      for (const turn of [0, 0.7, 2.1, 5]) {
        const f = sceneFrame(input({ phase, turn }));
        const box = mustFindBase(f);
        for (const [x, y] of glassPixels(f, box)) {
          if (!inCircle(f.layout, x + 1, y + 1, -2) || inBox(box, x + 1, y + 1)) continue;
          const a = at(f, x, y);
          const b = at(f, x + 1, y);
          if (a !== b && a === at(f, x + 1, y + 1) && b === at(f, x, y + 1)) {
            expect.fail(`${name} turn ${turn}: checkerboard at ${x},${y}`);
          }
        }
      }
    }
  });
});

describe('sceneFrame: the cast shadow', () => {
  /** Sizes with ground to the right of the base for a shadow to fall on. */
  const ROOMY: [number, number][] = [
    [W, H],
    [320, 180],
    [240, 300],
  ];

  it.each(ROOMY)('casts a shadow on the ground to the right of the base, away from the disc at top left, at %s x %s', (width, height) => {
    for (const [name, phase] of READINGS) {
      const f = sceneFrame(input({ width, height, phase }));
      const b = baseline({ width, height, phase });
      const box = mustFindBase(f);
      const right = (BASE?.width ?? 0) + box.x;
      const cast = outsideChanges(f, b, box).filter(([x, y]) => x >= right && y >= f.layout.groundTop && brightness(at(f, x, y)) < brightness(at(b, x, y)));
      expect(cast.length, `${name}: darkened ground pixels right of the base`).toBeGreaterThanOrEqual(10);
    }
  });

  it.each(ROOMY)('keeps the shadow still while the globe turns at %s x %s: outside the globe and base, every turn draws the same pixels', (width, height) => {
    for (const [name, phase] of READINGS) {
      const first = sceneFrame(input({ width, height, phase, turn: 0 }));
      const box = mustFindBase(first);
      expect(outsideChanges(first, baseline({ width, height, phase }), box).length, `${name}: a shadow is drawn`).toBeGreaterThan(0);
      for (const turn of [0.01, 1.3, Math.PI, 4, -2]) {
        const f = sceneFrame(input({ width, height, phase, turn }));
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (inCircle(f.layout, x, y, 1) || inBox(box, x, y)) continue;
            if (at(f, x, y) !== at(first, x, y)) expect.fail(`${name} turn ${turn}: pixel ${x},${y} outside the globe changed with the turn`);
          }
        }
      }
    }
  });

  it('draws the same shadow for the same inputs', () => {
    const a = sceneFrame(input({ phase: steady('sunset'), turn: 0.8 }));
    const b = sceneFrame(input({ phase: steady('sunset'), turn: 0.8 }));
    const box = mustFindBase(a);
    const cast = outsideChanges(a, baseline({ phase: steady('sunset') }), box);
    expect(cast.length).toBeGreaterThan(0);
    for (const [x, y] of cast) expect(at(b, x, y)).toBe(at(a, x, y));
  });

  it('draws the shadow in smooth tones: no 2 x 2 checkerboard on the ground beside the base', () => {
    for (const [name, phase] of READINGS) {
      const f = sceneFrame(input({ phase }));
      const box = mustFindBase(f);
      for (let y = f.layout.groundTop; y + 1 < f.height; y++) {
        for (let x = 0; x + 1 < f.width; x++) {
          if (inBox(box, x, y) || inBox(box, x + 1, y) || inBox(box, x, y + 1) || inBox(box, x + 1, y + 1)) continue;
          const a = at(f, x, y);
          const b = at(f, x + 1, y);
          if (a !== b && a === at(f, x + 1, y + 1) && b === at(f, x, y + 1)) expect.fail(`${name}: checkerboard on the ground at ${x},${y}`);
        }
      }
    }
  });
});

describe('sceneFrame: the shortest picture', () => {
  it.each([240, 2 * GLOBE_RADIUS])('at %s x 160 rests the base on the bottom 22 rows, over the foot of the glass, and keeps a valid picture', (width) => {
    const height = 160;
    for (const [name, phase] of READINGS) {
      const f = sceneFrame(input({ width, height, phase }));
      expect(f.picture.length).toBe(width * height);
      for (const c of f.picture) expect(c).toBeLessThanOrEqual(0xffffff);
      const box = mustFindBase(f);
      const bh = BASE?.height ?? 0;
      const { cy, radius } = f.layout.globe;
      expect(box.y, `${name}: base on the bottom rows`).toBe(height - bh);
      // The globe's foot is hidden in the base: its lowest rows sit inside the base's box.
      expect(cy + radius, `${name}: globe bottom`).toBeGreaterThan(box.y);
      expect(cy + radius).toBeLessThanOrEqual(box.y + bh);
      // Above the base the glass is drawn right down to it.
      const b = baseline({ width, height, phase });
      const { cx } = f.layout.globe;
      expect(at(f, cx, box.y - 1), `${name}: glass just above the base`).not.toBe(at(b, cx, box.y - 1));
    }
  });
});

describe('sceneFrame: the base', () => {
  it.each(SIZES)('puts the base drawing under the globe, centred across and inside the picture, at %s x %s', (width, height) => {
    const f = sceneFrame(input({ width, height }));
    const box = mustFindBase(f);
    const { cx, cy, radius } = f.layout.globe;
    const bw = BASE?.width ?? 0;
    const bh = BASE?.height ?? 0;
    expect(box.x + bw / 2, 'base centre across').toBe(cx);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + bw).toBeLessThanOrEqual(width);
    expect(box.y + bh).toBeLessThanOrEqual(height);
    expect(box.y, 'base top is below the globe centre').toBeGreaterThan(cy);
    expect(box.y + bh, 'base holds the globe from below').toBeGreaterThanOrEqual(cy + radius);
  });

  it('draws the base in the same colour numbers in every phase and blend (lettering included)', () => {
    const turn = 0.9;
    const first = sceneFrame(input({ turn }));
    const box = mustFindBase(first);
    for (const [name, phase] of READINGS) {
      const f = sceneFrame(input({ phase, turn }));
      for (let y = 0; y < (BASE?.height ?? 0); y++) {
        for (let x = 0; x < (BASE?.width ?? 0); x++) {
          const px = box.x + x;
          const py = box.y + y;
          if (at(f, px, py) !== at(first, px, py)) expect.fail(`${name}: base pixel ${x},${y} differs from purple-night`);
        }
      }
    }
  });

  it('shows every base pixel as the base drawing, the font colour or a blend between them', () => {
    for (const turn of [0, 0.004, 0.5, 2, 3.3]) {
      const f = sceneFrame(input({ turn }));
      const box = mustFindBase(f);
      for (let y = 0; y < (BASE?.height ?? 0); y++) {
        for (let x = 0; x < (BASE?.width ?? 0); x++) {
          if (inkAt(at(f, box.x + x, box.y + y), baseColour(x, y)) === undefined) {
            expect.fail(`turn ${turn}: base pixel ${x},${y} is neither base, font colour nor a blend of them`);
          }
        }
      }
    }
  });
});

describe('sceneFrame: the lettering on the base', () => {
  /** Font ink per base pixel at one turn. */
  function ink(turn: number | undefined): { box: Box; ink: number[]; frame: SceneFrame } {
    const f = sceneFrame(input(turn === undefined ? {} : { turn }));
    const box = mustFindBase(f);
    const bw = BASE?.width ?? 0;
    const out: number[] = [];
    for (let y = 0; y < (BASE?.height ?? 0); y++) {
      for (let x = 0; x < bw; x++) out.push(inkAt(at(f, box.x + x, box.y + y), baseColour(x, y)) ?? Number.NaN);
    }
    return { box, ink: out, frame: f };
  }

  it('writes the lettering in the font colour: some base pixels are the font colour itself', () => {
    const { box, frame } = ink(0);
    let solid = 0;
    for (let y = 0; y < (BASE?.height ?? 0); y++) {
      for (let x = 0; x < (BASE?.width ?? 0); x++) if (at(frame, box.x + x, box.y + y) === FONT) solid++;
    }
    expect(solid).toBeGreaterThanOrEqual(10);
  });

  it(`shows all of "${TEXT}" facing the visitor at turn 0: the base carries the whole text's ink`, () => {
    const total = ink(0).ink.reduce((s, c) => s + c, 0);
    expect(total).toBeGreaterThan(TEXT_INK * 0.97);
    expect(total).toBeLessThan(TEXT_INK * 1.03);
  });

  it('keeps the lettering on whole rows: its ink spans at most one glyph height', () => {
    for (const turn of [0, 0.013, 1.7]) {
      const { ink: cells } = ink(turn);
      const bw = BASE?.width ?? 0;
      const rows = new Set<number>();
      cells.forEach((c, i) => {
        if (c > 0.02) rows.add(Math.floor(i / bw));
      });
      expect(rows.size, `turn ${turn}: rows with ink`).toBeGreaterThan(0);
      expect(Math.max(...rows) - Math.min(...rows) + 1).toBeLessThanOrEqual(GLYPH_HEIGHT);
    }
  });

  it('slides the lettering by in-between shades when the turn moves 0.01 rad: no pixel jumps a whole step', () => {
    for (let k = 0; k < 20; k++) {
      const a = ink(k * 0.01);
      const b = ink((k + 1) * 0.01);
      let moved = 0;
      let between = 0;
      for (let i = 0; i < a.ink.length; i++) {
        const ca = a.ink[i] ?? Number.NaN;
        const cb = b.ink[i] ?? Number.NaN;
        if (ca !== cb) moved++;
        if (Math.abs(ca - cb) >= 0.99) expect.fail(`turn ${k * 0.01} -> ${(k + 1) * 0.01}: base cell ${i} jumped a whole pixel`);
        if (cb > 0.02 && cb < 0.98) between++;
      }
      expect(moved, `turn ${k * 0.01} -> ${(k + 1) * 0.01}: lettering pixels that moved`).toBeGreaterThan(0);
      expect(moved).toBeLessThanOrEqual(GLYPH_HEIGHT * (BASE?.width ?? 0));
      expect(between, `turn ${(k + 1) * 0.01}: in-between shades`).toBeGreaterThan(0);
    }
  });

  it('moves the lettering, not just recolours it: its ink centre shifts across as the turn grows a little', () => {
    const centre = (cells: number[]): number => {
      const bw = BASE?.width ?? 0;
      let sum = 0;
      let mass = 0;
      cells.forEach((c, i) => {
        sum += c * (i % bw);
        mass += c;
      });
      return sum / mass;
    };
    const a = centre(ink(0).ink);
    const b = centre(ink(0.05).ink);
    expect(Math.abs(b - a)).toBeGreaterThan(0.01);
    expect(Math.abs(b - a)).toBeLessThan(5);
  });
});

describe('sceneFrame: turning the globe', () => {
  it('changes the picture with the turn (reflections and lettering move)', () => {
    const a = sceneFrame(input({ turn: 0 }));
    const b = sceneFrame(input({ turn: 1 }));
    expect(Array.from(a.picture)).not.toEqual(Array.from(b.picture));
  });

  it('draws an undefined turn exactly as turn 0', () => {
    expectGlobeDrawn();
    for (const [, phase] of READINGS) {
      expect(Array.from(sceneFrame(input({ phase })).picture)).toEqual(Array.from(sceneFrame(input({ phase, turn: 0 })).picture));
    }
  });

  it('comes back to the same picture after a full turn: 2π, -2π and 4π equal 0 exactly', () => {
    expectGlobeDrawn();
    const zero = Array.from(sceneFrame(input({ turn: 0 })).picture);
    for (const turn of [2 * Math.PI, -2 * Math.PI, 4 * Math.PI]) {
      expect(Array.from(sceneFrame(input({ turn })).picture), `turn ${turn}`).toEqual(zero);
    }
  });

  it('draws a negative turn as the same turn a full circle on: -0.5 equals 2π - 0.5', () => {
    expectGlobeDrawn({ turn: -0.5 });
    expect(Array.from(sceneFrame(input({ turn: -0.5 })).picture)).toEqual(Array.from(sceneFrame(input({ turn: 2 * Math.PI - 0.5 })).picture));
  });

  it('gives the same frame for the same inputs, fresh or drawn into a reused target', () => {
    expectGlobeDrawn({ turn: 0.37 });
    const fresh = Array.from(sceneFrame(input({ turn: 0.37 })).picture);
    expect(Array.from(sceneFrame(input({ turn: 0.37 })).picture)).toEqual(fresh);
    const target = new Uint32Array(W * H).fill(0xffffffff);
    sceneFrame(input({ turn: 2, phase: steady('frosty-morning') }), target);
    sceneFrame(input({ turn: 0.37 }), target);
    expect(Array.from(target)).toEqual(fresh);
  });

  it('moves the reflections with the turn but keeps the glass tint: some glass pixels change, most stay', () => {
    for (const [name, phase] of READINGS) {
      const a = sceneFrame(input({ phase, turn: 0 }));
      const b = sceneFrame(input({ phase, turn: 1.5 }));
      const glass = glassPixels(a, mustFindBase(a));
      const changed = glass.filter(([x, y]) => at(a, x, y) !== at(b, x, y)).length;
      expect(changed, `${name}: glass pixels the reflections moved`).toBeGreaterThan(0);
      expect(changed / glass.length, `${name}: share of the glass that changed with the turn`).toBeLessThanOrEqual(0.4);
    }
  });

  it('slides the reflections by in-between shades when the turn moves 0.01 rad: no glass pixel flips between bare glass and a solid reflection', () => {
    for (const phase of [steady('purple-night'), steady('frosty-morning')]) {
      const name = phase.from;
      const first = sceneFrame(input({ phase, turn: 0 }));
      const glass = glassPixels(first, mustFindBase(first));
      // The bare glass at each pixel: its most common colour round a full turn,
      // as a reflection covers any one pixel only for a short stretch of it.
      const round = Array.from({ length: 24 }, (_, i) => sceneFrame(input({ phase, turn: (i * 2 * Math.PI) / 24 })));
      const bare = new Map<number, number>();
      for (const [x, y] of glass) {
        const counts = new Map<number, number>();
        for (const f of round) counts.set(at(f, x, y), (counts.get(at(f, x, y)) ?? 0) + 1);
        let best = -1;
        let most = -1;
        for (const [c, n] of counts) if (n > most) [best, most] = [c, n];
        bare.set(y * W + x, best);
      }
      /** The reflections' solid colours in a frame: colours off the bare glass that fill ten or more glass pixels. */
      const solids = (f: SceneFrame): Set<number> => {
        const counts = new Map<number, number>();
        for (const [x, y] of glass) {
          const c = at(f, x, y);
          if (c !== bare.get(y * W + x)) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        return new Set([...counts].filter(([, n]) => n >= 10).map(([c]) => c));
      };
      let prev = first;
      for (let k = 1; k <= 20; k++) {
        const next = sceneFrame(input({ phase, turn: k * 0.01 }));
        const solid = new Set([...solids(prev), ...solids(next)]);
        expect(solid.size, `${name}: the reflections have a solid core`).toBeGreaterThan(0);
        let moved = 0;
        let between = 0;
        for (const [x, y] of glass) {
          const g = bare.get(y * W + x);
          const a = at(prev, x, y);
          const b = at(next, x, y);
          if (b !== g && !solid.has(b)) between++;
          if (a === b) continue;
          moved++;
          if ((a === g && solid.has(b)) || (b === g && solid.has(a))) {
            expect.fail(`${name} turn ${((k - 1) * 0.01).toFixed(2)} -> ${(k * 0.01).toFixed(2)}: glass pixel ${x},${y} jumped a whole step`);
          }
        }
        expect(moved, `${name} turn ${(k * 0.01).toFixed(2)}: reflection pixels that moved`).toBeGreaterThan(0);
        expect(between, `${name} turn ${(k * 0.01).toFixed(2)}: in-between reflection shades`).toBeGreaterThan(0);
        prev = next;
      }
    }
  });

  it('carries the reflections round the glass: half a turn moves them somewhere else', () => {
    const a = sceneFrame(input({ turn: 0 }));
    const b = sceneFrame(input({ turn: Math.PI }));
    const glass = glassPixels(a, mustFindBase(a));
    expect(glass.filter(([x, y]) => at(a, x, y) !== at(b, x, y)).length).toBeGreaterThan(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('throws a RangeError for a turn of %s and leaves the target alone', (turn) => {
    const target = new Uint32Array(W * H).fill(0xffffffff);
    expect(() => sceneFrame(input({ turn }), target)).toThrow(RangeError);
    expect(target.every((c) => c === 0xffffffff)).toBe(true);
  });
});

describe('drawGlobe', () => {
  it('draws inside the globe and its base, and only a darker shadow on the ground beside them, over whatever the picture already holds', () => {
    const layout = sceneLayout(W, H, SEED);
    const fill = 0x123456;
    const picture = new Uint32Array(W * H).fill(fill);
    drawGlobe(picture, W, layout, steady('sunset'), 0.6);
    const f: SceneFrame = { width: W, height: H, picture, layout };
    const box = mustFindBase(f);
    let inside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = at(f, x, y);
        if (inCircle(layout, x, y, 1) || inBox(box, x, y)) {
          if (inCircle(layout, x, y, -2) && c !== fill) inside++;
          continue;
        }
        if (c === fill) continue;
        if (y < layout.groundTop || x < box.x || brightness(c) >= brightness(fill)) {
          expect.fail(`pixel ${x},${y} outside the globe and base was drawn on, and is not a shadow on the ground right of the base`);
        }
      }
    }
    expect(inside).toBeGreaterThan(0);
    for (const c of picture) expect(c).toBeLessThanOrEqual(0xffffff);
  });

  it('gives the same picture for the same inputs', () => {
    const layout = sceneLayout(W, H, SEED);
    const a = new Uint32Array(W * H).fill(0x0b1026);
    const b = new Uint32Array(W * H).fill(0x0b1026);
    drawGlobe(a, W, layout, steady('dawn'), 2.2);
    drawGlobe(b, W, layout, steady('dawn'), 2.2);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
