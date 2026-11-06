import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageCoreRuntime } from '../scripts/package-core-runtime.mjs';

test('runtime packaging honors published files, preserves nested dependencies and never runs lifecycle scripts', () => {
  const root = mkdtempSync(join(tmpdir(), 'terms-package-test-'));
  try {
    mkdirSync(join(root, 'dist'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'test'));
    mkdirSync(join(root, 'node_modules', 'runtime-child'), { recursive: true });
    const manifest = {
      name: 'tc-core-library-js', version: '1.0.0', main: 'dist/index.js',
      files: ['dist', 'README.md'], dependencies: { 'runtime-child': '1.0.0' },
      scripts: { prepack: 'node -e "process.exit(99)"' }
    };
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
    writeFileSync(join(root, 'dist/index.js'), "module.exports = require('runtime-child');\n");
    writeFileSync(join(root, 'README.md'), 'Published documentation');
    writeFileSync(join(root, 'LICENSE'), 'ISC license');
    writeFileSync(join(root, 'src/build-only.ts'), 'development source');
    writeFileSync(join(root, 'test/dev-only.cjs'), 'development tests');
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'Development dependency lockfile');
    writeFileSync(join(root, 'node_modules/runtime-child/package.json'), JSON.stringify({ name: 'runtime-child', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(root, 'node_modules/runtime-child/index.js'), 'module.exports = 42;');
    packageCoreRuntime(root);
    for (const path of ['src', 'test', 'pnpm-lock.yaml']) assert.equal(existsSync(join(root, path)), false, path);
    for (const path of ['dist/index.js', 'README.md', 'LICENSE', 'node_modules/runtime-child/index.js']) assert.equal(existsSync(join(root, path)), true, path);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), manifest);
    assert.equal(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(require(process.argv[1])))', root], { encoding: 'utf8' }).trim(), '42');
    packageCoreRuntime(root);
    assert.equal(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(require(process.argv[1])))', root], { encoding: 'utf8' }).trim(), '42');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
