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
