// XMAS-31a "Scene core engine and reference pictures": the frame function.
// Inputs (time, drag, phase reading, seed, picture size in art pixels) give a
// frame whose picture is width * height colour numbers (0xRRGGBB). Sky bands,
// ground and stars are worked out in code, the disc comes from the Props
// sheet, phases only swap colour tables, and the globe's place is reserved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { skyAndInk } from '../countdown/colours.ts';
import { contrast, MIN_CONTRAST_RATIO, relativeLuminance } from '../countdown/contrast.ts';
import { countdownFrame } from '../countdown/render.ts';
import { SKY_ABOVE } from '../shared/sky.ts';
import { drawings } from '../shared/art.generated.ts';
import { phaseAt, type PhaseName, type PhaseReading } from '../shared/clock.ts';
import { DISC_MARGIN, DISC_SIZE, GLOBE_RADIUS, MIN_HEIGHT, sceneFrame, sceneLayout, type SceneFrame, type SceneInput, type SceneLayout } from './frame.ts';
import { BASE_ROWS, BASE_WIDTH } from './base-fine.ts';
import { BASE_SINK } from './globe.ts';
import { createGlobeSnow, stepGlobeSnow, type Flake, type GlobeSnow } from './snow.ts';

const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
const W = 240;
const H = 180;
const SEED = 12345;
const T = 1_000_000;
const SENTINEL = 0xffffffff; // above 0xffffff, so never a colour

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function steady(phase: PhaseName): PhaseReading {
  return { from: phase, to: phase, share: 0 };
}

function input(over: Partial<SceneInput> = {}): SceneInput {
  // The plain sky and ground: the backdrop (XMAS-70) has its own tests in backdrop.test.ts.
  return { time: T, drag: 0, phase: steady('purple-night'), seed: SEED, width: W, height: H, backdrop: false, ...over };
}

/** The picture of a frame as a plain array, for toEqual. */
function pic(over: Partial<SceneInput> = {}): number[] {
  return Array.from(sceneFrame(input(over)).picture);
}

const hexNum = (hex: string): number => Number.parseInt(hex.slice(1), 16);
const hexOf = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const rgb = (n: number): [number, number, number] => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const distance = (a: number, b: number): number => rgb(a).reduce((t, v, i) => t + Math.abs(v - (rgb(b)[i] ?? 0)), 0);
const at = (f: SceneFrame, x: number, y: number): number => f.picture[y * f.width + x] ?? -1;

function* grid(w: number, h: number): Generator<[number, number]> {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) yield [x, y];
}

/** Every pixel of a rectangle of the picture. */
function* cells(c: { x: number; y: number; width: number; height: number }): Generator<[number, number]> {
  for (let y = c.y; y < c.y + c.height; y++) for (let x = c.x; x < c.x + c.width; x++) yield [x, y];
}

/** Near the globe's reserved circle (pixel centre within radius + margin). */
function inGlass(l: SceneLayout, x: number, y: number, margin = 2): boolean {
  return (x + 0.5 - l.globe.cx) ** 2 + (y + 0.5 - l.globe.cy) ** 2 <= (l.globe.radius + margin) ** 2;
}

function nearGlobe(l: SceneLayout, x: number, y: number, margin = 2): boolean {
  // XMAS-68: the base's top rows rise BASE_SINK rows above the horizon, over the glass's foot, across the base's width.
  return inGlass(l, x, y, margin) || (Math.abs(x + 0.5 - l.globe.cx) <= BASE_WIDTH / 2 && y >= l.groundTop - BASE_SINK && y < l.groundTop);
}

function inDisc(l: SceneLayout, x: number, y: number): boolean {
  return x >= l.disc.x && x < l.disc.x + l.disc.width && y >= l.disc.y && y < l.disc.y + l.disc.height;
}

/** Whether a disc of the layout's size, placed at left gap x on its row, stays wholly outside the globe's circle. */
function discClearsAt(l: SceneLayout, x: number): boolean {
  for (let y = l.disc.y; y < l.disc.y + l.disc.height; y++) {
    for (let xx = x; xx < x + l.disc.width; xx++) if (nearGlobe(l, xx, y, 0)) return false;
  }
  return true;
}

/** The rule's answer: the widest left gap up to DISC_MARGIN at which the disc clears the globe, 0 where none does. */
function expectedDiscX(l: SceneLayout): number {
  for (let x = DISC_MARGIN; x > 0; x--) if (discClearsAt(l, x)) return x;
  return 0;
}

const starSet = (l: SceneLayout): Set<string> => new Set(l.stars.map((s) => `${s.x},${s.y}`));

