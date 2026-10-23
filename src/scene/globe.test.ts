// XMAS-32a "The globe": the glass (phase tint, rim, reflections that travel
// with the turn), the base's cast shadow and the lettering wrapped round the
// base's drum. XMAS-68: the base is drawn in code (base-fine.ts) in hard master
// colours, centred on layout.globe, after the ground; nothing outside the
// globe, its base and the base's shadow changes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { drawings } from '../shared/art.generated.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { GLOBE_RADIUS, MIN_HEIGHT, sceneFrame, sceneLayout, type SceneFrame, type SceneInput, type SceneLayout } from './frame.ts';
import { BASE_FOOT_ROWS, BASE_ROWS, BASE_WIDTH, renderBase } from './base-fine.ts';
import { BASE_SINK, drawGlobe, NO_FRONT } from './globe.ts';

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
  ...PHASES.map((p): [string, PhaseReading] => [p, steady(p)]),
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
  [161, MIN_HEIGHT],
  [2 * GLOBE_RADIUS, MIN_HEIGHT],
];
/** The base's master colours (base-fine.ts): the lettering's gold, and the shared engraving dark. */
const GOLD = hexNum('#ffe08a');
const GOLD_DARK = hexNum('#c4923a');
/** The rows the cast shadow tints under the base's bottom row: the drum's 28 art rows at the shapes' flat (shapes-draw.ts), 7 deep at its middle. */
const SHADOW_ROWS = 7;

afterEach(() => {
  globeOn.value = true;
  vi.restoreAllMocks();
});

function overDisc({ disc: d }: SceneLayout, x: number, y: number): boolean {
  return x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height;
}

/** Whether a disc flush with the left edge would stay outside the globe's circle. */
function discFlushClears(l: SceneLayout): boolean {
  for (let y = l.disc.y; y < l.disc.y + l.disc.height; y++) {
    for (let x = 0; x < l.disc.width; x++) {
      const dx = x + 0.5 - l.globe.cx;
      const dy = y + 0.5 - l.globe.cy;
      if (dx * dx + dy * dy <= l.globe.radius ** 2) return false;
    }
  }
  return true;
}

function steady(phase: PhaseName): PhaseReading {
  return { from: phase, to: phase, share: 0 };
}

function input(over: Partial<SceneInput> = {}): SceneInput {
  return { time: T, drag: 0, phase: steady('purple-night'), seed: SEED, width: W, height: H, backdrop: false, ...over };
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

function at(f: SceneFrame, x: number, y: number): number {
  return f.picture[y * f.width + x] ?? -1;
}

/** Pixel centre within radius + margin of the globe's centre. */
function inCircle(l: SceneLayout, x: number, y: number, margin: number): boolean {
  const dx = x + 0.5 - l.globe.cx;
  const dy = y + 0.5 - l.globe.cy;
  return dx * dx + dy * dy <= (l.globe.radius + margin) ** 2;
}

/** The base's box in the picture (XMAS-68): centred on the globe, its top BASE_SINK rows above the horizon. */
function baseBox(f: SceneFrame): Box {
  return { x: f.layout.globe.cx - BASE_WIDTH / 2, y: f.layout.groundTop - BASE_SINK };
}

/** What renderBase draws at one pixel to an art pixel, in the base's own box: NO_FRONT where it draws nothing. */
function drawnBase(turn: number): Uint32Array {
  const out = new Uint32Array(BASE_WIDTH * BASE_ROWS).fill(NO_FRONT);
  renderBase(out, BASE_WIDTH, 0, 0, 1, turn);
  return out;
}

/** Calls fn for every pixel renderBase draws at this turn: base-box coordinates, the wanted colour, the frame's colour. */
function eachBasePixel(f: SceneFrame, turn: number, fn: (x: number, y: number, want: number, got: number) => void): void {
  const box = baseBox(f);
  const want = drawnBase(turn);
  for (let y = 0; y < BASE_ROWS; y++) {
    for (let x = 0; x < BASE_WIDTH; x++) {
      const c = want[y * BASE_WIDTH + x] ?? NO_FRONT;
      if (c !== NO_FRONT) fn(x, y, c, at(f, box.x + x, box.y + y));
    }
  }
}

function pic(over: Partial<SceneInput> = {}): number[] {
  return Array.from(sceneFrame(input(over)).picture);
}

/**
 * Every colour any drawing uses. Sprites are point-sampled (XMAS-75), so their pixels
 * are crisp and carry the art's own patterns; only the glass is smooth, and the glass
 * tests look past these colours.
 */
const SPRITE_COLOURS = ((): Set<number> => {
  const out = new Set<number>();
  for (const d of Object.values(drawings)) for (const n of d.pixels) if (n !== 0) out.add(hexNum(masterColours[n - 1] ?? '#000000'));
  return out;
})();

interface Box { x: number; y: number }

function inBox(box: Box, x: number, y: number): boolean {
  return x >= box.x && x < box.x + BASE_WIDTH && y >= box.y && y < box.y + BASE_ROWS;
}

/** The glass: pixel centres well inside the circle, off the base. */
function glassPixels(f: SceneFrame, box: Box): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) if (inCircle(f.layout, x, y, -2) && !inBox(box, x, y)) out.push([x, y]);
  return out;
}

