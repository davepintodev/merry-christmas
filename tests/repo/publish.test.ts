// XMAS-23 "Publish pipeline: checks, preview addresses and publishing".
// Repo-config checks: they read wrangler.jsonc, public/_headers, the GitHub
// workflow and package.json from disk, parse them, and assert the pipeline's
// invariants. One test drives a real `vite build` into a temp folder.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments, parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'tests/repo/publish.test.ts';
const TOOL_TIMEOUT = 120_000;
const WORKFLOWS_DIR = '.github/workflows';
const WORKFLOW = `${WORKFLOWS_DIR}/publish.yml`;

// ---------------------------------------------------------------------------
// helpers

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

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, what: string): Obj {
  if (!isObj(v)) throw new Error(`expected ${what} to be a mapping, got ${JSON.stringify(v)}`);
  return v;
}

/** Strip // and /* *\/ comments and trailing commas, respecting strings. */
function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

function wrangler(): Obj {
  return obj(parseJsonc(readText('wrangler.jsonc')), 'wrangler.jsonc');
}

/** Top-level config plus every `env.<name>` override block. */
function wranglerScopes(): Array<[string, Obj]> {
  const cfg = wrangler();
  const scopes: Array<[string, Obj]> = [['top level', cfg]];
  if (isObj(cfg['env'])) for (const [k, v] of Object.entries(cfg['env'])) scopes.push([`env.${k}`, obj(v, `env.${k}`)]);
  return scopes;
}

type Step = Obj & { run?: string; uses?: string; env?: Obj; 'continue-on-error'?: unknown };
type Job = Obj & { steps?: Step[]; needs?: string | string[]; if?: string; env?: Obj; outputs?: Obj };

function workflow(): Obj {
  return obj(parseYaml(readText(WORKFLOW)), WORKFLOW);
}

function jobs(): Record<string, Job> {
  return obj(workflow()['jobs'], 'jobs') as Record<string, Job>;
}

function steps(job: Job): Step[] {
  return Array.isArray(job.steps) ? job.steps : [];
}

function runText(job: Job): string {
  return steps(job).map((s) => (typeof s.run === 'string' ? s.run : '')).join('\n');
}

function stepIndex(job: Job, re: RegExp): number {
  return steps(job).findIndex((s) => typeof s.run === 'string' && re.test(s.run));
}

/** The single job whose run steps match `re`. */
function jobRunning(re: RegExp, what: string): [string, Job] {
  const hits = Object.entries(jobs()).filter(([, j]) => re.test(runText(j)));
  if (hits.length !== 1) throw new Error(`expected exactly one job that runs ${what}, found ${hits.map(([n]) => n).join(', ') || 'none'}`);
  return hits[0]!;
}

const VERSIONS_UPLOAD = /\bwrangler\s+versions\s+upload\b/;
const WRANGLER_DEPLOY = /\bwrangler\s+deploy\b/;
const VERSIONS_DEPLOY = /\bwrangler\s+versions\s+deploy\b/;

function previewJob(): [string, Job] {
  return jobRunning(VERSIONS_UPLOAD, '`wrangler versions upload`');
}

function publishJob(): [string, Job] {
  return jobRunning(WRANGLER_DEPLOY, '`wrangler deploy`');
}

function needsOf(job: Job): string[] {
  const n = job.needs;
  return n === undefined ? [] : Array.isArray(n) ? n : [n];
}

/** `${{ a  == "b" }}` -> `a == 'b'` */
function normExpr(v: unknown): string {
  return String(v ?? '')
    .replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function effectiveEnv(job: Job, step: Step): Obj {
  const wfEnv = isObj(workflow()['env']) ? (workflow()['env'] as Obj) : {};
  return { ...wfEnv, ...(isObj(job.env) ? job.env : {}), ...(isObj(step.env) ? step.env : {}) };
}

function truthy(v: unknown): boolean {
  return v !== undefined && v !== false && v !== 'false' && v !== null;
}

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function pkg(): PackageJson {
  return JSON.parse(readText('package.json')) as PackageJson;
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
    if (f === 'pnpm-lock.yaml' || f === SELF || BINARY_EXT.test(f)) return false;
    return statSync(path.join(ROOT, f)).size < 2 * 1024 * 1024;
  });
}

// --- Cloudflare `_headers` ---------------------------------------------------

type HeaderRule = { pattern: string; headers: Array<[string, string]> };

function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const line = raw.trim();
    if (line.startsWith('!')) continue; // detach a header
    const colon = line.indexOf(':');
    if (current === undefined || colon <= 0) throw new Error(`malformed _headers line: ${JSON.stringify(raw)}`);
    current.headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

function headerRules(): HeaderRule[] {
  return parseHeaders(readText('public/_headers'));
}

