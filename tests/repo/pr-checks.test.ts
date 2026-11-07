// XMAS-73a "Run the gate, gitleaks and leak-check in CI": repo-config checks
// on the PR workflows. The three required check names are listed here so a
// rename has to touch this test, and the ruleset with it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type Step = { run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { name?: string; steps?: Step[]; env?: Record<string, string> };
type Workflow = { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> };

function load(file: string): { text: string; wf: Workflow } {
  const text = readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8');
  return { text, wf: parseYaml(text) as Workflow };
}

const runs = (job: Job): string => (job.steps ?? []).map((s) => s.run ?? '').join('\n');

describe('PR workflows', () => {
  it('names the gate job so a ruleset can require it, and it runs the gate with browsers installed', () => {
    const { wf } = load('publish.yml');
    const job = wf.jobs['check']!;
    expect(job.name).toBe('gate');
    expect(runs(job)).toContain('pnpm check');
    expect(runs(job)).toContain('playwright install');
  });

  it('runs gitleaks and leak-check on every PR to main with read-only permissions', () => {
    const { wf } = load('pr-checks.yml');
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(wf.on['pull_request']).toMatchObject({ branches: ['main'] });
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(wf.jobs['gitleaks']!.name).toBe('gitleaks');
    expect(wf.jobs['leak-check']!.name).toBe('leak-check');
  });

  it('scans the PR commits with gitleaks, redacted, from a checksum-verified pinned binary', () => {
    const job = load('pr-checks.yml').wf.jobs['gitleaks']!;
    const script = runs(job);
    expect(job.env!['GITLEAKS_VERSION']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(job.env!['GITLEAKS_SHA256']).toMatch(/^[0-9a-f]{64}$/);
    expect(script).toMatch(/sha256sum -c/);
    expect(script).toContain('--redact');
    expect(script).toContain('--log-opts');
    expect(script).not.toContain('latest');
  });

  it('passes LEAK_WORDS through env, never on a command line, and keeps tracing off', () => {
    const { text, wf } = load('pr-checks.yml');
    const job = wf.jobs['leak-check']!;
    const stepWithSecret = (job.steps ?? []).find((s) => s.env?.['LEAK_WORDS'] !== undefined)!;
    expect(stepWithSecret.env!['LEAK_WORDS']).toBe('${{ secrets.LEAK_WORDS }}');
    expect(stepWithSecret.run).toContain('node tools/leak-check.ts');
    expect(stepWithSecret.run).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/set -\w*x/);
  });

  it('pins every action to a full commit SHA', () => {
    for (const file of ['pr-checks.yml', 'publish.yml']) {
      for (const job of Object.values(load(file).wf.jobs)) {
        for (const step of job.steps ?? []) {
          if (step.uses) expect(step.uses, step.uses).toMatch(/@[0-9a-f]{40}$/);
        }
      }
    }
  });
});