/** Every pixel outside the circle (radius + 1) and the base box that differs from the bare XMAS-31 picture. */
function outsideChanges(f: SceneFrame, b: SceneFrame, box: Box): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) if (!inCircle(f.layout, x, y, 1) && !inBox(box, x, y) && at(f, x, y) !== at(b, x, y)) out.push([x, y]);
  }
  return out;
}

function brightness(n: number): number {
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
}

/** Whether the 2 x 2 block at x,y is a checkerboard of two alternating colours. */
function checkered(f: SceneFrame, x: number, y: number): boolean {
  const a = at(f, x, y);
  const b = at(f, x + 1, y);
  return a !== b && a === at(f, x + 1, y + 1) && b === at(f, x, y + 1);
}

/** Ground pixels outside the circle and base box that the cast shadow darkened. */
function darkened(f: SceneFrame, b: SceneFrame, box: Box): [number, number][] {
  return outsideChanges(f, b, box).filter(([x, y]) => y >= f.layout.groundTop && brightness(at(f, x, y)) < brightness(at(b, x, y)));
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
        const box = baseBox(f);
        for (const [x, y] of outsideChanges(f, b, box)) {
          const where = `${name} turn ${turn}: pixel ${x},${y} outside the globe and base changed`;
          if (y < f.layout.groundTop) expect.fail(`${where} above the ground`);
          if (x < box.x) expect.fail(`${where} left of the base: the cast shadow stays inside the base's footprint`);
          if (brightness(at(f, x, y)) >= brightness(at(b, x, y))) expect.fail(`${where} and is not darker`);
        }
      }
    }
  });

  it.each(SIZES)('keeps the glass at radius 56 at %s x %s: the rim band just inside the circle is drawn all round the top', (width, height) => {
    const f = sceneFrame(input({ width, height }));
    const b = baseline({ width, height });
    expect(f.layout.globe.radius).toBe(GLOBE_RADIUS);
    const discClears = discFlushClears(f.layout);
    let band = 0;
    let drawn = 0;
    for (let y = 0; y < f.layout.globe.cy; y++) {
      for (let x = 0; x < width; x++) {
        // Where even a disc flush with the left edge overlaps the globe (XMAS-63, the narrowest pictures) the disc hides part of the band.
        if (!inCircle(f.layout, x, y, -0.5) || inCircle(f.layout, x, y, -1.5) || (!discClears && overDisc(f.layout, x, y))) continue;
        band++;
        if (at(f, x, y) !== at(b, x, y)) drawn++;
      }
    }
    expect(band).toBeGreaterThan(100);
    expect(drawn / band, 'share of the rim band that is drawn').toBeGreaterThanOrEqual(0.9);
  });

  it('draws no checkerboard dither: no 2 x 2 block of two alternating colours on the glass (the sprites\' own crisp art patterns aside)', () => {
    for (const [name, phase] of READINGS) {
      for (const turn of [0, 0.7, 2.1, 5]) {
        const f = sceneFrame(input({ phase, turn }));
        const box = baseBox(f);
        for (const [x, y] of glassPixels(f, box)) {
          if (!inCircle(f.layout, x + 1, y + 1, -2) || inBox(box, x + 1, y + 1)) continue;
          if (SPRITE_COLOURS.has(at(f, x, y)) || SPRITE_COLOURS.has(at(f, x + 1, y))) continue;
          if (checkered(f, x, y)) expect.fail(`${name} turn ${turn}: checkerboard at ${x},${y}`);
        }
      }
    }
  });
});

