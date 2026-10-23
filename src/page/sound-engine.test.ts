// XMAS-46b: the sound engine. Nothing audio exists until unmute(); then a wind bed and a faint
// chime layer loop under a master gain, and update(stir, paused) schedules the stir chimes that
// the pure model (46a) gives. A fake context records every node, param and ramp.
import { describe, expect, it, vi } from 'vitest';
import {
  createSoundEngine,
  type BufferSourceLike,
  type FilterNodeLike,
  type GainNodeLike,
  type NodeLike,
  type OscillatorLike,
  type ParamLike,
  type SoundContext,
} from './sound-engine.ts';
import { SOUND_SETTINGS, masterGain, stirChimes } from './sound-model.ts';

class FakeParam implements ParamLike {
  value = 0;
  readonly ramps: { v: number; t: number }[] = [];
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.ramps.push({ v, t });
  }
  cancelScheduledValues(): void {}
}

class FakeNode implements NodeLike {
  readonly outputs: NodeLike[] = [];
  started: number[] = [];
  stopped = 0;
  connect(destination: NodeLike): void {
    this.outputs.push(destination);
  }
  start(when = 0): void {
    this.started.push(when);
  }
  stop(): void {
    this.stopped++;
  }
}
class FakeGain extends FakeNode implements GainNodeLike {
  gain = new FakeParam();
}
class FakeFilter extends FakeNode implements FilterNodeLike {
  type = 'lowpass';
  frequency = new FakeParam();
}
class FakeBufferSource extends FakeNode implements BufferSourceLike {
  buffer: unknown = null;
  loop = false;
}
class FakeOscillator extends FakeNode implements OscillatorLike {
  type = 'sine';
  frequency = new FakeParam();
}

class FakeContext implements SoundContext {
  currentTime = 5;
  sampleRate = 8000;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  sources: FakeBufferSource[] = [];
  oscillators: FakeOscillator[] = [];
  resumes = 0;
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }
  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.sources.push(node);
    return node;
  }
  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
  createBuffer(_channels: number, length: number): { getChannelData(channel: number): Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  async resume(): Promise<void> {
    this.resumes++;
  }
  /** The master gain: the gain node wired straight to the destination. */
  master(): FakeGain {
    const found = this.gains.filter((g) => g.outputs.includes(this.destination));
    expect(found).toHaveLength(1);
    return found[0];
  }
}

/** True when `target` can be reached from `from` by following connect() calls. */
function reaches(from: FakeNode, target: NodeLike): boolean {
  const seen = new Set<NodeLike>();
  const walk = (n: FakeNode): boolean => {
    if (n === target) return true;
    if (seen.has(n)) return false;
    seen.add(n);
    return n.outputs.some((o) => walk(o as FakeNode));
  };
  return walk(from);
}

/** A repeatable random source. */
function seeded(): () => number {
  let s = 7;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483647;
  };
}

function setup() {
  const ctx = new FakeContext();
  const createContext = vi.fn(() => ctx);
  const engine = createSoundEngine({ createContext, random: seeded() });
  return { ctx, createContext, engine };
}

