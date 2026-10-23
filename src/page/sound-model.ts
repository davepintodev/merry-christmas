// XMAS-46a: the pure sound model. All the sound's settings sit in SOUND_SETTINGS; masterGain
// gives the fade for a mute or an unmute, and stirChimes gives the chimes for this moment. No Web
// Audio, no DOM, no clock and no Math.random: the caller owns the random source, so the same
// source gives the same chimes.

/** The sound's settings. The levels, notes and stir mapping are working values, tuned in XMAS-49. */
export const SOUND_SETTINGS = {
  /** Level of the wind noise bed, as a gain under the master gain. */
  windLevel: 0.12,
  /** Level of the faint chime layer that loops under the wind, as a gain under the master gain. */
  chimeLayerLevel: 0.1,
  /** The stir chime notes in Hz, all above zero. */
  chimeNotes: [523.25, 587.33, 659.25, 783.99, 880] as readonly number[],
  /** Seconds the master gain takes to fade in on an unmute. */
  fadeInSeconds: 1,
  /** Seconds the master gain takes to fade out on a mute. */
  fadeOutSeconds: 0.3,
  /** A stir at or under this is calm, and gives no chimes. */
  calmStir: 0.1,
  /** The top of the stir range: a stir above it counts as this. */
  maxStir: 1.6,
  /** The most chimes one moment can give. */
  maxChimes: 4,
  /** The loudest a single chime can be, as a gain. */
  maxChimeGain: 0.25,
  /** Seconds over which one moment's chimes are spread: each starts at a random delay inside it. */
  chimeSpreadSeconds: 0.8,
};

/** The master gain to ramp to, and the seconds the ramp takes. */
export interface MasterGain {
  target: number;
  seconds: number;
}

/** One stir chime: its note in Hz, its gain and the delay in seconds before it starts. */
export interface Chime {
  hz: number;
  gain: number;
  delay: number;
}

/** The master gain for an unmute (the full level over the fade in) or a mute (silence over the fade out). */
export function masterGain(unmuted: boolean): MasterGain {
  return unmuted
    ? { target: 1, seconds: SOUND_SETTINGS.fadeInSeconds }
    : { target: 0, seconds: SOUND_SETTINGS.fadeOutSeconds };
}

/**
 * The chimes for this moment. A paused scene gives none, and so does a calm stir, a NaN stir,
 * a negative one or -Infinity. A stronger stir gives more chimes, each louder, up to the caps.
 * `random` returns numbers in [0, 1); the same source gives the same chimes.
 */
export function stirChimes(stir: number, paused: boolean, random: () => number): Chime[] {
  // NaN fails every comparison, so the bad stirs fall into the calm case with the rest.
  if (paused || !(stir > SOUND_SETTINGS.calmStir)) return [];
  const { calmStir, maxStir, maxChimes, maxChimeGain, chimeNotes, chimeSpreadSeconds } = SOUND_SETTINGS;
  // How far the stir runs from calm (0) to the top of its range (1).
  const strength = (Math.min(stir, maxStir) - calmStir) / (maxStir - calmStir);
  const count = Math.ceil(strength * maxChimes);
  const gain = strength * maxChimeGain;
  const chimes: Chime[] = [];
  for (let i = 0; i < count; i++) {
    const note = chimeNotes[Math.min(chimeNotes.length - 1, Math.floor(random() * chimeNotes.length))];
    chimes.push({ hz: note, gain, delay: random() * chimeSpreadSeconds });
  }
  return chimes;
}