describe('sceneFrame: the cast shadow', () => {
  /** Sizes with ground to the right of the base for a shadow to fall on. */
  const ROOMY = SIZES.slice(0, 3);

  it.each(ROOMY)('casts a shadow on the ground under the base, leaning right and within its sides, at %s x %s', (width, height) => {
    for (const [name, phase] of READINGS) {
      const f = sceneFrame(input({ width, height, phase }));
      const b = baseline({ width, height, phase });
      const box = baseBox(f);
      const cast = darkened(f, b, box);
      expect(cast.length, `${name}: darkened ground pixels`).toBeGreaterThanOrEqual(10);
      const xs = cast.map(([x]) => x);
      expect(Math.min(...xs), `${name}: shadow left of the base's footprint`).toBeGreaterThanOrEqual(box.x);
      expect(Math.max(...xs), `${name}: shadow past the base's right side`).toBeLessThan(box.x + BASE_WIDTH);
      const middle = box.x + BASE_WIDTH / 2;
      expect(xs.reduce((sum, x) => sum + x, 0) / xs.length, `${name}: shadow leans right of the base's middle`).toBeGreaterThan(middle);
    }
  });

  it.each(ROOMY)('keeps the shadow still while the globe turns at %s x %s: outside the globe and base, every turn draws the same pixels', (width, height) => {
    for (const [name, phase] of READINGS) {
      const first = sceneFrame(input({ width, height, phase, turn: 0 }));
      const box = baseBox(first);
      expect(outsideChanges(first, baseline({ width, height, phase }), box).length, `${name}: a shadow is drawn`).toBeGreaterThan(0);
      for (const turn of [0.01, 1.3, Math.PI, 4, -2]) {
        const [moved] = outsideChanges(sceneFrame(input({ width, height, phase, turn })), first, box);
        expect(moved, `${name} turn ${turn}: a pixel outside the globe changed with the turn`).toBeUndefined();
      }
    }
  });

  it('draws the shadow in smooth tones: no 2 x 2 checkerboard on the ground beside the base', () => {
    for (const [name, phase] of READINGS) {
      const f = sceneFrame(input({ phase }));
      const box = baseBox(f);
      for (let y = f.layout.groundTop; y + 1 < f.height; y++) {
        for (let x = 0; x + 1 < f.width; x++) {
          if (inBox(box, x, y) || inBox(box, x + 1, y) || inBox(box, x, y + 1) || inBox(box, x + 1, y + 1)) continue;
          if (checkered(f, x, y)) expect.fail(`${name}: checkerboard on the ground at ${x},${y}`);
        }
      }
    }
  });
});

