const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { FILE_CANDIDATE_RE, TEST_NAME_RE } = require('./evidence');

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const SCRIPT_PRIORITY = ['test', 'verify', 'check', 'typecheck', 'lint', 'build'];

const EVIDENCE_PATTERNS = [
  { re: /\bnpm test\b/i },
  { re: /\bnpm run ([\w:-]+)\b/i, canonical: (match) => `npm run ${match[1]}` },
  { re: /\bpnpm exec vitest(?:\s+run)?\b/i },
  { re: /\bnpx vitest(?:\s+run)?\b/i },
  { re: /\bvitest(?:\s+run)?\b/i },
  { re: /\bbun test\b/i },
  { re: /\bbun x vitest(?:\s+run)?\b/i },
  { re: /\bbun run ([\w:-]+)\b/i, canonical: (match) => `bun run ${match[1]}` },
  { re: /\bnpx jest\b/i },
  { re: /\bjest\b/i },
  { re: /\bpnpm test\b/i },
  { re: /\bpnpm run ([\w:-]+)\b/i, canonical: (match) => `pnpm run ${match[1]}` },
  { re: /\bpnpm (verify|check|typecheck|lint|build)\b/i, canonical: (match) => `pnpm ${match[1]}` },
  { re: /\bpnpm exec (vitest(?:\s+run)?|playwright test|jest|eslint|biome check(?:\s+\S+)*)\b/i, canonical: (match) => `pnpm exec ${match[1]}` },
  { re: /\byarn test\b/i },
  { re: /\byarn (verify|check|typecheck|lint|build)\b/i, canonical: (match) => `yarn ${match[1]}` },
  { re: /\bnode --test\b/i },
  { re: /\bpython -m pytest\b/i },
  { re: /\buv run pytest\b/i },
  { re: /\bpython -m unittest\b/i },
  { re: /\bpytest\b/i },
  { re: /\bruff check(?:\s+\S+)*\b/i },
  { re: /\bmypy(?:\s+\S+)*\b/i },
  { re: /\beslint(?:\s+\S+)*\b/i },
  { re: /\bbiome check(?:\s+\S+)*\b/i },
  { re: /\bplaywright test(?:\s+\S+)*\b/i },
  { re: /\btsc(?:\s+-b|\s+--noEmit)?\b/i },
  { re: /\bcargo test\b/i },
  { re: /\bcargo check\b/i },
  { re: /\bcargo clippy\b/i },
  { re: /\bcargo nextest run\b/i },
  { re: /\bgo test(?:\s+\S+)*\b/i }
];

function sanitizeStamp(iso) {
  return String(iso || new Date().toISOString()).replace(/[:]/g, '-');
}

function normalizeCommand(command) {
  return String(command || '').trim().replace(/\s+/g, ' ');
}

function parseEvidenceCommand(evidenceText) {
  const text = String(evidenceText || '');
  for (const pattern of EVIDENCE_PATTERNS) {
    const match = text.match(pattern.re);
    if (!match) continue;
    const command = pattern.canonical ? pattern.canonical(match) : match[0];
    return normalizeCommand(command);
  }
  return null;
}

function sessionLogPathFor(projectRoot, explicitPath) {
  if (explicitPath) return explicitPath;
  if (!projectRoot) return null;
  return path.join(projectRoot, '.plan-enforcer', '.session-log.jsonl');
}

function readSessionLogRecords(sessionLogPath) {
  if (!sessionLogPath || !fs.existsSync(sessionLogPath)) return [];
  try {
    return fs.readFileSync(sessionLogPath, 'utf8')
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
      .filter(Boolean);
  } catch (_e) {
    return [];
  }
}

