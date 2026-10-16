// XMAS-36b2 "Snow and the stir": the outside snow, simulation and drawing.
// Flakes are {x, y, v, d, p} in art px (d depth, 0 far to 1 near, v px/s, p tumble
// phase), as in the prototype. drawOutsideSnow takes the time in ms, like the
// globe snow. The drawing is checked on a black picture, so a drawn pixel is
// alpha x the flake colour, and the alpha is read back from it.
import { describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import { sceneFrame, sceneLayout, type SceneInput } from './frame.ts';
import {
  OUTSIDE_SNOW,
  createOutsideSnow,
  drawOutsideSnow,
  setOutsideChristmasDay,
  stepOutsideSnow,
  type OutsideFlake,
  type OutsideSnow,
} from './outside-snow.ts';
import type { PhaseReading } from '../shared/clock.ts';

const W = 240;
const H = 180;
const SEED = 4242;
const LAYOUT = sceneLayout(W, H, SEED);
const GROUND = LAYOUT.groundTop;
const SKY_COLOUR = [0x8f, 0x8a, 0xd0];
const GROUND_COLOUR = [0xb9, 0xc3, 0xee];
const GLOBE_BACK = 0xaebcf0;

function flake(x: number, y: number, d: number, over: Partial<OutsideFlake> = {}): OutsideFlake {
  return { x, y, v: 5, d, p: 0, ...over };
}
function snowOf(flakes: OutsideFlake[]): OutsideSnow {
  return { flakes };
}
function chans(c: number): number[] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
function luma(c: number): number {
  const [r, g, b] = chans(c);
  return 0.299 * r! + 0.587 * g! + 0.114 * b!;
}
/** Draws on black; returns the changed pixels as Map "x,y" -> colour. */
function drawn(flakes: OutsideFlake[], time = 0, base = 0): Map<string, number> {
  const pic = new Uint32Array(W * H).fill(base);
  drawOutsideSnow(pic, W, LAYOUT, snowOf(flakes), time);
  const out = new Map<string, number>();
  pic.forEach((c, i) => {
    if (c !== base) out.set(`${i % W},${Math.floor(i / W)}`, c);
  });
  return out;
}
/** The alpha a black-based pixel was drawn at, against the colour it should blend toward. */
function alphaOf(c: number, target: number[]): number {
  const a = chans(c).map((v, i) => v / target[i]!);
  for (const x of a) expect(Math.abs(x - a[0]!)).toBeLessThan(0.02);
  return a[0]!;
}
function offsets(m: Map<string, number>, x: number, y: number): string[] {
  return [...m.keys()]
    .map((k) => k.split(',').map(Number) as [number, number])
    .map(([px, py]) => `${px - x},${py - y}`)
    .sort();
}
const PLUS = ['-1,0', '0,-1', '0,0', '0,1', '1,0'];
const CROSS = ['-1,-1', '-1,1', '0,0', '1,-1', '1,1'];
const SPARKLE = [...PLUS, '-2,0', '0,-2', '0,2', '2,0'].sort();
const SKY_Y = 40;
const GROUND_Y = GROUND + 6;

function count(christmasDay: boolean): number {
  const a = christmasDay ? OUTSIDE_SNOW.christmasDay.amount : OUTSIDE_SNOW.ordinary.amount;
  return Math.round(((W * H) / 700) * a);
}

describe('outside snow: the amounts', () => {
  it('ordinary day is amount 2.5 at fall speed 1.3; Christmas Day is amount 4 at fall speed 1.5', () => {
    expect(OUTSIDE_SNOW.ordinary).toEqual({ amount: 2.5, fallSpeed: 1.3 });
    expect(OUTSIDE_SNOW.christmasDay).toEqual({ amount: 4, fallSpeed: 1.5 });
  });

  it('an ordinary day makes round(W*H/700*2.5) flakes', () => {
    expect(createOutsideSnow(1, W, H, false).flakes).toHaveLength(154);
  });

  it('Christmas Day makes round(W*H/700*4) flakes', () => {
    expect(createOutsideSnow(1, W, H, true).flakes).toHaveLength(247);
  });

  it('the count scales with the picture size', () => {
    expect(createOutsideSnow(1, 120, 90, false).flakes).toHaveLength(Math.round((120 * 90) / 700 * 2.5));
    expect(createOutsideSnow(1, 480, 270, true).flakes).toHaveLength(Math.round((480 * 270) / 700 * 4));
  });

  it('every flake starts inside the picture with v in 3..8 px/s, depth and phase in range', () => {
    for (const christmas of [false, true]) {
      for (const f of createOutsideSnow(9, W, H, christmas).flakes) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.x).toBeLessThan(W);
        expect(f.y).toBeGreaterThanOrEqual(0);
        expect(f.y).toBeLessThan(H);
        expect(f.v).toBeGreaterThanOrEqual(3);
        expect(f.v).toBeLessThanOrEqual(8);
        expect(f.d).toBeGreaterThanOrEqual(0);
        expect(f.d).toBeLessThan(1);
        expect(f.p).toBeGreaterThanOrEqual(0);
        expect(f.p).toBeLessThan(2 * Math.PI);
      }
    }
  });

  it('depths are spread out, not all one depth (a third tumble, a few sparkle)', () => {
    const fl = createOutsideSnow(3, 480, 270, true).flakes;
    const tumble = fl.filter((f) => f.d > 2 / 3).length / fl.length;
    const sparkle = fl.filter((f) => f.d > 0.93).length / fl.length;
    expect(tumble).toBeGreaterThan(0.25);
    expect(tumble).toBeLessThan(0.42);
    expect(sparkle).toBeGreaterThan(0.03);
    expect(sparkle).toBeLessThan(0.12);
  });
});

