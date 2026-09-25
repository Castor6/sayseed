import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packages = { web: 'apps/web', extension: 'apps/extension', shared: 'packages/shared' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const readAt = (cwd, ref, path) => git(cwd, 'show', `${ref}:${path}`);

export function validateChangeset(content, path) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match || !match[2].trim()) throw new Error(`${path}: changeset must have frontmatter and a summary`);
  const names = new Set();
  for (const line of match[1].split(/\r?\n/).filter((line) => line.trim())) {
    const entry = line.match(/^["']?(@sayseed\/(?:web|extension|shared))["']?: (patch|minor|major)$/);
    if (!entry || names.has(entry[1])) throw new Error(`${path}: invalid or duplicate package release`);
    names.add(entry[1]);
  }
  if (!names.size) throw new Error(`${path}: at least one package release is required`);
}

export function checkCurrent(cwd, head = 'HEAD') {
  for (const path of Object.values(packages)) {
    const metadata = JSON.parse(readAt(cwd, head, `${path}/package.json`));
    if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error(`${path}: only stable versions are supported`);
  }
  for (const path of git(cwd, 'ls-tree', '-r', '--name-only', head, '--', '.changeset').split('\n')) {
    if (/^\.changeset\/[^/]+\.md$/.test(path) && path !== '.changeset/README.md') validateChangeset(readAt(cwd, head, path), path);
  }
}

export function checkOrdinary(cwd, base, head = 'HEAD') {
  for (const path of Object.values(packages)) {
    const previous = JSON.parse(readAt(cwd, base, `${path}/package.json`));
    const current = JSON.parse(readAt(cwd, head, `${path}/package.json`));
    if (previous.version !== current.version) throw new Error(`${path}: only a version PR may change versions`);
  }
  const changed = git(cwd, 'diff', '--name-only', base, head).split('\n').filter(Boolean);
  for (const path of changed) {
    if (/(^|\/)CHANGELOG\.md$/i.test(path)) throw new Error(`${path}: only a version PR may change changelogs`);
    if (/^\.changeset\/[^/]+\.md$/.test(path) && path !== '.changeset/README.md') {
      if (git(cwd, 'ls-tree', base, '--', path)) throw new Error(`${path}: existing changesets are immutable`);
      validateChangeset(readAt(cwd, head, path), path);
    }
  }
}

export function checkVersion(cwd, base, head = 'HEAD', runVersion) {
  const temporary = mkdtempSync(join(tmpdir(), 'sayseed-version-'));
  try {
    git(cwd, 'clone', '--quiet', '--shared', '--no-checkout', cwd, temporary);
    git(temporary, 'checkout', '--quiet', '--detach', base);
    git(temporary, 'config', 'core.autocrlf', 'false');
    if (runVersion) runVersion(temporary);
    else {
      const manifestPath = join(cwd, 'node_modules/@changesets/cli/package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const binary = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.changeset;
      execFileSync(process.execPath, [join(dirname(manifestPath), binary), 'version'], {
        cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true' },
      });
    }
    git(temporary, 'add', '--all', '--force');
    const expected = git(temporary, 'write-tree');
    if (expected !== git(cwd, 'rev-parse', `${head}^{tree}`)) {
      const differences = git(temporary, 'diff', '--stat', git(cwd, 'rev-parse', head), expected);
      throw new Error(`Version PR must exactly match Changesets output from RELEASE_BASE; extra or forged changes are forbidden\n${differences}`);
    }
    if (expected === git(cwd, 'rev-parse', `${base}^{tree}`)) throw new Error('Version PR contains no release');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function releasePlan(cwd, base, head = 'HEAD') {
  const plan = { commit: git(cwd, 'rev-parse', head) };
  for (const [name, path] of Object.entries(packages)) {
    const oldVersion = JSON.parse(readAt(cwd, base, `${path}/package.json`)).version;
    const version = JSON.parse(readAt(cwd, head, `${path}/package.json`)).version;
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${path}: only stable versions are supported`);
    plan[`${name}_changed`] = oldVersion !== version;
    plan[`${name}_version`] = version;
  }
  return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const cwd = process.cwd();
    const base = process.env.RELEASE_BASE;
    const head = process.env.RELEASE_HEAD || 'HEAD';
    if (head !== 'HEAD' && !/^[a-f0-9]{40,64}$/.test(head)) throw new Error('RELEASE_HEAD must be a full Git commit SHA');
    checkCurrent(cwd, head);
    if (base) {
      if (!/^[a-f0-9]{40,64}$/.test(base)) throw new Error('RELEASE_BASE must be a full Git commit SHA');
      git(cwd, 'merge-base', '--is-ancestor', base, head);
      if (process.env.VERSION_PR === 'true') checkVersion(cwd, base, head);
      else checkOrdinary(cwd, base, head);
    } else if (process.env.VERSION_PR === 'true' || process.argv.includes('--plan')) {
      throw new Error('Version PR validation and release plans require RELEASE_BASE');
    }
    const plan = releasePlan(cwd, base || head, head);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.log(process.argv.includes('--plan') ? JSON.stringify(plan) : 'Release policy passed');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
