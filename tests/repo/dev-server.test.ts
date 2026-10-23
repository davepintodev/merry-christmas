// XMAS-22 "Repository and tooling skeleton": the dev server follows HOST,
// while the Playwright preview server stays on loopback whatever HOST says.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Inline `pnpm <script>` / `pnpm run <script>` references, recursively. */
function expandScript(scripts: Record<string, string>, body: string, depth = 0): string {
  if (depth > 10) throw new Error('script expansion too deep (cycle?)');
  return body.replace(/\bpnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g, (whole, name: string) => {
    const target = scripts[name];
    return target === undefined ? whole : `( ${expandScript(scripts, target, depth + 1)} )`;
  });
}

describe('dev server address', () => {
  type ServerCfg = { server?: { host?: unknown }; preview?: { host?: unknown } };

  async function loadViteConfig(host: string | undefined): Promise<ServerCfg> {
    const saved = process.env['HOST'];
    if (host === undefined) delete process.env['HOST'];
    else process.env['HOST'] = host;
    try {
      const { loadConfigFromFile } = await import('vite');
      const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, undefined, ROOT);
      expect(loaded, 'vite.config.ts not found').not.toBeNull();
      return (loaded?.config ?? {}) as ServerCfg;
    } finally {
      if (saved === undefined) delete process.env['HOST'];
      else process.env['HOST'] = saved;
    }
  }

  it('server.host follows the HOST setting', async () => {
    expect((await loadViteConfig('127.0.0.5')).server?.host).toBe('127.0.0.5');
    expect((await loadViteConfig('::1')).server?.host).toBe('::1');
  });

  it('without HOST the dev server stays on loopback (no address baked in)', async () => {
    const host = (await loadViteConfig(undefined)).server?.host;
    expect([undefined, false, 'localhost', '127.0.0.1', '::1']).toContain(host);
  });

  // Review finding: Vite's preview.host falls back to server.host, so an exported
  // HOST moved `vite preview` (Playwright's webServer) off loopback and the
  // webServer wait on localhost timed out. Either fix is accepted: pin
  // preview.host in vite.config.ts, or pass --host <loopback> in the command.
  it('with HOST exported, the Playwright preview server still binds to loopback', async () => {
    const LOOPBACK = ['localhost', '127.0.0.1', '::1'];
    const saved = process.env['HOST'];
    process.env['HOST'] = '127.0.0.5';
    let cfg: ServerCfg;
    try {
      const { loadConfigFromFile } = await import('vite');
      const loaded = await loadConfigFromFile({ command: 'serve', mode: 'production', isPreview: true }, undefined, ROOT);
      cfg = (loaded?.config ?? {}) as ServerCfg;
    } finally {
      if (saved === undefined) delete process.env['HOST'];
      else process.env['HOST'] = saved;
    }

    const pw = readText('playwright.config.ts');
    const raw = pw.match(/command\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '';
    const scripts = (JSON.parse(readText('package.json')) as { scripts?: Record<string, string> }).scripts ?? {};
    const cmd = expandScript(scripts, raw);
    expect(cmd, 'webServer.command must run vite preview').toMatch(/\bvite\s+preview\b/);
    const flag = cmd.match(/--host(?:[=\s]+(?!-)(\S+))?/);

    // Vite's precedence: CLI --host, else preview.host, else server.host.
    const effective: unknown = flag ? (flag[1] ?? true) : cfg.preview?.host !== undefined ? cfg.preview.host : cfg.server?.host;
    expect(LOOPBACK, `vite preview would bind to ${String(effective)} with HOST=127.0.0.5`).toContain(effective);

    const url = pw.match(/url\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '';
    expect(LOOPBACK, 'webServer.url must wait on loopback').toContain(new URL(url).hostname.replace(/^\[|\]$/g, ''));
  });
});
