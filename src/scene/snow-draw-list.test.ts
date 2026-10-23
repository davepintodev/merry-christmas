// XMAS-84 "Snow inside the glass on the fine layer": the flakes as pure draw
// steps (snowDrawList) and a CPU renderer that snaps them to the screen's pixel
// grid (renderSnowSteps). Flake coordinates are art px from the globe centre
// (y down, z toward the viewer). Assumed interface (see the report):
//   snowDrawList(snow, previous, fraction, side, time = 0, into = [], turnStep = 0): SnowStep[]
//   SnowStep { x, y (unfloored, globe-centred), colour, shape (offsets), depth }
import { describe, expect, it } from 'vitest';
import { NO_FRONT, drawGlobe } from './globe.ts';
import { sceneLayout } from './frame.ts';
import { renderSnowSteps, snowDrawList, type SnowStep } from './snow-draw-list.ts';
import type { Flake, GlobeSnow } from './snow.ts';

const W = 240;
const H = 180;
const LAYOUT = sceneLayout(W, H, 777);
const CX = LAYOUT.globe.cx;
const CY = LAYOUT.globe.cy;
const WHITE = 0xffffff;
const BEHIND = 0xaebcf0;
const REST_Y = 24;

function flake(x: number, y: number, z: number, over: Partial<Flake> = {}): Flake {
  return { x, y, z, resting: false, phase: 0, ...over };
}
function snowOf(flakes: Flake[], stir = 0): GlobeSnow {
  return { flakes, stir };
}
function list(snow: GlobeSnow, side: 'behind' | 'front', previous?: GlobeSnow, fraction = 1, time = 0): SnowStep[] {
  return snowDrawList(snow, previous, fraction, side, time);
}
function render(steps: SnowStep[], zoom = 1): Uint32Array {
  const picture = new Uint32Array(W * zoom * H * zoom);
  renderSnowSteps(picture, W, LAYOUT, steps, zoom);
  return picture;
}
function lit(picture: Uint32Array, zoom = 1): [number, number, number][] {
  const out: [number, number, number][] = [];
  picture.forEach((c, i) => {
    if (c !== 0) out.push([i % (W * zoom), Math.floor(i / (W * zoom)), c]);
  });
  return out;
}

describe('snowDrawList: the two sides', () => {
  const snow = snowOf([flake(1, 2, -30), flake(3, 4, 0), flake(5, 6, 0.5), flake(7, 8, 40), flake(9, 10, -0.5)]);

  it('behind takes z <= 0 and front takes z > 0, each flake once', () => {
    expect(list(snow, 'behind').map((s) => s.x)).toEqual([1, 3, 9]);
    expect(list(snow, 'front').map((s) => s.x)).toEqual([5, 7]);
  });

  it('behind flakes are the dim blue and front flakes white', () => {
    for (const s of list(snow, 'behind')) expect(s.colour).toBe(BEHIND);
    for (const s of list(snow, 'front')) expect(s.colour).toBe(WHITE);
  });

  it('empty snow gives no steps on either side', () => {
    expect(list(snowOf([]), 'behind')).toEqual([]);
    expect(list(snowOf([]), 'front')).toEqual([]);
  });

  it('stir changes nothing about the steps', () => {
    const flakes = [flake(1, 2, -30), flake(7, 8, 40)];
    for (const side of ['behind', 'front'] as const) {
      expect(list(snowOf(flakes, 1.6), side)).toEqual(list(snowOf(flakes, 0), side));
    }
  });

  it('steps are not floored: a fractional flake keeps its fraction', () => {
    const [s] = list(snowOf([flake(10.25, -20.75, 20)]), 'front');
    expect(s?.x).toBe(10.25);
    expect(s?.y).toBe(-20.75);
  });

  it('is pure: same input, same steps, inputs untouched, no randomness or clock', () => {
    const a = snowOf([flake(1.5, 2.5, 20), flake(3, 4, -20)]);
    const b = snowOf([flake(2.5, 2.5, 20), flake(3, 4, -20)]);
    const copy = JSON.stringify([a, b]);
    const real = { random: Math.random, now: Date.now };
    let reads = 0;
    Math.random = (): number => (reads++, 0.5);
    Date.now = (): number => (reads++, 0);
    try {
      expect(list(a, 'front', b, 0.4)).toEqual(list(a, 'front', b, 0.4));
    } finally {
      Math.random = real.random;
      Date.now = real.now;
    }
    expect(reads).toBe(0);
    expect(JSON.stringify([a, b])).toBe(copy);
  });
});

