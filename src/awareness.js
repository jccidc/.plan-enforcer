const fs = require('fs');
const path = require('path');

const { parseChainCell, parseTaskRows, splitRow } = require('./ledger-parser');
const { normalizeId, parseAwareness, readAwareness } = require('./awareness-parser');

const DEFAULT_OVERLAP_THRESHOLD = 2;
const USER_MESSAGES_BASENAME = '.user-messages.jsonl';
const STOPWORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'because', 'been', 'before',
  'being', 'between', 'build', 'can', 'could', 'does', 'doing', 'done',
  'each', 'from', 'have', 'into', 'just', 'keep', 'make', 'more', 'need',
  'only', 'over', 'ship', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'this', 'those', 'through', 'until', 'very', 'want', 'were',
  'what', 'when', 'where', 'which', 'while', 'with', 'without', 'would',
  'your'
]);

function findProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.plan-enforcer'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

function resolvePaths(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const projectRoot = opts.projectRoot
    ? path.resolve(opts.projectRoot)
    : findProjectRoot(cwd);
  const awarenessPath = opts.awarenessPath
    ? path.resolve(cwd, opts.awarenessPath)
    : path.join(projectRoot, '.plan-enforcer', 'awareness.md');
  const ledgerPath = opts.ledgerPath
    ? path.resolve(cwd, opts.ledgerPath)
    : path.join(projectRoot, '.plan-enforcer', 'ledger.md');
  return { cwd, projectRoot, awarenessPath, ledgerPath };
}

function resolveUserMessagesPath(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  if (opts.userMessagesPath) {
    return path.resolve(cwd, opts.userMessagesPath);
  }
  const projectRoot = opts.projectRoot
    ? path.resolve(opts.projectRoot)
    : findProjectRoot(cwd);
  return path.join(projectRoot, '.plan-enforcer', USER_MESSAGES_BASENAME);
}

function parseAwarenessToken(raw, previousWasAwareness = false) {
  const token = String(raw || '').trim();
  const explicit = token.match(/^A:(I\d+|R\d+)$/i);
  if (explicit) {
    return { id: normalizeId(explicit[1]), awareness: true };
  }
  if (previousWasAwareness && /^(I\d+|R\d+)$/i.test(token)) {
    return { id: normalizeId(token), awareness: true };
  }
  return { id: '', awareness: false };
}

function normalizeAwarenessRefs(refs) {
  const values = Array.isArray(refs) ? refs : String(refs || '').split(',');
  return Array.from(new Set(values
    .map((raw) => String(raw || '').trim().replace(/^A:/i, ''))
    .map((raw) => normalizeId(raw))
    .filter((id) => /^(I\d+|R\d+)$/i.test(id))));
}

function extractAwarenessRefs(chain = []) {
  const refs = [];
  let previousWasAwareness = false;
  for (const raw of chain) {
    const parsed = parseAwarenessToken(raw, previousWasAwareness);
    previousWasAwareness = parsed.awareness;
    if (parsed.awareness) refs.push(parsed.id);
  }
  return Array.from(new Set(refs));
}

function indexAwareness(state) {
  const intents = new Map();
  const restates = new Map();
  const corrections = new Map();

  for (const intent of state.intents || []) intents.set(intent.id, intent);
  for (const restate of state.restates || []) restates.set(restate.id, restate);
  for (const correction of state.corrections || []) {
    for (const ref of correction.refs || []) {
      if (!corrections.has(ref)) corrections.set(ref, []);
      corrections.get(ref).push(correction);
    }
  }

  return { intents, restates, corrections };
}

function awarenessChainTokens(refs) {
  return normalizeAwarenessRefs(refs).map((id) => `A:${id}`);
}

function stemToken(token) {
  let value = String(token || '').toLowerCase();
  if (value.endsWith('ies') && value.length > 4) value = `${value.slice(0, -3)}y`;
  else if (value.endsWith('ing') && value.length > 5) value = value.slice(0, -3);
  else if (value.endsWith('ers') && value.length > 5) value = value.slice(0, -3);
  else if (value.endsWith('er') && value.length > 4) value = value.slice(0, -2);
  else if (value.endsWith('ed') && value.length > 4) value = value.slice(0, -2);
  else if (value.endsWith('es') && value.length > 4) value = value.slice(0, -2);
  else if (value.endsWith('s') && value.length > 4) value = value.slice(0, -1);
  return value;
}

