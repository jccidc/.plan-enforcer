#!/usr/bin/env node
// aggregate-cell-usage.js
//
// Walks a results/<size>/<scenario>/<system>/ directory, finds every
// *.usage.json sidecar written by extract-session-usage.js, and prints
// a combined totals object to stdout. Used by run-comparison.sh to
// populate token/cost fields on meta.json.
//
// Usage: node aggregate-cell-usage.js <cell-dir>

const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.usage.json')) out.push(full);
  }
  return out;
}

function main() {
  const cellDir = process.argv[2];
  if (!cellDir) { console.error('usage: aggregate-cell-usage.js <cell-dir>'); process.exit(2); }
  const files = walk(cellDir);
  const totals = {
    sessions_counted: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    total_tokens: 0,
    total_cost_usd: 0,
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 0,
    sessions: []
  };
  for (const file of files) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { continue; }
    if (doc && doc.error) continue;
    totals.sessions_counted += 1;
    totals.input_tokens += Number(doc.input_tokens || 0);
    totals.output_tokens += Number(doc.output_tokens || 0);
    totals.cache_read_input_tokens += Number(doc.cache_read_input_tokens || 0);
    totals.cache_creation_input_tokens += Number(doc.cache_creation_input_tokens || 0);
    totals.total_tokens += Number(doc.total_tokens || 0);
    totals.total_cost_usd += Number(doc.total_cost_usd || 0);
    totals.duration_ms += Number(doc.duration_ms || 0);
    totals.duration_api_ms += Number(doc.duration_api_ms || 0);
    totals.num_turns += Number(doc.num_turns || 0);
    totals.sessions.push({
      file: path.relative(cellDir, file).replace(/\\/g, '/'),
      input_tokens: doc.input_tokens,
      output_tokens: doc.output_tokens,
      cache_read_input_tokens: doc.cache_read_input_tokens,
      cache_creation_input_tokens: doc.cache_creation_input_tokens,
      total_cost_usd: doc.total_cost_usd,
      num_turns: doc.num_turns
    });
  }
  totals.total_cost_usd = Number(totals.total_cost_usd.toFixed(6));
  console.log(JSON.stringify(totals, null, 2));
}

if (require.main === module) main();
module.exports = { main };
