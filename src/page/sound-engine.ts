// XMAS-46b: the sound engine. Nothing audio exists until the first unmute(); then a wind bed and a
// faint chime layer loop under a master gain, and update(stir, paused) schedules the stir chimes
// that the pure model (46a) gives. Web Audio only: no file, no fetch, no day or date.
import { masterGain, SOUND_SETTINGS, stirChimes, type Chime } from './sound-model.ts';

export interface ParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  cancelScheduledValues(t: number): unknown;
}
export interface NodeLike {
  connect(destination: NodeLike): unknown;
}
export interface GainNodeLike extends NodeLike {
  gain: ParamLike;
}
export interface FilterNodeLike extends NodeLike {
  type: string;
  frequency: ParamLike;
}
export interface SourceNodeLike extends NodeLike {
  start(when?: number): void;
  stop?(when?: number): void;
}
export interface BufferSourceLike extends SourceNodeLike {
  buffer: unknown;
  loop: boolean;
}
export interface OscillatorLike extends SourceNodeLike {
  type: string;
  frequency: ParamLike;
}
export interface SoundContext {
  currentTime: number;
  sampleRate: number;
  destination: NodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter(): FilterNodeLike;
  createBufferSource(): BufferSourceLike;
  createOscillator(): OscillatorLike;
  createBuffer(channels: number, length: number, sampleRate: number): { getChannelData(channel: number): Float32Array };
  resume(): Promise<void>;
}
export interface SoundEngine {
  unmute(): void;
  mute(): void;
  update(stir: number, paused: boolean): void;
  readonly unmuted: boolean;
}

/** The wind's low-pass cutoff in Hz: the gusts do most of the shaping, so this only takes off the top hiss. */
const WIND_CUTOFF_HZ = 700;
/** The rate, in Hz, the wind and chime buffers are baked at: cheap to make, and the browser resamples them on playback. */
const RENDER_RATE = 12000;
/** Seconds the wind loop lasts: every gust wave fits a whole number of cycles in it, so the loop closes without a seam. */
const WIND_LOOP_SECONDS = 47;
/** Seconds the chime layer loop lasts: not the wind's length, so the two drift and never lock in tempo. */
const CHIME_LOOP_SECONDS = 31;
/** Seconds the wind filters run over the loop's tail before the loop starts, so the seam carries no click. */
const WIND_WARM_SECONDS = 1;
/** Samples between the points where the gust envelope is worked out: the envelope is straight between them, and it is slow. */
const ENVELOPE_CELL_SAMPLES = 64;
/** The dark part of the wind: noise low-passed at this many Hz, heard when the wind is quiet and far away. */
const WIND_DARK_HZ = 250;
/** The bright part of the wind: noise with everything under this many Hz taken out, heard when it gusts close. */
const WIND_BRIGHT_HZ = 1800;
/** The quietest gust as a share of the peak, so a lull is near silent but never gone. */
const WIND_FLOOR = 0.04;
/** How far a lull drops the wind: 0.9 takes it down to a tenth of the gust. */
const LULL_DEPTH = 0.9;
/** The slow gust waves: cycles per wind loop (so a 47 s loop holds 3 cycles of a 15.7 s wave) and each wave's weight. */
const GUSTS = [
  { cycles: 3, weight: 1 },
  { cycles: 4, weight: 0.8 },
  { cycles: 5, weight: 0.6 },
  { cycles: 7, weight: 0.5 },
  { cycles: 9, weight: 0.35 },
  { cycles: 11, weight: 0.25 },
];
const GUST_TOTAL = GUSTS.reduce((sum, gust) => sum + gust.weight, 0);
/** Seconds one stir chime takes to die away. */
const CHIME_SECONDS = 1.5;
/** Seconds one note of the chime layer rings: long and soft, so each note dies away gently. */
const LAYER_NOTE_SECONDS = 3;

/** The graph made by the first unmute: the master gain and the context it lives in. */
interface Live {
  context: SoundContext;
  master: GainNodeLike;
}

/** A fixed LCG in [0, 1): the same seed gives the same sound on every load, and Math.random is not used. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Clamps a number into [0, 1]. */
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** The smoothing factor of a one-pole low-pass at `hz`, for samples at `sampleRate`. */
function onePoleAlpha(sampleRate: number, hz: number): number {
  return 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
}

/** Scales the samples so the loudest is 1 in size, never more: the gain alone then sets the level and nothing clips. */
function normalise(data: Float32Array): void {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak === 0) return;
  for (let i = 0; i < data.length; i++) data[i] /= peak;
}

/**
 * The wind: a long baked buffer of gusts. White noise is shaped sample by sample: a gust envelope,
 * built from slow waves that never repeat in step, swells and falls from near-silent (far away) to
 * clearly present (close), with occasional deep lulls. The gust also sets the brightness: a dark
 * low-passed bed when the wind is quiet, a bright band when it blows.
 */
