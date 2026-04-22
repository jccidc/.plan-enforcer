const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  formatGitWorktreeSummary,
  hasDirectGitMarker,
  normalizePathFromPorcelain,
  parsePorcelainLine,
  summarizeGitWorktree
} = require('../src/git-worktree');

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

describe('git-worktree', () => {
  it('parses porcelain lines including rename output', () => {
    assert.deepEqual(parsePorcelainLine(' M README.md'), {
      xy: ' M',
      path: 'README.md',
      staged: false,
      unstaged: true,
      untracked: false
    });
    assert.deepEqual(parsePorcelainLine('M  src/app.js'), {
      xy: 'M ',
      path: 'src/app.js',
      staged: true,
      unstaged: false,
      untracked: false
    });
    assert.deepEqual(parsePorcelainLine('?? docs/new.md'), {
      xy: '??',
      path: 'docs/new.md',
      staged: false,
      unstaged: false,
      untracked: true
    });
    assert.equal(normalizePathFromPorcelain('old.md -> docs/new.md'), 'docs/new.md');
  });

  it('summarizes uncommitted tracked and untracked files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-git-worktree-'));
    runGit(['init', '-q'], dir);
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log("a");\n');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.email=test@local', '-c', 'user.name=test', 'commit', '-q', '-m', 'init'], dir);

    fs.writeFileSync(path.join(dir, 'README.md'), 'hello world\n');
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log("b");\n');
    runGit(['add', 'src/app.js'], dir);
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'note.md'), 'note\n');

    const summary = summarizeGitWorktree(dir, { maxFiles: 10 });
    assert.equal(summary.total, 3);
    assert.equal(summary.staged, 1);
    assert.equal(summary.unstaged, 1);
    assert.equal(summary.untracked, 1);
    assert.deepEqual([...summary.files].sort(), ['README.md', 'docs/note.md', 'src/app.js']);

    const formatted = formatGitWorktreeSummary(summary);
    assert.match(formatted, /Git: 3 uncommitted files/);
    assert.match(formatted, /1 staged/);
    assert.match(formatted, /1 unstaged/);
    assert.match(formatted, /1 untracked/);
  });

  it('does not climb into a parent git repo unless asked', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-git-parent-'));
    runGit(['init', '-q'], root);
    fs.mkdirSync(path.join(root, 'child', 'nested'), { recursive: true });
    const nested = path.join(root, 'child', 'nested');

    assert.equal(hasDirectGitMarker(nested), false);
    assert.equal(summarizeGitWorktree(nested), null);

    const summary = summarizeGitWorktree(nested, { searchParents: true });
    assert.ok(summary);
    assert.equal(summary.root.replace(/\\/g, '/'), root.replace(/\\/g, '/'));
  });
});
