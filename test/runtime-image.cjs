// Run inside the final image with networking disabled, before publishing it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('tc-core-library-js');
const packageRoot = path.resolve('node_modules/tc-core-library-js');
for (const name of ['createJwtVerifier', 'createM2MClient', 'createBusClient']) {
  assert.equal(typeof core[name], 'function', `Missing packaged runtime export: ${name}`);
}
for (const name of ['src', 'test', 'pnpm-lock.yaml', 'tsconfig.json', 'eslint.config.mjs']) {
  assert.equal(fs.existsSync(path.join(packageRoot, name)), false, `Development file shipped: ${name}`);
}
assert.ok(fs.existsSync(path.join(packageRoot, 'package.json')));
assert.ok(fs.existsSync(path.join(packageRoot, 'dist/index.js')));
assert.notEqual(process.getuid(), 0, 'Runtime image must run as non-root');
console.log('Runtime package exports, dependency loading, package metadata and non-root user verified.');
