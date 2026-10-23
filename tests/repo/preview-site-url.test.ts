// XMAS-98 "Absolute preview URLs": PUBLIC_SITE_URL (env only) makes og:image and
// twitter:image absolute https URLs and adds og:url and og:type. Real Vite builds.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = 'https://example.test';

/** Build with PUBLIC_SITE_URL set to `value` (undefined = removed); return html and preview file. */
async function buildWith(value: string | undefined): Promise<{ html: string; preview: string }> {
  const saved = process.env['PUBLIC_SITE_URL'];
  if (value === undefined) delete process.env['PUBLIC_SITE_URL'];
  else process.env['PUBLIC_SITE_URL'] = value;
  const outDir = mkdtempSync(path.join(tmpdir(), 'preview-site-url-'));
  try {
    await build({
      root: ROOT,
      configFile: path.join(ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      publicDir: false,
      build: { outDir, emptyOutDir: true },
    });
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
    return { html, preview: readdirSync(outDir).find((f) => f.startsWith('preview')) ?? '' };
  } finally {
    if (saved === undefined) delete process.env['PUBLIC_SITE_URL'];
    else process.env['PUBLIC_SITE_URL'] = saved;
    rmSync(outDir, { recursive: true, force: true });
  }
}

function meta(html: string, key: string): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const id = /\b(?:name|property)\s*=\s*"([^"]*)"/i.exec(m[0])?.[1];
    if (id === key) return /\bcontent\s*=\s*"([^"]*)"/i.exec(m[0])?.[1];
  }
  return undefined;
}

describe('XMAS-98 PUBLIC_SITE_URL in the built page', () => {
  it('names the same fingerprinted preview as an absolute https URL, and adds og:url and og:type', async () => {
    const { html, preview } = await buildWith(SITE);
    expect(preview).toMatch(/^preview-[0-9a-f]{8}\.png$/);
    expect(meta(html, 'og:image')).toBe(`${SITE}/${preview}`);
    expect(meta(html, 'twitter:image')).toBe(`${SITE}/${preview}`);
    expect(meta(html, 'og:url')).toBe(`${SITE}/`);
    expect(meta(html, 'og:type')).toBe('website');
  }, 120_000);

  it('tolerates a trailing slash without doubling it', async () => {
    const { html, preview } = await buildWith(`${SITE}/`);
    expect(meta(html, 'og:image')).toBe(`${SITE}/${preview}`);
    expect(meta(html, 'og:url')).toBe(`${SITE}/`);
  }, 120_000);

  it.each([['unset', undefined], ['empty', '']])('stays root-relative with no og:url or og:type when %s', async (_n, v) => {
    const { html, preview } = await buildWith(v);
    expect(meta(html, 'og:image')).toBe(`/${preview}`);
    expect(meta(html, 'twitter:image')).toBe(`/${preview}`);
    expect(meta(html, 'og:url')).toBeUndefined();
    expect(meta(html, 'og:type')).toBeUndefined();
  }, 120_000);

  it('fails the build, naming PUBLIC_SITE_URL, when the address is not https', async () => {
    await expect(buildWith('http://example.test')).rejects.toThrow(/PUBLIC_SITE_URL/);
  }, 120_000);
});

describe('XMAS-98 the publish workflow passes the address from the repo variable', () => {
  const text = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8');

  it('sets PUBLIC_SITE_URL to https:// plus vars.LIVE_DOMAIN', () => {
    expect(text).toMatch(/PUBLIC_SITE_URL:\s*\S*\$\{\{[^}]*vars\.LIVE_DOMAIN[^}]*\}\}/);
  });

  it('gives an unset LIVE_DOMAIN an empty value and writes no hostname', () => {
    expect(text).toMatch(/PUBLIC_SITE_URL/);
    expect(text).toMatch(/vars\.LIVE_DOMAIN\s*&&\s*format\(\s*'https:\/\/\{0\}'|if\s+\[\s+-n\s+"\$LIVE_DOMAIN"\s+\][\s\S]*PUBLIC_SITE_URL/);
    expect(text).not.toMatch(/https?:\/\/(?!\$\{\{)[a-z0-9-]+(\.[a-z0-9-]+)+/i);
  });
});
