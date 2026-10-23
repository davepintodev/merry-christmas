// XMAS-30 "Contrast test and a stand-in colour table for Dawn": the countdown's
// contrast surface (spec 6.6); the maths itself is in contrast-helper.ts, so
// the colours module and the tests share one definition.
export { contrast, MIN_CONTRAST_RATIO, relativeLuminance } from './contrast-helper.ts';