describe('sound engine', () => {
  it('creates nothing until unmute, then creates the context once and reuses it', () => {
    const { ctx, createContext, engine } = setup();
    expect(createContext).toHaveBeenCalledTimes(0);
    engine.update(1, false);
    engine.mute();
    expect(createContext).toHaveBeenCalledTimes(0);
    engine.unmute();
    expect(createContext).toHaveBeenCalledTimes(1);
    engine.mute();
    engine.unmute();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(ctx.resumes).toBeGreaterThanOrEqual(1);
  });

  it('ramps the master gain to the 46a target over 1 s on unmute and to 0 over 0.3 s on mute', () => {
    const { ctx, engine } = setup();
    engine.unmute();
    expect(engine.unmuted).toBe(true);
    const ramps = ctx.master().gain.ramps;
    expect(ramps.at(-1)).toEqual({ v: masterGain(true).target, t: 5 + masterGain(true).seconds });
    ctx.currentTime = 9;
    engine.mute();
    expect(engine.unmuted).toBe(false);
    expect(ramps.at(-1)).toEqual({ v: 0, t: 9 + SOUND_SETTINGS.fadeOutSeconds });
  });

  it('starts a looping filtered-noise wind and a looping chime layer, both into the master gain, with no fetch', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const { ctx, engine } = setup();
      engine.unmute();
      const master = ctx.master();
      expect(ctx.sources.length).toBeGreaterThanOrEqual(2);
      for (const s of ctx.sources) {
        expect(s.loop).toBe(true);
        expect(s.started.length).toBe(1);
        expect(reaches(s, master)).toBe(true);
      }
      const wind = ctx.sources.filter((s) => ctx.filters.some((f) => reaches(s, f)));
      expect(wind.length).toBeGreaterThanOrEqual(1);
      expect(ctx.filters[0].type).toMatch(/pass/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('schedules the sine chimes stirChimes gives, at currentTime + delay with the chime gain', () => {
    const { ctx, engine } = setup();
    engine.unmute();
    const before = ctx.oscillators.length;
    engine.update(1.2, false);
    const expected = stirChimes(1.2, false, seeded());
    const made = ctx.oscillators.slice(before);
    expect(expected.length).toBeGreaterThan(0);
    expect(made).toHaveLength(expected.length);
    expected.forEach((chime, i) => {
      const osc = made[i];
      expect(osc.type).toBe('sine');
      expect(osc.frequency.value).toBe(chime.hz);
      expect(osc.started).toHaveLength(1);
      expect(osc.started[0]).toBeCloseTo(5 + chime.delay, 9);
      const gain = osc.outputs[0] as FakeGain;
      expect(gain.gain.value).toBeCloseTo(chime.gain, 9);
      expect(reaches(osc, ctx.master())).toBe(true);
    });
  });

  it('schedules at most one batch per chimeSpreadSeconds of context time', () => {
    const { ctx, engine } = setup();
    engine.unmute();
    engine.update(1.2, false);
    const first = ctx.oscillators.length;
    ctx.currentTime += SOUND_SETTINGS.chimeSpreadSeconds / 2;
    engine.update(1.2, false);
    expect(ctx.oscillators.length).toBe(first);
    ctx.currentTime += SOUND_SETTINGS.chimeSpreadSeconds;
    engine.update(1.2, false);
    expect(ctx.oscillators.length).toBeGreaterThan(first);
  });

  it('schedules no chimes when never unmuted, muted, calm or paused, and a pause keeps the bed playing', () => {
    const idle = setup();
    idle.engine.update(1.5, false);
    expect(idle.ctx.oscillators).toHaveLength(0);

    const { ctx, engine } = setup();
    engine.unmute();
    const base = ctx.oscillators.length;
    engine.update(0, false);
    ctx.currentTime += 10;
    engine.update(1.5, true);
    expect(ctx.oscillators.length).toBe(base);
    expect(ctx.sources.every((s) => s.stopped === 0)).toBe(true);
    expect(ctx.master().gain.ramps.at(-1)?.v).toBe(masterGain(true).target);

    ctx.currentTime += 10;
    engine.mute();
    ctx.currentTime += 10;
    engine.update(1.5, false);
    expect(ctx.oscillators.length).toBe(base);
  });

  it('stays muted without throwing when the context cannot be created', () => {
    const createContext = vi.fn((): SoundContext => {
      throw new Error('no audio');
    });
    const engine = createSoundEngine({ createContext, random: seeded() });
    expect(() => engine.unmute()).not.toThrow();
    expect(engine.unmuted).toBe(false);
    expect(() => engine.update(1.5, false)).not.toThrow();
    expect(() => engine.mute()).not.toThrow();
    expect(engine.unmuted).toBe(false);
  });

  it('sounds the same whatever the day: the API takes no day or date', () => {
    const { engine } = setup();
    expect(Object.keys(engine).sort()).toEqual(['mute', 'unmute', 'unmuted', 'update']);
    expect(engine.update.length).toBe(2);
    expect(engine.unmute.length).toBe(0);
  });
});