describe('snowDrawList: between the last two steps', () => {
  const previous = snowOf([flake(10, -20, 20), flake(-10, 5, -20)]);
  const current = snowOf([flake(14, -16, 24), flake(-6, 9, -16)]);

  it('fraction 0 is the previous positions, 1 the current, 0.5 halfway', () => {
    expect(list(current, 'front', previous, 0)[0]).toMatchObject({ x: 10, y: -20 });
    expect(list(current, 'front', previous, 1)[0]).toMatchObject({ x: 14, y: -16 });
    expect(list(current, 'front', previous, 0.5)[0]).toMatchObject({ x: 12, y: -18 });
    expect(list(current, 'behind', previous, 0.25)[0]).toMatchObject({ x: -9, y: 6 });
  });

  it('no previous draws the current positions at any fraction', () => {
    for (const f of [0, 0.5, 1]) expect(list(current, 'front', undefined, f)).toEqual(list(current, 'front', current, 1));
  });

  it('a fraction outside [0, 1] is held at the nearer end', () => {
    expect(list(current, 'front', previous, -3)).toEqual(list(current, 'front', previous, 0));
    expect(list(current, 'front', previous, 7)).toEqual(list(current, 'front', previous, 1));
  });

  it('a flake that restarted far away is drawn where it is, not swept across the glass', () => {
    const far = snowOf([flake(-40, 40, 20)]);
    const near = snowOf([flake(40, -40, 20)]);
    expect(list(near, 'front', far, 0.5)[0]).toMatchObject({ x: 40, y: -40 });
  });

  it('a flake that settled or lifted off is not blended from its old state', () => {
    const was = snowOf([flake(0, 10, 20)]);
    const nowResting = snowOf([flake(1, REST_Y, 20, { resting: true })]);
    expect(list(nowResting, 'front', was, 0.5)[0]).toMatchObject({ x: 1, y: REST_Y + 20 * 0.3 });
    const lifted = snowOf([flake(1, 20, 20)]);
    expect(list(lifted, 'front', nowResting, 0.5)[0]).toMatchObject({ x: 1, y: 20 });
  });

  it('a previous with fewer flakes draws the extra ones where they are', () => {
    const shorter = snowOf([flake(10, -20, 20)]);
    const steps = list(current, 'behind', shorter, 0.5);
    expect(steps[0]).toMatchObject({ x: -6, y: 9 });
  });

  it('a previous with more flakes does not throw and keeps the current count', () => {
    const longer = snowOf([...previous.flakes, flake(0, 0, 20)]);
    expect(list(current, 'front', longer, 0.5)).toHaveLength(1);
  });

});

