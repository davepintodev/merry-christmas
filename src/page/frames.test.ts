// XMAS-31b "Scene core", page runtime: frames for the scene canvas.
// makeFrameSource(build) gives a frame function that keeps the layout for
// one picture size and seed, building it again only when the size or seed
// changes (not every frame), and draws with the layout it keeps.
// toRgba(picture, out) turns the engine's 0xRRGGBB colour numbers into the
// canvas's RGBA bytes, fully opaque.
import { describe, expect, it } from 'vitest';
import { sceneFrame, sceneLayout, type SceneInput, type SceneLayout } from '../scene/frame.ts';
import { makeFrameSource, toRgba } from './frames.ts';

const NIGHT = { from: 'purple-night', to: 'purple-night', share: 0 } as const;

function input(over: Partial<SceneInput> = {}): SceneInput {
  return { time: 0, drag: 0, phase: NIGHT, seed: 42, width: 200, height: 180, ...over };
}

/** A build that counts its calls and otherwise is the engine's own. */
function counting(): { build: (w: number, h: number, seed: number) => SceneLayout; calls: [number, number, number][] } {
  const calls: [number, number, number][] = [];
  return {
    calls,
    build: (w, h, seed) => {
      calls.push([w, h, seed]);
      return sceneLayout(w, h, seed);
    },
  };
}

describe('makeFrameSource', () => {
  it('draws the same picture as the engine', () => {
    const frames = makeFrameSource();
    for (const time of [0, 500, 1000, 1700]) {
      const want = sceneFrame(input({ time }));
      const got = frames(input({ time }));
      expect(got.width).toBe(want.width);
      expect(got.height).toBe(want.height);
      expect(Array.from(got.picture)).toEqual(Array.from(want.picture));
    }
  });

  it('builds the layout once for many frames of one size and seed', () => {
    const { build, calls } = counting();
    const frames = makeFrameSource(build);
    for (let i = 0; i < 120; i++) frames(input({ time: i * (1000 / 60), phase: { from: 'sunset', to: 'purple-night', share: i / 120 } }));
    expect(calls).toEqual([[200, 180, 42]]);
  });

  it('draws with the layout it keeps, not a fresh one from inside the engine', () => {
    // A build that hands back another seed's layout: if the frame really uses
    // the kept layout, its stars are the other seed's.
    const frames = makeFrameSource((w, h, seed) => sceneLayout(w, h, seed + 1));
    const time = 0;
    const mine = sceneFrame(input({ seed: 42, time })).picture;
    const other = sceneFrame(input({ seed: 43, time })).picture;
    expect(Array.from(mine)).not.toEqual(Array.from(other)); // the seeds' stars differ at night
    expect(Array.from(frames(input({ seed: 42, time })).picture)).toEqual(Array.from(other));
  });

  it('builds again when the width, the height or the seed changes', () => {
    const { build, calls } = counting();
    const frames = makeFrameSource(build);
    frames(input());
    frames(input({ width: 260 })); // the window grew wider
    frames(input({ width: 260 }));
    frames(input({ width: 260, height: 240 })); // ...and taller
    frames(input({ width: 260, height: 240, seed: 7 }));
    expect(calls).toEqual([
      [200, 180, 42],
      [260, 180, 42],
      [260, 240, 42],
      [260, 240, 7],
    ]);
  });

  it('after a resize the frame has the new size and matches the engine there', () => {
    const frames = makeFrameSource();
    frames(input());
    const got = frames(input({ width: 333, height: 201 }));
    const want = sceneFrame(input({ width: 333, height: 201 }));
    expect([got.width, got.height]).toEqual([333, 201]);
    expect(got.layout.width).toBe(333);
    expect(Array.from(got.picture)).toEqual(Array.from(want.picture));
  });

  it('does not rebuild for a change of time, drag or phase alone', () => {
    const { build, calls } = counting();
    const frames = makeFrameSource(build);
    frames(input());
    frames(input({ time: 99_999 }));
    frames(input({ drag: 0.5 }));
    frames(input({ phase: { from: 'dawn', to: 'dawn', share: 0 } }));
    expect(calls).toHaveLength(1);
  });

  it('writes into the target it is given', () => {
    const frames = makeFrameSource();
    const target = new Uint32Array(200 * 180);
    const frame = frames(input(), target);
    expect(frame.picture).toBe(target);
    expect(Array.from(target)).toEqual(Array.from(sceneFrame(input()).picture));
  });

  it('a size the engine refuses throws, keeps nothing, and the next good size still works', () => {
    const { build, calls } = counting();
    const frames = makeFrameSource(build);
    frames(input());
    expect(() => frames(input({ width: 10 }))).toThrow(RangeError);
    expect(() => frames(input({ height: 159 }))).toThrow(RangeError);
    // The good layout from before is still the one in use, or is built again: either way the frame is right.
    const after = frames(input());
    expect(Array.from(after.picture)).toEqual(Array.from(sceneFrame(input()).picture));
    // A refused size is never kept: asking for it again throws again.
    expect(() => frames(input({ width: 10 }))).toThrow(RangeError);
    expect(calls.filter(([w]) => w === 200).length).toBeLessThanOrEqual(2);
  });

  it('a build that throws once is asked again next frame (the failure is not cached)', () => {
    let fail = true;
    const frames = makeFrameSource((w, h, seed) => {
      if (fail) {
        fail = false;
        throw new Error('boom');
      }
      return sceneLayout(w, h, seed);
    });
    expect(() => frames(input())).toThrow('boom');
    expect(Array.from(frames(input()).picture)).toEqual(Array.from(sceneFrame(input()).picture));
  });

  it('a target of the wrong length is refused', () => {
    const frames = makeFrameSource();
    expect(() => frames(input(), new Uint32Array(10))).toThrow(RangeError);
  });
});

describe('toRgba', () => {
  it('writes red, green, blue, then 255 for each colour number, in order', () => {
    const picture = Uint32Array.from([0xff0000, 0x00ff00, 0x0000ff, 0x123456, 0x000000, 0xffffff]);
    const out = new Uint8ClampedArray(picture.length * 4);
    toRgba(picture, out);
    expect(Array.from(out)).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      0x12, 0x34, 0x56, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
  });

  it('overwrites every byte of a reused buffer, alpha included', () => {
    const out = new Uint8ClampedArray(8).fill(7);
    toRgba(Uint32Array.from([0x010203, 0x0a0b0c]), out);
    expect(Array.from(out)).toEqual([1, 2, 3, 255, 10, 11, 12, 255]);
  });

  it('an empty picture writes nothing', () => {
    const out = new Uint8ClampedArray(0);
    expect(() => toRgba(new Uint32Array(0), out)).not.toThrow();
  });

  it('a buffer of the wrong length is refused', () => {
    expect(() => toRgba(new Uint32Array(3), new Uint8ClampedArray(8))).toThrow(RangeError);
    expect(() => toRgba(new Uint32Array(3), new Uint8ClampedArray(16))).toThrow(RangeError);
  });

  it('a whole engine frame comes out with the engine colours at each art pixel', () => {
    const frame = sceneFrame(input());
    const out = new Uint8ClampedArray(frame.picture.length * 4);
    toRgba(frame.picture, out);
    for (const index of [0, frame.width - 1, (frame.height - 1) * frame.width, frame.picture.length - 1]) {
      const n = frame.picture[index] ?? -1;
      expect([out[index * 4], out[index * 4 + 1], out[index * 4 + 2], out[index * 4 + 3]]).toEqual([
        (n >> 16) & 0xff,
        (n >> 8) & 0xff,
        n & 0xff,
        255,
      ]);
    }
  });
});
