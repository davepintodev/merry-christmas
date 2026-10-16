// XMAS-41b1 "Drag model, scene side": the globe leans into a drag. `lean` is a
// plain input (radians, + leans the top toward +x); the glass and all inside
// it shear sideways, more at the top, about the base top. The base, the
// ground, the sky, the disc and the stars stay put (spec 7.4: the grid never
// moves, only what turns is blended on it).
import { describe, expect, it } from 'vitest';
import { sceneFrame, sceneLayout, GLOBE_RADIUS, type SceneFrame, type SceneInput } from './frame.ts';
import { keepBackdrop, leanBox, leanGlass, rowShift, MAX_LEAN } from './lean.ts';
import { createGlobeSnow, stepGlobeSnow } from './snow.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';

const W = 400;
const H = 260;
const T = 1_000_000;
const SEED = 99;

function steady(phase: PhaseName): PhaseReading {
  return { from: phase, to: phase, share: 0 };
}

function input(over: Partial<SceneInput> = {}): SceneInput {
  return { time: T, drag: 0, phase: steady('purple-night'), seed: SEED, width: W, height: H, backdrop: false, ...over };
}

function at(f: SceneFrame, x: number, y: number): number {
  return f.picture[y * f.width + x] ?? -1;
}

/** Mean column of the globe's pixels (not the row's sky, not a star) over the glass's top rows. */
function topMean(f: SceneFrame): number {
  const { cx, cy } = f.layout.globe;
  const stars = new Set(f.layout.stars.map((s) => `${s.x},${s.y}`));
  let sum = 0;
  let count = 0;
  for (let y = cy - GLOBE_RADIUS; y < cy - GLOBE_RADIUS + 25; y++) {
    const sky = at(f, 0, y);
    for (let x = cx - GLOBE_RADIUS - 90; x <= cx + GLOBE_RADIUS + 90; x++) {
      if (at(f, x, y) === sky || stars.has(`${x},${y}`)) continue;
      sum += x;
      count++;
    }
  }
  return sum / count;
}

function snowy(): ReturnType<typeof createGlobeSnow> {
  const snow = createGlobeSnow(7, false);
  for (let i = 0; i < 30; i++) stepGlobeSnow(snow, { turn: 0, raise: 0.5, push: { x: 40, y: 0, z: 0 } });
  return snow;
}

const LEANS = [0.05, 0.2, 0.5];

describe('lean input', () => {
  it('draws the same picture for a missing, 0 and -0 lean', () => {
    const none = sceneFrame(input()).picture;
    expect(sceneFrame(input({ lean: 0 })).picture).toEqual(none);
    expect(sceneFrame(input({ lean: -0 })).picture).toEqual(none);
  });

  it.each([0.1, -0.1, 0.5, -0.5])('changes the picture for lean %s', (lean) => {
    expect(sceneFrame(input({ lean })).picture).not.toEqual(sceneFrame(input()).picture);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5000001, -0.5000001, 0.6, -3, 7])(
    'throws a RangeError for lean %s',
    (lean) => {
      expect(() => sceneFrame(input({ lean }))).toThrow(RangeError);
    },
  );

  it('takes the limits +-0.5 exactly', () => {
    expect(() => sceneFrame(input({ lean: 0.5 }))).not.toThrow();
    expect(() => sceneFrame(input({ lean: -0.5 }))).not.toThrow();
  });

  it('leaves a handed-in target untouched when the lean is refused', () => {
    const target = new Uint32Array(W * H).fill(0xffffffff);
    expect(() => sceneFrame(input({ lean: 9 }), target)).toThrow(RangeError);
    expect(target.every((c) => c === 0xffffffff)).toBe(true);
  });

  it('is deterministic and ignores what a reused target held before', () => {
    const fresh = sceneFrame(input({ lean: 0.23 })).picture;
    const dirty = new Uint32Array(W * H).fill(0xffffffff);
    sceneFrame(input({ lean: 0.23 }), dirty);
    expect(dirty).toEqual(fresh);
    expect(sceneFrame(input({ lean: 0.23 })).picture).toEqual(fresh);
  });
});

