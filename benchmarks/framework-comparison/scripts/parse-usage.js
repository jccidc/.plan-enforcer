#!/usr/bin/env node
// parse-usage.js — Extract claude CLI usage totals from output.txt.
//
// Contract: prints a single positive integer (total output+input
// tokens) to stdout, or "null" when the file isn't a parseable JSON
// output. Exit 0 either way; run-comparison.sh gates token capture
// on the numeric-or-null distinction.
//
// Activates only when run-comparison is invoked with
// CLAUDE_OUTPUT_FORMAT=json (or otherwise produces a JSON output.txt).
// With the default --output-format text this script prints "null" and
// the caller preserves JSON null in meta.json. P5b flips the format
// when it does the real measured rerun.

const fs = require('fs');

function main() {
  const path = process.argv[2];
  if (!path || !fs.existsSync(path)) { console.log('null'); return 0; }
  const raw = fs.readFileSync(path, 'utf8').trim();
  if (!raw.startsWith('{') && !raw.startsWith('[')) { console.log('null'); return 0; }

  try {
    const doc = JSON.parse(raw);
    // Known shapes: { usage: { input_tokens, output_tokens } } on
    // a single non-streamed JSON response. Streamed formats emit
    // multiple JSON objects and aren't parseable by a single
    // JSON.parse — those callers should use a different extractor.
    const usage = (doc && doc.usage) || (doc.result && doc.result.usage);
    if (!usage) { console.log('null'); return 0; }
    const input = Number(usage.input_tokens || 0);
    const output = Number(usage.output_tokens || 0);
    const total = input + output;
    if (!Number.isFinite(total) || total < 0) { console.log('null'); return 0; }
    console.log(total);
    return 0;
  } catch (_e) {
    console.log('null');
    return 0;
  }
}

if (require.main === module) process.exit(main());

module.exports = { main };