/** Most common colour on row y, skipping the disc and the globe's place. */
function rowSky(f: SceneFrame, y: number): number {
  const counts = new Map<number, number>();
  for (let x = 0; x < f.width; x++) {
    if (inDisc(f.layout, x, y) || nearGlobe(f.layout, x, y)) continue;
    const c = at(f, x, y);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = -1;
  let most = -1;
  for (const [c, n] of counts) if (n > most) [best, most] = [c, n];
  return best;
}

/** The sky colour directly beside a star on its own row (stars never touch, so x - 1 or x + 1 is sky). */
function besideSky(f: SceneFrame, x: number, y: number): number {
  for (const nx of [x - 1, x + 1]) {
    if (nx < 0 || nx >= f.width || inDisc(f.layout, nx, y) || nearGlobe(f.layout, nx, y, 0)) continue;
    return at(f, nx, y);
  }
  throw new Error(`star ${x},${y} has no sky beside it`);
}

/** How much lighter (relative luminance, signed) a star pixel is than the sky beside it. */
function lift(f: SceneFrame, x: number, y: number): number {
  return relativeLuminance(hexOf(at(f, x, y))) - relativeLuminance(hexOf(besideSky(f, x, y)));
}

const BLEND_PAIRS = [
  ['purple-night', 'dawn'],
  ['dawn', 'frosty-morning'],
  ['frosty-morning', 'sunset'],
  ['sunset', 'purple-night'],
] as const;

const STAR_READINGS: [string, PhaseReading][] = [
  ...PHASES.map((p): [string, PhaseReading] => [p, steady(p)]),
  ...BLEND_PAIRS.flatMap(([from, to]) =>
    [0.25, 0.5, 0.75].map((share): [string, PhaseReading] => [`${from} -> ${to} at ${share}`, { from, to, share }]),
  ),
];

/** The blends with Dawn in them, which bend through a via ramp instead of mixing straight. */
const DAWN_BLENDS = BLEND_PAIRS.slice(0, 2);
const DAWN_SIZES: [number, number][] = [[130, 260], [120, 420], [240, 172]];
const DAWN_CASES: [number, number, number][] = DAWN_SIZES.flatMap(([w, h]) => [0.25, 0.5, 0.75].map((s): [number, number, number] => [w, h, s]));
/** Most one channel may move from one sky row to the next before it shows as a band. */
const MAX_SKY_STEP = 8;
/** Mid-blend horizon floors: below these the colour reads as grey. */
const MIN_HORIZON_CHROMA = 36;
const MIN_HORIZON_SATURATION = 0.3;

/** 3 seconds at 60 steps a second. */
function sweep(phase: PhaseReading, seed = SEED): SceneFrame[] {
  return Array.from({ length: 180 }, (_, i) => sceneFrame(input({ phase, seed, time: T + (i * 1000) / 60 })));
}

describe('sceneFrame: the picture', () => {
  it('is a Uint32Array of width * height 0xRRGGBB colour numbers', () => {
    const f = sceneFrame(input());
    expect(f.width).toBe(W);
    expect(f.height).toBe(H);
    expect(f.picture).toBeInstanceOf(Uint32Array);
    expect(f.picture.length).toBe(W * H);
    for (const c of f.picture) expect(c).toBeLessThanOrEqual(0xffffff);
  });

  it.each([...PHASES.map((p) => [p, steady(p)] as const), ['mid-blend', { from: 'sunset', to: 'purple-night', share: 0.5 }] as const])(
    'writes every pixel itself in %s (a target buffer full of garbage keeps none of it)',
    (_name, phase) => {
      const target = new Uint32Array(W * H).fill(SENTINEL);
      const f = sceneFrame(input({ phase: phase as PhaseReading }), target);
      expect(f.picture).toBe(target);
      expect(target.findIndex((c) => c === SENTINEL)).toBe(-1);
      expect(Array.from(target).every((c) => c <= 0xffffff)).toBe(true);
    },
  );

  it('draws into a reused target the same picture as a fresh one; a target of the wrong length is a RangeError and is left alone', () => {
    const target = new Uint32Array(W * H);
    sceneFrame(input({ phase: steady('frosty-morning'), seed: 7 }), target);
    sceneFrame(input(), target);
    expect(Array.from(target)).toEqual(pic());
    const short = new Uint32Array(W * H - 1).fill(SENTINEL);
    expect(() => sceneFrame(input(), short)).toThrow(RangeError);
    expect(short.every((c) => c === SENTINEL)).toBe(true);
  });

  // The last three rows: too narrow to hold the globe, too short for the countdown above it, and a height that is only the globe's.
  it.each([
    [0, H],
    [W, 0],
    [-W, H],
    [W + 0.5, H],
    [W, Number.NaN],
    [Number.POSITIVE_INFINITY, H],
    [2 * GLOBE_RADIUS - 1, H],
    [W, MIN_HEIGHT - 1],
    [W, 2 * GLOBE_RADIUS],
  ])('throws a RangeError for a picture size of %s x %s', (width, height) => {
    expect(() => sceneFrame(input({ width, height }))).toThrow(RangeError);
    expect(() => sceneLayout(width, height, SEED)).toThrow(RangeError);
  });

  it('accepts the narrowest picture that holds the globe and the shortest, MIN_HEIGHT (172): the countdown area above the globe', () => {
    expect(sceneLayout(2 * GLOBE_RADIUS, MIN_HEIGHT, SEED).width).toBe(2 * GLOBE_RADIUS);
    expect(MIN_HEIGHT).toBe(172);
    expect(sceneFrame(input({ height: MIN_HEIGHT })).picture.length).toBe(W * MIN_HEIGHT);
  });

  // XMAS-68: the base is 28 rows, its top 5 over the glass's foot; under its bottom row the layout keeps 12 rows (its shadow and a margin).
  it.each([[240, MIN_HEIGHT], [112, MIN_HEIGHT], [240, 180], [320, 300], [130, 260], [200, 1130]])('keeps the base and 12 rows under it inside a %i x %i picture: groundTop is at most height - 35', (width, height) => {
    const l = sceneLayout(width, height, SEED);
    expect(l.groundTop).toBeLessThanOrEqual(height - 35);
    expect(l.groundTop - BASE_SINK + BASE_ROWS + 12).toBeLessThanOrEqual(height);
    // The ground line is the globe's bottom where there is room, and never below it.
    expect(l.groundTop).toBeLessThanOrEqual(l.globe.cy + l.globe.radius);
  });

  it('rests the glass on the horizon from 240 x 260 up, sinks its foot into the base at the shortest picture, and raises the globe, never below the countdown, as the base needs room', () => {
    for (const height of [260, 300, 420, 1130]) {
      const l = sceneLayout(240, height, SEED);
      expect(l.groundTop, `height ${height}`).toBe(l.globe.cy + l.globe.radius);
    }
    const l = sceneLayout(240, MIN_HEIGHT, SEED);
    expect(l.groundTop + BASE_ROWS - BASE_SINK).toBe(MIN_HEIGHT - 12);
    expect(l.globe.cy + l.globe.radius, 'the glass reaches below the horizon').toBeGreaterThan(l.groundTop);
    expect(l.globe.cy - l.globe.radius, 'and stays under the countdown').toBeGreaterThanOrEqual(l.countdown.height);
    for (let height = MIN_HEIGHT; height <= 400; height += 7) {
      const g = sceneLayout(240, height, SEED);
      expect(g.globe.cy - g.globe.radius, `height ${height}`).toBeGreaterThanOrEqual(g.countdown.height);
      expect(g.globe.cy + g.globe.radius - BASE_SINK, `height ${height}`).toBeLessThanOrEqual(height);
    }
  });

  it('throws a RangeError for a NaN time or seed', () => {
    expect(() => sceneFrame(input({ time: Number.NaN }))).toThrow(RangeError);
    expect(() => sceneFrame(input({ seed: Number.NaN }))).toThrow(RangeError);
  });
});

describe('sceneFrame: determinism', () => {
  it('gives an identical picture for identical inputs, in a fresh array each time, with no hidden state: other calls in between change nothing', () => {
    const a = sceneFrame(input());
    sceneFrame(input({ seed: 999, width: 320, height: 200, phase: steady('dawn'), time: 5 }));
    sceneLayout(400, 300, 4242);
    const b = sceneFrame(input());
    expect(b.picture).not.toBe(a.picture);
    expect(Array.from(b.picture)).toEqual(Array.from(a.picture));
    expect(b.layout).toEqual(a.layout);
  });

  it('never calls Math.random, Date.now or performance.now', () => {
    const expected = pic();
    const stars = sceneLayout(W, H, SEED + 1).stars;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random called');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now called');
    });
    vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('performance.now called');
    });
    expect(pic()).toEqual(expected);
    expect(sceneLayout(W, H, SEED + 1).stars).toEqual(stars);
  });

  it('takes the stars from the seed: a different seed moves them, the same seed keeps them, and the edges 0 and 2^32 - 1 are accepted', () => {
    const a = sceneLayout(W, H, 1);
    expect(sceneLayout(W, H, 2).stars).not.toEqual(a.stars);
    expect(sceneLayout(W, H, 1).stars).toEqual(a.stars);
    expect(sceneFrame(input({ seed: 1 })).layout.stars).toEqual(a.stars);
    expect(pic({ seed: 2 })).not.toEqual(pic({ seed: 1 }));
    expect(sceneLayout(W, H, 0).stars.length).toBeGreaterThan(0);
    expect(sceneLayout(W, H, 0xffffffff).stars.length).toBeGreaterThan(0);
  });

  // XMAS-32d: Santa flies inside the glass with the time, so the glass may change too.
  it('changes only star pixels and pixels inside the glass as time passes', () => {
    const a = sceneFrame(input({ time: T }));
    const b = sceneFrame(input({ time: T + 7_000 }));
    const stars = starSet(a.layout);
    for (const [x, y] of grid(W, H)) {
      if (stars.has(`${x},${y}`) || inGlass(a.layout, x, y, 0)) continue;
      if (at(a, x, y) !== at(b, x, y)) expect.fail(`non-star pixel ${x},${y} outside the glass changed with time`);
    }
  });

  it('changes nothing outside the globe when only drag changes', () => {
    const a = sceneFrame(input({ drag: 0 }));
    const b = sceneFrame(input({ drag: 1.25 }));
    for (const [x, y] of grid(W, H)) {
      if (nearGlobe(a.layout, x, y, 0)) continue;
      if (at(a, x, y) !== at(b, x, y)) expect.fail(`pixel ${x},${y} outside the globe changed with drag`);
    }
  });
});

