// XMAS-131 "Wallpaper Engine build": the build-time flag. Every build sets it with `define`: true only in the
// wallpaper build (tools/build-wallpaper.ts), false in the site build, the dev server and the unit tests.
declare const __XMAS_WALLPAPER__: boolean;