function meaningfulTokens(text) {
  const matches = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const out = [];
  for (const token of matches) {
    if (token.length < 3) continue;
    if (STOPWORDS.has(token)) continue;
    const stemmed = stemToken(token);
    if (stemmed.length < 3) continue;
    if (STOPWORDS.has(stemmed)) continue;
    out.push(stemmed);
  }
  return Array.from(new Set(out));
}

function overlapThreshold(opts = {}) {
  const raw = opts.overlapThreshold != null
    ? opts.overlapThreshold
    : (opts.config && opts.config.overlap_threshold);
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_OVERLAP_THRESHOLD;
}

function sharedMeaningfulTokens(task, intent) {
  const taskTokens = new Set(meaningfulTokens(`${task.name || ''} ${task.evidence || ''}`));
  return meaningfulTokens(intent.quote).filter((token) => taskTokens.has(token));
}

function expandIntentRefs(refs, state) {
  const { intents, restates } = indexAwareness(state);
  const out = [];

  function visit(ref) {
    const id = normalizeId(ref);
    if (!id) return;
    if (intents.has(id)) out.push(id);
    else if (restates.has(id)) {
      for (const child of restates.get(id).refs || []) visit(child);
    }
  }

  for (const ref of refs || []) visit(ref);
  return Array.from(new Set(out));
}

function currentIntents(state, opts = {}) {
  const includeSuperseded = Boolean(opts.includeSuperseded);
  const { restates, corrections } = indexAwareness(state);

  return (state.intents || [])
    .map((intent) => {
      const relatedCorrections = corrections.get(intent.id) || [];
      const superseded = relatedCorrections.some((row) => row.type === 'supersede');
      const narrowed = relatedCorrections.filter((row) => row.type === 'narrow');
      const supportedBy = Array.from(restates.values()).filter((row) => (row.refs || []).includes(intent.id));
      return {
        ...intent,
        active: !superseded,
        superseded,
        narrowed,
        supportedBy
      };
    })
    .filter((intent) => includeSuperseded || intent.active);
}

function normalizeCapturedDate(value) {
  const text = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function awarenessOrdinal(id) {
  const match = String(id || '').trim().match(/^[IR](\d+)$/i);
  return match ? Number(match[1]) : null;
}

function packageScopedIntents(state, opts = {}) {
  const intents = currentIntents(state, opts);
  const scopedIntentIds = normalizeAwarenessRefs([
    ...(opts.mustHaveIntentIds || []),
    ...(opts.taskIntentIds || [])
  ]);
  const mustHaveIntentIds = new Set(scopedIntentIds);
  const scopedOrdinals = scopedIntentIds
    .map((id) => awarenessOrdinal(id))
    .filter((value) => Number.isInteger(value));
  const minScopedOrdinal = scopedOrdinals.length > 0 ? Math.min(...scopedOrdinals) : null;
  const minCapturedDate = normalizeCapturedDate(opts.minCapturedDate);
  if (!minCapturedDate) return intents;
  return intents.filter((intent) => {
    if (mustHaveIntentIds.has(intent.id)) return true;
    const captured = normalizeCapturedDate(intent.captured);
    if (!captured) return false;
    if (captured > minCapturedDate) return true;
    if (captured < minCapturedDate) return false;
    if (!Number.isInteger(minScopedOrdinal)) return true;
    const ordinal = awarenessOrdinal(intent.id);
    return Number.isInteger(ordinal) && ordinal >= minScopedOrdinal;
  });
}

function shouldVerifyIntentQuote(intent) {
  const source = String(intent && intent.source || '').trim().toLowerCase();
  if (!source) return true;
  if (/\bmanual\b/.test(source)) return false;
  if (/\bpre-capture\b/.test(source)) return false;
  return true;
}

function normalizePromptText(value) {
  return String(value || '').replace(/\r\n/g, '\n');
}

function readUserMessages(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_e) {
          return null;
        }
      })
      .filter(Boolean)
      .map((record) => ({
        ...record,
        prompt: typeof record.prompt === 'string'
          ? record.prompt
          : (typeof record.user_prompt === 'string'
            ? record.user_prompt
            : (typeof record.message === 'string' ? record.message : ''))
      }))
      .filter((record) => record.prompt);
  } catch (_e) {
    return [];
  }
}

function latestUserMessage(messages) {
  return Array.isArray(messages) && messages.length > 0
    ? messages[messages.length - 1]
    : null;
}

function quoteMatchesUserMessages(quote, messages) {
  const target = normalizePromptText(quote);
  if (!target) return false;
  return (messages || []).some((record) => normalizePromptText(record.prompt).includes(target));
}

