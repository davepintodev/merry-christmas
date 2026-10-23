// XMAS-79 "Smooth between steps: turn, lean and Santa": the scene steps 60 times
// a second but frames come at any rate, so draw shows the pose partway between
// the last two steps. makePoseTrack remembers those two poses and blend(f)
// gives the one between; smoothTime(steps, f) is the same for Santa's time.
import { STEP_MS } from './steps.ts';

/** The globe's pose: how far it has turned, and how far it leans, in radians. */
export interface Pose {
  turn: number;
  lean: number;
}

export interface PoseTrack {
  /** Records the pose a step leaves; the one before becomes the previous pose. */
  push(pose: Pose): void;
  /** The pose `fraction` of the way from the previous pose to the latest, clamped to 0 to 1. */
  blend(fraction: number): Pose;
  /** The last pose pushed (the initial pose until the first push). */
  latest(): Pose;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function makePoseTrack(initial: Pose): PoseTrack {
  let previous: Pose = { turn: initial.turn, lean: initial.lean };
  let latest: Pose = { turn: initial.turn, lean: initial.lean };

  return {
    push(pose: Pose): void {
      previous = latest;
      latest = { turn: pose.turn, lean: pose.lean };
    },
    blend(fraction: number): Pose {
      const f = clamp01(fraction);
      return {
        turn: previous.turn + (latest.turn - previous.turn) * f,
        lean: previous.lean + (latest.lean - previous.lean) * f,
      };
    },
    latest(): Pose {
      return { turn: latest.turn, lean: latest.lean };
    },
  };
}

/**
 * Santa's time in milliseconds for a frame drawn `fraction` of the way from the
 * last step to the next: the previous step's time at 0, the latest step's at 1,
 * so it moves on smoothly between steps and is never before time zero.
 */
export function smoothTime(steps: number, fraction: number): number {
  return Math.max(0, steps - 1 + clamp01(fraction)) * STEP_MS;
}
