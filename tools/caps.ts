// XMAS-24 "Cap script: download caps checked after every build": pure cap
// logic. Classifies built files into caps, adds up Brotli sizes per cap,
// formats the table and picks out failures.
import path from 'node:path';

/** Bytes in a KB; the caps are written in these units. */
export const KB = 1024;

export type CapName = 'before-countdown' | 'globe-ready' | 'total' | 'preview';

export type CapSetting = { name: CapName; limitBytes: number };

export type FileSize = { file: string; bytes: number };

export type CapResult = { name: CapName; files: number; bytes: number; limitBytes: number; pass: boolean };

/** The caps, in the order they are reported. */
export const CAPS: readonly CapSetting[] = [
  { name: 'before-countdown', limitBytes: 50 * KB },
  { name: 'globe-ready', limitBytes: 300 * KB },
  { name: 'total', limitBytes: 500 * KB },
  { name: 'preview', limitBytes: 300 * KB },
];

/** The caps a built file counts towards. */
export function capsFor(file: string): CapName[] {
  const base = path.posix.basename(file);
  if (base.startsWith('preview') && base.endsWith('.png')) return ['preview'];
  // before-countdown is index.html alone: the countdown script and digits are
  // inlined there, so if that ever changes this rule has to change too.
  if (file === 'index.html') return ['before-countdown', 'globe-ready', 'total'];
  // _headers is a Cloudflare directive, not a download.
  if (file === '_headers') return [];
  // Everything else is served, so it counts conservatively.
  return ['globe-ready', 'total'];
}

/** Files and bytes per cap, in cap order. */
export function evaluateCaps(sizes: readonly FileSize[], caps: readonly CapSetting[] = CAPS): CapResult[] {
  return caps.map((cap) => {
    const counted = sizes.filter((s) => capsFor(s.file).includes(cap.name));
    const bytes = counted.reduce((sum, s) => sum + s.bytes, 0);
    return { name: cap.name, files: counted.length, bytes, limitBytes: cap.limitBytes, pass: bytes <= cap.limitBytes };
  });
}

/** Caps that were passed, in cap order. */
export function failures(results: readonly CapResult[]): CapResult[] {
  return results.filter((r) => !r.pass);
}

const COLUMNS = ['cap', 'files', 'bytes', 'limit', 'result'] as const;

/** A plain-text table; byte counts are plain integers. */
export function formatTable(results: readonly CapResult[]): string {
  const rows = results.map((r) => [r.name, String(r.files), String(r.bytes), String(r.limitBytes), r.pass ? 'pass' : 'FAIL']);
  const widths = COLUMNS.map((column, i) => Math.max(column.length, ...rows.map((row) => row[i]?.length ?? 0)));
  const line = (cells: readonly string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join('  ').trimEnd();
  return [COLUMNS, ...rows].map(line).join('\n');
}
