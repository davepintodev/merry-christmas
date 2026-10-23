// XMAS-33 "The ?perf readout": the hidden `?perf` option (spec 3.9). Only a
// query parameter named exactly `perf` turns the readout on; a value, its
// place among other options, or a name that merely contains "perf" does not
// change that.

/** True when the page address's query string carries a parameter named `perf`. */
export function wantsPerf(search: string): boolean {
  return new URLSearchParams(search).has('perf');
}