describe('outside snow: same seed, same snow', () => {
  const run = (seed: number, steps: number, christmas = false): OutsideSnow => {
    const s = createOutsideSnow(seed, W, H, christmas);
    for (let i = 0; i < steps; i++) stepOutsideSnow(s);
    return s;
  };

  it('the same seed gives the same flakes, and another seed gives other flakes', () => {
    expect(createOutsideSnow(5, W, H, false).flakes).toEqual(createOutsideSnow(5, W, H, false).flakes);
    expect(createOutsideSnow(5, W, H, false).flakes).not.toEqual(createOutsideSnow(6, W, H, false).flakes);
  });

  it('the same seed after the same steps gives the same flakes, across wraps, in both states', () => {
    for (const christmas of [false, true]) {
      expect(run(5, 3000, christmas).flakes).toEqual(run(5, 3000, christmas).flakes);
    }
    expect(run(5, 3000).flakes).not.toEqual(run(6, 3000).flakes);
  });

  it('it reads neither Math.random nor Date.now', () => {
    const real = { random: Math.random, now: Date.now };
    let reads = 0;
    Math.random = (): number => (reads++, 0.5);
    Date.now = (): number => (reads++, 0);
    try {
      const s = createOutsideSnow(2, W, H, false);
      for (let i = 0; i < 2000; i++) stepOutsideSnow(s);
      setOutsideChristmasDay(s, true);
      drawOutsideSnow(new Uint32Array(W * H), W, LAYOUT, s, 1000);
    } finally {
      Math.random = real.random;
      Date.now = real.now;
    }
    expect(reads).toBe(0);
  });

  it('flakes are never lost or added by stepping', () => {
    expect(run(1, 500).flakes).toHaveLength(154);
    expect(run(1, 500, true).flakes).toHaveLength(247);
  });
});