describe('sceneFrame: the shortest picture', () => {
  it.each([240, 2 * GLOBE_RADIUS])('at %s x MIN_HEIGHT rests the base 12 rows above the bottom, over the foot of the glass, and keeps a valid picture', (width) => {
    const height = MIN_HEIGHT;
    for (const [name, phase] of READINGS) {
      const f = sceneFrame(input({ width, height, phase }));
      expect(f.picture.length).toBe(width * height);
      for (const c of f.picture) expect(c).toBeLessThanOrEqual(0xffffff);
      const box = baseBox(f);
      const { cx, cy, radius } = f.layout.globe;
      expect(box.y + BASE_ROWS, `${name}: the margin under the base`).toBe(height - 12);
      // The globe's foot is hidden in the base: its lowest rows sit inside the base's box.
      expect(cy + radius, `${name}: globe bottom`).toBeGreaterThan(box.y);
      expect(cy + radius).toBeLessThanOrEqual(box.y + BASE_ROWS);
      expect(at(f, cx, box.y - 1), `${name}: glass just above the base`).not.toBe(at(baseline({ width, height, phase }), cx, box.y - 1));
    }
  });

  it('keeps the whole base and its shadow inside the picture at every height from MIN_HEIGHT up', () => {
    for (let height = MIN_HEIGHT; height <= MIN_HEIGHT + 60; height += 3) {
      const f = sceneFrame(input({ height }));
      const box = baseBox(f);
      expect(box.y + BASE_ROWS, `height ${height}: base bottom`).toBeLessThanOrEqual(height - 12);
      expect(box.y + BASE_ROWS + SHADOW_ROWS, `height ${height}: shadow bottom`).toBeLessThanOrEqual(height);
    }
  });
});

describe('sceneFrame: the base', () => {
  it.each(SIZES)('puts the base under the globe, centred across and inside the picture, drawn there, at %s x %s', (width, height) => {
    const f = sceneFrame(input({ width, height }));
    const b = baseline({ width, height });
    const box = baseBox(f);
    const { cx, cy, radius } = f.layout.globe;
    expect(box.x + BASE_WIDTH / 2, 'base centre across').toBe(cx);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + BASE_WIDTH).toBeLessThanOrEqual(width);
    expect(box.y + BASE_ROWS).toBeLessThanOrEqual(height);
    expect(box.y, 'base top is below the globe centre').toBeGreaterThan(cy);
    expect(box.y + BASE_ROWS, 'base holds the globe from below').toBeGreaterThanOrEqual(cy + radius);
    // It is in the picture: the drum's bottom middle and the lip's top middle differ from the bare picture; the box's top corners (outside the lip's trapezoid) do not.
    expect(at(f, cx, box.y + BASE_ROWS - 1)).not.toBe(at(b, cx, box.y + BASE_ROWS - 1));
    expect(at(f, cx, box.y)).not.toBe(at(b, cx, box.y));
    expect(at(f, box.x, box.y), 'top left corner of the box').toBe(at(b, box.x, box.y));
    expect(at(f, box.x + BASE_WIDTH - 1, box.y), 'top right corner of the box').toBe(at(b, box.x + BASE_WIDTH - 1, box.y));
  });

  it.each([0, 0.5, 2.2, 5.9])('draws exactly renderBase at one pixel to an art pixel (turn %s)', (turn) => {
    let drawn = 0;
    eachBasePixel(sceneFrame(input({ turn })), turn, (x, y, want, got) => {
      drawn++;
      if (got !== want) expect.fail(`turn ${turn}: base pixel ${x},${y} is not what renderBase draws`);
    });
    expect(drawn).toBeGreaterThan(BASE_WIDTH * 15);
  });

  it('draws the base in the same colour numbers in every phase and blend (lettering included)', () => {
    for (const [name, phase] of READINGS) {
      eachBasePixel(sceneFrame(input({ phase, turn: 0.9 })), 0.9, (x, y, want, got) => {
        if (got !== want) expect.fail(`${name}: base pixel ${x},${y} differs from the base's own colour`);
      });
    }
  });

  it('shows every base pixel as one hard master colour: no blend of two colours anywhere on the base', () => {
    const master = new Set(masterColours.map(hexNum));
    for (const turn of [0, 0.004, 0.5, 2, 3.3]) {
      eachBasePixel(sceneFrame(input({ turn })), turn, (x, y, _want, got) => {
        if (!master.has(got)) expect.fail(`turn ${turn}: base pixel ${x},${y} is ${got.toString(16)}, not a master colour`);
      });
    }
  });

  it('draws no base body when the page draws it on its fine layer (parts shadows or none): the shadow stays, the drum does not', () => {
    const layout = sceneLayout(W, H, SEED);
    const box = { x: layout.globe.cx - BASE_WIDTH / 2, y: layout.groundTop - BASE_SINK };
    const want = drawnBase(0.6);
    const withBody = new Uint32Array(W * H).fill(0x123456);
    drawGlobe(withBody, W, layout, steady('sunset'), 0.6, T, undefined, 0, 'all');
    for (const parts of ['shadows', 'none'] as const) {
      const without = new Uint32Array(W * H).fill(0x123456);
      drawGlobe(without, W, layout, steady('sunset'), 0.6, T, undefined, 0, parts);
      let same = 0;
      let counted = 0;
      for (let y = 0; y < BASE_ROWS; y++) {
        for (let x = 0; x < BASE_WIDTH; x++) {
          const c = want[y * BASE_WIDTH + x] ?? NO_FRONT;
          if (c === NO_FRONT || inCircle(layout, box.x + x, box.y + y, 1)) continue;
          counted++;
          expect(withBody[(box.y + y) * W + box.x + x], `with the body: base pixel ${x},${y}`).toBe(c);
          if (without[(box.y + y) * W + box.x + x] === c) same++;
        }
      }
      expect(counted).toBeGreaterThan(100);
      expect(same / counted, `${parts}: share of base pixels still drawn`).toBeLessThan(0.05);
      // The shadow is still there under the base's middle.
      const foot = box.y + BASE_ROWS + 2;
      expect(without[foot * W + layout.globe.cx], `${parts}: shadow under the base`).not.toBe(0x123456);
    }
  });
});