describe('snowDrawList: the globe turns between steps (XMAS-101)', () => {
  const TURN = 0.75;
  /** A flake turned about the upright axis by angle (rad), the way the globe's spin turns it. */
  function turnedBy(f: Flake, angle: number): Flake {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { ...f, x: f.x * c - f.z * s, z: f.x * s + f.z * c };
  }
  /** Both sides' steps for one snow, behind then front, with the turn passed in. */
  function bothSides(snow: GlobeSnow, previous: GlobeSnow | undefined, fraction: number, turnStep: number): SnowStep[] {
    return [...snowDrawList(snow, previous, fraction, 'behind', 0, [], turnStep), ...snowDrawList(snow, previous, fraction, 'front', 0, [], turnStep)];
  }

  it('a flake the turn carries round is drawn on the arc at every fraction, not the chord', () => {
    const cur = flake(50, 0, 0);
    const now: GlobeSnow = { flakes: [cur], stir: 0, airTurn: TURN };
    const was = snowOf([turnedBy(cur, -TURN)]);
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const steps = bothSides(now, was, fraction, 0);
      expect(steps, `fraction ${fraction}`).toHaveLength(1);
      const s = steps[0];
      expect(Math.hypot(s?.x ?? 0, s?.depth ?? 0), `fraction ${fraction}`).toBeCloseTo(50, 6);
    }
    expect(bothSides(now, was, 1, 0)[0]).toMatchObject({ x: 50, y: 0 });
    const mid = bothSides(now, was, 0.5, 0)[0];
    expect(mid?.x).toBeCloseTo(50 * Math.cos(TURN / 2), 6);
    expect(mid?.depth).toBeCloseTo(-50 * Math.sin(TURN / 2), 6);
  });

  it('a flake that crosses z = 0 in the turn is behind before the crossing and in front after, switching once', () => {
    const cur = flake(50, 0, 10);
    const now: GlobeSnow = { flakes: [cur], stir: 0, airTurn: TURN };
    const was = snowOf([turnedBy(cur, -TURN)]);
    const sides: string[] = [];
    for (let i = 0; i <= 20; i++) {
      const fraction = i / 20;
      const behind = snowDrawList(now, was, fraction, 'behind').length;
      const front = snowDrawList(now, was, fraction, 'front').length;
      expect(behind + front, `fraction ${fraction}`).toBe(1);
      sides.push(behind === 1 ? 'behind' : 'front');
    }
    expect(sides[0]).toBe('behind');
    expect(sides[20]).toBe('front');
    expect(sides.slice(1).filter((side, i) => side !== sides[i])).toHaveLength(1);
  });

  it('a free flake turns by the snow airTurn, not the globe turn, and blends on the arc', () => {
    const cur = flake(50, 0, 0);
    const now: GlobeSnow = { flakes: [cur], stir: 0, airTurn: TURN };
    const mid = bothSides(now, snowOf([turnedBy(cur, -TURN)]), 0.5, 0)[0];
    expect(mid?.x).toBeCloseTo(50 * Math.cos(TURN / 2), 6);
    expect(mid?.depth).toBeCloseTo(-50 * Math.sin(TURN / 2), 6);
  });

  it('a resting flake turns by the globe turn, whatever the airTurn', () => {
    const cur = flake(50, REST_Y, 0, { resting: true });
    const now: GlobeSnow = { flakes: [cur], stir: 0, airTurn: 0.2 };
    const mid = bothSides(now, snowOf([turnedBy(cur, -TURN)]), 0.5, TURN)[0];
    expect(mid?.x).toBeCloseTo(50 * Math.cos(TURN / 2), 6);
    expect(mid?.depth).toBeCloseTo(-50 * Math.sin(TURN / 2), 6);
  });

  it('a flake that restarted far away is still drawn where it is when the globe turns', () => {
    const near = flake(40, -40, 20);
    const far = flake(-40, 40, 20);
    const spun: GlobeSnow = { flakes: [near], stir: 0, airTurn: 0.3 };
    expect(bothSides(spun, snowOf([far]), 0.5, 0)[0]).toMatchObject({ x: 40, y: -40, depth: 20 });
  });

  it('a resting flake the turn carries keeps y + blended z * 0.3 at both ends and between', () => {
    const was = flake(30, REST_Y, 10, { resting: true });
    const now = turnedBy(was, 0.2);
    const start = bothSides(snowOf([now]), snowOf([was]), 0, 0.2)[0];
    const end = bothSides(snowOf([now]), snowOf([was]), 1, 0.2)[0];
    expect(start?.y).toBeCloseTo(REST_Y + was.z * 0.3, 9);
    expect(end?.y).toBeCloseTo(REST_Y + now.z * 0.3, 9);
    const mid = bothSides(snowOf([now]), snowOf([was]), 0.5, 0.2)[0];
    expect(mid?.depth).toBeCloseTo(30 * Math.sin(0.1) + 10 * Math.cos(0.1), 9);
    expect(mid?.y).toBeCloseTo(REST_Y + (mid?.depth ?? NaN) * 0.3, 9);
  });

  it('with no turn passed the blend is the straight line, as before', () => {
    const now = snowOf([flake(14, -16, 24), flake(-6, 9, -16)]);
    const was = snowOf([flake(10, -20, 20), flake(-10, 5, -20)]);
    expect(snowDrawList(now, was, 0.5, 'front')).toEqual(snowDrawList(now, was, 0.5, 'front', 0, [], 0));
    expect(snowDrawList(now, was, 0.5, 'behind')[0]).toMatchObject({ x: -8, y: 7 });
  });

  it('a turn with a drift walks the arc first, then the drift is a straight line from there', () => {
    const back = turnedBy(flake(50, 0, 0), -0.5);
    const onArc = turnedBy(back, 0.5);
    const cur = flake(onArc.x + 4, 0, onArc.z);
    const mid = bothSides({ flakes: [cur], stir: 0, airTurn: 0.5 }, snowOf([back]), 0.5, 0)[0];
    expect(mid?.x).toBeCloseTo(50 * Math.cos(0.25) + 2, 6);
    expect(mid?.depth).toBeCloseTo(-50 * Math.sin(0.25), 6);
  });
});

