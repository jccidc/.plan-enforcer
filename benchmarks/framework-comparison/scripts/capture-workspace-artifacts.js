#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ALLOWED_EXTENSIONS = new Set([
  '.md',
  '.json',
  '.js',
  '.ts',
  '.mjs',
  '.sql',
  '.yaml',
  '.yml'
]);

const PRUNED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '.plan-enforcer',
  '.claude'
]);

function shouldPrune(absPath, rootDir) {
  const rel = path.relative(rootDir, absPath);
  if (!rel || rel.startsWith('..')) return false;
  const parts = rel.split(path.sep);
  if (parts.some((part) => PRUNED_SEGMENTS.has(part))) return true;
  return rel === path.join('benchmarks', 'framework-comparison', 'results') ||
    rel.startsWith(path.join('benchmarks', 'framework-comparison', 'results') + path.sep);
}

function walk(dir, rootDir, destDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldPrune(abs, rootDir)) continue;
      walk(abs, rootDir, destDir);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const rel = path.relative(rootDir, abs);
    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
}

function main(argv = process.argv.slice(2)) {
  const [rootDirArg, destDirArg] = argv;
  if (!rootDirArg || !destDirArg) {
    console.error('Usage: node capture-workspace-artifacts.js <rootDir> <destDir>');
    return 2;
  }
  const rootDir = path.resolve(rootDirArg);
  const destDir = path.resolve(destDirArg);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    console.error(`Missing root dir: ${rootDir}`);
    return 2;
  }
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  walk(rootDir, rootDir, destDir);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main
};