function windNoise(context: SoundContext): { getChannelData(channel: number): Float32Array } {
  const length = Math.round(RENDER_RATE * WIND_LOOP_SECONDS);
  const buffer = context.createBuffer(1, length, RENDER_RATE);
  const data = buffer.getChannelData(0);
  const random = seededRandom(1);
  // The white noise goes in first; the filter pass below reads each sample before it overwrites it.
  for (let i = 0; i < length; i++) data[i] = random() * 2 - 1;
  const phases = GUSTS.map(() => random() * 2 * Math.PI);
  const lullPhases = [random() * 2 * Math.PI, random() * 2 * Math.PI];
  // The gust and the level are worked out at a few points, not at every sample. Point p sits at sample
  // p * length / cells, so the last point is the loop's end and its waves match the loop's start.
  const cells = Math.ceil(length / ENVELOPE_CELL_SAMPLES);
  const gusts = new Float64Array(cells + 1);
  const levels = new Float64Array(cells + 1);
  for (let p = 0; p <= cells; p++) {
    const t = (p * length) / cells / RENDER_RATE;
    let waves = 0;
    for (let k = 0; k < GUSTS.length; k++) {
      waves += GUSTS[k].weight * Math.sin((2 * Math.PI * GUSTS[k].cycles * t) / WIND_LOOP_SECONDS + phases[k]);
    }
    // 0 is the quietest the gusts go, 1 the fullest; the waves sit mostly near the middle, so they are stretched out.
    const gust = clamp01(0.5 + (1.5 * waves) / GUST_TOTAL);
    // A lull is where the 47 s wave and the 23.5 s wave both run high at once: rare, and deep.
    const lullWaves =
      Math.sin((2 * Math.PI * t) / WIND_LOOP_SECONDS + lullPhases[0]) +
      Math.sin((4 * Math.PI * t) / WIND_LOOP_SECONDS + lullPhases[1]);
    const lull = clamp01((lullWaves - 1.3) / 0.7);
    gusts[p] = gust;
    levels[p] = (WIND_FLOOR + (1 - WIND_FLOOR) * gust * gust) * (1 - LULL_DEPTH * lull);
  }
  const darkAlpha = onePoleAlpha(RENDER_RATE, WIND_DARK_HZ);
  const brightAlpha = onePoleAlpha(RENDER_RATE, WIND_BRIGHT_HZ);
  let dark = 0;
  let low = 0;
  // The filters start from silence, so a warm-up over the tail leaves them where the loop's end leaves them.
  const warm = Math.min(length, Math.round(RENDER_RATE * WIND_WARM_SECONDS));
  for (let i = length - warm; i < length; i++) {
    dark += darkAlpha * (data[i] - dark);
    low += brightAlpha * (data[i] - low);
  }
  for (let i = 0; i < length; i++) {
    const white = data[i];
    dark += darkAlpha * (white - dark);
    low += brightAlpha * (white - low);
    const cell = (i * cells) / length;
    const p = Math.floor(cell);
    const f = cell - p;
    const gust = gusts[p] + (gusts[p + 1] - gusts[p]) * f;
    const level = levels[p] + (levels[p + 1] - levels[p]) * f;
    data[i] = level * (dark * (1 - gust) + (white - low) * gust);
  }
  normalise(data);
  return buffer;
}

/**
 * Adds one bell note into the chime layer's loop, from `at` seconds in: a tone with a slight second
 * partial, wrapping at the loop's end. The sines are walked by rotation, one multiply-add a sample.
 */
function addNote(data: Float32Array, at: number, hz: number, amp: number): void {
  const start = Math.floor(at * RENDER_RATE);
  const count = Math.floor(RENDER_RATE * LAYER_NOTE_SECONDS);
  const turn = (2 * Math.PI * hz) / RENDER_RATE;
  const cos1 = Math.cos(turn);
  const sin1 = Math.sin(turn);
  const cos2 = Math.cos(2 * turn);
  const sin2 = Math.sin(2 * turn);
  const decay1 = Math.exp(-2 / RENDER_RATE);
  const decay2 = Math.exp(-3 / RENDER_RATE);
  // (re1, im1) is the phasor at the note's frequency and (re2, im2) at twice it; both start at angle 0.
  let re1 = 1;
  let im1 = 0;
  let re2 = 1;
  let im2 = 0;
  let env1 = 1;
  let env2 = 1;
  for (let n = 0; n < count; n++) {
    const i = (start + n) % data.length;
    data[i] += amp * (im1 * env1 + 0.25 * im2 * env2);
    const nextRe1 = re1 * cos1 - im1 * sin1;
    im1 = im1 * cos1 + re1 * sin1;
    re1 = nextRe1;
    const nextRe2 = re2 * cos2 - im2 * sin2;
    im2 = im2 * cos2 + re2 * sin2;
    re2 = nextRe2;
    env1 *= decay1;
    env2 *= decay2;
  }
}