function assessAwarenessQuoteVerification(state, opts = {}) {
  const userMessagesPath = resolveUserMessagesPath(opts);
  const messages = readUserMessages(userMessagesPath);
  const issues = [];

  for (const intent of (state && state.intents) || []) {
    if (!shouldVerifyIntentQuote(intent)) continue;
    if (quoteMatchesUserMessages(intent.quote, messages)) continue;
    const missingLog = messages.length === 0 && !fs.existsSync(userMessagesPath);
    const suffix = missingLog
      ? `; ${userMessagesPath} not found`
      : `; no exact prompt substring match found in ${userMessagesPath}`;
    issues.push({
      code: 'AWARENESS_QUOTE_UNVERIFIED',
      message: `Intent ${intent.id} quote could not be verified against captured user messages (${intent.source || 'no source'}${suffix})`,
      row: intent.id,
      source: intent.source || '',
      quote: intent.quote || ''
    });
  }

  return {
    userMessagesPath,
    messages,
    issues
  };
}

function readLedgerTasks(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return [];
  return parseTaskRows(fs.readFileSync(ledgerPath, 'utf8'));
}

function resolveTaskAwareness(task, state, opts = {}) {
  const threshold = overlapThreshold(opts);
  if (!state || state.schema === 'missing') {
    return {
      refs: [],
      intents: [],
      restates: [],
      issues: [],
      threshold,
      validIntentIds: []
    };
  }
  const refs = extractAwarenessRefs(task.chain);
  const indexed = indexAwareness(state);
  const expandedIntentIds = expandIntentRefs(refs, state);
  const intents = expandedIntentIds.map((id) => indexed.intents.get(id)).filter(Boolean);
  const restates = refs
    .filter((id) => /^R\d+$/i.test(id))
    .map((id) => indexed.restates.get(id))
    .filter(Boolean);
  const issues = [];
  const validIntentIds = new Set();

  if (refs.length === 0 || intents.length === 0) {
    issues.push({
      code: 'AWARENESS_LINK_MISSING',
      message: `Task ${task.id} has no awareness link in Chain`,
      row: task.id,
      refs
    });
  } else {
    for (const intent of intents) {
      const overlap = sharedMeaningfulTokens(task, intent);
      if (overlap.length < threshold) {
        issues.push({
          code: 'AWARENESS_LINK_WEAK',
          message: `Task ${task.id} awareness link ${intent.id} is weak (${overlap.length}/${threshold} shared tokens)`,
          row: task.id,
          ref: intent.id,
          overlap
        });
      } else {
        validIntentIds.add(intent.id);
      }
    }
  }

  return {
    refs,
    intents,
    restates,
    issues,
    threshold,
    validIntentIds: Array.from(validIntentIds)
  };
}

function taskAwareness(taskId, state, ledgerPath, opts = {}) {
  const tasks = readLedgerTasks(ledgerPath);
  const task = tasks.find((row) => normalizeId(row.id) === normalizeId(taskId));
  if (!task) return null;
  return {
    task,
    ...resolveTaskAwareness(task, state, opts)
  };
}

function orphanIntents(state, ledgerPath, opts = {}) {
  const linked = new Set();
  const tasks = readLedgerTasks(ledgerPath);
  const taskIntentIds = new Set(normalizeAwarenessRefs(opts.taskIntentIds || []));
  for (const task of tasks) {
    extractAwarenessRefs(task.chain).forEach((id) => taskIntentIds.add(id));
    const assessment = resolveTaskAwareness(task, state, opts);
    for (const id of assessment.validIntentIds) linked.add(id);
  }

  return packageScopedIntents(state, {
    ...opts,
    taskIntentIds: Array.from(taskIntentIds)
  }).filter((intent) => !linked.has(intent.id));
}

