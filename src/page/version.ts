// XMAS-33 "The ?perf readout": which version of the scene runs. Until the
// lighter version exists it is always the full scene; setVersionSource() is
// the seam that ticket fills, and it is read afresh every time.

export type VersionName = 'full scene' | 'lighter version' | 'every second frame';

let source: () => VersionName = () => 'full scene';

/** Replaces where currentVersion() reads from; a later source replaces an earlier one. */
export function setVersionSource(next: () => VersionName): void {
  source = next;
}

/** The version running now. */
export function currentVersion(): VersionName {
  return source();
}