/**
 * The faint chime layer: a phrase, not a pattern. Runs of one to four notes with uneven gaps, then a
 * long rest, from the chime notes with some an octave down or up and varied loudness. It is drawn
 * from a fixed source and loops every 31 s, so it never lines up with the 47 s wind.
 */
function chimeLayer(context: SoundContext): { getChannelData(channel: number): Float32Array } {
  const length = Math.round(RENDER_RATE * CHIME_LOOP_SECONDS);
  const buffer = context.createBuffer(1, length, RENDER_RATE);
  const data = buffer.getChannelData(0);
  const random = seededRandom(2);
  const { chimeNotes } = SOUND_SETTINGS;
  let at = 0;
  while (at < CHIME_LOOP_SECONDS) {
    const run = 1 + Math.floor(random() * 4);
    for (let k = 0; k < run && at < CHIME_LOOP_SECONDS; k++) {
      const base = chimeNotes[Math.floor(random() * chimeNotes.length)];
      const roll = random();
      // An octave down for a fifth of the notes, and an octave up for the lower ones only, so none rings above about 1.3 kHz.
      const hz = roll < 0.2 ? base / 2 : roll < 0.4 && base < 700 ? base * 2 : base;
      addNote(data, at, hz, 0.4 + 0.6 * random());
      at += 0.6 + 1.4 * random();
    }
    at += 3 + 5 * random();
  }
  normalise(data);
  return buffer;
}

/** Starts a looping buffer. It joins `started`, so a failed build can stop it. */
function startLoop(
  context: SoundContext,
  buffer: { getChannelData(channel: number): Float32Array },
  started: SourceNodeLike[],
): BufferSourceLike {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  started.push(source);
  return source;
}

/** Builds the graph: the wind and the chime layer into the master gain, which reaches the destination last. */
function buildLive(context: SoundContext): Live {
  const started: SourceNodeLike[] = [];
  try {
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(0, now);

    const windGain = context.createGain();
    windGain.gain.setValueAtTime(SOUND_SETTINGS.windLevel, now);
    windGain.connect(master);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(WIND_CUTOFF_HZ, now);
    filter.connect(windGain);
    startLoop(context, windNoise(context), started).connect(filter);

    const layerGain = context.createGain();
    layerGain.gain.setValueAtTime(SOUND_SETTINGS.chimeLayerLevel, now);
    layerGain.connect(master);
    startLoop(context, chimeLayer(context), started).connect(layerGain);

    master.connect(context.destination);
    return { context, master };
  } catch (err) {
    // A half-built graph must not sound: stop the loops already started.
    for (const source of started) source.stop?.();
    throw err;
  }
}

/** Ramps the master gain to the target for `unmuted`, from wherever it is now. */
function fade(live: Live, unmuted: boolean): void {
  const { target, seconds } = masterGain(unmuted);
  const { context, master } = live;
  const now = context.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(target, now + seconds);
}

/** Schedules one stir chime: a sine at its note, which dies away into the master gain. */
function playChime(live: Live, chime: Chime, now: number): void {
  const { context, master } = live;
  const start = now + chime.delay;
  const osc = context.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(chime.hz, start);
  const gain = context.createGain();
  gain.gain.setValueAtTime(chime.gain, start);
  gain.gain.linearRampToValueAtTime(0, start + CHIME_SECONDS);
  osc.connect(gain);
  gain.connect(master);
  osc.start(start);
  osc.stop?.(start + CHIME_SECONDS);
}

/**
 * The sound engine. The context is made on the first unmute and reused after; a context or graph
 * that cannot be made leaves the engine muted, without throwing. `random` is used only by stirChimes.
 */
export function createSoundEngine(options: { createContext: () => SoundContext; random: () => number }): SoundEngine {
  let context: SoundContext | null = null;
  let live: Live | null = null;
  let unmuted = false;
  // Context time before which no new chime batch is scheduled.
  let nextBatchAt = -Infinity;

  /** The graph, made on the first call. Null when the context or the graph cannot be made. */
  function ensureLive(): Live | null {
    try {
      if (!context) context = options.createContext();
      if (!live) live = buildLive(context);
      return live;
    } catch {
      return null;
    }
  }

  return {
    unmute(): void {
      if (unmuted) return;
      const audio = ensureLive();
      if (!audio) return;
      // A resume that fails leaves the sound silent; the engine still counts as unmuted.
      void audio.context.resume().catch(() => undefined);
      unmuted = true;
      fade(audio, true);
    },
    mute(): void {
      if (!unmuted || !live) return;
      unmuted = false;
      fade(live, false);
    },
    update(stir: number, paused: boolean): void {
      if (!unmuted || !live) return;
      const now = live.context.currentTime;
      if (now < nextBatchAt) return;
      const chimes = stirChimes(stir, paused, options.random);
      if (chimes.length === 0) return;
      nextBatchAt = now + SOUND_SETTINGS.chimeSpreadSeconds;
      for (const chime of chimes) playChime(live, chime, now);
    },
    get unmuted(): boolean {
      return unmuted;
    },
  };
}
