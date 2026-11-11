import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Codeload installs source archives; publish only the dependency's declared package. */
export function packageCoreRuntime(directory = 'node_modules/tc-core-library-js') {
  const root = resolve(directory);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'tc-core-library-js');
  assert.ok(Array.isArray(manifest.files) && manifest.files.includes('dist'));
  const temporary = mkdtempSync(join(tmpdir(), 'terms-core-runtime-'));
  try {
    const packages = JSON.parse(execFileSync('npm', [
      'pack', root, '--ignore-scripts', '--json', '--pack-destination', temporary
    ], { encoding: 'utf8' }));
    assert.equal(packages.length, 1);
    const { filename, files } = packages[0];
    assert.equal(basename(filename), filename);
    assert.ok(files.some(file => file.path === 'package.json'));
    assert.ok(files.some(file => file.path === 'dist/index.js'));
    // Keep any nested production dependencies installed by npm ci/prune.
    for (const name of readdirSync(root)) {
      if (name !== 'node_modules') rmSync(join(root, name), { recursive: true, force: true });
    }
    execFileSync('tar', ['-xzf', join(temporary, filename), '--strip-components=1', '-C', root]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageCoreRuntime();
}