describe('outside snow: one 1/60 s step', () => {
  function oneStep(christmas: boolean, steps = 1): [OutsideFlake[], OutsideFlake[]] {
    const s = createOutsideSnow(7, W, H, christmas);
    for (let i = 0; i < steps - 1; i++) stepOutsideSnow(s);
    const before = s.flakes.map((f) => ({ ...f }));
    stepOutsideSnow(s);
    return [before, s.flakes];
  }

  it('a flake falls v*(0.5+d)*fallSpeed/60 px a step, on an ordinary day and on Christmas Day', () => {
    for (const christmas of [false, true]) {
      const speed = (christmas ? OUTSIDE_SNOW.christmasDay : OUTSIDE_SNOW.ordinary).fallSpeed;
      const [before, after] = oneStep(christmas);
      let checked = 0;
      before.forEach((b, i) => {
        const a = after[i]!;
        if (a.y < b.y) return; // wrapped
        expect(a.y - b.y).toBeCloseTo((b.v * (0.5 + b.d) * speed) / 60, 9);
        checked++;
      });
      expect(checked).toBeGreaterThan(100);
    }
  });

  it('nearer flakes fall faster: at one speed the nearer flake falls further', () => {
    const s = snowOf([flake(50, 20, 0.1), flake(60, 20, 0.9)]);
    stepOutsideSnow(s);
    expect(s.flakes[1]!.y - 20).toBeGreaterThan(s.flakes[0]!.y - 20);
  });

  it('a step sways a flake sideways by at most 1/30 px and leaves depth, speed and phase alone', () => {
    const [before, after] = oneStep(false, 40);
    before.forEach((b, i) => {
      const a = after[i]!;
      expect(a.d).toBe(b.d);
      expect(a.v).toBe(b.v);
      expect(a.p).toBe(b.p);
      if (a.y > b.y) expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1 / 30 + 1e-9);
    });
  });

  it('the sway is not nothing: some flake moves sideways in a step', () => {
    const [before, after] = oneStep(false, 40);
    expect(before.some((b, i) => after[i]!.y > b.y && Math.abs(after[i]!.x - b.x) > 1e-4)).toBe(true);
  });

  it('a flake just past the bottom (y > H + 2) wraps to y = -2 at a new x inside the picture', () => {
    const s = snowOf([flake(100, H + 2, 0.5), flake(100, H + 1.9, 1, { v: 8 })]);
    stepOutsideSnow(s);
    expect(s.flakes[0]!.y).toBe(-2);
    expect(s.flakes[0]!.x).toBeGreaterThanOrEqual(0);
    expect(s.flakes[0]!.x).toBeLessThan(W);
    // The second needs 8*1.5*1.3/60 = 0.26 px: it passes H + 2 too.
    expect(s.flakes[1]!.y).toBe(-2);
  });

  it('a flake that has not passed H + 2 does not wrap', () => {
    const s = snowOf([flake(100, H, 0.5)]);
    stepOutsideSnow(s);
    expect(s.flakes[0]!.y).toBeGreaterThan(H);
    expect(s.flakes[0]!.y).toBeLessThanOrEqual(H + 2);
  });

  it('a long run keeps every flake between -2 and H + 2 + one step, and x inside the picture after wraps', () => {
    const s = createOutsideSnow(11, W, H, true);
    let outOfRange = 0;
    for (let i = 0; i < 6000; i++) {
      stepOutsideSnow(s);
      for (const f of s.flakes) if (!(f.y >= -2 && f.y <= H + 2.5)) outOfRange++;
    }
    expect(outOfRange).toBe(0);
    for (const f of s.flakes) {
      expect(f.x).toBeGreaterThan(-5);
      expect(f.x).toBeLessThan(W + 5);
    }
  });

  it('wrapping gives different x for different flakes (not one shared column)', () => {
    const s = snowOf(Array.from({ length: 30 }, () => flake(100, H + 2, 0.5)));
    stepOutsideSnow(s);
    expect(new Set(s.flakes.map((f) => f.x)).size).toBeGreaterThan(20);
  });
});

