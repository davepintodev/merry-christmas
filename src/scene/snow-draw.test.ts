// XMAS-36b1 "Snow and the stir": drawing the globe snow. sceneFrame draws the
// flakes of input.snow inside the glass: single art pixels, dim behind the
// objects and white in front, the nearest tumbling between a plus and an X.
// The tests render a frame with and without snow and compare pixels, so they
// go through sceneFrame only. Flake coordinates are art px from the globe
// centre (y down, z toward the viewer); a flake's pixel is floor(centre + x).
import { describe, expect, it } from 'vitest';
import { masterColours } from '../../art/colours.ts';
import type { PhaseName, PhaseReading } from '../shared/clock.ts';
import { GLOBE_RADIUS, sceneFrame, sceneLayout, type SceneInput } from './frame.ts';
import { createGlobeSnow, stepGlobeSnow, type Flake, type GlobeSnow } from './snow.ts';

const W = 240;
const H = 180;
const SEED = 777;
const T = 5_000;
const WHITE = 0xffffff;
const LAYOUT = sceneLayout(W, H, SEED);
const CX = LAYOUT.globe.cx;
const CY = LAYOUT.globe.cy;
const PHASES: PhaseName[] = ['dawn', 'frosty-morning', 'sunset', 'purple-night'];
const READINGS: [string, PhaseReading][] = [
  ...PHASES.map((p): [string, PhaseReading] => [p, { from: p, to: p, share: 0 }]),
  ['purple-night -> dawn at 0.5', { from: 'purple-night', to: 'dawn', share: 0.5 }],
];

function reading(p: PhaseName = 'purple-night'): PhaseReading {
  return { from: p, to: p, share: 0 };
}
function input(over: Partial<SceneInput> = {}): SceneInput {
  return { time: T, drag: 0, phase: reading(), seed: SEED, width: W, height: H, ...over };
}
function flake(x: number, y: number, z: number, over: Partial<Flake> = {}): Flake {
  return { x, y, z, resting: false, phase: 0, ...over };
}
function snowOf(flakes: Flake[], stir = 0): GlobeSnow {
  return { flakes, stir };
}
function picture(over: Partial<SceneInput> = {}): Uint32Array {
  return sceneFrame(input(over)).picture;
}
/** Pixels that differ between the frame without snow and the frame with it, as [x, y, colour]. */
function changed(flakes: Flake[], over: Partial<SceneInput> = {}, stir = 0): [number, number, number][] {
  const before = picture(over);
  const after = picture({ ...over, snow: snowOf(flakes, stir) });
  const out: [number, number, number][] = [];
  after.forEach((c, i) => {
    if (c !== before[i]) out.push([i % W, Math.floor(i / W), c]);
  });
  return out;
}
function luma(c: number): number {
  return 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
}
function inGlass(x: number, y: number): boolean {
  return Math.hypot(x + 0.5 - CX, y + 0.5 - CY) <= GLOBE_RADIUS - 0.5;
}

// A mid-pixel-safe spot in the upper glass: floor and round agree on it.
const FX = 10.25;
const FY = -20.75;
const PX = CX + 10;
const PY = CY - 21;

describe('globe snow drawing: absent and empty', () => {
  it('no snow field draws the same picture as an empty snow', () => {
    expect(picture({ snow: snowOf([]) })).toEqual(picture());
  });

  it('an empty globe at any stir draws nothing (stir alone changes no pixel)', () => {
    expect(picture({ snow: snowOf([], 1.6) })).toEqual(picture());
  });

  it('the snow is not changed by drawing it', () => {
    const snow = snowOf([flake(FX, FY, 40), flake(3.2, 4.1, -30, { resting: true })], 0.7);
    const copy = JSON.parse(JSON.stringify(snow)) as unknown;
    sceneFrame(input({ snow }));
    expect(JSON.parse(JSON.stringify(snow))).toEqual(copy);
  });

  it('draws into a caller target and gives the same picture as a fresh one', () => {
    const snow = snowOf([flake(FX, FY, 40)]);
    const target = new Uint32Array(W * H).fill(0x123456);
    sceneFrame(input({ snow }), target, LAYOUT);
    expect(target).toEqual(picture({ snow }));
  });
});

