// XMAS-131 "Wallpaper Engine build": the page's side of Wallpaper Engine's
// property listener. The tests call it the way the engine does: all user
// properties once on load, then only the changed ones.
import { describe, expect, it } from 'vitest';
import { createWallpaperListener, type WallpaperListener } from './wallpaper.ts';

class FakeSound {
  unmuted = false;
  calls: string[] = [];
  unmute(): void {
    this.unmuted = true;
    this.calls.push('unmute');
  }
  mute(): void {
    this.unmuted = false;
    this.calls.push('mute');
  }
}

function setup(): { listener: WallpaperListener; sound: FakeSound; paused: boolean[]; caps: number[] } {
  const sound = new FakeSound();
  const paused: boolean[] = [];
  const caps: number[] = [];
  const listener = createWallpaperListener({
    sound,
    scene: { setPaused: (p) => void paused.push(p) },
    loop: { setFrameCap: (fps) => void caps.push(fps) },
  });
  return { listener, sound, paused, caps };
}

describe('wallpaper user properties', () => {
  it('sound on unmutes and sound off mutes; a later update without it leaves it alone', () => {
    const { listener, sound } = setup();
    listener.applyUserProperties({ sound: { value: true }, movement: { value: true } });
    expect(sound.unmuted).toBe(true);
    listener.applyUserProperties({ movement: { value: true } });
    expect(sound.calls).toEqual(['unmute']);
    listener.applyUserProperties({ sound: { value: false } });
    expect(sound.unmuted).toBe(false);
  });

  it('movement off pauses the scene and on resumes it; a partial update touches only its keys', () => {
    const { listener, paused, sound } = setup();
    listener.applyUserProperties({ movement: { value: false } });
    listener.applyUserProperties({ movement: { value: true } });
    expect(paused).toEqual([true, false]);
    listener.applyUserProperties({ sound: { value: true } });
    expect(paused).toEqual([true, false]);
    expect(sound.calls).toEqual(['unmute']);
  });

  it('ignores values that are not booleans, and missing or undefined entries', () => {
    const { listener, sound, paused } = setup();
    listener.applyUserProperties({ sound: { value: 'true' }, movement: { value: 0 } });
    listener.applyUserProperties({ sound: {}, movement: undefined });
    expect(sound.calls).toEqual([]);
    expect(paused).toEqual([]);
  });
});

describe('wallpaper general properties', () => {
  it('passes a positive fps, rounded, as the frame cap; 0 lifts the cap', () => {
    const { listener, caps } = setup();
    listener.applyGeneralProperties({ fps: 30 });
    listener.applyGeneralProperties({ fps: 59.6 });
    listener.applyGeneralProperties({ fps: 0 });
    expect(caps).toEqual([30, 60, 0]);
  });

  it('leaves the cap alone when fps is missing or not a usable number', () => {
    const { listener, caps } = setup();
    for (const fps of [undefined, -5, Number.NaN, Number.POSITIVE_INFINITY, '30', null]) {
      listener.applyGeneralProperties({ fps });
    }
    listener.applyGeneralProperties({});
    expect(caps).toEqual([]);
  });
});

describe('wallpaper pause', () => {
  it('a pause from the engine mutes sound that was on and unmutes it on resume', () => {
    const { listener, sound } = setup();
    listener.applyUserProperties({ sound: { value: true } });
    listener.setPaused(true);
    expect(sound.unmuted).toBe(false);
    listener.setPaused(false);
    expect(sound.unmuted).toBe(true);
  });

  it('sound is off by default, and a pause and resume after the load never unmutes it', () => {
    const { listener, sound } = setup();
    listener.applyUserProperties({ movement: { value: true } });
    listener.setPaused(true);
    listener.setPaused(false);
    expect(sound.calls).toEqual([]);
  });

  it('sound turned off during a pause stays off after the resume', () => {
    const { listener, sound } = setup();
    listener.applyUserProperties({ sound: { value: true } });
    listener.setPaused(true);
    listener.applyUserProperties({ sound: { value: false } });
    listener.setPaused(false);
    expect(sound.unmuted).toBe(false);
  });
});
