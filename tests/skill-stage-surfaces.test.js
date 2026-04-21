const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readSkill(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('skill stage surfaces', () => {
  it('discuss skills set stage, read existing packets, and include awareness fallback', () => {
    for (const relativePath of [
      'skills/plan-enforcer-discuss/SKILL.md',
      'skills/plan-enforcer-combobulate/SKILL.md'
    ]) {
      const content = readSkill(relativePath);
      assert.match(content, /statusline-stage-cli\.js" discuss --label 1-DISCUSS/);
      assert.match(content, /Read it before\s+overwriting/);
      assert.match(content, /awareness-cli\.js" capture-latest --if-empty/);
    }
  });

  it('draft skill sets 2-DRAFT and includes awareness fallback', () => {
    const content = readSkill('skills/plan-enforcer-draft/SKILL.md');
    assert.match(content, /statusline-stage-cli\.js" draft --label 2-DRAFT/);
    assert.match(content, /If the target plan file already exists, Read it before overwriting\./);
    assert.match(content, /awareness-cli\.js" capture-latest --if-empty/);
  });

  it('review skill sets 3-REVIEW', () => {
    const content = readSkill('skills/plan-enforcer-review/SKILL.md');
    assert.match(content, /statusline-stage-cli\.js" review --label 3-REVIEW/);
  });
});
