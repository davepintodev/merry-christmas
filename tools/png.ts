// XMAS-26 "Art build step and the rough Font sheet": a tiny PNG reader and
// writer for the art build. 8-bit RGB and RGBA only, no interlacing; all five
// row filters on the way in, filter 0 on the way out. Compression is
// node:zlib, so the build needs no image library.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export interface PngImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(problem: string): never {
  throw new Error(`PNG: ${problem}`);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodes an 8-bit RGB or RGBA PNG to RGBA bytes; throws on anything else. */
export function decodePng(bytes: Uint8Array): PngImage {
  if (bytes.length < SIGNATURE.length) fail('not a PNG');
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) fail('not a PNG');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  let seenHeader = false;
  const idats: Uint8Array[] = [];

  for (let at = SIGNATURE.length; at < bytes.length; ) {
    if (at + 8 > bytes.length) fail('a chunk header runs past the end of the file');
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const start = at + 8;
    const end = start + length;
    if (end + 4 > bytes.length) fail(`${type} chunk runs past the end of the file`);
    if (type === 'IHDR') {
      if (length !== 13) fail('IHDR is not 13 bytes long');
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = bytes[start + 8];
      colourType = bytes[start + 9];
      interlace = bytes[start + 12];
      seenHeader = true;
    } else if (type === 'IDAT') {
      idats.push(bytes.subarray(start, end));
    } else if (type === 'IEND') {
      break;
    }
    at = end + 4;
  }

  if (!seenHeader) fail('no IHDR chunk');
  if (bitDepth !== 8) fail(`unsupported bit depth ${bitDepth}`);
  if (colourType !== 2 && colourType !== 6) fail(`unsupported colour type ${colourType}`);
  if (interlace !== 0) fail('interlaced images are not supported');

  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = new Uint8Array(inflateSync(concat(idats)));
  if (raw.length !== height * (stride + 1)) fail('the inflated data does not match the image size');

  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? pixels[y * stride + i - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      const byte = raw[line + i];
      let value: number;
      if (filter === 0) value = byte;
      else if (filter === 1) value = byte + left;
      else if (filter === 2) value = byte + up;
      else if (filter === 3) value = byte + ((left + up) >> 1);
      else if (filter === 4) value = byte + paeth(left, up, upLeft);
      else return fail(`unknown row filter ${filter}`);
      pixels[y * stride + i] = value & 0xff;
    }
  }

  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * 3];
    rgba[i * 4 + 1] = pixels[i * 3 + 1];
    rgba[i * 4 + 2] = pixels[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)) >>> 0);
  return out;
}

/** Encodes 8-bit RGBA bytes as a PNG with filter-0 rows. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    fail(`bad image size ${width}x${height}`);
  }
  if (rgba.length !== width * height * 4) fail('the pixel data does not match the image size');

  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ]);
}
