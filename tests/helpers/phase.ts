// Phase readings for tests.
import type { PhaseName, PhaseReading } from '../../src/shared/clock.ts';

/** A phase that is not blending: from and to are the same. */
export function steady(phase: PhaseName): PhaseReading {
  return { from: phase, to: phase, share: 0 };
}
