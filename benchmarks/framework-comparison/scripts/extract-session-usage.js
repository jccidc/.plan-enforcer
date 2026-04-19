#!/usr/bin/env node
// extract-session-usage.js
//
// Reads the JSON document claude -p --output-format json produces, and
// writes two sidecar files:
//
//   - <base>.txt        the .result string (for sentinel-grep compat
//                       with the old text-format flow)
//   - <base>.usage.json {input_tokens, output_tokens,
//                        cache_creation_input_tokens,
//                        cache_read_input_tokens, total_cost_usd,
//                        duration_ms, num_turns, service_tier, model}
//
// Usage:
//   node extract-session-usage.js <input.json> <base-path-without-ext>
//
// If the input file isn't valid json (e.g. claude printed a raw error),
// the .txt is written as-is and .usage.json contains {error: "..."}.

const fs = require('fs');
const path = require('path');

function main() {
  const [inputPath, basePath] = process.argv.slice(2);
  if (!inputPath || !basePath) {
    console.error('usage: extract-session-usage.js <input.json> <base-path>');
    process.exit(2);
  }
  if (!fs.existsSync(inputPath)) {
    fs.writeFileSync(basePath + '.txt', '');
    fs.writeFileSync(basePath + '.usage.json', JSON.stringify({ error: 'input missing' }, null, 2));
    return;
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    // SessionEnd hook + other stderr land on the same stream via
    // 2>&1 and get appended after the JSON envelope. Recover by
    // extracting the first complete top-level JSON object using a
    // bracket-counting scan that respects string escapes.
    const extracted = extractFirstJsonObject(raw);
    if (extracted) {
      try {
        doc = JSON.parse(extracted);
      } catch (e2) {
        fs.writeFileSync(basePath + '.txt', raw);
        fs.writeFileSync(basePath + '.usage.json', JSON.stringify({ error: `json parse failed (both full + extracted): ${e2.message}` }, null, 2));
        return;
      }
    } else {
      fs.writeFileSync(basePath + '.txt', raw);
      fs.writeFileSync(basePath + '.usage.json', JSON.stringify({ error: `json parse failed, no object found: ${e.message}` }, null, 2));
      return;
    }
  }

  const resultText = typeof doc.result === 'string' ? doc.result : '';
  // Hook-side stderr (SessionEnd refusal etc.) leaks onto the same
  // stream via our 2>&1 redirect and sits *after* the JSON envelope
  // in the raw file. The recovery loop greps .txt for 'hard gate',
  // so we have to preserve that tail — otherwise a first-pass that
  // ends with an empty .result and a gate refusal looks identical
  // to a happy completion and recovery never fires.
  let tail = '';
  const openBrace = raw.indexOf('{');
  if (openBrace >= 0) {
    const envelope = extractFirstJsonObject(raw);
    if (envelope) {
      const after = raw.slice(openBrace + envelope.length).replace(/^[\s\r\n]+/, '');
      if (after && !after.startsWith('{')) tail = after;
    }
  }
  const combinedText = tail
    ? (resultText ? `${resultText}\n\n${tail}` : tail)
    : resultText;
  fs.writeFileSync(basePath + '.txt', combinedText);

  // Prefer modelUsage totals (aggregates subagents) over top-level usage.
  // Fall back to usage if modelUsage is missing.
  const modelUsage = doc.modelUsage || {};
  const modelKeys = Object.keys(modelUsage);
  let input = 0, output = 0, cacheRead = 0, cacheCreate = 0, cost = 0;
  let model = null;
  if (modelKeys.length > 0) {
    for (const key of modelKeys) {
      const mu = modelUsage[key] || {};
      input += Number(mu.inputTokens || 0);
      output += Number(mu.outputTokens || 0);
      cacheRead += Number(mu.cacheReadInputTokens || 0);
      cacheCreate += Number(mu.cacheCreationInputTokens || 0);
      cost += Number(mu.costUSD || 0);
    }
    model = modelKeys.join('+');
  } else if (doc.usage) {
    input = Number(doc.usage.input_tokens || 0);
    output = Number(doc.usage.output_tokens || 0);
    cacheRead = Number(doc.usage.cache_read_input_tokens || 0);
    cacheCreate = Number(doc.usage.cache_creation_input_tokens || 0);
    cost = Number(doc.total_cost_usd || 0);
  }

  const summary = {
    model,
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate,
    total_tokens: input + output + cacheRead + cacheCreate,
    total_cost_usd: cost,
    duration_ms: Number(doc.duration_ms || 0),
    duration_api_ms: Number(doc.duration_api_ms || 0),
    num_turns: Number(doc.num_turns || 0),
    service_tier: (doc.usage && doc.usage.service_tier) || null,
    stop_reason: doc.stop_reason || null,
    terminal_reason: doc.terminal_reason || null,
    is_error: Boolean(doc.is_error)
  };
  fs.writeFileSync(basePath + '.usage.json', JSON.stringify(summary, null, 2));
}

// Scan a string for the first complete top-level JSON object. Returns
// the object as a string, or null. Respects string literals and
// escape sequences so brackets inside strings don't throw off the
// counter. Built for recovering the claude CLI JSON envelope when
// hook-side stderr leaks into the same stream.
function extractFirstJsonObject(str) {
  const start = str.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

if (require.main === module) main();
module.exports = { main, extractFirstJsonObject };