function extractEvidenceHints(evidenceText) {
  const text = String(evidenceText || '');
  const hints = new Set();
  let match;
  while ((match = FILE_CANDIDATE_RE.exec(text)) !== null) {
    hints.add(match[1].toLowerCase());
  }
  while ((match = TEST_NAME_RE.exec(text)) !== null) {
    const value = match[1].trim().toLowerCase();
    if (value.length >= 3) hints.add(value);
  }
  const words = text.toLowerCase().match(/[a-z0-9_.:/-]{4,}/g) || [];
  for (const word of words) {
    if (['tests', 'pass', 'passed', 'green', 'check', 'verify', 'verified', 'build'].includes(word)) continue;
    hints.add(word);
  }
  return Array.from(hints);
}

function scoreSessionVerificationCommand(command, response, hints) {
  const blob = `${String(command || '')}\n${JSON.stringify(response || {})}`.toLowerCase();
  let score = 0;
  for (const hint of hints) {
    if (!hint || hint.length < 4) continue;
    if (blob.includes(hint)) score++;
  }
  return score;
}

function detectSessionLogCommand(projectRoot, evidenceText, sessionLogPath) {
  const records = readSessionLogRecords(sessionLogPathFor(projectRoot, sessionLogPath));
  if (records.length === 0) return null;
  const hints = extractEvidenceHints(evidenceText);
  const candidates = [];
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record.tool !== 'Bash') continue;
    const raw = record.input && record.input.command;
    if (!raw || typeof raw !== 'string') continue;
    const command = parseEvidenceCommand(raw);
    if (!command) continue;
    candidates.push({
      command,
      score: scoreSessionVerificationCommand(raw, record.response, hints),
      ts: record.ts || '',
      raw
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.ts).localeCompare(String(a.ts));
  });
  if (candidates[0].score > 0 || candidates.length === 1) {
    return {
      command: candidates[0].command,
      source: candidates[0].score > 0 ? 'session-log:matched-verification' : 'session-log:latest-verification'
    };
  }
  return null;
}

function readPackageScripts(projectRoot) {
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg && pkg.scripts ? pkg.scripts : null;
  } catch (_e) {
    return null;
  }
}

function detectPackageCommand(projectRoot) {
  const scripts = readPackageScripts(projectRoot);
  if (scripts) {
    for (const name of SCRIPT_PRIORITY) {
      if (!scripts[name]) continue;
      const command = name === 'test' ? 'npm test' : `npm run ${name}`;
      return { command, source: `package.json:${name}` };
    }
  }
  if (fs.existsSync(path.join(projectRoot, 'pytest.ini')) || fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) {
    return { command: 'pytest', source: 'convention:pytest' };
  }
  if (fs.existsSync(path.join(projectRoot, '.ruff.toml')) || fs.existsSync(path.join(projectRoot, 'ruff.toml'))) {
    return { command: 'ruff check .', source: 'convention:ruff' };
  }
  if (fs.existsSync(path.join(projectRoot, 'mypy.ini'))) {
    return { command: 'mypy .', source: 'convention:mypy' };
  }
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    return { command: 'cargo test', source: 'convention:cargo' };
  }
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    return { command: 'go test ./...', source: 'convention:go' };
  }
  return null;
}

function detectVerificationCommand({ projectRoot, config, evidenceText, sessionLogPath }) {
  const checkCmd = config && typeof config.check_cmd === 'string' ? config.check_cmd.trim() : '';
  if (checkCmd) {
    return { command: normalizeCommand(checkCmd), source: 'config:check_cmd' };
  }
  const evidenceCommand = parseEvidenceCommand(evidenceText);
  if (evidenceCommand) {
    return { command: evidenceCommand, source: 'evidence' };
  }
  const packageCommand = detectPackageCommand(projectRoot);
  if (packageCommand) return packageCommand;
  return detectSessionLogCommand(projectRoot, evidenceText, sessionLogPath);
}

