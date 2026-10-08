// XMAS-24 "Cap script: download caps checked after every build": pure cap
// logic. Classifies dist files into caps, adds up Brotli sizes per cap,
// formats the table and picks out failures, using made-up file sets.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPS, KB, capsFor, evaluateCaps, failures, formatTable, type CapResult, type CapSetting, type FileSize } from './caps.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function result(results: readonly CapResult[], name: string): CapResult {
  const r = results.find((x) => x.name === name);
  if (!r) throw new Error(`no result for cap ${name}`);
  return r;
}

describe('cap settings', () => {
  it('uses 1024 bytes per KB', () => {
    expect(KB).toBe(1024);
  });

  it('lists the four caps in order with their limits', () => {
    expect(CAPS.map((c) => [c.name, c.limitBytes])).toEqual([
      ['before-countdown', 50 * 1024],
      ['globe-ready', 300 * 1024],
      ['total', 500 * 1024],
      ['preview', 300 * 1024],
    ]);
  });
});

describe('capsFor', () => {
  it('counts index.html towards before-countdown, globe-ready and total', () => {
    expect(capsFor('index.html')).toEqual(['before-countdown', 'globe-ready', 'total']);
  });

  it('counts a hashed scene file towards globe-ready and total', () => {
    expect(capsFor('assets/scene-abc123.js')).toEqual(['globe-ready', 'total']);
  });

  it('counts a fingerprinted preview image towards preview only, not total', () => {
    expect(capsFor('preview-abc123.png')).toEqual(['preview']);
  });

  it('counts other assets/ files conservatively towards globe-ready and total', () => {
    expect(capsFor('assets/chunk-ff00.js')).toEqual(['globe-ready', 'total']);
    expect(capsFor('assets/style-1a2b.css')).toEqual(['globe-ready', 'total']);
  });

  it('counts _headers towards nothing', () => {
    expect(capsFor('_headers')).toEqual([]);
  });

  it('counts any other served file outside assets/ towards globe-ready and total', () => {
    expect(capsFor('favicon.ico')).toEqual(['globe-ready', 'total']);
    expect(capsFor('robots.txt')).toEqual(['globe-ready', 'total']);
    expect(capsFor('notes/index.html')).toEqual(['globe-ready', 'total']);
  });

  it('counts only _headers in the dist root as not served', () => {
    expect(capsFor('notes/_headers')).toEqual(['globe-ready', 'total']);
  });

  it('counts a non-png preview file as an ordinary served file', () => {
    expect(capsFor('preview-abc123.jpg')).toEqual(['globe-ready', 'total']);
  });

  it('counts a scene-named file outside assets/ as an ordinary served file', () => {
    expect(capsFor('scene-abc123.js')).toEqual(['globe-ready', 'total']);
  });

  it('adds an unknown served file into globe-ready and total', () => {
    const r = evaluateCaps([
      { file: 'index.html', bytes: 1_000 },
      { file: 'favicon.ico', bytes: 400 },
      { file: '_headers', bytes: 50 },
    ]);
    expect(result(r, 'before-countdown')).toMatchObject({ files: 1, bytes: 1_000 });
    expect(result(r, 'globe-ready')).toMatchObject({ files: 2, bytes: 1_400 });
    expect(result(r, 'total')).toMatchObject({ files: 2, bytes: 1_400 });
  });

  it('matches a nested file on its basename, not on a directory name', () => {
    expect(capsFor('assets/scene/chunk-1.js')).toEqual(['globe-ready', 'total']);
    expect(capsFor('assets/preview-x.png')).toEqual(['preview']);
  });
});

