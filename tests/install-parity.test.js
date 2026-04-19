const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INSTALL = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
const SETUP = fs.readFileSync(path.join(ROOT, 'setup.sh'), 'utf8');

function extractForList(script, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = script.match(new RegExp(`for ${escaped} in ([\\s\\S]*?); do`));
  assert.ok(match, `missing for-loop for ${label}`);
  return match[1]
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

describe('installer parity', () => {
  it('install.sh and setup.sh ship the same skill set', () => {
    assert.deepEqual(
      extractForList(INSTALL, 'skill'),
      extractForList(SETUP, 'skill')
    );
  });

  it('install.sh and setup.sh ship the same hook set', () => {
    assert.deepEqual(
      extractForList(INSTALL, 'hook'),
      extractForList(SETUP, 'hook')
    );
  });

  it('install.sh and setup.sh ship the same runtime module set', () => {
    assert.deepEqual(
      extractForList(INSTALL, 'module'),
      extractForList(SETUP, 'module')
    );
  });
});