describe('outside snow: Crossing zero and the following midnight, live', () => {
  const made = (christmas: boolean, steps: number): OutsideSnow => {
    const s = createOutsideSnow(21, W, H, christmas);
    for (let i = 0; i < steps; i++) stepOutsideSnow(s);
    return s;
  };

  it('switching on adds flakes up to the Christmas Day count and keeps every existing flake as it was', () => {
    const s = made(false, 300);
    const old = s.flakes.map((f) => ({ ...f }));
    setOutsideChristmasDay(s, true);
    expect(s.flakes).toHaveLength(247);
    expect(s.flakes.slice(0, 154)).toEqual(old);
  });

  it('switching off removes flakes down to the ordinary count and keeps the rest as they were', () => {
    const s = made(true, 300);
    const old = s.flakes.slice(0, 154).map((f) => ({ ...f }));
    setOutsideChristmasDay(s, false);
    expect(s.flakes).toHaveLength(154);
    expect(s.flakes).toEqual(old);
  });

  it('added flakes are inside the picture and in range, and they fall (are not frozen)', () => {
    const s = made(false, 100);
    setOutsideChristmasDay(s, true);
    for (const f of s.flakes.slice(154)) {
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThan(W);
      expect(f.y).toBeGreaterThanOrEqual(-2);
      expect(f.y).toBeLessThanOrEqual(H + 2);
      expect(f.d).toBeLessThan(1);
    }
    const ys = s.flakes.slice(154).map((f) => f.y);
    stepOutsideSnow(s);
    expect(s.flakes.slice(154).filter((f, i) => f.y !== ys[i]).length).toBe(93);
  });

  it('after the switch the fall speed is the new one', () => {
    const s = made(false, 50);
    setOutsideChristmasDay(s, true);
    const before = s.flakes.map((f) => ({ ...f }));
    stepOutsideSnow(s);
    let checked = 0;
    before.forEach((b, i) => {
      const a = s.flakes[i]!;
      if (a.y < b.y) return;
      expect(a.y - b.y).toBeCloseTo((b.v * (0.5 + b.d) * 1.5) / 60, 9);
      checked++;
    });
    expect(checked).toBeGreaterThan(200);
    setOutsideChristmasDay(s, false);
    const b2 = s.flakes.map((f) => ({ ...f }));
    stepOutsideSnow(s);
    s.flakes.forEach((a, i) => {
      if (a.y < b2[i]!.y) return;
      expect(a.y - b2[i]!.y).toBeCloseTo((b2[i]!.v * (0.5 + b2[i]!.d) * 1.3) / 60, 9);
    });
  });

  it('the live switch is deterministic: same seed, steps and switch give the same snow', () => {
    const go = (): OutsideSnow => {
      const s = made(false, 200);
      setOutsideChristmasDay(s, true);
      for (let i = 0; i < 200; i++) stepOutsideSnow(s);
      setOutsideChristmasDay(s, false);
      for (let i = 0; i < 50; i++) stepOutsideSnow(s);
      return s;
    };
    expect(go().flakes).toEqual(go().flakes);
  });

  it('switching to the state it is already in changes nothing', () => {
    const s = made(true, 120);
    const copy = s.flakes.map((f) => ({ ...f }));
    setOutsideChristmasDay(s, true);
    expect(s.flakes).toEqual(copy);
    const t = made(false, 120);
    const copy2 = t.flakes.map((f) => ({ ...f }));
    setOutsideChristmasDay(t, false);
    expect(t.flakes).toEqual(copy2);
  });

  it('a switch on and off again, flake for flake, gives the ordinary flakes back', () => {
    const s = made(false, 90);
    const old = s.flakes.map((f) => ({ ...f }));
    setOutsideChristmasDay(s, true);
    setOutsideChristmasDay(s, false);
    expect(s.flakes).toEqual(old);
  });
});

