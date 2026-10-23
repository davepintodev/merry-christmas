// XMAS-33 "The ?perf readout": which version of the scene runs. Until the
// lighter version exists it is always the full scene; setVersionSource() is
// the seam that ticket fills, and it is read afresh every time.
import { afterEach, describe, expect, it } from 'vitest';
import { currentVersion, setVersionSource, type VersionName } from './version.ts';

afterEach(() => {
  setVersionSource(() => 'full scene');
});

describe('currentVersion', () => {
  it('is the full scene by default', () => {
    expect(currentVersion()).toBe('full scene');
  });

  it('reads an installed source', () => {
    setVersionSource(() => 'lighter version');
    expect(currentVersion()).toBe('lighter version');
  });

  it('asks the source on every call, so a switch mid-visit shows at once', () => {
    let now: VersionName = 'full scene';
    let calls = 0;
    setVersionSource(() => {
      calls++;
      return now;
    });
    expect(currentVersion()).toBe('full scene');
    now = 'every second frame';
    expect(currentVersion()).toBe('every second frame');
    now = 'lighter version';
    expect(currentVersion()).toBe('lighter version');
    expect(calls).toBe(3);
  });

  it('a later source replaces an earlier one', () => {
    setVersionSource(() => 'lighter version');
    setVersionSource(() => 'every second frame');
    expect(currentVersion()).toBe('every second frame');
  });

});