function nextIntentId(state) {
  const nums = (state.intents || [])
    .map((row) => Number((row.id || '').replace(/^I/i, '')))
    .filter((n) => Number.isFinite(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `I${max + 1}`;
}

function createAwarenessTemplate(created) {
  return [
    '# Plan Enforcer Awareness Ledger',
    '<!-- schema: v1 -->',
    `<!-- created: ${created} -->`,
    '',
    '## Project-level intents',
    '',
    '| ID | Quote | Source | Captured |',
    '|----|-------|--------|----------|',
    '',
    '## This-session intents',
    '',
    '| ID | Quote | Source | Captured |',
    '|----|-------|--------|----------|',
    '',
    '## Restate rows',
    '',
    '| ID | Summary | Refs | Captured |',
    '|----|---------|------|----------|',
    '',
    '## Correction rows',
    '',
    '| ID | Type | Refs | Note | Captured |',
    '|----|------|------|------|----------|',
    ''
  ].join('\n');
}

function quoteCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function isIntentTableHeader(line) {
  return /^\|\s*ID\s*\|\s*Quote(?:\s*\([^)]+\))?\s*\|\s*Source\s*\|\s*Captured\s*\|/i.test(line || '');
}

function appendIntentRow(markdown, row) {
  const lines = String(markdown || '').split(/\r?\n/);
  const sectionIndex = lines.findIndex((line) => /^##\s+This-session intents/i.test(line));
  if (sectionIndex === -1) {
    return `${markdown.trimEnd()}\n\n## This-session intents\n\n| ID | Quote | Source | Captured |\n|----|-------|--------|----------|\n| ${row.id} | ${quoteCell(row.quote)} | ${quoteCell(row.source)} | ${quoteCell(row.captured)} |\n`;
  }

  let sectionEnd = lines.length;
  for (let i = sectionIndex + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  let tableHeaderIndex = -1;
  for (let i = sectionIndex + 1; i < sectionEnd - 1; i++) {
    if (!isIntentTableHeader(lines[i])) continue;
    if (!/^\|[-\s|]+\|?$/.test(lines[i + 1] || '')) continue;
    tableHeaderIndex = i;
    break;
  }

  let insertAt = sectionEnd;
  if (tableHeaderIndex === -1) {
    const newLines = [];
    if (insertAt > 0 && lines[insertAt - 1].trim() !== '') newLines.push('');
    newLines.push(
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      `| ${row.id} | ${quoteCell(row.quote)} | ${quoteCell(row.source)} | ${quoteCell(row.captured)} |`
    );
    if (insertAt < lines.length && lines[insertAt].trim() !== '') newLines.push('');
    lines.splice(insertAt, 0, ...newLines);
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
  }

  insertAt = tableHeaderIndex + 2;
  while (insertAt < sectionEnd && /^\|/.test(lines[insertAt])) insertAt++;
  lines.splice(insertAt, 0, `| ${row.id} | ${quoteCell(row.quote)} | ${quoteCell(row.source)} | ${quoteCell(row.captured)} |`);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function renderTaskRow(cells) {
  return `| ${cells.join(' | ')} |`;
}

function appendAwarenessRefsToTask(taskId, refs, opts = {}) {
  const normalizedTaskId = normalizeId(taskId);
  if (!/^T\d+$/i.test(normalizedTaskId)) throw new Error(`Invalid task ID "${taskId}"`);
  const awarenessTokens = awarenessChainTokens(refs);
  if (awarenessTokens.length === 0) throw new Error('Missing awareness refs. Example: link T5 I3,I4');

  const paths = resolvePaths(opts);
  if (!fs.existsSync(paths.ledgerPath)) throw new Error(`Ledger not found at ${paths.ledgerPath}`);

  const markdown = fs.readFileSync(paths.ledgerPath, 'utf8');
  const lines = markdown.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => new RegExp(`^\\|\\s*${normalizedTaskId}\\s*\\|`, 'i').test(line));
  if (lineIndex === -1) throw new Error(`Task ${normalizedTaskId} not found in ledger`);

  const cells = splitRow(lines[lineIndex]);
  if (cells.length < 6) throw new Error(`Task ${normalizedTaskId} is on a schema without Chain support`);

  const merged = [...parseChainCell(cells[4] || '')];
  for (const token of awarenessTokens) {
    if (!merged.includes(token)) merged.push(token);
  }

  cells[0] = normalizedTaskId;
  cells[4] = merged.join(', ');
  lines[lineIndex] = renderTaskRow(cells.slice(0, 6));
  fs.writeFileSync(paths.ledgerPath, `${lines.join('\n')}\n`, 'utf8');

  return {
    taskId: normalizedTaskId,
    refs: normalizeAwarenessRefs(refs),
    chain: merged,
    ledgerPath: paths.ledgerPath
  };
}

function addIntent(opts = {}) {
  const paths = resolvePaths(opts);
  const created = opts.captured || new Date().toISOString().slice(0, 10);
  const quote = String(opts.quote || '').trim();
  if (!quote) throw new Error('Missing awareness intent quote');

  fs.mkdirSync(path.dirname(paths.awarenessPath), { recursive: true });
  const initial = fs.existsSync(paths.awarenessPath)
    ? fs.readFileSync(paths.awarenessPath, 'utf8')
    : createAwarenessTemplate(created);
  const state = parseAwareness(initial);
  const row = {
    id: nextIntentId(state),
    quote,
    source: String(opts.source || 'manual').trim() || 'manual',
    captured: created
  };
  const updated = appendIntentRow(initial, row);
  fs.writeFileSync(paths.awarenessPath, updated, 'utf8');
  return { ...row, awarenessPath: paths.awarenessPath };
}

function captureLatestIntent(opts = {}) {
  const loaded = loadAwarenessState(opts);
  const userMessagesPath = resolveUserMessagesPath({
    ...opts,
    cwd: loaded.cwd,
    projectRoot: loaded.projectRoot
  });

  if (opts.ifEmpty && (loaded.state.intents || []).length > 0) {
    return {
      skipped: true,
      reason: 'awareness-not-empty',
      awarenessPath: loaded.awarenessPath,
      userMessagesPath,
      existingIntents: loaded.state.intents.length
    };
  }

  const latest = latestUserMessage(readUserMessages(userMessagesPath));
  if (!latest) throw new Error(`No captured user messages found at ${userMessagesPath}`);

  const quote = normalizePromptText(latest.prompt).trim();
  if (!quote) throw new Error(`Latest captured user message at ${userMessagesPath} is empty`);
  if (/\n/.test(quote)) {
    throw new Error('Latest captured user message spans multiple lines; use plan-enforcer-awareness add --intent "<verbatim excerpt>" for an exact quote');
  }

  const created = latest.ts
    ? String(latest.ts).slice(0, 10)
    : undefined;
  const row = addIntent({
    ...opts,
    cwd: loaded.cwd,
    awarenessPath: loaded.awarenessPath,
    quote,
    source: opts.source || `msg:${latest.index || 1}`,
    captured: opts.captured || created
  });

  return {
    skipped: false,
    ...row,
    userMessagesPath,
    messageIndex: latest.index || 1,
    sessionId: latest.session_id || null
  };
}

function loadAwarenessState(opts = {}) {
  const paths = resolvePaths(opts);
  return {
    ...paths,
    state: readAwareness(paths.awarenessPath)
  };
}

function summarizeAwareness(opts = {}) {
  const loaded = loadAwarenessState(opts);
  const initialized = loaded.state.schema !== 'missing';
  if (!initialized) {
    return {
      ...loaded,
      initialized: false,
      liveIntents: [],
      orphanRows: [],
      quoteIssues: [],
      linkedCount: 0,
      userMessagesPath: resolveUserMessagesPath({
        ...opts,
        cwd: loaded.cwd,
        projectRoot: loaded.projectRoot
      })
    };
  }

  const taskIntentIds = new Set(normalizeAwarenessRefs(opts.taskIntentIds || []));
  for (const task of readLedgerTasks(loaded.ledgerPath)) {
    extractAwarenessRefs(task.chain).forEach((id) => taskIntentIds.add(id));
  }
  const packageOpts = {
    ...opts,
    taskIntentIds: Array.from(taskIntentIds)
  };
  const liveIntents = packageScopedIntents(loaded.state, packageOpts);
  const orphanRows = orphanIntents(loaded.state, loaded.ledgerPath, packageOpts);
  const quoteAssessment = assessAwarenessQuoteVerification(loaded.state, {
    ...opts,
    cwd: loaded.cwd,
    projectRoot: loaded.projectRoot
  });

  return {
    ...loaded,
    initialized: true,
    liveIntents,
    orphanRows,
    quoteIssues: quoteAssessment.issues,
    linkedCount: Math.max(0, liveIntents.length - orphanRows.length),
    userMessagesPath: quoteAssessment.userMessagesPath
  };
}

module.exports = {
  addIntent,
  assessAwarenessQuoteVerification,
  appendAwarenessRefsToTask,
  appendIntentRow,
  awarenessChainTokens,
  captureLatestIntent,
  quoteMatchesUserMessages,
  createAwarenessTemplate,
  currentIntents,
  expandIntentRefs,
  packageScopedIntents,
  extractAwarenessRefs,
  findProjectRoot,
  loadAwarenessState,
  meaningfulTokens,
  nextIntentId,
  latestUserMessage,
  normalizeAwarenessRefs,
  normalizePromptText,
  orphanIntents,
  parseAwarenessToken,
  readLedgerTasks,
  readUserMessages,
  resolveTaskAwareness,
  resolvePaths,
  resolveUserMessagesPath,
  sharedMeaningfulTokens,
  shouldVerifyIntentQuote,
  summarizeAwareness,
  taskAwareness
};
