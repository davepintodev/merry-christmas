// Flake watch: a rolling take of a few tracked flakes, frame by frame, for the ?perf reporter.
import { describe, expect, it } from 'vitest';
import { createFlakeWatch, type WatchInput } from './flake-watch.ts';

const globeFlake = (i: number) => ({ x: i + 0.123456, y: i * 2 + 0.456, z: -i - 0.999, resting: i % 2 === 0 });

function input(over: Partial<WatchInput> = {}): WatchInput {
  return { time: 1000, fraction: 0.5, sceneTimeMs: 40, turn: 0, turnStep: 0, down: false, globe: [], outside: [], ...over };
}

describe('createFlakeWatch', () => {
  it('counts steps since the previous frame, then resets', () => {
    const w = createFlakeWatch();
    w.step(); w.step(); w.step();
    w.frame(input());
    w.frame(input());
    w.step();
    w.frame(input());
    expect(w.take().rows.map((r) => r.steps)).toEqual([3, 0, 1]);
  });

  it('tracks 10 globe flakes spread by index, rounded to 2 decimals, resting as 1/0', () => {
    const w = createFlakeWatch();
    w.frame(input({ globe: Array.from({ length: 25 }, (_, i) => globeFlake(i)) }));
    const { meta, rows } = w.take();
    expect(meta.globeIdx).toEqual([0, 2, 5, 7, 10, 12, 15, 17, 20, 22]);
    expect(rows[0]!.g.slice(0, 8)).toEqual([0.12, 0.46, -1, 1, 2.12, 4.46, -3, 1]);
    expect(rows[0]!.g).toHaveLength(40);
  });

  it('tracks all globe flakes when there are fewer than 10', () => {
    const w = createFlakeWatch();
    w.frame(input({ globe: [globeFlake(0), globeFlake(1)] }));
    expect(w.take().meta.globeIdx).toEqual([0, 1]);
  });

  it('picks up to 4 sparkle, tumble and plain outside flakes in that order, and re-picks for a new array', () => {
    const w = createFlakeWatch();
    const ds = [0.1, 0.95, 0.8, 0.5, 0.99, 0.7, 0.2, 0.97, 0.94, 0.96, 0.98, 0.9, 0.85, 0.3, 0.4, 0.6];
    const outside = ds.map((d, i) => ({ x: i + 0.456, y: 1.234, d }));
    w.frame(input({ outside }));
    const first = w.take();
    expect(first.meta.outsideIdx).toEqual([1, 4, 7, 8, 2, 5, 11, 12, 0, 3, 6, 13]);
    expect(first.meta.outsideD).toEqual(first.meta.outsideIdx.map((i) => ds[i]));
    expect(first.rows[0]!.o.slice(0, 4)).toEqual([1.46, 1.23, 4.46, 1.23]);
    w.frame(input({ outside }));
    w.frame(input({ outside: [{ x: 0, y: 0, d: 0.1 }] }));
    expect(w.take().meta.outsideIdx).toEqual([0]);
  });

  it('take returns rows once, with the same meta the second time', () => {
    const w = createFlakeWatch();
    w.frame(input({ globe: [globeFlake(0)] }));
    const a = w.take();
    const b = w.take();
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toEqual([]);
    expect(b.meta).toEqual(a.meta);
  });

  it('keeps the newest 120 rows', () => {
    const w = createFlakeWatch();
    for (let i = 0; i < 130; i++) w.frame(input({ time: i }));
    const rows = w.take().rows;
    expect(rows).toHaveLength(120);
    expect(rows[0]!.t).toBe(10);
    expect(rows[119]!.t).toBe(129);
  });

  it('records front and behind draw steps as x, y, depth rounded to 1 decimal, and leaves them out when absent', () => {
    const w = createFlakeWatch();
    w.frame(input({
      front: [{ x: 1.04, y: -2.36, depth: 0.58 }, { x: 3.02, y: 4.26, depth: 0.96 }],
      behind: [{ x: 5.56, y: 6.04, depth: 0.14 }],
    }));
    w.frame(input());
    const [withSteps, without] = w.take().rows;
    expect(withSteps).toMatchObject({ fr: [1, -2.4, 0.6, 3, 4.3, 1], bh: [5.6, 6, 0.1] });
    expect(without).not.toHaveProperty('fr');
    expect(without).not.toHaveProperty('bh');
  });

  it('records time, fraction, scene time, turn, turn step and pointer, rounded to 3 decimals', () => {
    const w = createFlakeWatch();
    w.frame(input({ time: 1234, fraction: 0.12345, sceneTimeMs: 77, turn: 1.23456, turnStep: 0.0126, down: true }));
    expect(w.take().rows[0]).toMatchObject({ t: 1234, f: 0.123, st: 77, turn: 1.235, ts: 0.013, down: true });
  });
});