describe('sceneFrame: the base\'s cast shadow', () => {
  const TALL: [number, number][] = [[W, 300], [320, 260]];

  it.each(TALL)('keeps the shade inside the base\'s footprint at %s x %s: nothing changes %i rows under the base down or beside the base, some ground under it, and each column\'s shade starts no higher than the drum\'s foot in that column, the shade\'s top being the row under the highest of them', (width, height) => {
    const f = sceneFrame(input({ width, height }));
    const b = baseline({ width, height });
    const box = baseBox(f);
    for (let y = box.y + BASE_ROWS + SHADOW_ROWS; y < height; y++) {
      for (let x = 0; x < width; x++) if (at(f, x, y) !== at(b, x, y)) expect.fail(`pixel ${x},${y} is more than ${SHADOW_ROWS} rows under the base and changed`);
    }
    let beside = 0;
    let under = 0;
    for (let y = f.layout.groundTop; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (inBox(box, x, y) || at(f, x, y) === at(b, x, y)) continue;
        if (x < box.x || x >= box.x + BASE_WIDTH) beside++;
        else under++;
      }
    }
    expect(beside, 'shadow pixels beside the base').toBe(0);
    expect(under, 'shadow pixels under the base').toBeGreaterThan(0);
    const want = drawnBase(0);
    let top = Number.POSITIVE_INFINITY;
    for (let col = 0; col < BASE_WIDTH; col++) {
      let first = Number.POSITIVE_INFINITY;
      for (let y = Math.max(f.layout.groundTop, box.y); y < box.y + BASE_ROWS + SHADOW_ROWS && first === Number.POSITIVE_INFINITY; y++) {
        if ((want[(y - box.y) * BASE_WIDTH + col] ?? NO_FRONT) === NO_FRONT && at(f, box.x + col, y) !== at(b, box.x + col, y)) first = y;
      }
      expect(first, `column ${col}: first shaded row`).toBeGreaterThanOrEqual(box.y + (BASE_FOOT_ROWS[col] ?? 0));
      top = Math.min(top, first);
    }
    expect(top, 'the shade starts under the highest foot of the drum').toBe(box.y + Math.min(...BASE_FOOT_ROWS));
  });

  it.each(TALL)('clamps the shade to the base\'s sides at every turn: no darkened ground pixel lies past them, at %s x %s', (width, height) => {
    for (const turn of [0, 1.3, -2]) {
      for (const [name, phase] of READINGS) {
        const f = sceneFrame(input({ width, height, phase, turn }));
        const b = baseline({ width, height, phase });
        const box = baseBox(f);
        const past = darkened(f, b, box).filter(([x]) => x < box.x || x >= box.x + BASE_WIDTH);
        expect(past, `${name} turn ${turn}: shade past the base's sides`).toEqual([]);
      }
    }
  });
});