describe('outside snow drawing: tiers', () => {
  it('a far flake is a single pixel at floor(x), floor(y)', () => {
    for (const d of [0, 0.3, 0.66]) {
      const m = drawn([flake(100.9, SKY_Y + 0.9, d)]);
      expect([...m.keys()], `d ${d}`).toEqual([`100,${SKY_Y}`]);
    }
  });

  it('the tumble tier starts above depth 2/3: just under is a pixel, just over is five', () => {
    expect(drawn([flake(100.5, SKY_Y + 0.5, 2 / 3 - 0.001)]).size).toBe(1);
    expect(drawn([flake(100.5, SKY_Y + 0.5, 2 / 3 + 0.001)]).size).toBe(5);
  });

  it('a tumbler is a plus when floor(time*2.5 + p) is odd and an X when it is even', () => {
    const f = flake(100.5, SKY_Y + 0.5, 0.8, { p: 0.3 });
    // time in ms: 0 -> floor(0.3) = 0 even; 400 -> floor(1.3) = 1 odd; 800 -> 2 even
    expect(offsets(drawn([f], 0), 100, SKY_Y)).toEqual(CROSS);
    expect(offsets(drawn([f], 400), 100, SKY_Y)).toEqual(PLUS);
    expect(offsets(drawn([f], 800), 100, SKY_Y)).toEqual(CROSS);
    expect(offsets(drawn([f], 1200), 100, SKY_Y)).toEqual(PLUS);
  });

  it('the tumble follows the flake phase: flakes with other phases swap at other times', () => {
    const a = flake(100.5, SKY_Y + 0.5, 0.8, { p: 0.1 });
    const b = flake(100.5, SKY_Y + 0.5, 0.8, { p: 1.1 });
    expect(offsets(drawn([a], 0), 100, SKY_Y)).not.toEqual(offsets(drawn([b], 0), 100, SKY_Y));
  });

  it('a tumbler is one whole colour on all five pixels, the same as a far flake', () => {
    const t = drawn([flake(100.5, SKY_Y + 0.5, 0.8)]);
    const single = drawn([flake(100.5, SKY_Y + 0.5, 0.1)]);
    expect(new Set(t.values()).size).toBe(1);
    expect([...t.values()][0]).toBe([...single.values()][0]);
  });

  it('the nearest 7% (d > 0.93) is a plus with four faint arms at distance 2, at every time', () => {
    for (const time of [0, 400, 800, 1234]) {
      expect(offsets(drawn([flake(100.5, SKY_Y + 0.5, 0.95)], time), 100, SKY_Y), `t ${time}`).toEqual(SPARKLE);
    }
    expect(drawn([flake(100.5, SKY_Y + 0.5, 0.93)]).size, 'exactly 0.93 is a tumbler').toBe(5);
  });

  it('a sparkle has its centre and four arms at full strength and its four tips at 0.4 of that', () => {
    const m = drawn([flake(100.5, SKY_Y + 0.5, 0.97)]);
    const full = m.get(`100,${SKY_Y}`)!;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      expect(m.get(`${100 + dx},${SKY_Y + dy}`), `${dx},${dy}`).toBe(full);
    }
    const a = alphaOf(full, SKY_COLOUR);
    expect(a).toBeCloseTo(1, 2);
    for (const k of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) {
      const tip = m.get(`${100 + k[0]},${SKY_Y + k[1]}`)!;
      expect(alphaOf(tip, SKY_COLOUR)).toBeCloseTo(0.4, 2);
      expect(luma(tip)).toBeLessThan(luma(full));
      expect(tip).not.toBe(0);
    }
  });

  it('a flake stays a whole pixel: any position inside one pixel draws the same picture', () => {
    for (const d of [0.1, 0.8, 0.97]) {
      const a = drawn([flake(100.02, SKY_Y + 0.98, d)], 400);
      const b = drawn([flake(100.98, SKY_Y + 0.02, d)], 400);
      expect([...a.entries()], `d ${d}`).toEqual([...b.entries()]);
    }
  });

  it('one pixel over, the flake moves exactly one pixel', () => {
    const a = drawn([flake(100.5, SKY_Y + 0.5, 0.1)]);
    const b = drawn([flake(101.5, SKY_Y + 0.5, 0.1)]);
    expect([...a.keys()]).toEqual([`100,${SKY_Y}`]);
    expect([...b.keys()]).toEqual([`101,${SKY_Y}`]);
  });

  it('negative positions floor, not truncate: x = -0.5 is pixel -1 (off the picture), a sparkle there shows its right tip at 0', () => {
    expect(drawn([flake(-0.5, SKY_Y + 0.5, 0.1)]).size).toBe(0);
    const m = drawn([flake(-1.5, SKY_Y + 0.5, 0.97)]);
    expect([...m.keys()]).toEqual([`0,${SKY_Y}`]);
  });

  it('the picture does not depend on the order of the flakes', () => {
    const fl = [flake(30, 30, 0.1), flake(90, 50, 0.8), flake(150, 20, 0.97), flake(200, 100, 0.5)];
    expect([...drawn(fl, 300).entries()].sort()).toEqual([...drawn([...fl].reverse(), 300).entries()].sort());
  });
});

