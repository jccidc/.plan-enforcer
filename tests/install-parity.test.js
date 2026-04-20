const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INSTALL = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
const SETUP = fs.readFileSync(path.join(ROOT, 'setup.sh'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

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

  it('ships discuss skill, standalone statusline hook, and all package bins', () => {
    const skills = new Set(extractForList(INSTALL, 'skill'));
    const hooks = new Set(extractForList(INSTALL, 'hook'));
    const modules = new Set(extractForList(INSTALL, 'module'));

    assert.equal(skills.has('plan-enforcer-discuss'), true);
    assert.equal(hooks.has('statusline.js'), true);
    for (const target of Object.values(PKG.bin)) {
      assert.equal(modules.has(path.basename(target)), true, `missing runtime for ${target}`);
    }
  });

  it('ships critical shared modules used by status and hook surfaces', () => {
    const modules = new Set(extractForList(INSTALL, 'module'));
    for (const file of ['git-worktree.js', 'partial-ledger-edit.js', 'statusline-state.js']) {
      assert.equal(modules.has(file), true, `missing ${file}`);
    }
  });
});