describe('sceneFrame: the lettering on the base', () => {
  /** The lettering's rows: between the engraving row under the lip (4) and the grooves' first row (17), only letters are gold. */
  const LETTER_ROWS = { first: 7, last: 14 };

  /** The base's pixels in the box's rows 5 to 16 that are the lettering's golds. */
  function letterPixels(turn: number): { x: number; y: number; c: number }[] {
    const f = sceneFrame(input({ turn }));
    const box = baseBox(f);
    const out: { x: number; y: number; c: number }[] = [];
    for (let y = 5; y <= 16; y++) {
      for (let x = 0; x < BASE_WIDTH; x++) {
        const c = at(f, box.x + x, box.y + y);
        if (c === GOLD || c === GOLD_DARK) out.push({ x, y, c });
      }
    }
    return out;
  }

  it('writes the lettering in solid gold on its own rows: at turn 0 some base pixels are the gold itself, and the gold ink spans rows 7 to 14 of the base box, at most', () => {
    expect(letterPixels(0).filter((p) => p.c === GOLD).length).toBeGreaterThanOrEqual(30);
    for (const turn of [0, 0.013, 1.7, 3.1, 5]) {
      const rows = letterPixels(turn).map((p) => p.y);
      expect(rows.length, `turn ${turn}: lettering pixels`).toBeGreaterThan(0);
      expect(Math.min(...rows), `turn ${turn}`).toBeGreaterThanOrEqual(LETTER_ROWS.first);
      expect(Math.max(...rows), `turn ${turn}`).toBeLessThanOrEqual(LETTER_ROWS.last);
    }
  });

  it('moves the lettering as the turn grows a little: the gold pixels are not the same ones', () => {
    const a = new Set(letterPixels(0).map((p) => `${p.x},${p.y}`));
    const b = new Set(letterPixels(0.05).map((p) => `${p.x},${p.y}`));
    expect([...a].filter((k) => !b.has(k)).length).toBeGreaterThan(0);
    expect([...b].filter((k) => !a.has(k)).length).toBeGreaterThan(0);
  });
});