describe('sceneLayout: places', () => {
  const SIZES: [number, number][] = [[W, H], [320, 180], [240, 300], [161, 172], [2 * GLOBE_RADIUS, 172]];

  it.each(SIZES)('lays out a %s x %s picture: frame.layout matches sceneLayout, the 21-across disc sits at the top left clear of the globe, radius 56, centred across, wholly inside', (width, height) => {
    expect(sceneFrame(input({ width, height })).layout).toEqual(sceneLayout(width, height, SEED));
    expect(sceneFrame(input({ width, height })).picture.length).toBe(width * height);
    const l = sceneLayout(width, height, SEED);
    const { globe } = l;
    expect(GLOBE_RADIUS).toBe(56);
    expect(globe.radius).toBe(GLOBE_RADIUS);
    expect(Math.abs(globe.cx - width / 2)).toBeLessThanOrEqual(0.5);
    expect(globe.cx - globe.radius).toBeGreaterThanOrEqual(0);
    expect(globe.cx + globe.radius).toBeLessThanOrEqual(width);
    expect(globe.cy - globe.radius).toBeGreaterThanOrEqual(0);
    expect(globe.cy + globe.radius).toBeLessThanOrEqual(height);
    expect(DISC_SIZE).toBe(21);
    expect(l.disc.width).toBe(21);
    expect(l.disc.height).toBe(21);
    expect(l.disc.x).toBeGreaterThanOrEqual(0);
    expect(l.disc.y).toBeGreaterThanOrEqual(0);
    expect(l.disc.x + l.disc.width / 2).toBeLessThan(width / 3);
    expect(l.disc.y + l.disc.height / 2).toBeLessThan(height / 2);
    expect(l.disc.y + l.disc.height).toBeLessThanOrEqual(l.groundTop);
    // Where even a disc flush with the left edge overlaps the globe (the narrowest pictures) there is nothing to assert.
    if (discClearsAt(l, 0)) expect(discClearsAt(l, l.disc.x), 'disc clear of the globe').toBe(true);
  });

  const HEIGHTS = [MIN_HEIGHT, 173, 175, 200, 350, 700, 1130];
  const NARROW_TO_WIDE = [
    ...Array.from({ length: 300 - 2 * GLOBE_RADIUS + 1 }, (_, i) => 2 * GLOBE_RADIUS + i),
    301, 320, 360, 375, 390, 393, 412, 428, 480, 600, 640, 768, 800, 810, 820, 960, 1024, 1180, 1280, 1366, 1440, 1536, 1920, 2560, 3840,
  ];

  it('puts the disc at min(6, the widest left gap that clears the globe), at every width and height, in whole art pixels, never narrower than at a smaller width', () => {
    const wrong: string[] = [];
    expect(DISC_MARGIN).toBe(6);
    for (const height of HEIGHTS) {
      let last = -1;
      for (const width of [...NARROW_TO_WIDE, 1000, 1500, 2000]) {
        const l = sceneLayout(width, height, SEED);
        const x = l.disc.x;
        const want = expectedDiscX(l);
        const where = `${width}x${height}`;
        if (x !== want) wrong.push(`${where}: x ${x}, want ${want}`);
        if (!Number.isInteger(x) || x < 0 || x > DISC_MARGIN) wrong.push(`${where}: x ${x} is not a whole gap from 0 to ${DISC_MARGIN}`);
        if (x < last) wrong.push(`${where}: gap ${x} narrower than at the previous width (${last})`);
        last = x;
        if (width >= 180 && x !== DISC_MARGIN) wrong.push(`${where}: x ${x}, not the full gap from 180 up`);
        if (!discClearsAt(l, 0)) continue;
        if (!discClearsAt(l, x)) wrong.push(`${where}: disc at ${x} overlaps the globe`);
        if (x < DISC_MARGIN && discClearsAt(l, x + 1)) wrong.push(`${where}: gap ${x} is narrower than needed`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('does not let the seed move the disc', () => {
    for (const width of [112, 127, 133, 138, 180, 1920]) {
      const xs = [0, 1, 31, 0xffffffff].map((seed) => sceneLayout(width, MIN_HEIGHT, seed).disc.x);
      expect(new Set(xs).size, `${width}`).toBe(1);
    }
  });

  it('draws nothing of the disc in the gap: the disc body starts at its layout x', () => {
    const f = sceneFrame(input({ width: 180, height: 350 }));
    const { x, y } = f.layout.disc;
    const stars = starSet(f.layout);
    for (let yy = y; yy < y + 21; yy++) {
      const sky = rowSky(f, yy);
      for (let xx = 0; xx < x; xx++) {
        if (stars.has(`${xx},${yy}`)) continue;
        expect(at(f, xx, yy), `gap pixel ${xx},${yy} is the sky`).toBe(sky);
      }
    }
    expect(x).toBe(6);
  });

  it('has sky above and ground below, both growing with a taller picture, and runs the same sky bands and ground right across a wider picture', () => {
    const small = sceneLayout(W, H, SEED);
    const tall = sceneLayout(W, H + 60, SEED);
    expect(small.groundTop).toBeGreaterThan(0);
    expect(small.groundTop).toBeLessThan(H);
    expect(tall.groundTop).toBeGreaterThan(small.groundTop);
    expect(H + 60 - tall.groundTop).toBeGreaterThanOrEqual(H - small.groundTop);
    const narrow = sceneFrame(input({ phase: steady('frosty-morning') }));
    const wide = sceneFrame(input({ phase: steady('frosty-morning'), width: W + 80 }));
    expect(wide.layout.groundTop).toBe(narrow.layout.groundTop);
    const top = wide.layout.groundTop;
    for (let y = 0; y < top; y++) expect(rowSky(wide, y), `row ${y}`).toBe(rowSky(narrow, y));
    // The far right column, well outside the globe and the disc, is that band's sky.
    for (let y = 0; y < top; y++) expect(at(wide, W + 79, y), `right edge row ${y}`).toBe(rowSky(wide, y));
    // The ground reaches the far right too: its top row there is a ground colour, not sky.
    expect(at(wide, W + 79, top)).not.toBe(rowSky(wide, top - 1));
  });

  it.each([SEED, 1, 2, 3, 77, 0xffffffff])('places stars only in open sky (above the ground, off the disc, outside the globe) and never lets two touch (seed %s)', (seed) => {
    const l = sceneLayout(W, H, seed);
    const set = starSet(l);
    expect(l.stars.length).toBeGreaterThanOrEqual(10);
    expect(set.size).toBe(l.stars.length);
    for (const s of l.stars) {
      expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
      expect(s.x >= 0 && s.x < W && s.y >= 0 && s.y < l.groundTop, `star ${s.x},${s.y}`).toBe(true);
      expect(inDisc(l, s.x, s.y), `star ${s.x},${s.y} on the disc`).toBe(false);
      expect(nearGlobe(l, s.x, s.y, 1), `star ${s.x},${s.y} in the globe`).toBe(false);
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
        expect(set.has(`${s.x + dx},${s.y + dy}`), `stars touch at ${s.x},${s.y}`).toBe(false);
      }
    }
  });

  it('keeps stars out of the globe for many seeds and sizes', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const [width, height] of SIZES) {
        const l = sceneLayout(width, height, seed * 2654435761);
        for (const s of l.stars) {
          if (inGlass(l, s.x, s.y, 1)) expect.fail(`seed ${seed} ${width}x${height}: star ${s.x},${s.y} in the globe`);
        }
      }
    }
  });
});

describe('sceneFrame: sky, ground and disc', () => {
  it('draws the sky as horizontal bands: one colour per row, at least two bands', () => {
    const f = sceneFrame(input({ phase: steady('frosty-morning') }));
    const bands = new Set<number>();
    for (let y = 0; y < f.layout.groundTop; y++) {
      const sky = rowSky(f, y);
      bands.add(sky);
      for (let x = 0; x < W; x++) {
        if (inDisc(f.layout, x, y) || nearGlobe(f.layout, x, y)) continue;
        if (at(f, x, y) !== sky) expect.fail(`sky row ${y} is not one colour at x ${x}`);
      }
    }
    expect(bands.size).toBeGreaterThanOrEqual(2);
  });

  it('shows a horizon: the top ground row shares no colour with the sky row above it', () => {
    for (const p of PHASES) {
      const f = sceneFrame(input({ phase: steady(p) }));
      const stars = starSet(f.layout);
      const colours = (y: number): Set<number> => {
        const out = new Set<number>();
        for (let x = 0; x < W; x++) if (!nearGlobe(f.layout, x, y) && !stars.has(`${x},${y}`)) out.add(at(f, x, y));
        return out;
      };
      const sky = colours(f.layout.groundTop - 1);
      for (const c of colours(f.layout.groundTop)) expect(sky.has(c), `${p}: ground colour ${c.toString(16)} is also sky`).toBe(false);
    }
  });

  it('keeps the top sky row identical to the countdown sky in every phase, through every blend, and at a clock reading taken by phaseAt (17:20, sunset blend)', () => {
    const shares = [...Array.from({ length: 21 }, (_, i) => i / 20).filter((s) => s < 1), 0.39, 0.4, 0.41, 0.999];
    const same = (reading: PhaseReading, label: string): void => {
      expect(rowSky(sceneFrame(input({ phase: reading })), 0), label).toBe(hexNum(skyAndInk(reading).sky));
    };
    for (const p of PHASES) same(steady(p), p);
    for (const [from, to] of BLEND_PAIRS) for (const share of shares) same({ from, to, share }, `${from} -> ${to} share ${share}`);
    const reading = phaseAt(new Date(2026, 11, 1, 17, 20, 0));
    expect(reading.share).toBeGreaterThan(0);
    same(reading, 'phaseAt 17:20');
  });

  /** The disc drawing from the Props sheet, and the colour number of its body (its most used drawn colour). */
  function discArt(): { pixels: Uint8Array; body: number } {
    const disc = drawings['disc'];
    if (disc === undefined) throw new Error('art.generated.ts has no disc');
    expect(disc.sheet).toBe('props.png');
    expect([disc.width, disc.height]).toEqual([21, 21]);
    const counts = new Map<number, number>();
    for (const n of disc.pixels) if (n !== 0) counts.set(n, (counts.get(n) ?? 0) + 1);
    const body = [...counts].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 0;
    return { pixels: disc.pixels, body };
  }

  /** The one frame colour of every body pixel; fails if the body pixels disagree. */
  function bodyColour(phase: PhaseReading): number {
    const f = sceneFrame(input({ phase }));
    const { pixels, body } = discArt();
    const seen = new Set<number>();
    for (let i = 0; i < 441; i++) if (pixels[i] === body) seen.add(at(f, f.layout.disc.x + (i % 21), f.layout.disc.y + Math.floor(i / 21)));
    expect(seen.size, 'disc body pixels share one colour').toBe(1);
    return [...seen][0] ?? -1;
  }

  it.each(STAR_READINGS)('draws the disc in %s from the Props sheet shape: one colour per drawn colour, the sky through its clear pixels, the snow-white highlight pure white (as the base\'s white lettering ink is)', (p, phase) => {
    const { pixels } = discArt();
    const white = masterColours.indexOf('#ffffff') + 1;
    const f = sceneFrame(input({ phase }));
    const { x: dx, y: dy } = f.layout.disc;
    const byNumber = new Map<number, number>();
    let highlights = 0;
    for (const [x, y] of grid(21, 21)) {
      const n = pixels[y * 21 + x] ?? 0;
      const got = at(f, dx + x, dy + y);
      if (n === white) {
        highlights++;
        expect(got, `${p}: highlight pixel ${x},${y}`).toBe(0xffffff);
      }
      if (n === 0) {
        expect(got, `${p}: clear disc pixel ${x},${y} shows the sky`).toBe(rowSky(f, dy + y));
        continue;
      }
      const seen = byNumber.get(n);
      if (seen === undefined) byNumber.set(n, got);
      else expect(got, `${p}: disc pixel ${x},${y} (drawn colour ${n})`).toBe(seen);
    }
    // The outline still reads: the drawn rim colour is not the sky behind it.
    expect(byNumber.size).toBeGreaterThan(1);
    expect(highlights, 'the Props sheet disc has snow-white highlight pixels').toBeGreaterThan(0);
  });

  it('shows a cool moon at night and a warm sun by day, with dawn and sunset between: the disc body changes colour, not shape', () => {
    const night = sceneFrame(input({ phase: steady('purple-night') }));
    const day = sceneFrame(input({ phase: steady('frosty-morning') }));
    expect(day.layout.disc).toEqual(night.layout.disc);
    const [moon, sun] = [bodyColour(steady('purple-night')), bodyColour(steady('frosty-morning'))];
    const [nr, , nb] = rgb(moon);
    const [dr, , db] = rgb(sun);
    expect(nb, `night body #${moon.toString(16)} must be cool (blue >= red)`).toBeGreaterThanOrEqual(nr);
    expect(dr - db, `day body #${sun.toString(16)} must be warm (red - blue >= 60)`).toBeGreaterThanOrEqual(60);
    expect(distance(moon, sun), 'moon and sun bodies clearly apart').toBeGreaterThanOrEqual(90);
    const warmth = (c: number): number => rgb(c)[0] - rgb(c)[2];
    for (const p of ['dawn', 'sunset'] as const) {
      const mid = bodyColour(steady(p));
      expect(mid, `${p} body is the moon's`).not.toBe(moon);
      expect(warmth(mid), `${p} warmer than the moon`).toBeGreaterThan(warmth(moon));
      expect(warmth(mid), `${p} no warmer than the sun`).toBeLessThanOrEqual(warmth(sun));
    }
  });

  it.each(BLEND_PAIRS)('moves the disc body steadily from %s to %s through the blend', (from, to) => {
    const a = rgb(bodyColour(steady(from)));
    const b = rgb(bodyColour(steady(to)));
    let prev = a;
    for (let i = 1; i <= 19; i++) {
      const share = i / 20;
      const got = rgb(bodyColour({ from, to, share }));
      for (let c = 0; c < 3; c++) {
        const lo = Math.min(a[c] ?? 0, b[c] ?? 0) - 1;
        const hi = Math.max(a[c] ?? 0, b[c] ?? 0) + 1;
        expect((got[c] ?? 0) >= lo && (got[c] ?? 0) <= hi, `share ${share} channel ${c}: ${got[c]} outside ${lo}..${hi}`).toBe(true);
        const step = (got[c] ?? 0) - (prev[c] ?? 0);
        const towards = Math.sign((b[c] ?? 0) - (a[c] ?? 0));
        expect(step * towards >= -1, `share ${share} channel ${c} steps back: ${prev[c]} -> ${got[c]}`).toBe(true);
      }
      prev = got;
    }
  });
});

describe('sceneFrame: phases are colour tables only', () => {
  it('keeps the same layout in every phase and blend', () => {
    const base = sceneFrame(input()).layout;
    for (const p of PHASES) expect(sceneFrame(input({ phase: steady(p) })).layout).toEqual(base);
    expect(sceneFrame(input({ phase: { from: 'dawn', to: 'frosty-morning', share: 0.3 } })).layout).toEqual(base);
  });

  it.each(PHASES.filter((p) => p !== 'purple-night'))('gives %s the same picture as purple night with only the colours swapped', (p) => {
    const night = sceneFrame(input({ phase: steady('purple-night') }));
    const other = sceneFrame(input({ phase: steady(p) }));
    const stars = starSet(night.layout);
    const map = new Map<number, number>();
    let changed = 0;
    for (const [x, y] of grid(W, H)) {
      if (stars.has(`${x},${y}`) || nearGlobe(night.layout, x, y)) continue;
      const n = at(night, x, y);
      const o = at(other, x, y);
      if (n !== o) changed++;
      const seen = map.get(n);
      if (seen === undefined) map.set(n, o);
      else if (seen !== o) expect.fail(`${p}: night colour ${n.toString(16)} maps to both ${seen.toString(16)} and ${o.toString(16)} (at ${x},${y})`);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('shows no stars in Frosty morning, faint ones at Dawn and Sunset, full ones in Purple night (lighter than the sky beside them)', () => {
    // Signed: a star darker than the sky beside it counts against its phase.
    const strength = (p: PhaseName): number => {
      const frames = sweep(steady(p));
      const l = frames[0]?.layout;
      if (l === undefined) throw new Error('no frames');
      let total = 0;
      for (const s of l.stars) {
        let most = Number.NEGATIVE_INFINITY;
        for (const f of frames) most = Math.max(most, lift(f, s.x, s.y));
        total += most;
      }
      return total / l.stars.length;
    };
    const night = strength('purple-night');
    const dawn = strength('dawn');
    const sunset = strength('sunset');
    expect(strength('frosty-morning')).toBe(0);
    expect(dawn).toBeGreaterThan(0);
    expect(sunset).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(night);
    expect(sunset).toBeLessThan(night);
  });

  it('draws Frosty morning stars exactly as the sky beside them', () => {
    for (const f of sweep(steady('frosty-morning')).filter((_, i) => i % 30 === 0)) {
      for (const s of f.layout.stars) expect(at(f, s.x, s.y), `star ${s.x},${s.y}`).toBe(besideSky(f, s.x, s.y));
    }
  });

  it.each(STAR_READINGS)('lights every star lighter than the sky beside it in %s', (_name, phase) => {
    const failures: string[] = [];
    let lit = 0;
    for (const time of [T, T + 1_300, T + 2_700, T + 9_100]) {
      const f = sceneFrame(input({ phase, time }));
      for (const s of f.layout.stars) {
        const star = at(f, s.x, s.y);
        const beside = besideSky(f, s.x, s.y);
        if (star === beside) continue;
        lit++;
        if (relativeLuminance(hexOf(star)) <= relativeLuminance(hexOf(beside))) {
          failures.push(`t ${time} star ${s.x},${s.y}: ${hexOf(star)} is not lighter than ${hexOf(beside)}`);
        }
      }
    }
    expect(failures).toEqual([]);
    if (phase.from !== 'frosty-morning' || phase.to !== 'frosty-morning') expect(lit, 'no star lit').toBeGreaterThan(0);
  });

  it.each(['dawn', 'sunset'] as const)('keeps the faint %s stars visibly apart from the sky beside them', (p) => {
    const frames = sweep(steady(p));
    const l = frames[0]?.layout;
    if (l === undefined) throw new Error('no frames');
    let visible = 0;
    for (const s of l.stars) if (frames.some((f) => distance(at(f, s.x, s.y), besideSky(f, s.x, s.y)) > 0)) visible++;
    expect(visible, `${p}: stars that ever differ from the sky beside them`).toBeGreaterThanOrEqual(l.stars.length / 2);
  });
});

describe('sceneFrame: blends', () => {
  // Sunset -> Purple night mixes straight, pixel by pixel. Blends with Dawn
  // in them bend through a via ramp instead (pinned below), and the
  // frosty-morning blends follow the countdown bridge, pinned above through
  // the top sky row.
  it.each([
    ['19:00:00, sunset -> purple night at 1/2', new Date(2026, 11, 3, 19, 0, 0), 0.5],
    ['19:07:30, sunset -> purple night at 3/4', new Date(2026, 11, 3, 19, 7, 30), 0.75],
  ] as const)('shows an even mix of the two colour tables at %s', (_name, when, share) => {
    const reading = phaseAt(when);
    expect(reading.share).toBeCloseTo(share, 9);
    const mixed = sceneFrame(input({ phase: reading }));
    const from = sceneFrame(input({ phase: steady(reading.from) }));
    const to = sceneFrame(input({ phase: steady(reading.to) }));
    const stars = starSet(mixed.layout);
    for (const [x, y] of grid(W, H)) {
      if (stars.has(`${x},${y}`) || nearGlobe(mixed.layout, x, y)) continue;
      const a = rgb(at(from, x, y));
      const b = rgb(at(to, x, y));
      const got = rgb(at(mixed, x, y));
      for (let c = 0; c < 3; c++) {
        const want = (a[c] ?? 0) * (1 - share) + (b[c] ?? 0) * share;
        if (Math.abs((got[c] ?? 0) - want) > 1) expect.fail(`pixel ${x},${y} channel ${c}: ${got[c]} is not the mix ${want}`);
      }
    }
  });

  describe.each(DAWN_BLENDS)('%s -> %s, through its via ramp', (from, to) => {
    it.each(DAWN_SIZES)('is the steady pictures at share 0 and 1, pixel for pixel, at %ix%i', (width, height) => {
      expect(pic({ width, height, phase: { from, to, share: 0 } })).toEqual(pic({ width, height, phase: steady(from) }));
      expect(pic({ width, height, phase: { from, to, share: 1 } })).toEqual(pic({ width, height, phase: steady(to) }));
    });

    it.each(DAWN_CASES)('keeps the countdown strip the countdown sky, then runs the sky smoothly to the horizon (no channel steps more than 8 between rows), at %ix%i, share %d', (width, height, share) => {
      const reading: PhaseReading = { from, to, share };
      const f = sceneFrame(input({ width, height, phase: reading }));
      const want = hexNum(skyAndInk(reading).sky);
      const c = f.layout.countdown;
      for (const [x, y] of cells(c)) {
        if (at(f, x, y) !== want) expect.fail(`countdown pixel ${x},${y} is ${hexOf(at(f, x, y))}, not the countdown sky ${hexOf(want)}`);
      }
      for (let y = 1; y < f.layout.groundTop; y++) {
        const above = rgb(rowSky(f, y - 1));
        const here = rgb(rowSky(f, y));
        for (let ch = 0; ch < 3; ch++) {
          const step = Math.abs((here[ch] ?? 0) - (above[ch] ?? 0));
          if (step > MAX_SKY_STEP) expect.fail(`row ${y - 1} -> ${y} channel ${ch} steps ${step}`);
        }
      }
    });

    it.each(DAWN_SIZES)('keeps the mid-blend horizon coloured, not grey, at %ix%i', (width, height) => {
      // Rendered at 1/2: purple night -> dawn #c889a0 (chroma 63, saturation
      // 0.36), dawn -> frosty morning #f5cad6 (chroma 43, saturation 0.68).
      // The straight mix would be #a2848f-ish (0.14) and #cbccc8 (0.04).
      const f = sceneFrame(input({ width, height, phase: { from, to, share: 0.5 } }));
      const horizon = rowSky(f, f.layout.groundTop - 1);
      const [r, g, b] = rgb(horizon);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lightness = (max + min) / 510;
      const saturation = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * lightness - 1));
      expect(max - min, `horizon ${hexOf(horizon)} chroma`).toBeGreaterThanOrEqual(MIN_HORIZON_CHROMA);
      expect(saturation, `horizon ${hexOf(horizon)} saturation`).toBeGreaterThanOrEqual(MIN_HORIZON_SATURATION);
    });

    it('gives the same frame for the same inputs, also after a frame of another size', () => {
      const reading: PhaseReading = { from, to, share: 0.5 };
      const first = pic({ width: 130, height: 260, phase: reading });
      sceneFrame(input({ width: 240, height: 172, phase: { from, to, share: 0.25 } }));
      expect(pic({ width: 130, height: 260, phase: reading })).toEqual(first);
    });
  });

  it('differs mid-blend from both steady phases', () => {
    const mid = pic({ phase: { from: 'sunset', to: 'purple-night', share: 0.5 } });
    expect(mid).not.toEqual(pic({ phase: steady('sunset') }));
    expect(mid).not.toEqual(pic({ phase: steady('purple-night') }));
  });
});

describe('sceneFrame: twinkling stars', () => {
  it('changes each star at most about once a second over a 3-second sweep at 60 steps a second', () => {
    const frames = sweep(steady('purple-night'));
    const l = frames[0]?.layout;
    if (l === undefined) throw new Error('no frames');
    let twinkled = 0;
    for (const s of l.stars) {
      let changes = 0;
      for (let i = 1; i < frames.length; i++) {
        const prev = frames[i - 1];
        const cur = frames[i];
        if (prev !== undefined && cur !== undefined && at(prev, s.x, s.y) !== at(cur, s.x, s.y)) changes++;
      }
      expect(changes, `star ${s.x},${s.y} changed ${changes} times in 3 s`).toBeLessThanOrEqual(4);
      if (changes > 0) twinkled++;
    }
    expect(twinkled, 'no star twinkled in 3 s').toBeGreaterThan(0);
  });

  it('lights a star as exactly one art pixel, and only at a star', () => {
    for (const f of sweep(steady('purple-night')).filter((_, i) => i % 15 === 0)) {
      const stars = starSet(f.layout);
      let lit = 0;
      for (let y = 0; y < f.layout.groundTop; y++) {
        const sky = rowSky(f, y);
        for (let x = 0; x < W; x++) {
          if (inDisc(f.layout, x, y) || nearGlobe(f.layout, x, y)) continue;
          if (at(f, x, y) === sky) continue;
          lit++;
          if (!stars.has(`${x},${y}`)) expect.fail(`lit pixel ${x},${y} is not a star`);
          for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1], [x - 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x + 1, y - 1]] as const) {
            if (ny < 0 || ny >= f.layout.groundTop || nx < 0 || nx >= W) continue;
            if (inDisc(f.layout, nx, ny) || nearGlobe(f.layout, nx, ny)) continue;
            if (at(f, nx, ny) !== rowSky(f, ny)) expect.fail(`star at ${x},${y} spills onto ${nx},${ny}`);
          }
        }
      }
      expect(lit).toBeGreaterThan(0);
    }
  });
});

