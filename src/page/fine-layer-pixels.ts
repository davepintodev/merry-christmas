// The pixel buffers and colour words the fine layer and Santa's sprite share, kept apart so
// that neither module imports the other.

/** An image of one size for a layer, and a 32-bit view of its bytes; kept while the size holds. */
export interface Pixels {
  image: ImageData;
  words: Uint32Array;
}

/** A colour number (0xRRGGBB) as the little-endian word of an opaque RGBA pixel. */
export function opaqueWord(colour: number): number {
  return 0xff000000 | ((colour & 0xff) << 16) | (colour & 0xff00) | ((colour >> 16) & 0xff);
}