describe('snowDrawList: resting flakes lie at y + z * 0.3', () => {
  it('is y + z*0.3 for negative, zero and positive z; a free flake keeps its y', () => {
    for (const z of [-40, -10.5, 0, 10.5, 40]) {
      const side = z > 0 ? 'front' : 'behind';
      const rest = list(snowOf([flake(3, REST_Y, z, { resting: true })]), side)[0];
      expect(rest?.y, `z ${z}`).toBeCloseTo(REST_Y + z * 0.3, 9);
      const free = list(snowOf([flake(3, REST_Y, z)]), side)[0];
      expect(free?.y, `free z ${z}`).toBe(REST_Y);
    }
  });

  it('the offset is blended too: both ends take it, so a resting flake does not jump', () => {
    const a = snowOf([flake(0, REST_Y, 10, { resting: true })]);
    const b = snowOf([flake(2, REST_Y, 20, { resting: true })]);
    const mid = list(b, 'front', a, 0.5)[0];
    expect(mid?.x).toBeCloseTo(1, 9);
    expect(mid?.y).toBeCloseTo(REST_Y + 15 * 0.3, 9);
  });

  const ANGLES = [0.5, 1.5, 2.5, 4, Math.PI / 4, (3 * Math.PI) / 4];
  /** Resting flakes spread over the floor disc, as the globe's turn leaves them. */
  function floor(angle: number): Flake[] {
    const out: Flake[] = [];
    for (let i = 0; i < 24; i++) {
      const a = angle + (i * 2 * Math.PI) / 24;
      const r = 20 + (i % 3) * 8;
      out.push(flake(r * Math.cos(a), REST_Y, r * Math.sin(a), { resting: true }));
    }
    return out;
  }

  it('resting flakes at different depths land on different rows at every turn angle, not one dashed line', () => {
    for (const angle of ANGLES) {
      const snow = snowOf(floor(angle));
      const steps = [...list(snow, 'behind'), ...list(snow, 'front')];
      expect(steps).toHaveLength(24);
      const rows = new Set(steps.map((s) => Math.floor(CY + s.y)));
      expect(rows.size, `angle ${angle}`).toBeGreaterThan(5);
      for (const f of snow.flakes) {
        const s = steps.find((st) => st.x === f.x);
        expect(s?.y, `angle ${angle}`).toBeCloseTo(REST_Y + f.z * 0.3, 9);
      }
    }
  });

  it('rendered, the resting flakes spread over several screen rows at every angle and zoom', () => {
    for (const angle of ANGLES) {
      for (const zoom of [1, 2]) {
        const snow = snowOf(floor(angle));
        const picture = render([...list(snow, 'behind'), ...list(snow, 'front')], zoom);
        const rows = new Set(lit(picture, zoom).map(([, y]) => y));
        expect(rows.size, `angle ${angle} zoom ${zoom}`).toBeGreaterThan(5);
      }
    }
  });
});