describe('sceneFrame: turning the globe', () => {
  it('changes the picture with the turn (reflections and lettering move), and half a turn moves the glass reflections somewhere else', () => {
    expect(pic({ turn: 0 })).not.toEqual(pic({ turn: 1 }));
    const a = sceneFrame(input({ turn: 0 }));
    const b = sceneFrame(input({ turn: Math.PI }));
    expect(glassPixels(a, baseBox(a)).filter(([x, y]) => at(a, x, y) !== at(b, x, y)).length).toBeGreaterThan(0);
  });

  it('draws the turn as an angle: undefined equals 0, 2π, -2π and 4π equal 0 exactly, and -0.5 equals 2π - 0.5', () => {
    expectGlobeDrawn({ turn: -0.5 });
    for (const [, phase] of READINGS) expect(pic({ phase })).toEqual(pic({ phase, turn: 0 }));
    const zero = pic({ turn: 0 });
    for (const turn of [2 * Math.PI, -2 * Math.PI, 4 * Math.PI]) expect(pic({ turn }), `turn ${turn}`).toEqual(zero);
    expect(pic({ turn: -0.5 })).toEqual(pic({ turn: 2 * Math.PI - 0.5 }));
  });

  it('gives the same frame for the same inputs, fresh or drawn into a reused target', () => {
    expectGlobeDrawn({ turn: 0.37 });
    const fresh = pic({ turn: 0.37 });
    expect(pic({ turn: 0.37 })).toEqual(fresh);
    const target = new Uint32Array(W * H).fill(0xffffffff);
    sceneFrame(input({ turn: 2, phase: steady('frosty-morning') }), target);
    sceneFrame(input({ turn: 0.37 }), target);
    expect(Array.from(target)).toEqual(fresh);
  });

  it('tints the glass in every phase and moves only the reflections with the turn: most glass pixels differ from the bare sky, some change with the turn, most stay', () => {
    for (const [name, phase] of READINGS) {
      const a = sceneFrame(input({ phase, turn: 0 }));
      const b = sceneFrame(input({ phase, turn: 1.5 }));
      const glass = glassPixels(a, baseBox(a));
      const bare = baseline({ phase, turn: 0 });
      const tinted = glass.filter(([x, y]) => at(a, x, y) !== at(bare, x, y)).length;
      expect(tinted / glass.length, `${name}: tinted share of the glass`).toBeGreaterThanOrEqual(0.5);
      const changed = glass.filter(([x, y]) => at(a, x, y) !== at(b, x, y)).length;
      expect(changed, `${name}: glass pixels the reflections moved`).toBeGreaterThan(0);
      expect(changed / glass.length, `${name}: share of the glass that changed with the turn`).toBeLessThanOrEqual(0.4);
    }
  });

  it('slides the reflections by in-between shades when the turn moves 0.01 rad: no glass pixel flips between bare glass and a solid reflection', () => {
    for (const phase of [steady('purple-night'), steady('frosty-morning')]) {
      const name = phase.from;
      const first = sceneFrame(input({ phase, turn: 0 }));
      const glass = glassPixels(first, baseBox(first));
      // The bare glass at each pixel: its most common colour round a full turn,
      // as a reflection covers any one pixel only for a short stretch of it.
      const round = Array.from({ length: 24 }, (_, i) => sceneFrame(input({ phase, turn: (i * 2 * Math.PI) / 24 })));
      const bare = new Map<number, number>();
      for (const [x, y] of glass) {
        const counts = new Map<number, number>();
        for (const f of round) counts.set(at(f, x, y), (counts.get(at(f, x, y)) ?? 0) + 1);
        bare.set(y * W + x, [...counts].sort((p, q) => q[1] - p[1])[0]?.[0] ?? -1);
      }
      /** The reflections' solid colours in a frame: colours off the bare glass that fill ten or more glass pixels. */
      const solids = (f: SceneFrame): Set<number> => {
        const counts = new Map<number, number>();
        for (const [x, y] of glass) {
          const c = at(f, x, y);
          if (c !== bare.get(y * W + x) && !SPRITE_COLOURS.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
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
          // Sprites and their hard-edged floor shadows are crisp and move whole pixels; only the
          // reflections slide smoothly, and they ride on the upper half of the glass.
          if (SPRITE_COLOURS.has(a) || SPRITE_COLOURS.has(b) || y >= first.layout.globe.cy) continue;
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
    drawGlobe(picture, W, layout, steady('sunset'), 0.6, T);
    const f: SceneFrame = { width: W, height: H, picture, layout };
    const box = baseBox(f);
    let inside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = at(f, x, y);
        if (inCircle(layout, x, y, 1) || inBox(box, x, y)) {
          if (inCircle(layout, x, y, -2) && c !== fill) inside++;
        } else if (c !== fill && (y < layout.groundTop || x < box.x || x >= box.x + BASE_WIDTH || brightness(c) >= brightness(fill))) {
          expect.fail(`pixel ${x},${y} outside the globe and base was drawn on, and is not a shadow on the ground under the base`);
        }
      }
    }
    expect(inside).toBeGreaterThan(0);
    for (const c of picture) expect(c).toBeLessThanOrEqual(0xffffff);
  });
});
