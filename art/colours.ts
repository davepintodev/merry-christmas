import type { PhaseName } from '../src/shared/clock.ts';

/** Named colours the code uses; every one also sits in the master list. */
export const colours = {
  midnight: '#0b1026',
  snow: '#ffffff',
} as const;

// XMAS-26: the master colour list every sheet is drawn with. Colour number n
// is masterColours[n - 1] and 0 is transparent, so the list holds at most 255
// entries of one byte each. Started from the theme colours of the
// visual-direction prototype (prototype/visual-direction/variant-b.js), with
// the midnight background the sketch misses added at the end.
export const masterColours: readonly string[] = [
  '#1a1433', '#06141f', '#221a47', '#0a2230', '#2b225c', '#0f3242', '#372b70', '#154454',
  '#463682', '#1d5866', '#d9d2ff', '#d2f4ff', '#1d3350', '#0c2a33', '#16283f', '#08202a',
  '#aab6e6', '#a3cfd8', '#dfe6ff', '#e2f6f8', '#8f8ad0', '#6fa9b8', '#b9c3ee', '#bfe3ea',
  '#98a4dc', '#7fb3bf', '#9fd8ff', '#9fe8e0', '#7f8ac8', '#c3cef2', '#bfe0e6', '#2a1a4a',
  '#5a2a6a', '#a03f78', '#e0637a', '#ffa07a', '#ffe9d0', '#3a1f4a', '#2a1638', '#e8b4c8',
  '#ffe9ee', '#f0c0d8', '#ffd9e6', '#d49ab8', '#7d2a2e', '#5a1f3a', '#ff8c7a', '#ffd9c8',
  '#b07a9a', '#f0cfe0', '#07170f', '#0b2418', '#103322', '#16432c', '#1d5437', '#f6e7b0',
  '#0a2417', '#071a11', '#b8d4c0', '#eef7ee', '#7fae90', '#cfe6d4', '#8fb79c', '#cfe2d6',
  '#7fb6e6', '#97c6ee', '#b0d6f4', '#c9e4f9', '#e2f1fd', '#ffffff', '#3d6a8a', '#2f5878',
  '#c4d8f0', '#d6e6f8', '#9fb8dc', '#1d4f7a', '#ffe08a', '#c8102e', '#1f6f5c', '#5f86b0',
  '#fff3b0', '#aebcf0', '#3a0d2e', '#5a1440', '#7a1d52', '#9c2a66', '#bf3d7c', '#ffd9ec',
  '#4a1238', '#380d2a', '#f0b8d4', '#fff0f6', '#f08cc0', '#ffd0e6', '#d98cb4', '#9ff0d8',
  '#c06a98', '#f4cfe0', '#0b1026',
];

// XMAS-27: the sky and ink the countdown draws with, per phase. Every colour
// is a master colour, so the art pass can redraw a phase without code changes.
// Dawn's colours are a stand-in from the prototype's purple bands until the
// art pass draws them; frosty-morning's sky is the palest band of its theme,
// the one the red ink reaches 4.5:1 against.
export const phaseColours: Record<PhaseName, { sky: string; ink: string }> = {
  dawn: { sky: '#2b225c', ink: '#ffe08a' },
  'frosty-morning': { sky: '#e2f1fd', ink: '#c8102e' },
  sunset: { sky: '#2a1a4a', ink: '#ffe08a' },
  'purple-night': { sky: '#1a1433', ink: '#ffe08a' },
};

// XMAS-28: the per-phase overrides the art pass redraws scene colours with,
// taken from the visual-direction prototype's themes (hex entries only). A
// colour the house, pines, snowman, presents, base or Santa is drawn with is
// never overridden, so those objects look the same in every phase. Purple
// night overrides nothing; dawn's stand-in is the plain palette.
export const phaseOverrides: Record<'frosty-morning' | 'sunset' | 'purple-night', Record<string, string>> = {
  'frosty-morning': {
    '#221a47': '#97c6ee',
    '#2b225c': '#b0d6f4',
    '#372b70': '#c9e4f9',
    '#463682': '#e2f1fd',
    '#d9d2ff': '#ffffff',
    '#1d3350': '#3d6a8a',
    '#16283f': '#2f5878',
    '#aab6e6': '#c4d8f0',
    '#dfe6ff': '#ffffff',
    '#8f8ad0': '#ffffff',
    '#b9c3ee': '#d6e6f8',
    '#98a4dc': '#9fb8dc',
    '#9fd8ff': '#1d4f7a',
    '#ff8c7a': '#1f6f5c',
    '#7f8ac8': '#5f86b0',
    '#aebcf0': '#ffffff',
  },
  sunset: {
    '#221a47': '#5a2a6a',
    '#2b225c': '#a03f78',
    '#372b70': '#e0637a',
    '#463682': '#ffa07a',
    '#d9d2ff': '#ffe9d0',
    '#1d3350': '#3a1f4a',
    '#16283f': '#2a1638',
    '#aab6e6': '#e8b4c8',
    '#dfe6ff': '#ffe9ee',
    '#8f8ad0': '#f0c0d8',
    '#b9c3ee': '#ffd9e6',
    '#98a4dc': '#d49ab8',
    '#9fd8ff': '#ffe9d0',
    '#ff8c7a': '#ffd9c8',
    '#7f8ac8': '#b07a9a',
  },
  'purple-night': {},
};