describe('evaluateCaps', () => {
  it('returns one zero result per cap, in cap order, for no files', () => {
    expect(evaluateCaps([])).toEqual(
      CAPS.map((c) => ({ name: c.name, files: 0, bytes: 0, limitBytes: c.limitBytes, pass: true })),
    );
  });

  it('adds up bytes and file counts per cap from a made-up file set', () => {
    const sizes: FileSize[] = [
      { file: 'index.html', bytes: 10_000 },
      { file: '_headers', bytes: 300 },
      { file: 'assets/scene-abc.js', bytes: 120_000 },
      { file: 'assets/chunk-1.js', bytes: 5_000 },
      { file: 'preview-abc.png', bytes: 90_000 },
    ];
    const r = evaluateCaps(sizes);
    expect(r.map((x) => x.name)).toEqual(['before-countdown', 'globe-ready', 'total', 'preview']);
    expect(result(r, 'before-countdown')).toMatchObject({ files: 1, bytes: 10_000, pass: true });
    expect(result(r, 'globe-ready')).toMatchObject({ files: 3, bytes: 135_000, pass: true });
    expect(result(r, 'total')).toMatchObject({ files: 3, bytes: 135_000, pass: true });
    expect(result(r, 'preview')).toMatchObject({ files: 1, bytes: 90_000, pass: true });
  });

  it('keeps the preview image out of the total', () => {
    const r = evaluateCaps([{ file: 'preview-x.png', bytes: 400 * KB }], CAPS);
    expect(result(r, 'total')).toMatchObject({ files: 0, bytes: 0, pass: true });
    expect(result(r, 'preview')).toMatchObject({ files: 1, bytes: 400 * KB, pass: false });
  });

  it('counts missing scene and preview files as zero', () => {
    const r = evaluateCaps([{ file: 'index.html', bytes: 2_000 }, { file: '_headers', bytes: 100 }]);
    expect(result(r, 'preview')).toMatchObject({ files: 0, bytes: 0, pass: true });
    expect(result(r, 'globe-ready')).toMatchObject({ files: 1, bytes: 2_000 });
  });

  it('passes a cap exactly at its limit', () => {
    const caps: CapSetting[] = [{ name: 'before-countdown', limitBytes: 100 }];
    const r = evaluateCaps([{ file: 'index.html', bytes: 100 }], caps);
    expect(r).toEqual([{ name: 'before-countdown', files: 1, bytes: 100, limitBytes: 100, pass: true }]);
  });

  it('fails a cap one byte over its limit', () => {
    const caps: CapSetting[] = [{ name: 'before-countdown', limitBytes: 100 }];
    const r = evaluateCaps([{ file: 'index.html', bytes: 101 }], caps);
    expect(r).toEqual([{ name: 'before-countdown', files: 1, bytes: 101, limitBytes: 100, pass: false }]);
  });

  it('fails a cap when files that each fit add up to more than the limit', () => {
    const caps: CapSetting[] = [
      { name: 'globe-ready', limitBytes: 1_000 },
      { name: 'total', limitBytes: 5_000 },
    ];
    const r = evaluateCaps(
      [
        { file: 'index.html', bytes: 600 },
        { file: 'assets/scene-a.js', bytes: 500 },
      ],
      caps,
    );
    expect(r).toEqual([
      { name: 'globe-ready', files: 2, bytes: 1_100, limitBytes: 1_000, pass: false },
      { name: 'total', files: 2, bytes: 1_100, limitBytes: 5_000, pass: true },
    ]);
  });

  it('uses injected caps instead of the defaults', () => {
    const caps: CapSetting[] = [{ name: 'total', limitBytes: 10 }];
    const r = evaluateCaps([{ file: 'index.html', bytes: 11 }], caps);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'total', limitBytes: 10, pass: false });
  });

  it('does not mutate its input', () => {
    const sizes: FileSize[] = [{ file: 'index.html', bytes: 1 }];
    const copy = structuredClone(sizes);
    evaluateCaps(sizes);
    expect(sizes).toEqual(copy);
  });
});

describe('failures', () => {
  it('returns only the failing results, in order', () => {
    const rs: CapResult[] = [
      { name: 'before-countdown', files: 1, bytes: 9, limitBytes: 5, pass: false },
      { name: 'globe-ready', files: 1, bytes: 1, limitBytes: 5, pass: true },
      { name: 'preview', files: 1, bytes: 9, limitBytes: 5, pass: false },
    ];
    expect(failures(rs).map((r) => r.name)).toEqual(['before-countdown', 'preview']);
  });

  it('returns nothing when every cap passes', () => {
    expect(failures(evaluateCaps([]))).toEqual([]);
  });
});

describe('formatTable', () => {
  const passing = evaluateCaps([{ file: 'index.html', bytes: 1_234 }]);

  it('has a header with cap, files, bytes, limit, result in that order', () => {
    const header = formatTable(passing).split('\n')[0] ?? '';
    const cols = ['cap', 'files', 'bytes', 'limit', 'result'].map((c) => header.indexOf(c));
    for (const i of cols) expect(i).toBeGreaterThanOrEqual(0);
    expect([...cols].sort((a, b) => a - b)).toEqual(cols);
  });

  it('prints one row per cap naming every cap', () => {
    const out = formatTable(passing);
    for (const c of CAPS) expect(out).toContain(c.name);
    const rows = out.split('\n').filter((l) => CAPS.some((c) => l.includes(c.name)));
    expect(rows).toHaveLength(CAPS.length);
  });

  it('shows pass on passing rows and no FAIL when all pass', () => {
    const out = formatTable(passing);
    expect(out).not.toContain('FAIL');
    const row = out.split('\n').find((l) => l.includes('before-countdown')) ?? '';
    expect(row).toContain('pass');
    expect(row).toContain('1234');
  });

  it('shows FAIL on the failing row only', () => {
    const rs = evaluateCaps([{ file: 'index.html', bytes: 101 }], [
      { name: 'before-countdown', limitBytes: 100 },
      { name: 'preview', limitBytes: 100 },
    ]);
    const lines = formatTable(rs).split('\n');
    const failRow = lines.find((l) => l.includes('before-countdown')) ?? '';
    const passRow = lines.find((l) => l.includes('preview')) ?? '';
    expect(failRow).toContain('FAIL');
    expect(failRow).toContain('101');
    expect(failRow).toContain('100');
    expect(passRow).not.toContain('FAIL');
    expect(passRow).toContain('pass');
  });
});

describe('package.json wiring', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};

  it('defines check:caps as the cap script', () => {
    expect(scripts['check:caps']).toBe('node tools/check-caps.ts');
  });

  it('runs check:caps after build and before test:e2e in check', () => {
    const check = scripts['check'] ?? '';
    const steps = check.split('&&').map((s) => s.trim());
    expect(steps).toEqual([
      'pnpm run typecheck',
      'pnpm run test:unit',
      'pnpm run build',
      'pnpm run check:caps',
      'pnpm run test:e2e',
    ]);
  });
});
