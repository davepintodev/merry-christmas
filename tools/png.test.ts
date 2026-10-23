// XMAS-26 "Art build step and the rough Font sheet": the small PNG reader and
// writer the art build uses. Fixtures are built here with node:zlib, not with
// the code under test, so a decoder bug cannot hide behind a matching encoder.
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from './png.ts';

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(Buffer.from(type, 'latin1'), 0);
  typeAndData.set(data, 4);
  out.set(typeAndData, 4);
  view.setUint32(8 + data.length, crc32(typeAndData) >>> 0);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

type FixtureOptions = {
  colourType?: 2 | 6;
  bitDepth?: number;
  interlace?: number;
  /** PNG filter type per row (0 none, 1 sub, 2 up, 3 average, 4 paeth); cycles. */
  filters?: number[];
  /** Split the compressed stream across this many IDAT chunks. */
  idatChunks?: number;
};

/** A PNG built by hand. `pixels` holds RGBA (colour type 6) or RGB (colour type 2) bytes. */
function makePng(width: number, height: number, pixels: Uint8Array, opts: FixtureOptions = {}): Uint8Array {
  const colourType = opts.colourType ?? 6;
  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const filters = opts.filters ?? [0];
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length] ?? 0;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = pixels[y * stride + i] ?? 0;
      const a = i >= bpp ? (pixels[y * stride + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (pixels[(y - 1) * stride + i] ?? 0) : 0;
      const c = y > 0 && i >= bpp ? (pixels[(y - 1) * stride + i - bpp] ?? 0) : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      raw[y * (stride + 1) + 1 + i] = (x - pred + 256) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = opts.bitDepth ?? 8;
  ihdr[9] = colourType;
  ihdr[12] = opts.interlace ?? 0;
  const z = new Uint8Array(deflateSync(raw));
  const n = Math.max(1, opts.idatChunks ?? 1);
  const size = Math.ceil(z.length / n);
  const idats: Uint8Array[] = [];
  for (let i = 0; i < n; i++) idats.push(chunk('IDAT', z.subarray(i * size, Math.min(z.length, (i + 1) * size))));
  return concat([SIGNATURE, chunk('IHDR', ihdr), ...idats, chunk('IEND', new Uint8Array())]);
}

/** Deterministic, varied RGBA bytes (alpha varies too). */
function pattern(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i++) out[i] = (i * 37 + 11 * Math.floor(i / 7)) & 0xff;
  return out;
}

describe('decodePng', () => {
  it('reads width, height and RGBA bytes of an unfiltered RGBA image', () => {
    const rgba = pattern(5, 3);
    const out = decodePng(makePng(5, 3, rgba));
    expect(out.width).toBe(5);
    expect(out.height).toBe(3);
    expect(Array.from(out.rgba)).toEqual(Array.from(rgba));
  });

  it.each([
    ['sub', [1]],
    ['up', [2]],
    ['average', [3]],
    ['paeth', [4]],
    ['all five filters, row by row', [0, 1, 2, 3, 4]],
  ])('undoes the %s row filter', (_label, filters) => {
    const rgba = pattern(6, 7);
    const out = decodePng(makePng(6, 7, rgba, { filters }));
    expect(Array.from(out.rgba)).toEqual(Array.from(rgba));
  });

  it('expands an RGB image to RGBA with alpha 255', () => {
    const rgb = Uint8Array.from([1, 2, 3, 250, 251, 252, 0, 0, 0, 9, 8, 7]);
    const out = decodePng(makePng(2, 2, rgb, { colourType: 2, filters: [4, 1] }));
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(Array.from(out.rgba)).toEqual([1, 2, 3, 255, 250, 251, 252, 255, 0, 0, 0, 255, 9, 8, 7, 255]);
  });

  it('joins image data split across several IDAT chunks', () => {
    const rgba = pattern(9, 9);
    const out = decodePng(makePng(9, 9, rgba, { idatChunks: 4, filters: [2, 4] }));
    expect(Array.from(out.rgba)).toEqual(Array.from(rgba));
  });

  it('reads a one-pixel image', () => {
    const out = decodePng(makePng(1, 1, Uint8Array.from([10, 20, 30, 40])));
    expect(out).toMatchObject({ width: 1, height: 1 });
    expect(Array.from(out.rgba)).toEqual([10, 20, 30, 40]);
  });

  it('throws on bytes that are not a PNG', () => {
    expect(() => decodePng(new TextEncoder().encode('GIF89a not a png at all'))).toThrow();
    expect(() => decodePng(new Uint8Array())).toThrow();
  });

  it('throws on a PNG cut short after the header', () => {
    const full = makePng(4, 4, pattern(4, 4));
    expect(() => decodePng(full.subarray(0, 40))).toThrow();
  });

  it('throws rather than returning wrong pixels for an interlaced image', () => {
    expect(() => decodePng(makePng(4, 4, pattern(4, 4), { interlace: 1 }))).toThrow();
  });

  it('throws rather than returning wrong pixels for a 16-bit image', () => {
    expect(() => decodePng(makePng(2, 2, new Uint8Array(32), { bitDepth: 16 }))).toThrow();
  });
});

describe('encodePng', () => {
  it('writes the PNG signature and an IHDR with the given size, 8-bit RGBA', () => {
    const bytes = encodePng(3, 2, pattern(3, 2));
    expect(Array.from(bytes.subarray(0, 8))).toEqual(Array.from(SIGNATURE));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(Buffer.from(bytes.subarray(12, 16)).toString('latin1')).toBe('IHDR');
    expect(view.getUint32(16)).toBe(3);
    expect(view.getUint32(20)).toBe(2);
    expect(bytes[24]).toBe(8);
    expect(bytes[25]).toBe(6);
    expect(Buffer.from(bytes.subarray(bytes.length - 8, bytes.length - 4)).toString('latin1')).toBe('IEND');
  });

  it('writes image data any zlib inflater can read back to the same pixels', () => {
    const rgba = pattern(4, 3);
    const bytes = encodePng(4, 3, rgba);
    // Walk the chunks independently of decodePng and undo filter type 0 only if used.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const idat: Uint8Array[] = [];
    for (let at = 8; at < bytes.length; ) {
      const len = view.getUint32(at);
      const type = Buffer.from(bytes.subarray(at + 4, at + 8)).toString('latin1');
      const typeAndData = bytes.subarray(at + 4, at + 8 + len);
      expect(view.getUint32(at + 8 + len), `CRC of ${type}`).toBe(crc32(typeAndData) >>> 0);
      if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + len));
      at += 12 + len;
    }
    const raw = new Uint8Array(inflateSync(concat(idat)));
    expect(raw.length).toBe(3 * (4 * 4 + 1));
  });

  it.each([
    [1, 1],
    [8, 4],
    [17, 3],
    [156, 5],
  ])('round-trips a %ix%i image through decodePng', (w, h) => {
    const rgba = pattern(w, h);
    const out = decodePng(encodePng(w, h, rgba));
    expect(out.width).toBe(w);
    expect(out.height).toBe(h);
    expect(Array.from(out.rgba)).toEqual(Array.from(rgba));
  });

  it('throws when the pixel buffer does not match width x height x 4', () => {
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow();
  });
});