describe('sceneFrame: never touches the page', () => {
  it('runs with document, window and canvas globals that throw on any use', () => {
    const trap = new Proxy({}, { get: (_t, key) => { throw new Error(`page global touched: ${String(key)}`); } });
    for (const name of ['document', 'window', 'OffscreenCanvas', 'ImageData']) vi.stubGlobal(name, trap);
    const f = sceneFrame(input({ phase: { from: 'frosty-morning', to: 'sunset', share: 0.5 } }));
    expect(f.picture.length).toBe(W * H);
  });
});

/** A flake at art px (x, y) from the globe centre, depth z; a flake is one art pixel. */
function flake(x: number, y: number, z: number): Flake {
  return { x, y, z, resting: false, phase: 0 };
}

/** A settled snow of real flakes, stepped for a while so it has a spread of depths. */
function settledSnow(): GlobeSnow {
  const snow = createGlobeSnow(SEED, false);
  for (let i = 0; i < 600; i++) stepGlobeSnow(snow, { turn: 0.4, raise: 0, push: { x: 0, y: 0, z: 0 } });
  return snow;
}

describe('globe snow is not in the scene picture (XMAS-84)', () => {
  it.each(PHASES)('in %s the picture is the same with the snow as without it', (p) => {
    expect(pic({ snow: settledSnow(), phase: steady(p) })).toEqual(pic({ phase: steady(p) }));
  });

  it('the frame with the shapes left out carries no picture of Santa or the flakes: they are the page\'s steps (XMAS-83, XMAS-84)', () => {
    const withSnow = sceneFrame(input({ snow: settledSnow(), shapeBodies: false }));
    expect(withSnow).toEqual(sceneFrame(input({ shapeBodies: false })));
    expect(Object.keys(withSnow).sort()).toEqual(['height', 'layout', 'picture', 'width']);
  });

  it('one flake in front and one behind leave the picture exactly as it was', () => {
    const snow: GlobeSnow = { flakes: [flake(10.25, -20.75, 20), flake(-5, 5, -20)], stir: 0 };
    expect(pic({ snow })).toEqual(pic());
    expect(pic({ snow, shapeBodies: false })).toEqual(pic({ shapeBodies: false }));
  });
});