describe('lean direction and size', () => {
  it('moves the top of the glass toward +x for a positive lean and toward -x for a negative one', () => {
    const flat = topMean(sceneFrame(input()));
    expect(topMean(sceneFrame(input({ lean: 0.2 })))).toBeGreaterThan(flat + 5);
    expect(topMean(sceneFrame(input({ lean: -0.2 })))).toBeLessThan(flat - 5);
  });

  it('shears by about lean times the height above the base top: a tenth of a radian moves the top 7 to 13 columns', () => {
    const flat = topMean(sceneFrame(input()));
    const shift = topMean(sceneFrame(input({ lean: 0.1 }))) - flat;
    expect(shift).toBeGreaterThan(7);
    expect(shift).toBeLessThan(13);
  });

  it('is mirror symmetric: +a and -a move the top by equal and opposite amounts', () => {
    const flat = topMean(sceneFrame(input()));
    for (const a of LEANS) {
      const right = topMean(sceneFrame(input({ lean: a }))) - flat;
      const left = flat - topMean(sceneFrame(input({ lean: -a })));
      expect(Math.abs(right - left), `lean ${a}`).toBeLessThan(1.5);
    }
  });

  it('moves the top further the bigger the lean', () => {
    const means = [0, 0.1, 0.25, 0.5].map((lean) => topMean(sceneFrame(input({ lean }))));
    for (let i = 1; i < means.length; i++) expect(means[i] ?? 0).toBeGreaterThan((means[i - 1] ?? 0) + 3);
  });

  it('moves the glass near the base far less than at the top', () => {
    const f0 = sceneFrame(input());
    const f1 = sceneFrame(input({ lean: 0.3 }));
    const { cx, cy } = f0.layout.globe;
    // The rim's left edge in a row near the bottom of the glass, by the first column differing from the sky.
    const edge = (f: SceneFrame, y: number): number => {
      const sky = at(f, 0, y);
      // A star lying in the row is not the rim.
      const stars = new Set(f.layout.stars.map((star) => `${star.x},${star.y}`));
      for (let x = cx - GLOBE_RADIUS - 90; x < cx; x++) if (at(f, x, y) !== sky && !stars.has(`${x},${y}`)) return x;
      return -1;
    };
    const lowRow = cy + GLOBE_RADIUS - 6;
    const topRow = cy - GLOBE_RADIUS + 12;
    const low = Math.abs(edge(f1, lowRow) - edge(f0, lowRow));
    const top = Math.abs(edge(f1, topRow) - edge(f0, topRow));
    expect(top).toBeGreaterThan(low + 10);
  });
});

describe('what a lean must not move', () => {
  const PHASED: [string, PhaseReading][] = [
    ['purple-night', steady('purple-night')],
    ['frosty-morning', steady('frosty-morning')],
    ['sunset -> purple-night at 0.5', { from: 'sunset', to: 'purple-night', share: 0.5 }],
  ];

  it.each(PHASED)('keeps the base, the ground and everything from the ground line down byte for byte for any lean in %s', (_n, phase) => {
    const l = sceneLayout(W, H, SEED);
    const from = l.groundTop * W;
    const flat = sceneFrame(input({ phase, turn: 0.7 })).picture.slice(from);
    for (const lean of [...LEANS, ...LEANS.map((a) => -a)]) {
      expect(sceneFrame(input({ phase, turn: 0.7, lean })).picture.slice(from), `lean ${lean}`).toEqual(flat);
    }
  });

  it('keeps the base rows identical at a second picture size and seed', () => {
    const base = { width: 240, height: 180, seed: 5 };
    const from = sceneLayout(240, 180, 5).groundTop * 240;
    const flat = sceneFrame(input(base)).picture.slice(from);
    expect(sceneFrame(input({ ...base, lean: 0.4 })).picture.slice(from)).toEqual(flat);
  });

  it('keeps the sky, the disc and the stars far from the globe where they were', () => {
    const l = sceneLayout(W, H, SEED);
    const flat = sceneFrame(input({ time: T + 1_500 })).picture;
    const leaned = sceneFrame(input({ time: T + 1_500, lean: 0.5 })).picture;
    for (let y = 0; y < l.groundTop; y++) {
      for (let x = 0; x < W; x++) {
        const far = Math.abs(x + 0.5 - l.globe.cx) > GLOBE_RADIUS + 80 || y < l.globe.cy - GLOBE_RADIUS - 1;
        if (far && flat[y * W + x] !== leaned[y * W + x]) expect.fail(`pixel ${x},${y} moved with the lean`);
      }
    }
  });

  it('keeps the countdown strip exactly as it was', () => {
    const l = sceneLayout(W, H, SEED);
    const n = l.countdown.height * W;
    expect(sceneFrame(input({ lean: -0.5 })).picture.slice(0, n)).toEqual(sceneFrame(input()).picture.slice(0, n));
  });

  it('does not move the layout', () => {
    expect(sceneFrame(input({ lean: 0.3 })).layout).toEqual(sceneFrame(input()).layout);
  });
});

