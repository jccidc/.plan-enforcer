const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { main } = require('../benchmarks/framework-comparison/scripts/capture-workspace-artifacts.js');

function write(file, contents = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
}

test('capture-workspace-artifacts copies allowed files and prunes ignored trees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-artifacts-root-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-artifacts-dest-'));

  write(path.join(root, 'docs', 'reports', 'final-audit-matrix.md'), '# ok');
  write(path.join(root, 'src', 'replay', 'route.js'), 'export {};');
  write(path.join(root, '.plan-enforcer', 'phase-verdict.json'), '{}');
  write(path.join(root, 'node_modules', 'leftpad', 'index.js'), 'module.exports = {};');
  write(path.join(root, 'benchmarks', 'framework-comparison', 'results', 'cell', 'output.json'), '{}');
  write(path.join(root, 'README.txt'), 'skip');

  const code = main([root, dest]);
  assert.equal(code, 0);

  assert.equal(fs.existsSync(path.join(dest, 'docs', 'reports', 'final-audit-matrix.md')), true);
  assert.equal(fs.existsSync(path.join(dest, 'src', 'replay', 'route.js')), true);
  assert.equal(fs.existsSync(path.join(dest, '.plan-enforcer', 'phase-verdict.json')), false);
  assert.equal(fs.existsSync(path.join(dest, 'node_modules', 'leftpad', 'index.js')), false);
  assert.equal(fs.existsSync(path.join(dest, 'benchmarks', 'framework-comparison', 'results', 'cell', 'output.json')), false);
  assert.equal(fs.existsSync(path.join(dest, 'README.txt')), false);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});
