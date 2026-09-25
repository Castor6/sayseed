import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkCurrent, checkOrdinary, checkVersion, packages, releasePlan, validateChangeset } from './release-check.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'release-policy-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, content) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), content); };
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  for (const [name, path] of Object.entries(packages)) write(`${path}/package.json`, JSON.stringify({ name: `@sayseed/${name}`, version: '0.1.0' }));
  write('.changeset/base-release.md', '---\n"@sayseed/web": patch\n---\nInitial release\n');
  const commit = () => { git('add', '-A'); git('commit', '--quiet', '-m', 'test: fixture'); return git('rev-parse', 'HEAD'); };
  return { cwd, git, write, commit, base: commit() };
}

function generatedVersion(cwd) {
  const path = join(cwd, 'apps/web/package.json');
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  metadata.version = '0.1.1';
  writeFileSync(path, JSON.stringify(metadata));
  writeFileSync(join(cwd, 'apps/web/CHANGELOG.md'), '# 0.1.1\n\nInitial release\n');
  rmSync(join(cwd, '.changeset/base-release.md'));
}

test('ordinary PR permits a new valid changeset and code edits', (t) => {
  const f = fixture(t);
  f.write('.changeset/new-work.md', '---\n"@sayseed/shared": minor\n---\nShared behavior\n');
  f.write('feature.js', 'export const feature = true;');
  f.commit();
  checkCurrent(f.cwd);
  checkOrdinary(f.cwd, f.base);
});

test('ordinary PR rejects forged versions, changelogs and changeset edits', (t) => {
  const f = fixture(t);
  generatedVersion(f.cwd);
  f.commit();
  assert.throws(() => checkOrdinary(f.cwd, f.base), /only a version PR/);
  f.git('reset', '--hard', f.base);
  f.write('apps/web/CHANGELOG.md', '# fake');
  f.commit();
  assert.throws(() => checkOrdinary(f.cwd, f.base), /changelogs/);
  f.git('reset', '--hard', f.base);
  f.write('.changeset/base-release.md', '---\n"@sayseed/web": major\n---\nChanged\n');
  f.commit();
  assert.throws(() => checkOrdinary(f.cwd, f.base), /immutable/);
});

test('changeset syntax rejects unknown packages, duplicates, missing body and empty releases', () => {
  for (const text of ['---\n"unknown": patch\n---\nSummary', '---\n"@sayseed/web": patch\n"@sayseed/web": major\n---\nSummary', '---\n"@sayseed/web": patch\n---\n', '---\n\n---\nSummary']) {
    assert.throws(() => validateChangeset(text, 'test.md'));
  }
});

test('version PR replay requires exact generated tree including new files and code', (t) => {
  const f = fixture(t);
  generatedVersion(f.cwd);
  f.commit();
  checkVersion(f.cwd, f.base, 'HEAD', generatedVersion);
  assert.equal(releasePlan(f.cwd, f.base).web_changed, true);
  assert.equal(releasePlan(f.cwd, f.base).extension_changed, false);
  f.write('injected.js', 'malicious();');
  f.commit();
  assert.throws(() => checkVersion(f.cwd, f.base, 'HEAD', generatedVersion), /exactly match/);
  f.git('reset', '--hard', f.base);
  generatedVersion(f.cwd);
  f.write('apps/web/CHANGELOG.md', 'forged changelog');
  f.commit();
  assert.throws(() => checkVersion(f.cwd, f.base, 'HEAD', generatedVersion), /exactly match/);
});

test('version PR replay rejects empty releases', (t) => {
  const f = fixture(t);
  assert.throws(() => checkVersion(f.cwd, f.base, 'HEAD', () => {}), /no release/);
});


test('real Changesets replay propagates a shared patch to both private applications', (t) => {
  const f = fixture(t);
  f.write('package.json', JSON.stringify({ name: 'release-fixture', private: true, packageManager: 'pnpm@12.4.1' }));
  f.write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*\n');
  f.write('.gitignore', 'node_modules\n');
  f.write('.changeset/config.json', readFileSync(new URL('../.changeset/config.json', import.meta.url), 'utf8'));
  f.write('.changeset/base-release.md', '---\n"@sayseed/shared": patch\n---\nShared release\n');
  for (const [name, path] of Object.entries(packages)) {
    f.write(`${path}/package.json`, JSON.stringify({ name: `@sayseed/${name}`, version: '0.1.0', private: true,
      ...(name === 'shared' ? {} : { dependencies: { '@sayseed/shared': 'workspace:*' } }) }));
  }
  const base = f.commit();
  const modules = new URL('../node_modules', import.meta.url).pathname;
  symlinkSync(modules, join(f.cwd, 'node_modules'));
  execFileSync(process.execPath, [join(modules, '@changesets/cli/bin.js'), 'version'], { cwd: f.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  f.commit();
  checkVersion(f.cwd, base);
  const plan = releasePlan(f.cwd, base);
  assert.equal(plan.web_version, '0.1.1');
  assert.equal(plan.extension_version, '0.1.1');
  assert.equal(plan.shared_version, '0.1.1');
});