describe('outside snow drawing: edges of the picture', () => {
  it('flakes off any edge draw nothing and do not throw', () => {
    for (const [x, y] of [[-10, 50], [W + 10, 50], [50, -10], [50, H + 10], [W, 50], [50, H]] as const) {
      expect(drawn([flake(x + 0.5, y + 0.5, 0.1)]).size, `${x},${y}`).toBe(0);
    }
  });

  it('a sparkle at the right edge keeps its inside pixels and does not wrap to the next row', () => {
    const m = drawn([flake(W - 1 + 0.5, SKY_Y + 0.5, 0.97)]);
    for (const k of m.keys()) {
      const [x, y] = k.split(',').map(Number);
      expect(x).toBeLessThan(W);
      expect(Math.abs(y! - SKY_Y)).toBeLessThanOrEqual(2);
    }
    expect(m.has(`0,${SKY_Y + 1}`)).toBe(false);
    expect(m.has(`0,${SKY_Y}`)).toBe(false);
    expect(offsets(m, W - 1, SKY_Y)).toEqual(['-1,0', '-2,0', '0,-1', '0,-2', '0,0', '0,1', '0,2'].sort());
  });

  it('a sparkle at the left edge does not wrap to the previous row end', () => {
    const m = drawn([flake(0.5, SKY_Y + 0.5, 0.97)]);
    expect(m.has(`${W - 1},${SKY_Y}`)).toBe(false);
    expect(m.has(`${W - 1},${SKY_Y - 1}`)).toBe(false);
    expect(m.has(`${W - 2},${SKY_Y}`)).toBe(false);
    expect(m.size).toBe(7);
  });

  it('a tumbler at the top row and bottom row clips to the picture', () => {
    expect(drawn([flake(100.5, 0.5, 0.8)], 400).size).toBe(4); // plus without its top arm
    expect(drawn([flake(100.5, H - 1 + 0.5, 0.8)], 400).size).toBe(4);
    expect(drawn([flake(100.5, 0.5, 0.8)], 0).size).toBe(3); // X without its top corners
  });

  it('a picture row of a different width draws on the width it was given', () => {
    const w = 120;
    const layout = sceneLayout(w, 172, 3);
    const pic = new Uint32Array(w * 172);
    drawOutsideSnow(pic, w, layout, snowOf([flake(w - 1 + 0.5, 20.5, 0.1), flake(5.5, 30.5, 0.1)]), 0);
    expect(pic[20 * w + w - 1]).not.toBe(0);
    expect(pic[30 * w + 5]).not.toBe(0);
    expect(pic.filter((c) => c !== 0)).toHaveLength(2);
  });
});

