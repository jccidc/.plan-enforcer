const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MARKDOWN_LINK_RE = /!?\[[^\]]*\]\(([^)]+)\)/g;

function normalizeMarkdownTarget(rawTarget) {
  let target = String(rawTarget || '').trim();
  if (!target) return null;
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1);
  }
  if (!target || target.startsWith('#')) return null;
  if (/^(?:https?:\/\/|mailto:|app:\/\/)/i.test(target)) return null;
  if (/^[A-Za-z]:[\\/]/.test(target)) return null;
  target = target.split('#')[0];
  try {
    target = decodeURIComponent(target);
  } catch (_e) {}
  return target || null;
}

function collectInternalMarkdownTargets(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const targets = [];
  let match;
  while ((match = MARKDOWN_LINK_RE.exec(content)) !== null) {
    const target = normalizeMarkdownTarget(match[1]);
    if (target) targets.push(target);
  }
  return targets;
}

function missingTargetsFor(filePath) {
  const baseDir = path.dirname(filePath);
  return collectInternalMarkdownTargets(filePath)
    .map((target) => ({
      target,
      resolved: path.resolve(baseDir, target)
    }))
    .filter((entry) => !fs.existsSync(entry.resolved));
}

function assertMarkdownLinksResolve(filePath) {
  const missing = missingTargetsFor(filePath);
  assert.equal(
    missing.length,
    0,
    `${path.relative(REPO_ROOT, filePath)} has broken links:\n${missing.map((entry) => `- ${entry.target} -> ${path.relative(REPO_ROOT, entry.resolved)}`).join('\n')}`
  );
}

describe('markdown link integrity', () => {
  it('README internal links resolve', () => {
    assertMarkdownLinksResolve(path.join(REPO_ROOT, 'README.md'));
  });

  it('docs/proof internal links resolve', () => {
    const proofDir = path.join(REPO_ROOT, 'docs', 'proof');
    const files = fs.readdirSync(proofDir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join(proofDir, name));
    for (const filePath of files) {
      assertMarkdownLinksResolve(filePath);
    }
  });
});