function assessExecutedVerification({ projectRoot, enforcerDir, taskId, evidenceText, config, sessionLogPath }) {
  const detected = detectVerificationCommand({ projectRoot, config, evidenceText, sessionLogPath });
  if (!detected) {
    return {
      required: false,
      state: 'not_required',
      command: null,
      latest: null
    };
  }

  const latest = readLatestExecutedVerification(enforcerDir, taskId);
  if (!latest) {
    return {
      required: true,
      state: 'missing',
      command: detected.command,
      source: detected.source,
      latest: null
    };
  }

  if (latest.ok === false) {
    return {
      required: true,
      state: 'failed',
      command: detected.command,
      source: detected.source,
      latest
    };
  }

  if (normalizeCommand(latest.command) && normalizeCommand(latest.command) !== normalizeCommand(detected.command)) {
    return {
      required: true,
      state: 'stale',
      command: detected.command,
      source: detected.source,
      latest
    };
  }

  return {
    required: true,
    state: 'ok',
    command: detected.command,
    source: detected.source,
    latest
  };
}

function latestIndexPath(enforcerDir) {
  return path.join(enforcerDir, 'checks', 'latest.json');
}

function readLatestExecutedVerification(enforcerDir, taskId) {
  const indexPath = latestIndexPath(enforcerDir);
  if (!fs.existsSync(indexPath)) return null;
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return taskId ? (index[taskId] || null) : index;
  } catch (_e) {
    return null;
  }
}

function writeLatestExecutedVerification(enforcerDir, taskId, meta) {
  const indexPath = latestIndexPath(enforcerDir);
  let index = {};
  try {
    if (fs.existsSync(indexPath)) index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (_e) {
    index = {};
  }
  index[taskId] = meta;
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

function runExecutedVerification({ projectRoot, enforcerDir, taskId, evidenceText, config, sessionLogPath }) {
  const detected = detectVerificationCommand({ projectRoot, config, evidenceText, sessionLogPath });
  if (!detected) {
    return { detected: false, ok: null, command: null, source: null };
  }

  const checksDir = path.join(enforcerDir, 'checks');
  fs.mkdirSync(checksDir, { recursive: true });
  const startedAt = new Date();
  const stamp = sanitizeStamp(startedAt.toISOString());
  const logPath = path.join(checksDir, `${taskId}-${stamp}.log`);
  const jsonPath = path.join(checksDir, `${taskId}-${stamp}.json`);
  const started = Date.now();

  const result = spawnSync(detected.command, {
    cwd: projectRoot,
    shell: true,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    env: { ...process.env, PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8' }
  });

  const durationMs = Date.now() - started;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const exitCode = timedOut ? null : (typeof result.status === 'number' ? result.status : 1);
  const ok = !timedOut && exitCode === 0;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  const meta = {
    taskId,
    ts: startedAt.toISOString(),
    command: normalizeCommand(detected.command),
    source: detected.source,
    ok,
    exitCode,
    timedOut,
    durationMs,
    logPath: path.relative(projectRoot, logPath).replace(/\\/g, '/'),
    jsonPath: path.relative(projectRoot, jsonPath).replace(/\\/g, '/')
  };

  const logContent = [
    `task: ${taskId}`,
    `ts: ${meta.ts}`,
    `command: ${meta.command}`,
    `source: ${detected.source}`,
    `ok: ${ok}`,
    `exit_code: ${exitCode == null ? 'timeout' : exitCode}`,
    `duration_ms: ${durationMs}`,
    '',
    '--- stdout ---',
    stdout,
    '',
    '--- stderr ---',
    stderr
  ].join('\n');

  fs.writeFileSync(logPath, logContent);
  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
  writeLatestExecutedVerification(enforcerDir, taskId, meta);

  return {
    detected: true,
    ...meta
  };
}

module.exports = {
  assessExecutedVerification,
  COMMAND_TIMEOUT_MS,
  detectPackageCommand,
  detectSessionLogCommand,
  detectVerificationCommand,
  extractEvidenceHints,
  normalizeCommand,
  parseEvidenceCommand,
  readSessionLogRecords,
  readLatestExecutedVerification,
  runExecutedVerification,
  scoreSessionVerificationCommand,
  writeLatestExecutedVerification
};