describe('globe snow drawing: one flake is one art pixel', () => {
  it('a flake in front is a single white pixel at floor(centre + x, centre + y)', () => {
    const px = changed([flake(FX, FY, 20)]);
    expect(px).toEqual([[PX, PY, WHITE]]);
  });

  it('a flake behind is a single pixel, not white, and not the glass colour', () => {
    const px = changed([flake(FX, FY, -40)]);
    expect(px).toHaveLength(1);
    const [x, y, colour] = px[0]!;
    expect([x, y]).toEqual([PX, PY]);
    expect(colour).not.toBe(WHITE);
    expect(luma(colour)).toBeLessThan(luma(WHITE));
  });

  it('a flake behind is dimmer than a flake in front, in every phase and blend', () => {
    for (const [name, phase] of READINGS) {
      const front = changed([flake(FX, FY, 40)], { phase });
      const back = changed([flake(FX, FY, -40)], { phase });
      expect(front, name).toEqual([[PX, PY, WHITE]]);
      expect(back, name).toHaveLength(1);
      expect(luma(back[0]![2]), name).toBeLessThan(luma(front[0]![2]));
    }
  });

  it('a lying flake is a single art pixel, even in the nearest depth', () => {
    for (const z of [-50, 0, 30, 52]) {
      const px = changed([flake(FX, 23.75, z, { resting: true })]);
      expect(px, `z ${z}`).toHaveLength(1);
      expect(px[0]![1]).toBe(CY + 23);
    }
  });

  it('a flake stays a whole pixel: any position inside one pixel gives the same picture', () => {
    for (const z of [-40, 20]) {
      const a = picture({ snow: snowOf([flake(10.02, -20.98, z)]) });
      const b = picture({ snow: snowOf([flake(10.98, -20.02, z)]) });
      expect(a, `z ${z}`).toEqual(b);
    }
  });

  it('one pixel over, the flake moves exactly one pixel with no blending of its neighbour', () => {
    const a = changed([flake(10.5, -20.5, 20)]);
    const b = changed([flake(11.5, -20.5, 20)]);
    expect(a).toEqual([[CX + 10, CY - 21, WHITE]]);
    expect(b).toEqual([[CX + 11, CY - 21, WHITE]]);
  });

  it('every pixel a flake changes is one whole colour number (no half-lit mix of two flakes)', () => {
    const px = changed([flake(FX, FY, -40), flake(FX + 6, FY, -40), flake(FX, FY + 6, 20)]);
    expect(px).toHaveLength(3);
    for (const [, , c] of px) expect(Number.isInteger(c) && c >= 0 && c <= 0xffffff).toBe(true);
  });
});

describe('globe snow drawing: the nearest flakes tumble', () => {
  const TUMBLER = flake(5.25, -8.75, 52);
  const PLUS = ['-1,0', '0,-1', '0,0', '0,1', '1,0'];
  const CROSS = ['-1,-1', '-1,1', '0,0', '1,-1', '1,1'];

  function shape(time: number, f: Flake = TUMBLER): string[] {
    const px = changed([f], { time });
    const ox = CX + Math.floor(f.x);
    const oy = CY + Math.floor(f.y);
    for (const [, , c] of px) expect(c).toBe(WHITE);
    return px.map(([x, y]) => `${x - ox},${y - oy}`).sort();
  }

  it('every frame shows exactly a plus or an X of white pixels on the flake', () => {
    for (let t = 0; t < 1000; t += 37) {
      const s = shape(T + t);
      expect([PLUS, CROSS].some((want) => JSON.stringify(want) === JSON.stringify(s)), `t ${t}: ${s.join(' ')}`).toBe(true);
    }
  });

  it('it tumbles about two and a half times a second: both shapes appear and it changes shape 4 to 12 times in 2 s', () => {
    let last = '';
    let flips = 0;
    const seen = new Set<string>();
    for (let t = 0; t < 2000; t += 25) {
      const s = shape(T + t).join(' ');
      seen.add(s);
      if (last !== '' && s !== last) flips++;
      last = s;
    }
    expect(seen.size).toBe(2);
    expect(flips).toBeGreaterThanOrEqual(4);
    expect(flips).toBeLessThanOrEqual(12);
  });

  it('the tumble is a pure function of the time: same time, same shape, a second apart too if whole cycles', () => {
    for (const t of [0, 90, 210, 333]) expect(shape(T + t)).toEqual(shape(T + t));
  });

  it('a flake further back than the front 7% of depth does not tumble', () => {
    for (let t = 0; t < 1000; t += 50) {
      expect(changed([flake(5.25, -8.75, 40)], { time: T + t }), `t ${t}`).toHaveLength(1);
    }
  });

  it('the tumbling flake stays white and in the glass at the very nearest z', () => {
    const f = flake(0.25, -0.75, 53);
    for (let t = 0; t < 800; t += 40) {
      for (const [x, y, c] of changed([f], { time: T + t })) {
        expect(c).toBe(WHITE);
        expect(inGlass(x, y)).toBe(true);
      }
    }
  });
});

