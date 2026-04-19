const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'src', 'discuss-cli.js');

function run(args, cwd, input = '') {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    input
  });
}

describe('discuss-cli', () => {
  it('writes discuss and compatibility packets non-interactively and seeds awareness', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-discuss-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"tmp"}');

    const result = run(['--non-interactive', 'Keep roadmap edits narrow and do not snap back to stale archived text'], dir);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Discuss packet written to:/);

    const packetPath = path.join(dir, '.plan-enforcer', 'discuss.md');
    const legacyPath = path.join(dir, '.plan-enforcer', 'combobulate.md');
    const awarenessPath = path.join(dir, '.plan-enforcer', 'awareness.md');

    assert.equal(fs.existsSync(packetPath), true);
    assert.equal(fs.existsSync(legacyPath), true);
    assert.equal(fs.existsSync(awarenessPath), true);

    const packet = fs.readFileSync(packetPath, 'utf8');
    assert.match(packet, /## Source Ask/);
    assert.match(packet, /> Keep roadmap edits narrow and do not snap back to stale archived text/);

    const awareness = fs.readFileSync(awarenessPath, 'utf8');
    assert.match(awareness, /\| I1 \| Keep roadmap edits narrow and do not snap back to stale archived text \| manual \|/);
  });

  it('supports ask files and custom packet paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-discuss-int-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"tmp"}');
    const askPath = path.join(dir, 'request.md');
    fs.writeFileSync(askPath, 'Keep the active roadmap version and preserve narrow update scope');

    const result = run([
      '--non-interactive',
      '--title', 'Roadmap Discuss Packet',
      '--from-file', askPath,
      '--packet', '.plan-enforcer/custom-discuss.md'
    ], dir);

    assert.equal(result.status, 0);
    const packet = fs.readFileSync(path.join(dir, '.plan-enforcer', 'custom-discuss.md'), 'utf8');
    assert.match(packet, /^# Roadmap Discuss Packet/m);
    assert.match(packet, /> Keep the active roadmap version and preserve narrow update scope/);
    assert.equal(fs.existsSync(path.join(dir, '.plan-enforcer', 'combobulate.md')), true);
  });
});