describe('lean with the other inputs', () => {
  it('still turns the whole globe when it leans: a turn changes the picture at the same lean', () => {
    expect(sceneFrame(input({ lean: 0.2, turn: 1 })).picture).not.toEqual(sceneFrame(input({ lean: 0.2, turn: 0 })).picture);
  });

  it('shears the same way at any turn', () => {
    const flat = topMean(sceneFrame(input({ turn: 2 })));
    expect(topMean(sceneFrame(input({ turn: 2, lean: 0.2 })))).toBeGreaterThan(flat + 5);
  });

  it('leans the snow inside the glass with it and keeps rows below the ground line fixed', () => {
    const snow = snowy();
    const l = sceneLayout(W, H, SEED);
    const flat = sceneFrame(input({ snow }));
    const leaned = sceneFrame(input({ snow, lean: 0.3 }));
    expect(leaned.picture).not.toEqual(flat.picture);
    expect(leaned.picture.slice(l.groundTop * W)).toEqual(flat.picture.slice(l.groundTop * W));
    expect(topMean(leaned)).toBeGreaterThan(topMean(flat) + 5);
  });

  it('does not change the snow when drawn: the same snow draws the same leaned frame twice', () => {
    const snow = snowy();
    const a = sceneFrame(input({ snow, lean: -0.3 })).picture;
    expect(sceneFrame(input({ snow, lean: -0.3 })).picture).toEqual(a);
  });

  it('draws lean 0 with snow exactly as no lean with snow', () => {
    const snow = snowy();
    expect(sceneFrame(input({ snow, lean: 0 })).picture).toEqual(sceneFrame(input({ snow })).picture);
  });

  it('draws a leaned frame at the shortest picture without throwing, hint or not', () => {
    const f = sceneFrame(input({ width: 112, height: 160, lean: 0.5 }));
    expect(f.picture.length).toBe(112 * 160);
  });
});

describe('rowShift and leanBox (XMAS-81: the fine layer shifts its rows as the glass does)', () => {
  const layout = sceneLayout(W, H, SEED);

  it('is the lean times the row\'s height above the ground line (its middle), rounded to a whole pixel', () => {
    const bottom = layout.groundTop;
    expect(rowShift(0, bottom, 10)).toBe(0);
    expect(rowShift(0.2, bottom, bottom - 1)).toBe(Math.round(0.2 * 0.5));
    expect(rowShift(0.2, bottom, bottom - 51)).toBe(10);
    expect(rowShift(-0.2, bottom, bottom - 51)).toBe(-10);
    expect(Math.abs(rowShift(0.5, bottom, bottom - 1))).toBeLessThanOrEqual(1);
  });

  it('grows with height and takes the lean\'s sign', () => {
    const bottom = layout.groundTop;
    for (const lean of [0.13, 0.5, -0.31]) {
      let last = 0;
      for (let y = bottom - 1; y >= layout.globe.cy - GLOBE_RADIUS; y--) {
        const shift = rowShift(lean, bottom, y);
        expect(Math.abs(shift)).toBeGreaterThanOrEqual(Math.abs(last));
        if (shift !== 0) expect(Math.sign(shift)).toBe(Math.sign(lean));
        last = shift;
      }
    }
  });

  it('moves every row of the glass exactly as leanGlass does', () => {
    for (const lean of [0.07, 0.26, -0.18, MAX_LEAN, -MAX_LEAN]) {
      const picture = new Uint32Array(W * H);
      keepBackdrop(picture, W, layout);
      const { cx, cy } = layout.globe;
      const box = leanBox(W, layout);
      const rows: number[] = [];
      for (let y = cy - GLOBE_RADIUS + 3; y < cy + GLOBE_RADIUS - 3 && y < box.bottom; y++) {
        picture[y * W + cx] = 0x200000 + y;
        rows.push(y);
      }
      leanGlass(picture, W, layout, lean);
      for (const y of rows) {
        expect(picture[y * W + cx + rowShift(lean, box.bottom, y)], `row ${y} at lean ${lean}`).toBe(0x200000 + y);
      }
    }
  });

  it('boxes every pixel a lean within the limit can reach, inside the picture', () => {
    for (const width of [112, 240, 400]) {
      const l = sceneLayout(width, 200, SEED);
      const box = leanBox(width, l);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width - 1);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBe(l.groundTop);
      for (const lean of [MAX_LEAN, -MAX_LEAN]) {
        for (let y = box.top; y < box.bottom; y++) {
          const shift = rowShift(lean, box.bottom, y);
          // The glass's own edge, moved by the lean, stays inside the box (or the picture's edge when the box is clipped by it).
          const edge = shift > 0 ? Math.ceil(l.globe.cx + l.globe.radius) + shift : Math.floor(l.globe.cx - l.globe.radius) + shift;
          const kept = Math.min(width - 1, Math.max(0, edge));
          expect(kept).toBeGreaterThanOrEqual(box.left);
          expect(kept).toBeLessThanOrEqual(box.right);
        }
      }
    }
  });
});
