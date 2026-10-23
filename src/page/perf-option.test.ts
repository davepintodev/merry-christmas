// XMAS-33 "The ?perf readout": the hidden `?perf` option (spec 3.9). Only a
// query parameter named exactly `perf` turns the readout on; a value, its
// place among other options, or a name that merely contains "perf" does not
// change that.
import { describe, expect, it } from 'vitest';
import { wantsPerf } from './perf-option.ts';

describe('wantsPerf', () => {
  it.each(['?perf', '?perf=1', '?perf=', '?now=2026-12-24T23:59:50&perf', '?perf&now=2026-12-25T10:00:00', '?a=1&perf=yes&b=2'])(
    'is on for %s',
    (search) => {
      expect(wantsPerf(search)).toBe(true);
    },
  );

  it.each(['', '?', '?now=2026-12-01T22:00:00', '?perfect', '?xperf', '?perf_', '?now=perf', '?a=perf&b=1', '#perf', '?per'])(
    'is off for %j',
    (search) => {
      expect(wantsPerf(search)).toBe(false);
    },
  );
});