describe('snowDrawList: tumbling', () => {
  const near = snowOf([flake(5.25, -8.75, 52)]);
  const key = (s: SnowStep): string => JSON.stringify([...s.shape].map((o) => [...o]).sort());

  it('a free flake beyond z 45.6 is a five-point plus or X, a nearer-in one a single point', () => {
    expect(list(near, 'front')[0]?.shape).toHaveLength(5);
    expect(list(snowOf([flake(5, -8, 45)]), 'front')[0]?.shape).toHaveLength(1);
    expect(list(snowOf([flake(5, -8, 46)]), 'front')[0]?.shape).toHaveLength(5);
  });

  it('a resting flake never tumbles, however near', () => {
    expect(list(snowOf([flake(5, REST_Y, 52, { resting: true })]), 'front')[0]?.shape).toHaveLength(1);
  });

  it('the shape swaps between plus and X over time, 2.5 swaps a second, off the flake phase', () => {
    const shapes = new Set<string>();
    let flips = 0;
    let last = '';
    for (let t = 0; t < 2000; t += 25) {
      const k = key(list(near, 'front', undefined, 1, t)[0] as SnowStep);
      shapes.add(k);
      if (last !== '' && k !== last) flips++;
      last = k;
    }
    expect(shapes.size).toBe(2);
    expect(flips).toBeGreaterThanOrEqual(4);
    expect(flips).toBeLessThanOrEqual(12);
    const a = key(list(snowOf([flake(5, -8, 52, { phase: 0 })]), 'front', undefined, 1, 0)[0] as SnowStep);
    const b = key(list(snowOf([flake(5, -8, 52, { phase: 1 })]), 'front', undefined, 1, 0)[0] as SnowStep);
    expect(a).not.toBe(b);
  });

  it('tumbling flakes are only in front', () => {
    expect(list(near, 'behind')).toEqual([]);
  });
});