describe('globe snow drawing: depth against the objects', () => {
  // A grid of flakes four pixels apart (far enough that a tumbler's arms never touch the next), at one depth.
  function grid(z: number): Flake[] {
    const out: Flake[] = [];
    for (let y = -48; y <= 48; y += 4) {
      for (let x = -48; x <= 48; x += 4) {
        if (Math.hypot(x, y) < 46) out.push(flake(x + 0.25, y + 0.75, z));
      }
    }
    return out;
  }
  const covered = (flakes: Flake[], over: Partial<SceneInput> = {}): Set<number> => {
    const set = new Set<number>();
    for (const [x, y] of changed(flakes, over)) set.add(y * W + x);
    return set;
  };

  it('flakes in front show everywhere on the glass, over the objects, the reflections and Santa', () => {
    for (const turn of [0, 1.3, 3.1]) {
      const flakes = grid(30);
      const before = picture({ turn });
      const after = picture({ turn, snow: snowOf(flakes) });
      let changedCount = 0;
      let notWhite = 0;
      for (const f of flakes) {
        const i = (CY + Math.floor(f.y)) * W + (CX + Math.floor(f.x));
        if (after[i] !== WHITE) notWhite++;
        if (before[i] !== WHITE && after[i] === WHITE) changedCount++;
      }
      // A flake's pixel is white with snow; where the no-snow pixel was already white it cannot change.
      expect(notWhite, `turn ${turn}`).toBe(0);
      const alreadyWhite = flakes.filter(
        (f) => before[(CY + Math.floor(f.y)) * W + (CX + Math.floor(f.x))] === WHITE,
      ).length;
      expect(changedCount, `turn ${turn}`).toBe(flakes.length - alreadyWhite);
      expect(changed(flakes, { turn }), `turn ${turn}`).toHaveLength(flakes.length - alreadyWhite);
    }
  });

  it('flakes behind are hidden by at least some of the objects, and show on open glass', () => {
    const front = covered(grid(30));
    const back = covered(grid(-40));
    const hidden = [...front].filter((i) => !back.has(i));
    expect(back.size).toBeGreaterThan(front.size * 0.4);
    expect(hidden.length).toBeGreaterThan(0);
    // Everything a back flake shows is a place a front flake shows.
    for (const i of back) expect(front.has(i)).toBe(true);
  });

  it('the flakes do not move with the turn: the simulation already turned them', () => {
    const a = changed([flake(FX, FY, 20)], { turn: 0 });
    const b = changed([flake(FX, FY, 20)], { turn: 2.2 });
    expect(a).toEqual(b);
    expect(a).toEqual([[PX, PY, WHITE]]);
  });

  it('a flake in front wins a pixel over a flake behind, whichever is listed first', () => {
    const near = flake(FX, FY, 40);
    const far = flake(FX, FY, -40);
    expect(changed([near, far])).toEqual([[PX, PY, WHITE]]);
    expect(changed([far, near])).toEqual([[PX, PY, WHITE]]);
  });

  it('the picture does not depend on the order of the flakes', () => {
    const flakes = [flake(-12.25, 4.75, -30), flake(7.25, 10.75, 10), flake(20.25, -30.75, 52), flake(-3.25, -9.75, -2)];
    const a = picture({ snow: snowOf(flakes) });
    const b = picture({ snow: snowOf([...flakes].reverse()) });
    expect(a).toEqual(b);
  });
});

describe('globe snow drawing: inside the glass', () => {
  function ring(z: number, radius: number): Flake[] {
    const out: Flake[] = [];
    for (let a = 0; a < 2 * Math.PI; a += 0.13) {
      const x = radius * Math.cos(a);
      const y = radius * Math.sin(a);
      out.push(flake(x, y, z));
    }
    return out;
  }

  it('flakes at the snow limit (radius 53) paint only inside the glass circle, front and back', () => {
    for (const z of [30, -30, 0]) {
      const r = Math.sqrt(53 ** 2 - z ** 2);
      for (const [x, y] of changed(ring(z, r))) expect(inGlass(x, y), `${x},${y} z ${z}`).toBe(true);
    }
  });

  it('tumbling flakes at the rim keep their arms inside the glass too', () => {
    // Nearest z of the limit sphere, but pushed out to the widest the sim allows at that depth.
    const z = 52;
    const r = Math.sqrt(53 ** 2 - z ** 2);
    for (const t of [0, 100, 200, 300]) {
      for (const [x, y] of changed(ring(z, r), { time: T + t })) expect(inGlass(x, y), `${x},${y}`).toBe(true);
    }
  });

  it('a flake at the left, right, top and bottom of the limit circle shows as a pixel and nothing outside the glass changes', () => {
    const flakes = [flake(-52.9, 0.25, 0), flake(52.9, 0.25, 0), flake(0.25, -52.9, 0), flake(0.25, 52.9, 0)];
    const px = changed(flakes);
    expect(px.length).toBeGreaterThanOrEqual(1);
    for (const [x, y] of px) expect(inGlass(x, y)).toBe(true);
  });

  it('flakes work at a small picture size, on a layout the caller kept', () => {
    const layout = sceneLayout(2 * GLOBE_RADIUS, 160, 1);
    const snow = snowOf([flake(0.25, 0.75, 30)]);
    const small = { ...input({ width: 2 * GLOBE_RADIUS, height: 160, seed: 1 }) };
    const a = sceneFrame(small, undefined, layout).picture;
    const b = sceneFrame({ ...small, snow }, undefined, layout).picture;
    const diff = [...b].filter((c, i) => c !== a[i]);
    expect(diff).toEqual([WHITE]);
  });
});

