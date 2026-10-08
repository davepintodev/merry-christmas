// XMAS-22 "Repository and tooling skeleton": repo-hygiene checks.
// These tests read the repository from disk and drive the real tools
// (git, tsc, vitest, playwright, vite) as child processes.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'tests/repo/skeleton.test.ts';
const TOOL_TIMEOUT = 120_000;

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('VITEST') || k === 'TEST' || k === 'NODE_ENV') continue;
    env[k] = v;
  }
  env['CI'] = '1';
  return env;
}

function run(cmd: string, args: string[], cwd = ROOT): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', env: childEnv(), timeout: TOOL_TIMEOUT, maxBuffer: 64 * 1024 * 1024 });
}

function readText(rel: string): string {
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`expected ${rel} to exist`);
  return readFileSync(p, 'utf8');
}

type PackageJson = {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function pkg(): PackageJson {
  return JSON.parse(readText('package.json')) as PackageJson;
}

function allDeps(p: PackageJson): string[] {
  return [
    ...Object.keys(p.dependencies ?? {}),
    ...Object.keys(p.devDependencies ?? {}),
    ...Object.keys(p.optionalDependencies ?? {}),
    ...Object.keys(p.peerDependencies ?? {}),
  ];
}

/** Inline `pnpm <script>` / `pnpm run <script>` references, recursively. */
function expandScript(scripts: Record<string, string>, body: string, depth = 0): string {
  if (depth > 10) throw new Error('script expansion too deep (cycle?)');
  return body.replace(/\bpnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g, (whole, name: string) => {
    const target = scripts[name];
    return target === undefined ? whole : `( ${expandScript(scripts, target, depth + 1)} )`;
  });
}

/** Files git tracks or would track (cached + untracked-not-ignored). */
function trackedFiles(): string[] {
  const r = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout.split('\0').filter((f) => f.length > 0 && existsSync(path.join(ROOT, f)));
}

const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|mp3|ogg|wav|mp4|webm|zip|gz|pdf)$/i;

function textFiles(): string[] {
  return trackedFiles().filter((f) => {
    if (f === 'pnpm-lock.yaml' || BINARY_EXT.test(f)) return false;
    return statSync(path.join(ROOT, f)).size < 2 * 1024 * 1024;
  });
}

// ---------------------------------------------------------------------------
// Canary files inside prototype/ prove that no tool picks prototype/ up.
// prototype/ is a throwaway, git-ignored folder; the canary is removed after.
const CANARY_DIR = path.join(ROOT, 'prototype', '__xmas22_canary__');

beforeAll(() => {
  if (!existsSync(path.join(ROOT, 'prototype'))) return;
  mkdirSync(CANARY_DIR, { recursive: true });
  writeFileSync(path.join(CANARY_DIR, 'canary.ts'), 'export const canary: number = "not a number";\n');
  writeFileSync(
    path.join(CANARY_DIR, 'canary.test.ts'),
    "import { it, expect } from 'vitest';\nit('xmas22 canary unit', () => expect(1).toBe(2));\n",
  );
  writeFileSync(
    path.join(CANARY_DIR, 'canary.spec.ts'),
    "import { test } from '@playwright/test';\ntest('xmas22 canary e2e', () => { throw new Error('canary'); });\n",
  );
});