/** Cloudflare `_headers` URL pattern -> RegExp over the request path. */
function patternRegex(pattern: string): RegExp {
  const p = pattern.replace(/^https?:\/\/[^/]+/, '');
  const src = p
    .split(/(\*|:[A-Za-z]\w*)/)
    .map((part) => (part === '*' ? '.*' : part.startsWith(':') ? '[^/]+' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${src}$`);
}

function cacheDirectives(value: string): Map<string, string | true> {
  const m = new Map<string, string | true>();
  for (const part of value.split(',')) {
    const [k, v] = part.trim().toLowerCase().split('=');
    if (k) m.set(k.trim(), v === undefined ? true : v.trim().replace(/^"|"$/g, ''));
  }
  return m;
}

function maxAge(d: Map<string, string | true>): number {
  const vals = ['max-age', 's-maxage'].map((k) => d.get(k)).filter((v): v is string => typeof v === 'string');
  return vals.length ? Math.max(...vals.map(Number)) : 0;
}

// ---------------------------------------------------------------------------
describe('AC1 wrangler.jsonc: a static-assets-only Worker', () => {
  it('names the Worker merry-christmas', () => {
    expect(wrangler()['name']).toBe('merry-christmas');
  });

  it('serves ./dist as its assets directory', () => {
    const assets = obj(wrangler()['assets'], 'assets');
    expect(typeof assets['directory']).toBe('string');
    expect(path.resolve(ROOT, assets['directory'] as string)).toBe(path.join(ROOT, 'dist'));
  });

  it('the assets directory is where vite build writes (no outDir override)', () => {
    expect(readText('vite.config.ts')).not.toMatch(/\boutDir\b/);
  });

  it('has no `main` entry anywhere: no server code', () => {
    for (const [where, scope] of wranglerScopes()) expect(scope, where).not.toHaveProperty('main');
    expect(existsSync(path.join(ROOT, 'src', 'worker.ts'))).toBe(false);
  });

  it('has a compatibility_date that is a real YYYY-MM-DD date not in the future', () => {
    const d = wrangler()['compatibility_date'];
    expect(typeof d).toBe('string');
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const t = Date.parse(`${d as string}T00:00:00Z`);
    expect(Number.isNaN(t)).toBe(false);
    expect(new Date(t).toISOString().slice(0, 10)).toBe(d);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it('carries no account id or credential', () => {
    for (const [where, scope] of wranglerScopes()) {
      expect(scope, where).not.toHaveProperty('account_id');
      expect(scope, where).not.toHaveProperty('api_token');
    }
    expect(readText('wrangler.jsonc')).not.toMatch(/\b[0-9a-f]{32}\b/i);
  });
});

// ---------------------------------------------------------------------------
describe('AC8 the live address is not attached', () => {
  it('has no routes, route or custom_domain in any scope', () => {
    for (const [where, scope] of wranglerScopes()) {
      for (const key of ['routes', 'route', 'custom_domain', 'custom_domains']) expect(scope, `${where}.${key}`).not.toHaveProperty(key);
    }
    expect(readText('wrangler.jsonc')).not.toMatch(/custom_domain|zone_name|zone_id/);
  });

  it('sets workers_dev and preview_urls to true explicitly at the top level', () => {
    const cfg = wrangler();
    expect(cfg['workers_dev'], 'workers_dev').toBe(true);
    expect(cfg['preview_urls'], 'preview_urls').toBe(true);
  });

  it('keeps workers.dev and preview URLs on in every scope', () => {
    for (const [where, scope] of wranglerScopes()) {
      expect(scope['workers_dev'], `${where}.workers_dev`).not.toBe(false);
      expect(scope['preview_urls'], `${where}.preview_urls`).not.toBe(false);
    }
  });

  it('names no hostname other than workers.dev in wrangler.jsonc', () => {
    const text = readText('wrangler.jsonc').replace(/\/\/.*$/gm, '');
    const hosts = [...text.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)].map((m) => m[1]!.toLowerCase());
    const foreign = hosts.filter((h) => !/(^|\.)workers\.dev$/.test(h) && !/\.(jsonc?|ts|js|html|css|toml)$/.test(h));
    expect(foreign).toEqual([]);
  });

  it('the workflow passes no --route or --domain to wrangler', () => {
    const all = Object.values(jobs()).map(runText).join('\n');
    expect(all).not.toMatch(/--routes?\b|--domains?\b|--custom-domain\b/);
  });
});

// ---------------------------------------------------------------------------
describe('AC2 one workflow; every push runs `pnpm check`', () => {
  it('there is exactly one workflow file and it is publish.yml', () => {
    expect(existsSync(path.join(ROOT, WORKFLOWS_DIR))).toBe(true);
    const files = readdirSync(path.join(ROOT, WORKFLOWS_DIR)).filter((f) => /\.ya?ml$/.test(f));
    expect(files).toEqual(['publish.yml']);
  });

  it('is triggered on push to every branch (no branch, tag-only or path filter)', () => {
    const wf = workflow();
    // YAML 1.1 parsers read a bare `on` as true; `yaml` uses 1.2 but accept both.
    const on = wf['on'] ?? (wf as Record<string, unknown>)['true'];
    const hasPush = on === 'push' || (Array.isArray(on) && on.includes('push')) || (isObj(on) && 'push' in on);
    expect(hasPush, 'workflow must trigger on push').toBe(true);
    const push = isObj(on) ? on['push'] : null;
    if (isObj(push)) {
      for (const k of ['branches-ignore', 'paths', 'paths-ignore', 'tags', 'tags-ignore']) expect(push, `on.push.${k}`).not.toHaveProperty(k);
      if ('branches' in push) expect(push['branches']).toEqual(expect.arrayContaining(['**']));
    } else {
      expect(push ?? null).toBeNull();
    }
  });

  it('has a `check` job that always runs (no `if`, no continue-on-error)', () => {
    const check = jobs()['check'];
    expect(check, 'job `check`').toBeDefined();
    expect(check).not.toHaveProperty('if');
    expect(truthy(check!['continue-on-error'])).toBe(false);
  });

  it('the check job runs `pnpm check` and does not swallow its failure', () => {
    const check = jobs()['check']!;
    const i = stepIndex(check, /(^|[\s;&|(])pnpm\s+(run\s+)?check\s*($|[\s;&|)])/m);
    expect(i, '`pnpm check` step').toBeGreaterThanOrEqual(0);
    const step = steps(check)[i]!;
    expect(truthy(step['continue-on-error'])).toBe(false);
    expect(step.run).not.toMatch(/\|\|\s*(true|:|exit 0)\b|set \+e|;\s*true\s*$/m);
  });

  it('the check job installs deps with a frozen lockfile, then Playwright browsers, before `pnpm check`', () => {
    const check = jobs()['check']!;
    const install = stepIndex(check, /\bpnpm\s+(install|i)\b[^\n]*--frozen-lockfile/);
    const browsers = stepIndex(check, /\bplaywright\s+install\b/);
    const gate = stepIndex(check, /\bpnpm\s+(run\s+)?check\b/);
    expect(install, 'frozen-lockfile install').toBeGreaterThanOrEqual(0);
    expect(browsers, 'playwright install').toBeGreaterThan(install);
    expect(gate, 'pnpm check').toBeGreaterThan(browsers);
  });

  it('package.json `check` script is unchanged', () => {
    expect(pkg().scripts?.['check']).toBe('pnpm run typecheck && pnpm run test:unit && pnpm run build && pnpm run test:e2e');
  });

  it('the check job never sees the Cloudflare credentials', () => {
    const check = jobs()['check']!;
    for (const s of steps(check)) {
      const env = effectiveEnv(check, s);
      expect(env).not.toHaveProperty('CLOUDFLARE_API_TOKEN');
      expect(env).not.toHaveProperty('CLOUDFLARE_ACCOUNT_ID');
    }
    expect(JSON.stringify(check)).not.toMatch(/secrets\./);
  });
});

// ---------------------------------------------------------------------------
describe('AC3 a non-main push uploads a version and prints its preview URL', () => {
  it('one job runs `pnpm exec wrangler versions upload`', () => {
    const [, job] = previewJob();
    expect(runText(job)).toMatch(/\bpnpm\s+exec\s+wrangler\s+versions\s+upload\b/);
  });

  it('the preview job needs `check`', () => {
    expect(needsOf(previewJob()[1])).toContain('check');
  });

  it("runs only when github.ref != 'refs/heads/main', and cannot bypass a failed check", () => {
    const cond = normExpr(previewJob()[1].if);
    expect(cond).toContain("github.ref != 'refs/heads/main'");
    expect(cond).not.toMatch(/\|\||always\(\)|failure\(\)|cancelled\(\)/);
  });

  it('never publishes: the preview job runs no `wrangler deploy` or `versions deploy`', () => {
    const text = runText(previewJob()[1]);
    expect(text).not.toMatch(WRANGLER_DEPLOY);
    expect(text).not.toMatch(VERSIONS_DEPLOY);
  });

  it('prints the workers.dev preview URL to the job summary or outputs', () => {
    const job = previewJob()[1];
    const text = JSON.stringify(job);
    expect(/GITHUB_STEP_SUMMARY/.test(runText(job)) || isObj(job.outputs)).toBe(true);
    expect(text).toMatch(/workers\.dev/);
  });
});

// ---------------------------------------------------------------------------
describe('AC4 a main push publishes, only when checks pass', () => {
  it('one job runs `pnpm exec wrangler deploy`', () => {
    expect(runText(publishJob()[1])).toMatch(/\bpnpm\s+exec\s+wrangler\s+deploy\b/);
  });

  it('the publish job needs `check`', () => {
    expect(needsOf(publishJob()[1])).toContain('check');
  });

  it("runs only when github.ref == 'refs/heads/main', and cannot bypass a failed check", () => {
    const cond = normExpr(publishJob()[1].if);
    expect(cond).toContain("github.ref == 'refs/heads/main'");
    expect(cond).not.toMatch(/\|\||always\(\)|failure\(\)|cancelled\(\)/);
  });

  it('`check` itself is not allowed to fail open', () => {
    const check = jobs()['check']!;
    expect(truthy(check['continue-on-error'])).toBe(false);
    for (const s of steps(check)) expect(truthy(s['continue-on-error']), `step ${String(s['name'] ?? s.run ?? s.uses)}`).toBe(false);
  });

  it('no job other than publish and preview runs wrangler', () => {
    const [pub] = publishJob();
    const [pre] = previewJob();
    const others = Object.entries(jobs()).filter(([n, j]) => n !== pub && n !== pre && /\bwrangler\b/.test(runText(j) + JSON.stringify(j.steps ?? [])));
    expect(others.map(([n]) => n)).toEqual([]);
  });

  it('every deploying job installs with a frozen lockfile and has ./dist before calling wrangler', () => {
    for (const [name, job] of [previewJob(), publishJob()]) {
      const wr = stepIndex(job, /\bwrangler\s+(deploy|versions\s+upload)\b/);
      const install = stepIndex(job, /\bpnpm\s+(install|i)\b[^\n]*--frozen-lockfile/);
      const build = steps(job).findIndex(
        (s) => (typeof s.run === 'string' && /\b(pnpm\s+(run\s+)?build|vite\s+build)\b/.test(s.run)) || (typeof s.uses === 'string' && /actions\/download-artifact@/.test(s.uses)),
      );
      expect(install, `${name}: frozen-lockfile install`).toBeGreaterThanOrEqual(0);
      expect(install, `${name}: install before wrangler`).toBeLessThan(wr);
      expect(build, `${name}: build or download dist`).toBeGreaterThanOrEqual(0);
      expect(build, `${name}: dist before wrangler`).toBeLessThan(wr);
    }
  });

  it('every wrangler call goes through `pnpm exec`', () => {
    const lines = Object.values(jobs())
      .flatMap((j) => runText(j).split('\n'))
      .filter((l) => /\bwrangler\b/.test(l) && !/^\s*#/.test(l) && /\bwrangler\s+(deploy|versions)\b/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/\bpnpm\s+exec\s+wrangler\b/);
    for (const j of Object.values(jobs())) for (const s of steps(j)) expect(String(s.uses ?? '')).not.toMatch(/wrangler-action/);
  });

  it('wrangler is a devDependency and is in the lockfile', () => {
    const p = pkg();
    expect(p.devDependencies).toHaveProperty('wrangler');
    expect(p.dependencies ?? {}).not.toHaveProperty('wrangler');
    // pnpm 12 writes a multi-document lockfile (an env document first); the
    // project document is the one whose root importer lists vitest.
    const projectDevDeps = parseAllDocuments(readText('pnpm-lock.yaml'))
      .map((d) => d.toJS() as unknown)
      .map((d) => (isObj(d) && isObj(d['importers']) ? d['importers']['.'] : undefined))
      .map((imp) => (isObj(imp) && isObj(imp['devDependencies']) ? imp['devDependencies'] : undefined))
      .filter((dd): dd is Obj => dd !== undefined && 'vitest' in dd);
    expect(projectDevDeps, 'project document in pnpm-lock.yaml').toHaveLength(1);
    expect(projectDevDeps[0]).toHaveProperty('wrangler');
  });
});

// ---------------------------------------------------------------------------
describe('AC9 the Cloudflare token lives only in GitHub secrets', () => {
  const TOKEN_REF = /^\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}$/;
  const ACCOUNT_REF = /^\$\{\{\s*secrets\.CLOUDFLARE_ACC_ID\s*\}\}$/;

  it('each wrangler step gets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from secrets', () => {
    for (const [name, job] of [previewJob(), publishJob()]) {
      const s = steps(job).find((st) => typeof st.run === 'string' && /\bwrangler\s+(deploy|versions\s+upload)\b/.test(st.run));
      expect(s, `${name}: wrangler step`).toBeDefined();
      const env = effectiveEnv(job, s!);
      expect(String(env['CLOUDFLARE_API_TOKEN'] ?? ''), `${name}: CLOUDFLARE_API_TOKEN`).toMatch(TOKEN_REF);
      expect(String(env['CLOUDFLARE_ACCOUNT_ID'] ?? ''), `${name}: CLOUDFLARE_ACCOUNT_ID`).toMatch(ACCOUNT_REF);
    }
  });

  it('every CLOUDFLARE_* env value in the workflow is a secrets reference', () => {
    const offenders: string[] = [];
    const wf = workflow();
    const envs: Array<[string, unknown]> = [['workflow', wf['env']]];
    for (const [n, j] of Object.entries(jobs())) {
      envs.push([n, j.env]);
      steps(j).forEach((s, i) => envs.push([`${n}.steps[${i}]`, s.env]));
    }
    for (const [where, env] of envs) {
      if (!isObj(env)) continue;
      for (const [k, v] of Object.entries(env)) {
        if (/^CLOUDFLARE_/.test(k) && !/^\$\{\{\s*secrets\.[A-Z_]+\s*\}\}$/.test(String(v))) offenders.push(`${where}.${k}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the workflow references no secret other than the two Cloudflare ones (and GITHUB_TOKEN)', () => {
    const names = new Set([...readText(WORKFLOW).matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    expect(names.has('CLOUDFLARE_API_TOKEN')).toBe(true);
    expect(names.has('CLOUDFLARE_ACC_ID')).toBe(true);
    for (const n of names) expect(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACC_ID', 'GITHUB_TOKEN']).toContain(n);
  });

  it('outside docs, CLOUDFLARE_API_TOKEN appears only as a secrets reference or its env mapping', () => {
    const offenders: string[] = [];
    for (const f of textFiles()) {
      if (/\.md$/i.test(f)) continue;
      for (const line of readFileSync(path.join(ROOT, f), 'utf8').split('\n')) {
        if (!line.includes('CLOUDFLARE_API_TOKEN')) continue;
        const mapping = /^\s*CLOUDFLARE_API_TOKEN\s*:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}\s*$/.test(line);
        const onlyRefs = line.replace(/secrets\.CLOUDFLARE_API_TOKEN/g, '').includes('CLOUDFLARE_API_TOKEN') === false;
        if (!mapping && !onlyRefs) offenders.push(`${f}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no tracked or would-be-tracked file holds a token- or account-id-looking literal', () => {
    const files = textFiles();
    for (const f of ['wrangler.jsonc', WORKFLOW, 'public/_headers']) expect(files, `${f} must be scanned`).toContain(f);
    const PATTERNS: Array<[string, RegExp]> = [
      ['32-hex account id', /\b[0-9a-f]{32}\b/i],
      ['Cloudflare prefixed token', /\bcf[a-z]{2}_[A-Za-z0-9_-]{16,}/],
      ['credential assigned a literal', /\b(CLOUDFLARE_[A-Z_]+|account_id|api_token|apiToken|accountId)\b["']?\s*[:=]\s*["']?(?!\$\{\{)[A-Za-z0-9_-]{20,}/],
    ];
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      for (const [label, re] of PATTERNS) if (re.test(text)) hits.push(`${f}: ${label}`);
    }
    expect(hits).toEqual([]);
  });

  it('local wrangler state and env files are git-ignored', () => {
    for (const p of ['.wrangler/state/x', '.dev.vars', '.env']) {
      const r = run('git', ['check-ignore', '-q', '--no-index', p]);
      expect(r.status, `${p} must be ignored`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe('AC5 cache headers: fingerprinted files immutable, page revalidates', () => {
  it('/assets/* gets Cache-Control: public, max-age=31536000, immutable', () => {
    const rule = headerRules().find((r) => r.pattern === '/assets/*');
    expect(rule, '/assets/* rule').toBeDefined();
    const cc = rule!.headers.filter(([k]) => k === 'cache-control');
    expect(cc).toHaveLength(1);
    const d = cacheDirectives(cc[0]![1]);
    expect([...d.keys()].sort()).toEqual(['immutable', 'max-age', 'public']);
    expect(d.get('max-age')).toBe('31536000');
  });

  it('no rule that matches the page gives it a long cache or immutable', () => {
    for (const page of ['/', '/index.html']) {
      for (const rule of headerRules()) {
        if (!patternRegex(rule.pattern).test(page)) continue;
        for (const [k, v] of rule.headers) {
          if (k !== 'cache-control') continue;
          const d = cacheDirectives(v);
          expect(d.has('immutable'), `${rule.pattern} makes ${page} immutable`).toBe(false);
          expect(maxAge(d), `${rule.pattern} caches ${page}`).toBe(0);
        }
      }
    }
  });

  it('only /assets/ (fingerprinted) patterns are long-cached or immutable', () => {
    const bad: string[] = [];
    for (const rule of headerRules()) {
      for (const [k, v] of rule.headers) {
        if (k !== 'cache-control') continue;
        const d = cacheDirectives(v);
        if ((d.has('immutable') || maxAge(d) > 0) && !/^\/assets\//.test(rule.pattern.replace(/^https?:\/\/[^/]+/, ''))) bad.push(rule.pattern);
      }
    }
    expect(bad).toEqual([]);
  });

  it('vite build copies _headers into the output root; everything under assets/ is fingerprinted', () => {
    expect(existsSync(path.join(ROOT, 'public', '_headers'))).toBe(true);
    const out = mkdtempSync(path.join(os.tmpdir(), 'xmas23-build-'));
    try {
      const r = run('pnpm', ['exec', 'vite', 'build', '--outDir', out, '--emptyOutDir']);
      expect(r.status, r.stderr + r.stdout).toBe(0);
      expect(readFileSync(path.join(out, '_headers'), 'utf8')).toBe(readText('public/_headers'));
      expect(existsSync(path.join(out, 'index.html'))).toBe(true);
      const assetsDir = path.join(out, 'assets');
      const assets = existsSync(assetsDir) ? readdirSync(assetsDir, { recursive: true }).map(String) : [];
      const files = assets.filter((f) => statSync(path.join(assetsDir, f)).isFile());
      for (const f of files) expect(path.basename(f), `assets/${f} is not fingerprinted`).toMatch(/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/);
      expect(existsSync(path.join(ROOT, 'public', 'assets')), 'public/assets would be served immutable without a hash').toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, TOOL_TIMEOUT);
});

// ---------------------------------------------------------------------------
describe('AC6 motion sensors are not disabled', () => {
  it('_headers has rules, and none restricts accelerometer or gyroscope', () => {
    const rules = headerRules();
    expect(rules.length).toBeGreaterThan(0);
    const bad = rules.flatMap((r) => r.headers.filter(([, v]) => /accelerometer|gyroscope/i.test(v)).map(([k]) => `${r.pattern}: ${k}`));
    expect(bad).toEqual([]);
  });

  it('_headers sets no Feature-Policy and no Permissions-Policy naming a motion sensor', () => {
    const text = readText('public/_headers');
    expect(text).not.toMatch(/^\s*Feature-Policy\s*:/im);
    expect(text).not.toMatch(/accelerometer|gyroscope|magnetometer|DeviceMotion|DeviceOrientation/i);
  });

  it('index.html sets no Permissions-Policy / Feature-Policy meta', () => {
    expect(readText('index.html')).not.toMatch(/http-equiv\s*=\s*["']?(permissions|feature)-policy/i);
  });
});

// ---------------------------------------------------------------------------
describe('AC7 no visitor-counting script', () => {
  // Guard: green today, must stay green once the publish pipeline lands.
  const MARKERS = /cloudflareinsights|beacon\.min\.js|googletagmanager|google-analytics|gtag\(|plausible|umami|matomo|fathom|analytics\.js|data-cf-beacon/i;

  it('index.html, src/ and public/ load no analytics or beacon', () => {
    const files = textFiles().filter((f) => f === 'index.html' || f.startsWith('src/') || f.startsWith('public/'));
    expect(files).toContain('index.html');
    const hits = files.filter((f) => MARKERS.test(readFileSync(path.join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the workflow and wrangler config add no analytics', () => {
    expect(readText(WORKFLOW)).not.toMatch(MARKERS);
    expect(readText('wrangler.jsonc')).not.toMatch(MARKERS);
    expect(wrangler()).not.toHaveProperty('analytics_engine_datasets');
  });
});

// ---------------------------------------------------------------------------
// Preview step harness. The step's `run` script is extracted from the
// workflow and executed with bash exactly as GitHub runs it
// (`bash --noprofile --norc -eo pipefail <file>`), with:
//   - a fake `pnpm` first on PATH: `pnpm exec wrangler versions upload ...`
//     prints a canned wrangler log (stdout part to stdout, error part to
//     stderr) and exits with wrangler's exit code; any other pnpm call exits 97;
//   - RUNNER_TEMP (empty temp dir), GITHUB_OUTPUT and GITHUB_STEP_SUMMARY
//     (empty temp files) set as on a CI machine. Nothing else from GitHub is set.
const NOT_YET_EXIST =
  'You cannot upload a new version of a Worker that does not yet exist. Please run the `deploy` command first.';
const PREVIEW_URL = 'https://abcd1234-merry-christmas.example-sub.workers.dev';

type Upload = { stdout: string; stderr?: string; exit: number };
type StepRun = { status: number | null; out: string; summary: string; output: string; pnpmCalls: string };

function previewStepScript(): string {
  const step = steps(previewJob()[1]).find((s) => typeof s.run === 'string' && VERSIONS_UPLOAD.test(s.run));
  if (step === undefined) throw new Error('no preview step running `wrangler versions upload`');
  const script = step.run as string;
  if (/\$\{\{/.test(script)) throw new Error('preview step script interpolates ${{ }} expressions; pass values through env instead');
  return script;
}

function runPreviewStep(upload: Upload): StepRun {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xmas23-step-'));
  try {
    const bin = path.join(dir, 'bin');
    const tmp = path.join(dir, 'ci-temp');
    mkdirSync(bin);
    mkdirSync(tmp);
    writeFileSync(path.join(dir, 'upload.out'), upload.stdout);
    writeFileSync(path.join(dir, 'upload.err'), upload.stderr ?? '');
    writeFileSync(path.join(dir, 'summary'), '');
    writeFileSync(path.join(dir, 'output'), '');
    writeFileSync(path.join(dir, 'calls'), '');
    writeFileSync(
      path.join(bin, 'pnpm'),
      [
        '#!/usr/bin/env bash',
        `echo "$*" >> '${path.join(dir, 'calls')}'`,
        'if [ "$1 $2 $3 $4" = "exec wrangler versions upload" ]; then',
        `  cat '${path.join(dir, 'upload.out')}'`,
        `  cat '${path.join(dir, 'upload.err')}' >&2`,
        `  exit ${upload.exit}`,
        'fi',
        'echo "fake pnpm: unexpected call: $*" >&2',
        'exit 97',
        '',
      ].join('\n'),
    );
    chmodSync(path.join(bin, 'pnpm'), 0o755);
    const scriptFile = path.join(dir, 'step.sh');
    writeFileSync(scriptFile, previewStepScript());
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptFile], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
        HOME: dir,
        RUNNER_TEMP: tmp,
        GITHUB_OUTPUT: path.join(dir, 'output'),
        GITHUB_STEP_SUMMARY: path.join(dir, 'summary'),
        CI: 'true',
        GITHUB_ACTIONS: 'true',
      },
    });
    return {
      status: r.status,
      out: `${r.stdout}\n${r.stderr}`,
      summary: readFileSync(path.join(dir, 'summary'), 'utf8'),
      output: readFileSync(path.join(dir, 'output'), 'utf8'),
      pnpmCalls: readFileSync(path.join(dir, 'calls'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const UPLOAD_OK = [
  ' ⛅️ wrangler 4.40.0',
  '───────────────────',
  '🌀 Building list of assets...',
  '🌀 Starting asset upload...',
  'Uploaded 3 of 3 assets',
  '✨ Success! Uploaded 3 files (1.23 sec)',
  'Total Upload: 0.34 KiB / gzip: 0.24 KiB',
  'Worker Startup Time: 1 ms',
  'Uploaded merry-christmas (3.21 sec)',
  'Worker Version ID: 0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',
  `Version Preview URL: ${PREVIEW_URL}`,
  '',
  'To deploy this version to production traffic use the command "wrangler versions deploy"',
  '',
].join('\n');

describe('AC3 preview step script, executed against sample wrangler logs', () => {
  it('the step script names the wrangler "does not yet exist" message and tells the owner to publish main first', () => {
    const script = previewStepScript();
    expect(script).toMatch(/does not yet exist/);
    expect(script).toMatch(/\bmain\b/);
  });

  it('a log with "Version Preview URL:" prints that URL and writes it to the step summary', () => {
    const r = runPreviewStep({ stdout: UPLOAD_OK, exit: 0 });
    expect(r.status, r.out).toBe(0);
    expect(r.pnpmCalls).toMatch(/^exec wrangler versions upload\b/m);
    expect(r.out).toContain(PREVIEW_URL);
    expect(r.summary).toContain(PREVIEW_URL);
  });

  it('picks the Version Preview URL line, not another workers.dev URL earlier in the log', () => {
    const noisy = UPLOAD_OK.replace(
      'Worker Startup Time: 1 ms',
      'Worker Startup Time: 1 ms\nCurrent production: https://merry-christmas.example-sub.workers.dev',
    );
    const r = runPreviewStep({ stdout: noisy, exit: 0 });
    expect(r.status, r.out).toBe(0);
    expect(r.summary).toContain(PREVIEW_URL);
    expect(r.summary).not.toContain('https://merry-christmas.example-sub.workers.dev');
  });

  it('a successful upload whose log has no preview URL fails with a readable message', () => {
    const r = runPreviewStep({ stdout: UPLOAD_OK.replace(/^Version Preview URL:.*$/m, ''), exit: 0 });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/preview url/i);
    expect(r.summary).not.toMatch(/https:\/\//);
  });

  it('a "Worker does not yet exist" failure exits non-zero telling the owner to publish main first', () => {
    const r = runPreviewStep({
      stdout: ' ⛅️ wrangler 4.40.0\n───────────────────\n',
      stderr: `\n✘ [ERROR] ${NOT_YET_EXIST}\n\n`,
      exit: 1,
    });
    expect(r.status).not.toBe(0);
    // A message of the step's own, beyond wrangler's echoed line.
    const own = r.out.replace(NOT_YET_EXIST, '');
    expect(own).toMatch(/\bmain\b/);
    expect(own).toMatch(/publish|deploy/i);
    expect(own).toMatch(/first|once|before/i);
  });

  it('any other wrangler failure still fails the step', () => {
    const r = runPreviewStep({ stdout: '', stderr: '✘ [ERROR] Authentication error [code: 10000]\n', exit: 1 });
    expect(r.status).not.toBe(0);
    expect(r.summary).not.toMatch(/https:\/\//);
  });
});

// ---------------------------------------------------------------------------
describe('concurrency never cancels a main run', () => {
  it('cancel-in-progress is false or excludes refs/heads/main', () => {
    const wf = workflow();
    const blocks: Array<[string, unknown]> = [['workflow', wf['concurrency']]];
    for (const [n, j] of Object.entries(jobs())) blocks.push([`jobs.${n}`, j['concurrency']]);
    for (const [where, c] of blocks) {
      if (!isObj(c)) continue;
      const cancel = c['cancel-in-progress'];
      if (cancel === undefined || cancel === false) continue;
      expect(cancel, `${where}.cancel-in-progress must not be a bare true`).not.toBe(true);
      const cond = normExpr(cancel);
      expect(cond, where).toMatch(/^github\.ref != 'refs\/heads\/main'$|&& github\.ref != 'refs\/heads\/main'|^github\.ref != 'refs\/heads\/main' &&/);
      expect(cond, where).not.toMatch(/\|\|/);
    }
  });
});

// ---------------------------------------------------------------------------
describe('workflow token permissions', () => {
  it('sets top-level permissions to exactly { contents: read }', () => {
    expect(workflow()['permissions']).toEqual({ contents: 'read' });
  });

  it('no job widens the permissions', () => {
    const bad: string[] = [];
    for (const [n, j] of Object.entries(jobs())) {
      const p = j['permissions'];
      if (p === undefined) continue;
      if (!isObj(p)) {
        bad.push(`${n}: ${String(p)}`);
        continue;
      }
      for (const [k, v] of Object.entries(p)) {
        const ok = v === 'none' || (k === 'contents' && v === 'read');
        if (!ok) bad.push(`${n}.${k}: ${String(v)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('dist/ is built once in check and handed to the deploying jobs', () => {
  const SHA_PIN = /@[0-9a-f]{40}\s+#\s*v\d/;

  function usesStep(job: Job, action: string): [number, Step] {
    const i = steps(job).findIndex((s) => typeof s.uses === 'string' && s.uses.startsWith(`${action}@`));
    return [i, steps(job)[i]!];
  }

  function normDir(v: unknown): string {
    return String(v ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '');
  }

  it('every action in the workflow is pinned by full commit SHA with a # vX comment', () => {
    const lines = readText(WORKFLOW).split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l, l.trim()).toMatch(SHA_PIN);
  });

  it('check uploads dist/ with actions/upload-artifact after `pnpm check`', () => {
    const check = jobs()['check']!;
    const [i, step] = usesStep(check, 'actions/upload-artifact');
    expect(i, 'upload-artifact step in check').toBeGreaterThanOrEqual(0);
    expect(i, 'upload after the build in `pnpm check`').toBeGreaterThan(stepIndex(check, /\bpnpm\s+(run\s+)?check\b/));
    const w = obj(step.with, 'upload-artifact with');
    expect(normDir(w['path'])).toBe('dist');
    expect(typeof w['name']).toBe('string');
  });

  it('preview and publish download that artifact into dist/ before wrangler', () => {
    const uploaded = obj(usesStep(jobs()['check']!, 'actions/upload-artifact')[1]?.with, 'upload-artifact with')['name'];
    for (const [name, job] of [previewJob(), publishJob()]) {
      const [i, step] = usesStep(job, 'actions/download-artifact');
      expect(i, `${name}: download-artifact step`).toBeGreaterThanOrEqual(0);
      const w = obj(step.with, `${name}: download-artifact with`);
      expect(w['name'], `${name}: artifact name`).toBe(uploaded);
      expect(normDir(w['path']), `${name}: download path`).toBe('dist');
      expect(i, `${name}: download before wrangler`).toBeLessThan(stepIndex(job, /\bwrangler\s+(deploy|versions\s+upload)\b/));
    }
  });

  it('preview and publish no longer build, but still install with a frozen lockfile', () => {
    for (const [name, job] of [previewJob(), publishJob()]) {
      expect(runText(job), `${name} must not rebuild`).not.toMatch(/\bpnpm\s+(run\s+)?(build|check)\b|\bvite\s+build\b/);
      expect(stepIndex(job, /\bpnpm\s+(install|i)\b[^\n]*--frozen-lockfile/), `${name}: frozen install`).toBeGreaterThanOrEqual(0);
    }
  });
});