describe('globe snow drawing: the stir makes no flash', () => {
  const flakes = [flake(FX, FY, 40), flake(-20.25, 5.75, -35), flake(3.25, -30.75, 52), flake(-9.25, 23.75, 10, { resting: true })];

  it('the same flakes draw the same picture at stir 0, 0.5 and the highest stir', () => {
    const calm = picture({ snow: snowOf(flakes, 0) });
    expect(picture({ snow: snowOf(flakes, 0.5) })).toEqual(calm);
    expect(picture({ snow: snowOf(flakes, 1.6) })).toEqual(calm);
  });

  it('a stir burst in the real simulation never changes how bright the flakes are: only white or the one dim colour', () => {
    const snow = createGlobeSnow(9, false);
    stepGlobeSnow(snow, { turn: 0, raise: 1.6, push: { x: 0, y: 0, z: 0 } });
    const colours = new Set(changed([...snow.flakes], {}, snow.stir).map(([, , c]) => c));
    expect(colours.has(WHITE)).toBe(true);
    // White in front, and one fixed dim colour behind (its list membership is checked under colours).
    for (const c of colours) expect(c === WHITE || luma(c) < luma(WHITE)).toBe(true);
  });

  it('the picture total brightness of one calm frame and one stirred frame of the same flakes is the same', () => {
    const sum = (p: Uint32Array): number => p.reduce((a, c) => a + luma(c), 0);
    expect(sum(picture({ snow: snowOf(flakes, 1.6) }))).toBe(sum(picture({ snow: snowOf(flakes, 0) })));
  });
});

describe('globe snow drawing: same inputs, same frame', () => {
  it('two draws of the same input are identical', () => {
    const snow = createGlobeSnow(3, true);
    for (let i = 0; i < 90; i++) stepGlobeSnow(snow, { turn: i * 0.01, raise: 0, push: { x: 0, y: 0, z: 0 } });
    expect(picture({ snow })).toEqual(picture({ snow }));
  });

  it('the same seed run the same steps gives the same frame; another seed gives another', () => {
    const run = (seed: number): Uint32Array => {
      const snow = createGlobeSnow(seed, false);
      for (let i = 0; i < 120; i++) stepGlobeSnow(snow, { turn: 0.5, raise: i === 0 ? 1 : 0, push: { x: 0, y: 0, z: 0 } });
      return picture({ snow });
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('draws no randomness: the Math.random and Date clocks are never read', () => {
    const snow = snowOf([flake(FX, FY, 40), flake(1.25, 2.75, 52), flake(-30.25, 10.75, -20)]);
    const real = { random: Math.random, now: Date.now };
    let reads = 0;
    Math.random = (): number => (reads++, 0.5);
    Date.now = (): number => (reads++, 0);
    try {
      sceneFrame(input({ snow }));
    } finally {
      Math.random = real.random;
      Date.now = real.now;
    }
    expect(reads).toBe(0);
  });

  it('a real snow after a settle draws many flakes, all inside the glass, in every phase', () => {
    const snow = createGlobeSnow(11, false);
    for (let i = 0; i < 300; i++) stepGlobeSnow(snow, { turn: 0, raise: 0, push: { x: 0, y: 0, z: 0 } });
    for (const [name, phase] of READINGS) {
      const px = changed([...snow.flakes], { phase });
      expect(px.length, name).toBeGreaterThan(100);
      for (const [x, y] of px) expect(inGlass(x, y), `${name} ${x},${y}`).toBe(true);
    }
  });

  it('the front flakes are white in every phase and blend', () => {
    for (const [name, phase] of READINGS) {
      expect(changed([flake(FX, FY, 25)], { phase }), name).toEqual([[PX, PY, WHITE]]);
    }
  });
});

describe('globe snow drawing: colours', () => {
  it('white is on the master colour list', () => {
    expect(masterColours.map((c) => c.toLowerCase())).toContain('#ffffff');
  });

  it('the dim colour drawn for a back flake is on the master colour list, in every phase and blend', () => {
    const hex = (c: number): string => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
    const master = masterColours.map((c) => c.toLowerCase());
    for (const [name, phase] of READINGS) {
      const back = changed([flake(FX, FY, -40)], { phase });
      expect(back, name).toHaveLength(1);
      expect(master, `${name} ${hex(back[0]![2])}`).toContain(hex(back[0]![2]));
    }
  });
});
