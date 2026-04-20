#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { buildPatchedPlanContent, formatReviewReport, reviewPlanContent } = require('./plan-review');
const { writeNamedStatuslineStage } = require('./statusline-state');

function printUsage() {
  console.error('Usage: plan-enforcer-review [--adversarial] [--write [output-path]] <plan-path>');
}

function exitCodeForSummary(summary) {
  if (summary === 'pass') return 0;
  if (summary === 'weak') return 2;
  return 3;
}

function parseArgs(argv) {
  const args = [...argv];
  let writeOutput = null;
  let adversarial = false;
  const positional = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--write') {
      if (args.length > 1 && !args[0].startsWith('--')) {
        writeOutput = args.shift();
      } else {
        writeOutput = true;
      }
      continue;
    }
    if (arg === '--adversarial') {
      adversarial = true;
      continue;
    }
    positional.push(arg);
  }

  return { planPath: positional[0] || null, writeOutput, adversarial };
}

function defaultPatchedPath(resolvedPath) {
  const ext = path.extname(resolvedPath) || '.md';
  return resolvedPath.slice(0, -ext.length) + '.repaired' + ext;
}

function findDiscussPacket(resolvedPlanPath) {
  const candidates = [
    path.join(path.dirname(resolvedPlanPath), '.plan-enforcer', 'discuss.md'),
    path.join(path.dirname(resolvedPlanPath), '.plan-enforcer', 'combobulate.md'),
    path.join(path.dirname(path.dirname(resolvedPlanPath)), '.plan-enforcer', 'discuss.md'),
    path.join(path.dirname(path.dirname(resolvedPlanPath)), '.plan-enforcer', 'combobulate.md'),
    path.join(path.dirname(path.dirname(path.dirname(resolvedPlanPath))), '.plan-enforcer', 'discuss.md'),
    path.join(path.dirname(path.dirname(path.dirname(resolvedPlanPath))), '.plan-enforcer', 'combobulate.md'),
    path.join(process.cwd(), '.plan-enforcer', 'discuss.md'),
    path.join(process.cwd(), '.plan-enforcer', 'combobulate.md')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function writePatchedDraft(resolvedPath, outputArg, content, review) {
  const outputPath = outputArg === true ? defaultPatchedPath(resolvedPath) : path.resolve(process.cwd(), outputArg);
  const patched = buildPatchedPlanContent(content, review);
  fs.writeFileSync(outputPath, patched, 'utf8');
  return outputPath;
}

function main(argv = process.argv.slice(2)) {
  const { planPath, writeOutput, adversarial } = parseArgs(argv);
  if (!planPath) {
    printUsage();
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), planPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Plan not found: ${resolvedPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  const packetPath = findDiscussPacket(resolvedPath);
  const packetContent = packetPath ? fs.readFileSync(packetPath, 'utf8') : '';
  const review = reviewPlanContent(content, { adversarial, packetContent });
  writeNamedStatuslineStage('review', {
    cwd: path.dirname(resolvedPath),
    label: '3-REVIEW',
    source: 'review-cli',
    title: path.basename(resolvedPath)
  });
  let out = `${formatReviewReport(content, review)}\n`;
  if (packetPath) {
    out += `\nDiscuss packet: ${packetPath}\n`;
  }
  if (writeOutput && review.summary !== 'pass') {
    const outputPath = writePatchedDraft(resolvedPath, writeOutput, content, review);
    out += `\nPatched draft written to: ${outputPath}\n`;
  }
  process.stdout.write(out);
  process.exit(exitCodeForSummary(review.summary));
}

if (require.main === module) {
  main();
}

module.exports = {
  defaultPatchedPath,
  exitCodeForSummary,
  findDiscussPacket,
  parseArgs,
  writePatchedDraft,
  main
};
