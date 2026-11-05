// XMAS-131 "Wallpaper Engine build": the page's side of Wallpaper Engine's
// property listener. The engine calls it on load with every user property, then
// with only the ones that changed, and calls setPaused when the wallpaper is
// covered or shown again. Sound is on only while the user wants it and the
// engine is not paused; movement off pauses the scene, a pause from the engine
// pauses it too.
export interface WallpaperTargets {
  sound: { unmute(): void; mute(): void };
  scene: { setPaused(paused: boolean): void };
  loop: { setFrameCap(fps: number): void };
}
export interface WallpaperListener {
  applyUserProperties(properties: Record<string, { value?: unknown } | undefined>): void;
  applyGeneralProperties(properties: { fps?: unknown }): void;
  setPaused(paused: boolean): void;
}

export function createWallpaperListener(targets: WallpaperTargets): WallpaperListener {
  let wantSound = false;
  let wantMovement = true;
  let enginePaused = false;
  let soundOn = false;
  let scenePaused = false;

  // Only a change reaches the sound engine: a repeated unmute would be harmless, but the scene's pause drops keys and drags.
  function syncSound(): void {
    const on = wantSound && !enginePaused;
    if (on === soundOn) return;
    soundOn = on;
    if (on) targets.sound.unmute();
    else targets.sound.mute();
  }

  function syncScene(): void {
    const paused = enginePaused || !wantMovement;
    if (paused === scenePaused) return;
    scenePaused = paused;
    targets.scene.setPaused(paused);
  }

  return {
    applyUserProperties(properties): void {
      const sound = properties['sound']?.value;
      if (typeof sound === 'boolean') wantSound = sound;
      const movement = properties['movement']?.value;
      if (typeof movement === 'boolean') wantMovement = movement;
      syncSound();
      syncScene();
    },
    applyGeneralProperties(properties): void {
      const fps = properties.fps;
      if (typeof fps !== 'number' || !Number.isFinite(fps) || fps < 0) return;
      // A positive cap below half a frame a second rounds to 0, which would lift the cap; keep it at 1.
      targets.loop.setFrameCap(fps === 0 ? 0 : Math.max(1, Math.round(fps)));
    },
    setPaused(paused: boolean): void {
      enginePaused = paused;
      syncSound();
      syncScene();
    },
  };
}
