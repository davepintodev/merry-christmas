// XMAS-23 "Publish pipeline: checks, preview addresses and publishing".
// Repo-config checks on the security of the GitHub workflow: which jobs may
// run wrangler and on which branch, that the Cloudflare credentials come only
// from GitHub secrets and reach only the deploying jobs, the token
// permissions and the concurrency rule. The preview step's own script is run
// with bash against sample wrangler logs.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

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

// ---------------------------------------------------------------------------
describe('AC2 one workflow; every push runs `pnpm check`', () => {
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
});

// ---------------------------------------------------------------------------
describe('AC4 a main push publishes, only when checks pass', () => {
  it("runs only when github.ref == 'refs/heads/main', and cannot bypass a failed check", () => {
    const cond = normExpr(publishJob()[1].if);
    expect(cond).toContain("github.ref == 'refs/heads/main'");
    expect(cond).not.toMatch(/\|\||always\(\)|failure\(\)|cancelled\(\)/);
  });

  it('no job other than publish and preview runs wrangler', () => {
    const [pub] = publishJob();
    const [pre] = previewJob();
    const others = Object.entries(jobs()).filter(([n, j]) => n !== pub && n !== pre && /\bwrangler\b/.test(runText(j) + JSON.stringify(j.steps ?? [])));
    expect(others.map(([n]) => n)).toEqual([]);
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