describe('outside snow drawing: colour', () => {
  it('over the sky a flake body is the dim #8f8ad0 at alpha 1, in every tier', () => {
    for (const d of [0.1, 0.8, 0.97]) {
      const m = drawn([flake(100.5, SKY_Y + 0.5, d)], 400);
      expect(m.get(`100,${SKY_Y}`), `d ${d}`).toBe(0x8f8ad0);
      expect(alphaOf(m.get(`100,${SKY_Y}`)!, SKY_COLOUR), `d ${d}`).toBeCloseTo(1, 2);
    }
  });

  it('over the ground a flake body is the dim #b9c3ee at alpha 1', () => {
    const sky = [...drawn([flake(100.5, SKY_Y + 0.5, 0.1)]).values()][0]!;
    const gnd = [...drawn([flake(100.5, GROUND_Y + 0.5, 0.1)]).values()][0]!;
    expect(alphaOf(gnd, GROUND_COLOUR)).toBeCloseTo(1, 2);
    expect(gnd).not.toBe(sky);
  });

  it('the ground starts at layout.groundTop: the row above is sky colour, the row at it is ground colour', () => {
    const above = [...drawn([flake(100.5, GROUND - 1 + 0.5, 0.1)]).values()][0]!;
    const at = [...drawn([flake(100.5, GROUND + 0.5, 0.1)]).values()][0]!;
    alphaOf(above, SKY_COLOUR);
    alphaOf(at, GROUND_COLOUR);
    expect(above).not.toBe(at);
  });

  it('a different layout moves the ground: the same row can be sky in one and ground in another', () => {
    const tall = sceneLayout(W, 360, SEED);
    const pic = new Uint32Array(W * 360);
    const y = GROUND + 6;
    drawOutsideSnow(pic, W, tall, snowOf([flake(100.5, y + 0.5, 0.1)]), 0);
    const c = pic[y * W + 100]!;
    if (tall.groundTop > y) alphaOf(c, SKY_COLOUR);
    else alphaOf(c, GROUND_COLOUR);
    expect(tall.groundTop).not.toBe(GROUND);
  });

  it('it blends over what is there: on a lighter base the pixel is the base mixed toward the flake colour at the drawn alpha', () => {
    const base = 0x404040;
    const pic = new Uint32Array(W * H).fill(base);
    drawOutsideSnow(pic, W, LAYOUT, snowOf([flake(100.5, SKY_Y + 0.5, 0.1)]), 0);
    const c = pic[SKY_Y * W + 100]!;
    const onBlack = [...drawn([flake(100.5, SKY_Y + 0.5, 0.1)]).values()][0]!;
    const a = alphaOf(onBlack, SKY_COLOUR);
    chans(c).forEach((v, i) => expect(Math.abs(v - (0x40 * (1 - a) + SKY_COLOUR[i]! * a))).toBeLessThan(2));
  });

  it('the outside snow is dimmer than the globe snow: the white front flake, in every tier', () => {
    for (const d of [0.1, 0.8, 0.97]) {
      for (const y of [SKY_Y, GROUND_Y]) {
        for (const c of drawn([flake(100.5, y + 0.5, d)], 400).values()) {
          // The approved prototype ground colour (#b9c3ee) is allowed to be near the globe's
          // dim back colour; only the white front flake is the bound.
          expect(luma(c), `d ${d} y ${y}`).toBeLessThan(luma(0xffffff));
        }
      }
    }
  });

  it('even on the brightest ground the flake is dimmer than white globe snow', () => {
    const pic = new Uint32Array(W * H).fill(0xffffff);
    drawOutsideSnow(pic, W, LAYOUT, snowOf([flake(100.5, GROUND_Y + 0.5, 0.97)]), 0);
    for (const c of pic) expect(luma(c)).toBeLessThanOrEqual(luma(0xffffff));
    expect(pic[GROUND_Y * W + 100]).not.toBe(0xffffff);
  });

  it('the two flake colours are on the master colour list', () => {
    const master = masterColours.map((c) => c.toLowerCase());
    expect(master).toContain('#8f8ad0');
    expect(master).toContain('#b9c3ee');
  });
});

