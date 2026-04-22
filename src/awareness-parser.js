const fs = require('fs');

function normalizeId(value) {
  return String(value || '').trim().toUpperCase();
}

function splitRow(line) {
  const parts = line.split('|').map((c) => c.trim());
  if (parts.length >= 2 && parts[0] === '') parts.shift();
  if (parts.length >= 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function parseMetadata(markdown) {
  const get = (name) => ((markdown.match(new RegExp(`<!--\\s*${name}:\\s*(.+?)\\s*-->`, 'i')) || [])[1] || '').trim();
  return {
    schema: get('schema') || 'missing',
    created: get('created') || ''
  };
}

function sectionLines(markdown, headingRe) {
  const lines = String(markdown || '').split(/\r?\n/);
  const start = lines.findIndex((line) => headingRe.test(line));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

function parseTable(lines) {
  const tableLines = lines.filter((line) => /^\|/.test(line.trim()));
  if (tableLines.length < 2) return [];
  const header = splitRow(tableLines[0]);
  const rows = [];
  for (const line of tableLines.slice(2)) {
    const cells = splitRow(line);
    if (cells.length === 0) continue;
    const row = {};
    header.forEach((name, idx) => {
      row[name] = cells[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function normalizeRefs(value) {
  return String(value || '')
    .split(',')
    .map((s) => normalizeId(s))
    .filter(Boolean);
}

function parseIntentRows(rows, scope) {
  return rows.map((row) => {
    const quoteKey = Object.keys(row).find((key) => /^Quote/i.test(key)) || 'Quote';
    return {
      id: normalizeId(row.ID),
      quote: row[quoteKey] || '',
      source: row.Source || '',
      captured: row.Captured || '',
      scope
    };
  }).filter((row) => row.id);
}

function parseAwareness(markdown) {
  const meta = parseMetadata(markdown);
  const projectIntents = parseIntentRows(parseTable(sectionLines(markdown, /^##\s+Project-level intents/i)), 'project');
  const sessionIntents = parseIntentRows(parseTable(sectionLines(markdown, /^##\s+This-session intents/i)), 'session');
  const restates = parseTable(sectionLines(markdown, /^##\s+Restate rows/i)).map((row) => ({
    id: normalizeId(row.ID),
    summary: row.Summary || '',
    refs: normalizeRefs(row.Refs),
    captured: row.Captured || ''
  })).filter((row) => row.id);
  const corrections = parseTable(sectionLines(markdown, /^##\s+Correction rows/i)).map((row) => ({
    id: normalizeId(row.ID),
    type: (row.Type || '').toLowerCase(),
    refs: normalizeRefs(row.Refs),
    note: row.Note || '',
    captured: row.Captured || ''
  })).filter((row) => row.id);

  return {
    ...meta,
    intents: [...projectIntents, ...sessionIntents],
    restates,
    corrections
  };
}

function readAwareness(filePath) {
  if (!fs.existsSync(filePath)) {
    return { schema: 'missing', created: '', intents: [], restates: [], corrections: [] };
  }
  return parseAwareness(fs.readFileSync(filePath, 'utf8'));
}

module.exports = {
  parseAwareness,
  parseMetadata,
  normalizeId,
  readAwareness,
  sectionLines,
  splitRow
};