describe('renderSnowSteps: the screen pixel grid', () => {
  it('at zoom 1 a step is one pixel at floor(centre + x, centre + y), in its colour', () => {
    const picture = render(list(snowOf([flake(10.25, -20.75, 20), flake(-3.5, 4.5, -10)]), 'front'));
    expect(lit(picture)).toEqual([[CX + 10, CY - 21, WHITE]]);
    const back = render(list(snowOf([flake(-3.5, 4.5, -10)]), 'behind'));
    expect(lit(back)).toEqual([[CX - 4, CY + 4, BEHIND]]);
  });

  it('at zoom 1 any position inside one pixel draws the same picture', () => {
    const a = render(list(snowOf([flake(10.02, -20.98, 20)]), 'front'));
    const b = render(list(snowOf([flake(10.98, -20.02, 20)]), 'front'));
    expect(a).toEqual(b);
  });

  it('at zoom 2 the flake moves in half art pixels, and stays in its own art pixel block', () => {
    const a = render(list(snowOf([flake(10.25, -20.75, 20)]), 'front'), 2);
    const b = render(list(snowOf([flake(10.75, -20.75, 20)]), 'front'), 2);
    expect(a).not.toEqual(b);
    for (const [pic, ax] of [[a, 10], [b, 10]] as const) {
      const px = lit(pic, 2);
      expect(px.length).toBeGreaterThanOrEqual(1);
      for (const [x, y, c] of px) {
        expect(c).toBe(WHITE);
        expect(Math.floor(x / 2)).toBe(CX + ax);
        expect(Math.floor(y / 2)).toBe(CY - 21);
      }
    }
  });

  it('a smooth glide: flake blended in quarters moves through distinct screen columns at zoom 4', () => {
    const was = snowOf([flake(10, -20, 20)]);
    const now = snowOf([flake(11, -20, 20)]);
    const cols = new Set<number>();
    for (const f of [0, 0.25, 0.5, 0.75]) {
      for (const [x] of lit(render(list(now, 'front', was, f), 4), 4)) cols.add(x);
    }
    expect(cols.size).toBeGreaterThanOrEqual(3);
  });

  it('a tumbling flake draws five pixels at zoom 1 in white', () => {
    const px = lit(render(list(snowOf([flake(5.25, -8.75, 52)]), 'front', undefined, 1, 0)));
    expect(px).toHaveLength(5);
    for (const [, , c] of px) expect(c).toBe(WHITE);
  });

  it('draws nothing for no steps, and skips pixels outside the picture', () => {
    expect(lit(render([]))).toEqual([]);
    expect(() => render(list(snowOf([flake(-5000, 5000, 20), flake(5000, -5000, 20)]), 'front'))).not.toThrow();
    expect(lit(render(list(snowOf([flake(-5000, 5000, 20)]), 'front')))).toEqual([]);
  });

  it('a later step covers an earlier one on the same pixel', () => {
    const steps = [...list(snowOf([flake(3.5, 3.5, -10)]), 'behind'), ...list(snowOf([flake(3.5, 3.5, 10)]), 'front')];
    expect(lit(render(steps))).toEqual([[CX + 3, CY + 3, WHITE]]);
  });

  it('rejects a zoom that is not a whole number of at least 1, and a picture of the wrong size', () => {
    const steps = list(snowOf([flake(1, 1, 20)]), 'front');
    for (const zoom of [0, 1.5, -1, Number.NaN]) {
      expect(() => renderSnowSteps(new Uint32Array(W * H), W, LAYOUT, steps, zoom)).toThrow(RangeError);
    }
    expect(() => renderSnowSteps(new Uint32Array(W * H), W, LAYOUT, steps, 2)).toThrow(RangeError);
  });
});

describe('the page wiring: the old art pixel snow layer goes away', () => {
  const SNOW = snowOf([flake(10.25, -20.75, 20), flake(5.25, -8.75, 52)]);

  it('drawGlobe takes no front picture any more (Santa is a draw step, the flakes steps): with the bodies left out, snow or not, the picture is the same', () => {
    const withSnow = new Uint32Array(W * H);
    const noSnow = new Uint32Array(W * H);
    const phase = { from: 'purple-night', to: 'purple-night', share: 0 } as const;
    drawGlobe(withSnow, W, LAYOUT, phase, 0.4, 5000, SNOW, 0, 'shadows');
    drawGlobe(noSnow, W, LAYOUT, phase, 0.4, 5000, undefined, 0, 'shadows');
    expect(withSnow).toEqual(noSnow);
    expect(NO_FRONT).toBe(0xffffffff);
  });

  it('drawGlobe no longer paints the flakes into the art pixel picture (they are steps now)', () => {
    const withSnow = new Uint32Array(W * H);
    const noSnow = new Uint32Array(W * H);
    const phase = { from: 'purple-night', to: 'purple-night', share: 0 } as const;
    drawGlobe(withSnow, W, LAYOUT, phase, 0.4, 5000, SNOW);
    drawGlobe(noSnow, W, LAYOUT, phase, 0.4, 5000);
    expect(withSnow).toEqual(noSnow);
  });
});