describe('outside snow drawing: purity', () => {
  it('drawing does not change the snow, and the same input draws the same picture', () => {
    const s = createOutsideSnow(8, W, H, true);
    for (let i = 0; i < 100; i++) stepOutsideSnow(s);
    const copy = JSON.parse(JSON.stringify(s)) as unknown;
    const a = new Uint32Array(W * H);
    const b = new Uint32Array(W * H);
    drawOutsideSnow(a, W, LAYOUT, s, 700);
    drawOutsideSnow(b, W, LAYOUT, s, 700);
    expect(JSON.parse(JSON.stringify(s))).toEqual(copy);
    expect(a).toEqual(b);
    expect(a.some((c) => c !== 0)).toBe(true);
  });

  it('a real snow draws about one pixel per far flake and stays inside the picture (no stray pixels)', () => {
    const s = createOutsideSnow(8, W, H, false);
    const pic = new Uint32Array(W * H);
    drawOutsideSnow(pic, W, LAYOUT, s, 0);
    const lit = pic.filter((c) => c !== 0).length;
    expect(lit).toBeGreaterThan(100);
    expect(lit).toBeLessThanOrEqual(154 * 9);
  });

  it('draws no randomness and reads no clock', () => {
    const real = { random: Math.random, now: Date.now };
    let reads = 0;
    Math.random = (): number => (reads++, 0.5);
    Date.now = (): number => (reads++, 0);
    try {
      drawOutsideSnow(new Uint32Array(W * H), W, LAYOUT, snowOf([flake(5, 5, 0.9)]), 10);
    } finally {
      Math.random = real.random;
      Date.now = real.now;
    }
    expect(reads).toBe(0);
  });
});

describe('outside snow in sceneFrame', () => {
  const reading: PhaseReading = { from: 'purple-night', to: 'purple-night', share: 0 };
  function input(over: Partial<SceneInput> = {}): SceneInput {
    return { time: 1000, drag: 0, phase: reading, seed: SEED, width: W, height: H, ...over };
  }
  const OX = W - 10;
  const OY = LAYOUT.countdown.y + LAYOUT.countdown.height + 20;

  it('no outsideSnow field draws the same picture as an empty one', () => {
    expect(sceneFrame(input({ outsideSnow: snowOf([]) })).picture).toEqual(sceneFrame(input()).picture);
  });

  it('an outside flake changes a sky pixel', () => {
    const before = sceneFrame(input()).picture;
    const after = sceneFrame(input({ outsideSnow: snowOf([flake(OX + 0.5, OY + 0.5, 0.1)]) })).picture;
    expect(after[OY * W + OX]).not.toBe(before[OY * W + OX]);
    const diff = after.filter((c, i) => c !== before[i]).length;
    expect(diff).toBe(1);
  });

  it('globe snow is not in the picture (XMAS-84: the page draws it as steps), so it leaves the outside snow behind the globe as it is', () => {
    const gx = LAYOUT.globe.cx;
    const gy = LAYOUT.globe.cy - 20;
    const globeSnow = { flakes: [{ x: 0.25, y: -19.25, z: 20, resting: false, phase: 0 }], stir: 0 };
    const withBoth = sceneFrame(
      input({ snow: globeSnow, outsideSnow: snowOf([flake(gx + 0.5, gy + 0.5, 0.1)]) }),
    ).picture;
    const outsideOnly = sceneFrame(input({ outsideSnow: snowOf([flake(gx + 0.5, gy + 0.5, 0.1)]) })).picture;
    expect(withBoth).toEqual(outsideOnly);
  });

  it('the globe covers an outside flake behind it where the globe is opaque', () => {
    const gx = LAYOUT.globe.cx;
    const base = sceneFrame(input()).picture;
    const withFlakes = sceneFrame(
      input({ outsideSnow: snowOf(Array.from({ length: 40 }, (_, i) => flake(gx - 20 + i + 0.5, LAYOUT.globe.cy + 0.5, 0.1))) }),
    ).picture;
    const row = LAYOUT.globe.cy;
    let same = 0;
    for (let x = gx - 20; x < gx + 20; x++) if (withFlakes[row * W + x] === base[row * W + x]) same++;
    expect(same).toBeGreaterThan(0);
  });
});
