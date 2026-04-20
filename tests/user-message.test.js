const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'user-message.js');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-user-msg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
  fs.mkdirSync(path.join(dir, '.plan-enforcer'));
  fs.writeFileSync(path.join(dir, '.plan-enforcer', 'config.md'), '---\ntier: structural\n---\n');
  return dir;
}

function runHook(cwd, payload) {
  execFileSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(payload),
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

describe('user-message hook', () => {
  it('captures raw prompt text into .user-messages.jsonl', () => {
    const dir = mkProject();
    runHook(dir, {
      hook_event_name: 'UserPromptSubmit',
      session_id: 's1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: dir,
      prompt: 'keep replay dossier explicit'
    });

    const logPath = path.join(dir, '.plan-enforcer', '.user-messages.jsonl');
    assert.equal(fs.existsSync(logPath), true);
    const record = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    assert.equal(record.index, 1);
    assert.equal(record.session_id, 's1');
    assert.equal(record.prompt, 'keep replay dossier explicit');
  });

  it('does nothing when no active .plan-enforcer project exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-user-msg-none-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
    runHook(dir, {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'keep replay dossier explicit'
    });
    assert.equal(fs.existsSync(path.join(dir, '.plan-enforcer', '.user-messages.jsonl')), false);
  });

  it('bootstraps discuss packet and statusline state for a plan ask', () => {
    const dir = mkProject();
    runHook(dir, {
      hook_event_name: 'UserPromptSubmit',
      prompt: "let's make a plan for launch-safe install fixes"
    });

    const packetPath = path.join(dir, '.plan-enforcer', 'discuss.md');
    const legacyPath = path.join(dir, '.plan-enforcer', 'combobulate.md');
    const statuslinePath = path.join(dir, '.plan-enforcer', 'statusline-state.json');

    assert.equal(fs.existsSync(packetPath), true);
    assert.equal(fs.existsSync(legacyPath), true);
    assert.equal(fs.existsSync(statuslinePath), true);
    assert.match(fs.readFileSync(packetPath, 'utf8'), /launch-safe install fixes/i);

    const statusline = JSON.parse(fs.readFileSync(statuslinePath, 'utf8'));
    assert.equal(statusline.stage, 'discuss');
    assert.equal(statusline.label, '1-DISCUSS');
  });
});
