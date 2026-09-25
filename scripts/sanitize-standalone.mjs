import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function sanitizeStandalone(outputRoot) {
  const root = lstatSync(outputRoot);
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new Error('Standalone output must be a real directory');
  }

  let removed = 0;
  function visit(directory, relative = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const privateName = entry.name.startsWith('.env') || entry.name === '.secret'
        || /\.(?:sqlite(?:3)?|db)(?:-(?:wal|shm|journal))?$/i.test(entry.name);
      const applicationData = relativePath === 'data' || relativePath === 'apps/web/data';
      if (privateName || applicationData) {
        // rm removes a symlink itself without following its target.
        rmSync(path, { recursive: true, force: true });
        removed += 1;
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
        visit(path, relativePath);
      }
    }
  }
  visit(outputRoot);
  return removed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const removed = sanitizeStandalone(join(projectRoot, 'apps/web/.next/standalone'));
  console.log(`Sanitized standalone output: removed ${removed} private entries.`);
}