describe('sceneLayout: the countdown area', () => {
  // Spec 6.6: the digits reach 4.5:1 against every sky colour that can sit
  // behind them, in every phase and at every tenth of each blend. The scene
  // reserves the top of the picture, as tall as the tallest countdown frame
  // (the days frame or the Christmas Day greeting) pushed down by the page's
  // sky above it (SKY_ABOVE), for plain sky only.
  const COUNTDOWN_HEIGHT =
    Math.max(
      countdownFrame({ christmasDay: false, days: 123, hours: 4, minutes: 5, seconds: 6 }, true).height,
      countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true).height,
    ) + SKY_ABOVE;
  it('reserves exactly the rows the greeting inks, shadow included, once the page puts SKY_ABOVE rows of sky over it', () => {
    const greeting = countdownFrame({ christmasDay: true, days: 0, hours: 0, minutes: 0, seconds: 0 }, true);
    const lastRow = Math.floor(Array.from(greeting.pixels).reduce((last, p, i) => (p !== 0 ? i : last), -1) / greeting.width);
    expect(sceneLayout(W, H, SEED).countdown.height).toBe(SKY_ABOVE + lastRow + 1);
    expect(COUNTDOWN_HEIGHT).toBe(SKY_ABOVE + lastRow + 1);
  });
  const AREA_SIZES: [number, number][] = [[130, 260], [130, 172], [2 * GLOBE_RADIUS, 172], [W, MIN_HEIGHT], [W, H], [320, 200]];
  const READINGS: PhaseReading[] = [
    ...PHASES.map(steady),
    ...BLEND_PAIRS.flatMap(([from, to]) =>
      [...Array.from({ length: 10 }, (_, i) => i / 10), 0.39, 0.41].map((share): PhaseReading => ({ from, to, share })),
    ),
  ];

  it.each(AREA_SIZES)('reserves the full-width top of a %s x %s picture, as tall as the countdown frame, and keeps the globe, the disc and every star out of it', (width, height) => {
    expect(sceneFrame(input({ width, height })).layout.countdown).toEqual(sceneLayout(width, height, SEED).countdown);
    for (const seed of [0, 1, 31, SEED, 0xffffffff]) {
      const l = sceneLayout(width, height, seed);
      const c = l.countdown;
      const bottom = c.y + c.height;
      expect(c, 'countdown area').toEqual({ x: 0, y: 0, width, height: COUNTDOWN_HEIGHT });
      expect(l.globe.cy - l.globe.radius, 'globe top').toBeGreaterThanOrEqual(bottom);
      expect(l.disc.y, 'disc top').toBeGreaterThanOrEqual(bottom);
      expect(l.groundTop).toBeGreaterThan(bottom);
      // Where even x = 0 overlaps the globe (the narrowest pictures) there is nothing to assert.
      if (discClearsAt(l, 0)) expect(discClearsAt(l, l.disc.x), 'disc in the globe').toBe(true);
      for (const s of l.stars) expect(s.y >= bottom, `seed ${seed}: star ${s.x},${s.y} in the countdown area`).toBe(true);
    }
  });

  it.each(AREA_SIZES)('gives every countdown-area pixel 4.5:1 against the countdown ink in every phase and tenth of each blend at %s x %s', (width, height) => {
    const failures: string[] = [];
    for (const reading of READINGS) {
      const { ink } = skyAndInk(reading);
      const f = sceneFrame(input({ width, height, phase: reading, seed: 31 }));
      // Until the layout names its countdown area, check where the digits sit: the full-width top rows.
      const c = (f.layout.countdown as SceneLayout['countdown'] | undefined) ?? { x: 0, y: 0, width, height: COUNTDOWN_HEIGHT };
      let worst = Number.POSITIVE_INFINITY;
      let worstSky = '';
      for (const [x, y] of cells(c)) {
        const sky = hexOf(at(f, x, y));
        const ratio = contrast(sky, ink);
        if (ratio < worst) [worst, worstSky] = [ratio, sky];
      }
      if (worst < MIN_CONTRAST_RATIO) {
        failures.push(`${reading.from} -> ${reading.to} at ${reading.share}: ink ${ink} on sky ${worstSky} is ${worst.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps the countdown area plain sky: one colour per row, no star, no disc', () => {
    for (const reading of [steady('purple-night'), steady('sunset'), { from: 'frosty-morning', to: 'sunset', share: 0.5 } as PhaseReading]) {
      for (const time of [T, T + 1_500, T + 4_000]) {
        const f = sceneFrame(input({ width: 130, height: 260, phase: reading, time }));
        const c = f.layout.countdown;
        for (const [x, y] of cells(c)) {
          if (at(f, x, y) !== at(f, c.x, y)) expect.fail(`${reading.from}->${reading.to} t ${time}: countdown row ${y} is not one colour at x ${x}`);
        }
      }
    }
  });
});