afterAll(() => {
  rmSync(CANARY_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
describe('git repository and prototype/', () => {
  it('the project root is a git work tree', () => {
    const r = run('git', ['rev-parse', '--show-toplevel']);
    expect(r.status, r.stderr).toBe(0);
    expect(path.resolve(r.stdout.trim())).toBe(ROOT);
  });

  it('.gitignore ignores prototype/', () => {
    expect(readText('.gitignore')).toMatch(/^\/?prototype\/?\s*$/m);
    const r = run('git', ['check-ignore', '-q', 'prototype/anything.ts']);
    expect(r.status, 'prototype/ must be ignored by git').toBe(0);
  });

  it('no file under prototype/ is tracked or would be tracked', () => {
    expect(trackedFiles().filter((f) => f.startsWith('prototype/'))).toEqual([]);
  });

  it('prototype/ never appears in git history', () => {
    const r = run('git', ['log', '--all', '--format=%H', '--', 'prototype']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('node_modules, dist and test output are ignored', () => {
    for (const p of ['node_modules/x', 'dist/index.html', 'test-results/x', 'playwright-report/index.html']) {
      expect(run('git', ['check-ignore', '-q', p]).status, `${p} must be ignored`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe('package.json and pnpm', () => {
  it('declares pnpm as the package manager and has only a pnpm lockfile', () => {
    expect(pkg().packageManager ?? '').toMatch(/^pnpm@\d+\.\d+\.\d+/);
    expect(existsSync(path.join(ROOT, 'pnpm-lock.yaml'))).toBe(true);
    expect(existsSync(path.join(ROOT, 'package-lock.json'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'yarn.lock'))).toBe(false);
  });

  it('has TypeScript, Vite, Vitest and Playwright as dependencies', () => {
    const deps = allDeps(pkg());
    for (const d of ['typescript', 'vite', 'vitest', '@playwright/test']) expect(deps).toContain(d);
  });

  it('`check` runs tsc --noEmit, vitest run, vite build, playwright test, in that order', () => {
    const scripts = pkg().scripts ?? {};
    expect(scripts['check'], 'scripts.check is missing').toBeTypeOf('string');
    const expanded = expandScript(scripts, scripts['check'] ?? '');
    const steps: Array<[string, RegExp]> = [
      ['tsc --noEmit', /\btsc\b[^&|;]*--noEmit\b/],
      ['vitest run', /\bvitest\b[^&|;]*(?:\brun\b|--run\b)/],
      ['vite build', /\bvite\s+build\b/],
      ['playwright test', /\bplaywright\s+test\b/],
    ];
    let last = -1;
    for (const [label, re] of steps) {
      const at = expanded.search(re);
      expect(at, `check must run "${label}" (expanded: ${expanded})`).toBeGreaterThanOrEqual(0);
      expect(at, `"${label}" is out of order in: ${expanded}`).toBeGreaterThan(last);
      last = at;
    }
  });

  it('`check` stops at the first failing step (steps chained with &&, nothing swallowed)', () => {
    const scripts = pkg().scripts ?? {};
    const expanded = expandScript(scripts, scripts['check'] ?? '');
    expect(expanded).not.toBe('');
    expect(expanded, 'no ";" separators').not.toMatch(/;/);
    expect(expanded, 'no "||" fallbacks').not.toMatch(/\|\|/);
    expect(expanded, 'no background "&"').not.toMatch(/(^|[^&])&([^&]|$)/);
    expect(expanded, 'no --passWithNoTests on the e2e step').not.toMatch(/playwright[^&]*--pass-with-no-tests/);
  });

  it('has no rendering library as a dependency', () => {
    const banned = /^(three|@react-three\/.*|pixi\.js|pixi|@pixi\/.*|phaser|babylonjs|@babylonjs\/.*|konva|react-konva|p5|@types\/p5|fabric|paper|two\.js|zdog|playcanvas|matter-js|regl|ogl|createjs|easeljs|aframe)$/;
    expect(allDeps(pkg()).filter((d) => banned.test(d))).toEqual([]);
  });

  it('has no web font package as a dependency', () => {
    const banned = /^(@fontsource(-variable)?\/.*|@fontsource.*|webfontloader|webfont|typeface-.*|google-fonts.*|@expo-google-fonts\/.*|fontfaceobserver|next\/font)$/;
    expect(allDeps(pkg()).filter((d) => banned.test(d))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('TypeScript', () => {
  it('tsconfig.json resolves to strict mode', () => {
    const r = run('pnpm', ['exec', 'tsc', '--showConfig', '-p', 'tsconfig.json']);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const cfg = JSON.parse(r.stdout) as { compilerOptions?: { strict?: boolean } };
    expect(cfg.compilerOptions?.strict).toBe(true);
  });

  it('type-checks src and tests but never prototype/', () => {
    const r = run('pnpm', ['exec', 'tsc', '--noEmit', '--listFilesOnly', '-p', 'tsconfig.json']);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const files = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((f) => path.relative(ROOT, path.resolve(ROOT, f)));
    expect(files.filter((f) => f.startsWith('prototype' + path.sep))).toEqual([]);
    expect(files).toContain(path.normalize(SELF));
    expect(files).toContain(path.normalize('tests/browser/load.spec.ts'));
    expect(files).toContain(path.normalize('art/colours.ts'));
  });
});

// ---------------------------------------------------------------------------
describe('test runners pick up the right files', () => {
  it('Vitest collects unit tests but not Playwright specs or prototype/', () => {
    const r = run('pnpm', ['exec', 'vitest', 'list', '--filesOnly']);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain('skeleton.test.ts');
    expect(r.stdout).not.toContain('canary');
    expect(r.stdout).not.toMatch(/prototype\//);
    expect(r.stdout).not.toMatch(/tests\/browser\//);
    expect(r.stdout).not.toContain('load.spec.ts');
  });

  it('Playwright collects tests/browser only, not prototype/ or unit tests', () => {
    const r = run('pnpm', ['exec', 'playwright', 'test', '--list']);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(r.stdout).toContain('load.spec.ts');
    expect(r.stdout).not.toContain('canary');
    expect(r.stdout).not.toContain('skeleton.test.ts');
  });

  it('playwright.config.ts uses tests/browser and serves the built page with vite preview', () => {
    const cfg = readText('playwright.config.ts');
    expect(cfg).toMatch(/testDir\s*:\s*['"`]\.?\/?tests\/browser\/?['"`]/);
    expect(cfg).toMatch(/webServer/);
    const scripts = pkg().scripts ?? {};
    const cmd = cfg.match(/command\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '';
    expect(expandScript(scripts, cmd), 'webServer.command must run vite preview').toMatch(/\bvite\s+preview\b/);
    expect(cfg).toMatch(/baseURL/);
  });

  it('unit tests sit next to the file they test; e2e specs only in tests/browser', () => {
    const files = trackedFiles();
    const set = new Set(files);
    for (const f of files) {
      if (/\.spec\.[cm]?[jt]sx?$/.test(f)) expect(f.startsWith('tests/browser/'), `${f} is a spec outside tests/browser`).toBe(true);
      if (!/\.test\.[cm]?[jt]sx?$/.test(f)) continue;
      expect(f.startsWith('tests/browser/'), `${f}: unit test in tests/browser`).toBe(false);
      if (f.startsWith('tests/')) continue; // repo-level checks (this file) and frame tests
      const subject = f.replace(/\.test(\.[cm]?[jt]sx?)$/, '$1');
      const candidates = [subject, subject.replace(/\.ts$/, '.tsx'), subject.replace(/\.tsx$/, '.ts')];
      expect(candidates.some((c) => set.has(c)), `${f} has no sibling source file`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('layout (spec 5.2)', () => {
  it('index.html and art/colours.ts exist', () => {
    expect(statSync(path.join(ROOT, 'index.html'), { throwIfNoEntry: false })?.isFile()).toBe(true);
    expect(statSync(path.join(ROOT, 'art/colours.ts'), { throwIfNoEntry: false })?.isFile()).toBe(true);
  });

  it.each([
    'src/countdown',
    'src/scene',
    'src/page',
    'src/shared',
    'art/sheets',
    'tools',
    'tests/frames',
    'tests/browser',
  ])('%s exists and holds at least one file git will track', (dir) => {
    expect(statSync(path.join(ROOT, dir), { throwIfNoEntry: false })?.isDirectory(), `${dir} missing`).toBe(true);
    expect(trackedFiles().some((f) => f.startsWith(dir + '/')), `${dir} is empty to git`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('AGENTS.md', () => {
  it('names the spec by title and key', () => {
    const md = readText('AGENTS.md');
    expect(md).toContain('Build-ready spec for the Christmas countdown site');
    expect(md).toContain('XMAS-21');
  });

  it('names the glossary by title and key', () => {
    const md = readText('AGENTS.md');
    expect(md).toContain('Glossary for the Christmas countdown site');
    expect(md).toContain('XMAS-16');
  });

  it('lists `pnpm check` and every script it runs', () => {
    const md = readText('AGENTS.md');
    expect(md).toContain('pnpm check');
    const scripts = pkg().scripts ?? {};
    const called = [...(scripts['check'] ?? '').matchAll(/\bpnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g)]
      .map((m) => m[1] ?? '')
      .filter((n) => n in scripts);
    for (const name of called) expect(md, `AGENTS.md should list pnpm ${name}`).toMatch(new RegExp(`pnpm\\s+(run\\s+)?${name.replace(/[:]/g, '\\:')}\\b`));
  });
});

// ---------------------------------------------------------------------------
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

  it('vite.config.ts exists', () => {
    expect(existsSync(path.join(ROOT, 'vite.config.ts'))).toBe(true);
  });

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
    const cmd = expandScript(pkg().scripts ?? {}, raw);
    expect(cmd, 'webServer.command must run vite preview').toMatch(/\bvite\s+preview\b/);
    const flag = cmd.match(/--host(?:[=\s]+(?!-)(\S+))?/);

    // Vite's precedence: CLI --host, else preview.host, else server.host.
    const effective: unknown = flag ? (flag[1] ?? true) : cfg.preview?.host !== undefined ? cfg.preview.host : cfg.server?.host;
    expect(LOOPBACK, `vite preview would bind to ${String(effective)} with HOST=127.0.0.5`).toContain(effective);

    const url = pw.match(/url\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? '';
    expect(LOOPBACK, 'webServer.url must wait on loopback').toContain(new URL(url).hostname.replace(/^\[|\]$/g, ''));
  });
});

// ---------------------------------------------------------------------------
describe('nothing private in tracked files', () => {
  const PRIVATE_ADDR: Array<[string, RegExp]> = [
    ['10/8 address', /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
    ['172.16/12 address', /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/],
    ['192.168/16 address', /\b192\.168\.\d{1,3}\.\d{1,3}\b/],
    ['100.64/10 (Tailscale/CGNAT) address', /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/],
    ['Tailscale MagicDNS name', /\.ts\.net\b/i],
    ['mDNS .local hostname', /\b(?!env\.)[a-z0-9-]+\.local\b/i],
    ['home directory path', /\/home\/[A-Za-z_][\w.-]*/],
    ['macOS user path', /\/Users\/[A-Za-z_][\w.-]*/],
    ['Windows user path', /[A-Za-z]:\\\\?Users\\\\?[A-Za-z_]/],
  ];
  const SECRETS: Array<[string, RegExp]> = [
    ['private key block', /-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}/],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
    ['OpenAI/Anthropic style key', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['Slack token', /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/],
    ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/],
  ];

  function offenders(patterns: Array<[string, RegExp]>): string[] {
    const hits: string[] = [];
    for (const f of textFiles()) {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      for (const [label, re] of patterns) if (re.test(text)) hits.push(`${f}: ${label}`);
    }
    return hits;
  }

  it('has a non-empty set of tracked files to scan', () => {
    expect(textFiles()).toContain('package.json');
    expect(textFiles()).toContain('AGENTS.md');
  });

  it('contains no private network address, hostname or machine path', () => {
    expect(offenders(PRIVATE_ADDR)).toEqual([]);
  });

  it("does not mention this machine's home directory, user name or host name", () => {
    const home = os.homedir();
    const user = os.userInfo().username;
    const host = os.hostname().split('.')[0] ?? '';
    const hits: string[] = [];
    for (const f of textFiles()) {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      if (home.length > 1 && text.includes(home)) hits.push(`${f}: home dir`);
      if (user.length >= 3 && new RegExp(`\\b${user}\\b`, 'i').test(text)) hits.push(`${f}: user name`);
      if (host.length >= 3 && host !== 'localhost' && new RegExp(`\\b${host}\\b`, 'i').test(text)) hits.push(`${f}: host name`);
    }
    expect(hits).toEqual([]);
  });

  it('contains no secret or token', () => {
    expect(offenders(SECRETS)).toEqual([]);
  });

  it('tracks no key, certificate or env file', () => {
    const bad = trackedFiles().filter((f) => /(^|\/)\.env(\.|$)|\.(pem|key|p12|pfx|crt)$/i.test(f) && !/\.env\.example$/.test(f));
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('no rendering library or web font in sources', () => {
  const SOURCE = (f: string): boolean =>
    f !== SELF &&
    (/^(src|art|tools|public)\//.test(f) || f === 'index.html' || /^tests\/(browser|frames)\//.test(f) || /\.(css|scss)$/.test(f));

  it('no source imports a rendering library', () => {
    const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](three|three\/[^'"]*|pixi\.js|@pixi\/[^'"]+|phaser|babylonjs|@babylonjs\/[^'"]+|konva|p5|fabric|paper|two\.js|zdog|playcanvas|ogl|regl|aframe)['"]/;
    const hits = textFiles().filter(SOURCE).filter((f) => re.test(readFileSync(path.join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('no source loads a web font', () => {
    const re = /@font-face|fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|@fontsource|webfontloader|new\s+FontFace\s*\(/i;
    const hits = textFiles().filter(SOURCE).filter((f) => re.test(readFileSync(path.join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('no font file is tracked', () => {
    expect(trackedFiles().filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('vite build', () => {
  let outDir = '';
  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(outDir, path.join(dir, e.name))],
    );
  }

  it('produces exactly one page, index.html, with no font and no machine path', () => {
    outDir = mkdtempSync(path.join(os.tmpdir(), 'xmas22-build-'));
    const r = run('pnpm', ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir']);
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const files = walk(outDir);
    expect(files.filter((f) => f.endsWith('.html'))).toEqual(['index.html']);
    expect(files.filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f))).toEqual([]);
    for (const f of files.filter((x) => /\.(html|css|js)$/.test(x))) {
      const text = readFileSync(path.join(outDir, f), 'utf8');
      expect(text, `${f} declares a web font`).not.toMatch(/@font-face|fonts\.googleapis/i);
      expect(text, `${f} leaks a machine path`).not.toContain(ROOT);
    }
  }, TOOL_TIMEOUT);
});
