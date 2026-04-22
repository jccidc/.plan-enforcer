const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { FILE_CANDIDATE_RE, TEST_NAME_RE } = require('./evidence');

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const SCRIPT_PRIORITY = ['test', 'verify', 'check', 'typecheck', 'lint', 'build'];
const PACKAGE_MANAGER_PRIORITY = [
  { manager: 'bun', files: ['bun.lock', 'bun.lockb'] },
  { manager: 'pnpm', files: ['pnpm-lock.yaml'] },
  { manager: 'yarn', files: ['yarn.lock'] },
  { manager: 'npm', files: ['package-lock.json', 'npm-shrinkwrap.json'] }
];
const PYTHON_ENV_MANAGER_PRIORITY = [
  { manager: 'uv', files: ['uv.lock'], pyproject: /^\s*\[tool\.uv(?:\.|])?/m },
  { manager: 'poetry', files: ['poetry.lock'], pyproject: /^\s*\[tool\.poetry(?:\.|])?/m },
  { manager: 'pipenv', files: ['Pipfile.lock', 'Pipfile'] }
];
const JS_EXEC_BINARIES = ['vitest', 'jest', 'playwright', 'eslint', 'biome', 'tsc'];
const PYTHON_EXEC_BINARIES = ['pytest', 'tox', 'nox', 'ruff', 'mypy'];
const JS_TOOL_CONVENTIONS = [
  {
    source: 'convention:vitest',
    files: ['vitest.config.js', 'vitest.config.cjs', 'vitest.config.mjs', 'vitest.config.ts', 'vitest.config.cts', 'vitest.config.mts'],
    binary: 'vitest',
    args: ['run']
  },
  {
    source: 'convention:jest',
    files: ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.ts', 'jest.config.cts', 'jest.config.mts'],
    binary: 'jest',
    args: []
  },
  {
    source: 'convention:playwright',
    files: ['playwright.config.js', 'playwright.config.cjs', 'playwright.config.mjs', 'playwright.config.ts', 'playwright.config.cts', 'playwright.config.mts'],
    binary: 'playwright',
    args: ['test']
  },
  {
    source: 'convention:eslint',
    files: ['eslint.config.js', 'eslint.config.cjs', 'eslint.config.mjs', 'eslint.config.ts', 'eslint.config.cts', 'eslint.config.mts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml'],
    binary: 'eslint',
    args: ['.']
  },
  {
    source: 'convention:biome',
    files: ['biome.json', 'biome.jsonc'],
    binary: 'biome',
    args: ['check', '.']
  },
  {
    source: 'convention:tsc',
    files: ['tsconfig.json', 'tsconfig.base.json'],
    binary: 'tsc',
    args: ['--noEmit']
  }
];
const NODE_TEST_FILE_RE = /\.(test|spec)\.(js|cjs|mjs)$/i;
const PYTHON_UNITTEST_FILE_RE = /(?:^|[\\/])(?:test_.*\.py|.*_test\.py)$/i;
const PHP_TEST_FILE_RE = /(?:^|[\\/])tests?[\\/].*Test\.php$/i;
const DENO_TEST_FILE_RE = /(?:^|[\\/])(?:test_.*|.*(?:\.|_)test)\.(?:ts|tsx|js|jsx|mjs|mts|cts)$/i;
const RUBY_SPEC_FILE_RE = /(?:^|[\\/])spec[\\/].*_spec\.rb$/i;
const DOTNET_PROJECT_FILE_RE = /\.(?:sln|csproj|fsproj|vbproj)$/i;
const HASKELL_CABAL_FILE_RE = /\.cabal$/i;
const DEFAULT_SCAN_IGNORES = new Set(['.git', '.plan-enforcer', 'node_modules', '__pycache__', '.venv', 'venv', 'vendor', 'bin', 'obj']);
const SCRIPT_FRONTDOOR_DIRS = ['scripts', 'script', 'tools', 'bin'];
const ROOT_SCRIPT_FRONTDOOR_NAMES = ['verify', 'check', 'typecheck', 'lint', 'build'];
const SCRIPT_FRONTDOOR_EXTENSIONS = ['.js', '.cjs', '.mjs', '.py', '.sh', '.bash', '.ps1', '.cmd', '.bat'];
const SCRIPT_FRONTDOOR_PATH_SOURCE = '(?:(?:\\.[\\\\/])?(?:(?:scripts|script|tools|bin)[\\\\/])|(?:\\.[\\\\/])?)?(?:test|verify|check|typecheck|lint|build)(?:[-_.][\\w-]+)?(?:\\.js|\\.cjs|\\.mjs|\\.py|\\.sh|\\.bash|\\.ps1|\\.cmd|\\.bat)';
const COMMAND_STARTERS = [
  'npm', 'pnpm', 'yarn', 'bun', 'npx', 'vitest', 'jest', 'node', 'uv',
  'poetry', 'pipenv', 'python', 'pytest', 'tox', 'nox', 'ruff', 'mypy',
  'eslint', 'biome', 'playwright', 'tsc', 'deno', 'dotnet', 'bundle',
  'rspec', './gradlew', 'gradle', 'mvn', 'composer', 'php',
  'vendor/bin/pest', 'vendor/bin/phpunit', 'phpunit', 'mix', 'swift',
  'ctest', 'meson', 'stack', 'cabal', 'make', 'just', 'task', 'cargo',
  'go'
];
const FOLLOWUP_COMMAND_RE = new RegExp(
  `\\s+(?:and then|then|and|&&)\\s+(?=(?:${COMMAND_STARTERS
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\b).*$`,
  'i'
);

const EVIDENCE_PATTERNS = [
  { re: /\bnpm test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bnpm run [\w:-]+(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bnpm exec(?:\s+--)?\s+(vitest(?:\s+run)?|playwright test(?:\s+\S+)*|jest(?:\s+\S+)*|eslint(?:\s+\S+)*|biome check(?:\s+\S+)*|tsc(?:\s+-b|\s+--noEmit)?(?:\s+\S+)*)\b/i, canonical: (match) => preserveCommandArgsByPrefixes(match[0], ['npm exec -- playwright test', 'npm exec playwright test', 'npm exec -- biome check', 'npm exec biome check', 'npm exec -- vitest run', 'npm exec vitest run', 'npm exec -- vitest', 'npm exec vitest', 'npm exec -- jest', 'npm exec jest', 'npm exec -- eslint', 'npm exec eslint', 'npm exec -- tsc', 'npm exec tsc']) },
  { re: /\bpnpm exec vitest(?:\s+run)?(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], String(match[0]).includes(' run') ? 3 : 2) },
  { re: /\bnpx vitest(?:\s+run)?(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], String(match[0]).includes(' run') ? 3 : 2) },
  { re: /\bvitest(?:\s+run)?(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], String(match[0]).includes(' run') ? 2 : 1) },
  { re: /\bbun test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bbun x vitest(?:\s+run)?(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], String(match[0]).includes(' run') ? 4 : 3) },
  { re: /\bbun run [\w:-]+(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bnpx jest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bjest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\bpnpm test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bpnpm run [\w:-]+(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bpnpm (verify|check|typecheck|lint|build)(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bpnpm exec(?:\s+--)?\s+(vitest(?:\s+run)?|playwright test(?:\s+\S+)*|jest(?:\s+\S+)*|eslint(?:\s+\S+)*|biome check(?:\s+\S+)*|tsc(?:\s+-b|\s+--noEmit)?(?:\s+\S+)*)\b/i, canonical: (match) => preserveCommandArgsByPrefixes(match[0], ['pnpm exec -- playwright test', 'pnpm exec playwright test', 'pnpm exec -- biome check', 'pnpm exec biome check', 'pnpm exec -- vitest run', 'pnpm exec vitest run', 'pnpm exec -- vitest', 'pnpm exec vitest', 'pnpm exec -- jest', 'pnpm exec jest', 'pnpm exec -- eslint', 'pnpm exec eslint', 'pnpm exec -- tsc', 'pnpm exec tsc']) },
  { re: /\bnpx (playwright test(?:\s+\S+)*|eslint(?:\s+\S+)*|biome check(?:\s+\S+)*|tsc(?:\s+-b|\s+--noEmit)?(?:\s+\S+)*)\b/i, canonical: (match) => preserveCommandArgsByPrefixes(match[0], ['npx playwright test', 'npx biome check', 'npx eslint', 'npx tsc']) },
  { re: /\byarn test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\byarn (verify|check|typecheck|lint|build)(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\byarn run (vitest(?:\s+run)?|playwright test(?:\s+\S+)*|jest(?:\s+\S+)*|eslint(?:\s+\S+)*|biome check(?:\s+\S+)*|tsc(?:\s+-b|\s+--noEmit)?(?:\s+\S+)*)\b/i, canonical: (match) => preserveCommandArgsByPrefixes(match[0], ['yarn run playwright test', 'yarn run biome check', 'yarn run vitest run', 'yarn run vitest', 'yarn run jest', 'yarn run eslint', 'yarn run tsc']) },
  { re: /\byarn run [\w:-]+(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\byarn (vitest(?:\s+run)?|playwright test(?:\s+\S+)*|jest(?:\s+\S+)*|eslint(?:\s+\S+)*|biome check(?:\s+\S+)*|tsc(?:\s+-b|\s+--noEmit)?(?:\s+\S+)*)\b/i, canonical: (match) => preserveCommandArgsByPrefixes(match[0], ['yarn playwright test', 'yarn biome check', 'yarn vitest run', 'yarn vitest', 'yarn jest', 'yarn eslint', 'yarn tsc']) },
  { re: /\bbun x (playwright test(?:\s+\S+)*|jest(?:\s+\S+)*|eslint(?:\s+\S+)*|biome check(?:\s+\S+)*|tsc(?:\s+-b|\s+--noEmit)?(?:\s+\S+)*)\b/i, canonical: (match) => preserveCommandArgsByPrefixes(match[0], ['bun x playwright test', 'bun x biome check', 'bun x jest', 'bun x eslint', 'bun x tsc']) },
  { re: /\bnode --test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: new RegExp(`\\b(?:bash|sh)\\s+${SCRIPT_FRONTDOOR_PATH_SOURCE}(?:\\s+\\S+)*`, 'i'), canonical: (match) => canonicalizeScriptFrontdoorCommand(match[0]) },
  { re: new RegExp(`\\b(?:pwsh|powershell(?:\\.exe)?)(?:\\s+-File)?\\s+${SCRIPT_FRONTDOOR_PATH_SOURCE}(?:\\s+\\S+)*`, 'i'), canonical: (match) => canonicalizeScriptFrontdoorCommand(match[0]) },
  { re: new RegExp(`\\bpython(?:\\d(?:\\.\\d+)*)?\\s+${SCRIPT_FRONTDOOR_PATH_SOURCE}(?:\\s+\\S+)*`, 'i'), canonical: (match) => canonicalizeScriptFrontdoorCommand(match[0]) },
  { re: new RegExp(`\\bnode\\s+${SCRIPT_FRONTDOOR_PATH_SOURCE}(?:\\s+\\S+)*`, 'i'), canonical: (match) => canonicalizeScriptFrontdoorCommand(match[0]) },
  { re: new RegExp(`(?:^|\\s)(${SCRIPT_FRONTDOOR_PATH_SOURCE}(?:\\s+\\S+)*)`, 'i'), canonical: (match) => canonicalizeScriptFrontdoorCommand(match[1]) },
  { re: /\buv run python -m pytest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 5) },
  { re: /\bpoetry run python -m pytest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 5) },
  { re: /\bpipenv run python -m pytest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 5) },
  { re: /\bpython -m pytest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\buv run pytest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bpoetry run pytest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bpipenv run pytest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\buv run python -m unittest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 5) },
  { re: /\bpoetry run python -m unittest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 5) },
  { re: /\bpipenv run python -m unittest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 5) },
  { re: /\bpython -m unittest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\buv run tox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bpoetry run tox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bpipenv run tox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bpython -m tox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\btox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\buv run nox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bpoetry run nox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bpipenv run nox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bpython -m nox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bnox(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\bpytest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\bruff check(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bmypy(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\beslint(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\bbiome check(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bplaywright test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\btsc(?:\s+-b|\s+--noEmit)?(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\bdeno test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bdotnet test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bbundle exec rspec(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\brspec(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /(?:^|\s)(\.\/gradlew test(?:\s+\S+)*)\b/i, canonical: (match) => preserveCommandArgs(match[1], 2) },
  { re: /\bgradle test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bmvn test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bcomposer run(?:-script)? (test|verify|check|typecheck|lint|build)(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bcomposer (test|verify|check|typecheck|lint|build)(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bphp artisan test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bvendor\/bin\/pest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\bvendor\/bin\/phpunit(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\bphpunit(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\bmix test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bswift test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bctest(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 1) },
  { re: /\bmeson test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bstack test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bcabal test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bmake (test|verify|check|typecheck|lint|build)(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bjust (test|verify|check|typecheck|lint|build)(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\btask (test|verify|check|typecheck|lint|build)(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bcargo test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bcargo check(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bcargo clippy(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) },
  { re: /\bcargo nextest run(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 3) },
  { re: /\bgo test(?:\s+\S+)*\b/i, canonical: (match) => preserveCommandArgs(match[0], 2) }
];
const VERIFICATION_CLAIM_PATTERNS = [
  /\b(?:test|tests|tested|pytest|jest|vitest|playwright|phpunit|pest|rspec|ctest)\b/i,
  /\b(?:cargo test|go test|dotnet test|mvn test|gradle test|swift test|meson test|mix test)\b/i,
  /\b(?:lint|linted|typecheck|typechecked|typed|ruff|mypy|eslint|biome|clippy|check|checked)\b/i,
  /\b\d+\s+(?:passed|failed|passing|failing)\b/i,
  /\b(?:pass(?:ed)?|fail(?:ed)?|green)\b/i
];

function sanitizeStamp(iso) {
  return String(iso || new Date().toISOString()).replace(/[:]/g, '-');
}

function balanceTrailingDoubleQuote(command) {
  const text = String(command || '');
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    if (i > 0 && text[i - 1] === '\\') continue;
    count++;
  }
  if (count % 2 === 1 && !text.endsWith('"')) return `${text}"`;
  return text;
}

function normalizeCommand(command) {
  const normalized = String(command || '')
    .replace(FOLLOWUP_COMMAND_RE, '')
    .trim()
    .replace(/\s+/g, ' ');
  return balanceTrailingDoubleQuote(normalized);
}

function normalizeCommandList(commands) {
  const values = Array.isArray(commands) ? commands : [commands];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeCommand(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function formatCommandSet(commands) {
  return normalizeCommandList(commands).join(' && ');
}

const SAFE_ARGUMENT_WORDS = new Set(['all', 'discover']);
const TRAILING_ARG_NOISE_RE = /[,\];)]+$/;
const ARG_STOP_WORDS = new Set([
  'after', 'again', 'and', 'before', 'close', 'closing', 'green', 'output',
  'outputs', 'pass', 'passed', 'save', 'saved', 'then', 'verified', 'via',
  'with'
]);

function stripWrappedToken(token) {
  const text = String(token || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('\'') && text.endsWith('\''))) {
    return text.slice(1, -1);
  }
  return text;
}

function sanitizePreservedArgToken(token) {
  let text = String(token || '').trim();
  if (!text) return '';
  text = text.replace(TRAILING_ARG_NOISE_RE, '');
  if (
    text.endsWith('.')
    && text.length > 1
    && /[\w"'`)\]]$/.test(text.slice(0, -1))
    && !/^[A-Za-z]:\.$/.test(text)
  ) {
    text = text.slice(0, -1);
  }
  return text;
}

function normalizeRelativeCommandPath(value) {
  const text = stripWrappedToken(value).replace(/\\/g, '/').trim();
  if (!text) return '';
  if (/^(?:[A-Za-z]:|\/)/.test(text)) return text;
  if (text.startsWith('./') || text.startsWith('../')) return text;
  return `./${text}`;
}

function looksLikeScriptFrontdoorPath(value) {
  return new RegExp(`^${SCRIPT_FRONTDOOR_PATH_SOURCE}$`, 'i').test(stripWrappedToken(value).replace(/\\/g, '/'));
}

function formatScriptFrontdoorCommand(scriptPath, trailingArgs = '') {
  const normalizedPath = normalizeRelativeCommandPath(scriptPath);
  if (!looksLikeScriptFrontdoorPath(normalizedPath)) return '';
  const ext = path.extname(normalizedPath).toLowerCase();
  const rest = String(trailingArgs || '').trim();
  let command = normalizedPath;
  if (['.js', '.cjs', '.mjs'].includes(ext)) command = `node ${normalizedPath}`;
  else if (ext === '.py') command = `python ${normalizedPath}`;
  else if (ext === '.ps1') command = `powershell -File ${normalizedPath}`;
  else if (ext === '.sh' || ext === '.bash') command = `bash ${normalizedPath}`;
  return normalizeCommand(rest ? `${command} ${rest}` : command);
}

function tokenLooksLikeCommandArg(token, previousToken = '') {
  const text = stripWrappedToken(sanitizePreservedArgToken(token));
  const previous = stripWrappedToken(sanitizePreservedArgToken(previousToken));
  if (!text) return false;
  if (SAFE_ARGUMENT_WORDS.has(text.toLowerCase())) return true;
  if (/^--?$/.test(text)) return true;
  if (/^--?[\w-]/.test(text)) return true;
  if ((/^--?[\w-]/.test(previous) || previous === '--') && !/^(?:and|then|before|after)$/i.test(text)) {
    return true;
  }
  if (/[./\\=:]/.test(text)) return true;
  if (/^\d[\w.-]*$/.test(text)) return true;
  if (/^[A-Za-z0-9_-]+::[A-Za-z0-9_-]+$/.test(text)) return true;
  if (/^[A-Za-z0-9_.-]+$/.test(text) && (text.includes('.') || text.includes('_') || /[A-Z]/.test(text))) {
    return true;
  }
  if (/^[A-Za-z0-9_-]+$/.test(text) && !ARG_STOP_WORDS.has(text.toLowerCase())) return true;
  return false;
}

function tokenStartsCommandStarter(token) {
  const text = stripWrappedToken(sanitizePreservedArgToken(token)).toLowerCase();
  if (!text) return false;
  return COMMAND_STARTERS.some((starter) => text === starter.toLowerCase());
}

function preserveCommandArgs(rawCommand, baseTokenCount) {
  const normalized = normalizeCommand(rawCommand);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length <= baseTokenCount) return normalized;
  const kept = tokens.slice(0, baseTokenCount);
  for (const token of tokens.slice(baseTokenCount)) {
    const sanitized = sanitizePreservedArgToken(token);
    if (tokenStartsCommandStarter(sanitized)) break;
    if (!tokenLooksLikeCommandArg(sanitized, kept[kept.length - 1])) break;
    kept.push(sanitized);
  }
  return normalizeCommand(kept.join(' '));
}

function preserveCommandArgsByPrefixes(rawCommand, prefixes) {
  const normalized = normalizeCommand(rawCommand);
  const lower = normalized.toLowerCase();
  const matchedPrefix = [...prefixes]
    .sort((a, b) => b.length - a.length)
    .find((prefix) => {
      const lowered = prefix.toLowerCase();
      return lower === lowered || lower.startsWith(`${lowered} `);
    });
  if (!matchedPrefix) return normalized;
  return preserveCommandArgs(normalized, matchedPrefix.trim().split(/\s+/).length);
}

function canonicalizeScriptFrontdoorCommand(rawCommand) {
  const raw = normalizeCommand(rawCommand);
  if (!raw) return '';
  const wrappedMatch = raw.match(/^(?:bash|sh|node|python(?:\d(?:\.\d+)*)?|(?!-File)(?:pwsh|powershell(?:\.exe)?))(?:\s+-File)?\s+(\S+)(.*)$/i);
  if (wrappedMatch && looksLikeScriptFrontdoorPath(wrappedMatch[1])) {
    return formatScriptFrontdoorCommand(wrappedMatch[1], wrappedMatch[2]);
  }
  const bareMatch = raw.match(/^(\S+)(.*)$/);
  if (bareMatch && looksLikeScriptFrontdoorPath(bareMatch[1])) {
    return formatScriptFrontdoorCommand(bareMatch[1], bareMatch[2]);
  }
  return '';
}

function cloneRegexWithGlobal(re) {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  return new RegExp(re.source, flags);
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function parseEvidenceCommands(evidenceText) {
  const text = String(evidenceText || '');
  const matches = [];
  EVIDENCE_PATTERNS.forEach((pattern, patternIndex) => {
    const re = cloneRegexWithGlobal(pattern.re);
    let match;
    while ((match = re.exec(text)) !== null) {
      const command = pattern.canonical ? pattern.canonical(match) : match[0];
      const trimmed = String(command || '').replace(FOLLOWUP_COMMAND_RE, '').trim();
      const normalized = normalizeCommand(trimmed);
      if (normalized) {
        const displayIndex = match[0].indexOf(trimmed);
        const start = match.index + (displayIndex >= 0 ? displayIndex : 0);
        matches.push({
          command: normalized,
          start,
          end: start + trimmed.length,
          patternIndex
        });
        const nextIndex = start + trimmed.length;
        if (nextIndex > match.index && nextIndex < re.lastIndex) {
          re.lastIndex = nextIndex;
        }
      }
      if (match[0].length === 0) re.lastIndex += 1;
    }
  });

  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.patternIndex !== b.patternIndex) return a.patternIndex - b.patternIndex;
    return (b.end - b.start) - (a.end - a.start);
  });

  const accepted = [];
  for (const match of matches) {
    if (accepted.some((existing) => existing.command === match.command)) continue;
    if (accepted.some((existing) => rangesOverlap(existing, match))) continue;
    accepted.push(match);
  }

  return accepted.map((match) => match.command);
}

function parseEvidenceCommand(evidenceText) {
  const commands = parseEvidenceCommands(evidenceText);
  return commands.length > 0 ? commands[0] : null;
}

function evidenceClaimsExecutableVerification(evidenceText) {
  const text = String(evidenceText || '').trim();
  if (!text) return false;
  if (parseEvidenceCommands(text).length > 0) return true;
  return VERIFICATION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

function commandSet(meta) {
  if (!meta) return [];
  if (Array.isArray(meta.commands)) return normalizeCommandList(meta.commands);
  return normalizeCommandList(meta.command);
}

function buildVerificationTarget(commands, source) {
  const normalized = normalizeCommandList(commands);
  if (normalized.length === 0) return null;
  return {
    command: formatCommandSet(normalized),
    commands: normalized,
    source: source || ''
  };
}

function isBareJsExecCommand(command) {
  const normalized = normalizeCommand(command);
  return JS_EXEC_BINARIES.some((binary) => new RegExp(`^${binary}(?:\\s|$)`, 'i').test(normalized));
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
    const commands = wrapInferredCommandsForProject(parseEvidenceCommands(raw), projectRoot);
    if (commands.length === 0) continue;
    candidates.push({
      command: formatCommandSet(commands),
      commands,
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
    return buildVerificationTarget(
      candidates[0].commands,
      candidates[0].score > 0 ? 'session-log:matched-verification' : 'session-log:latest-verification'
    );
  }
  return null;
}

function readPackageManifest(projectRoot) {
  return readJsonFile(path.join(projectRoot, 'package.json'));
}

function readComposerManifest(projectRoot) {
  return readJsonFile(path.join(projectRoot, 'composer.json'));
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function readTextFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return '';
  }
}

function detectPackageManager(projectRoot) {
  const pkg = readPackageManifest(projectRoot);
  const declared = pkg && typeof pkg.packageManager === 'string'
    ? pkg.packageManager.trim().toLowerCase()
    : '';
  const declaredMatch = declared.match(/^(npm|pnpm|yarn|bun)(?:@|$)/);
  if (declaredMatch) return declaredMatch[1];

  for (const candidate of PACKAGE_MANAGER_PRIORITY) {
    if (candidate.files.some((file) => fs.existsSync(path.join(projectRoot, file)))) {
      return candidate.manager;
    }
  }
  return 'npm';
}

function formatPackageScriptCommand(manager, name) {
  const script = String(name || '').trim();
  switch (manager) {
    case 'pnpm':
      return script === 'test' ? 'pnpm test' : `pnpm ${script}`;
    case 'yarn':
      return script === 'test' ? 'yarn test' : `yarn ${script}`;
    case 'bun':
      return `bun run ${script}`;
    case 'npm':
    default:
      return script === 'test' ? 'npm test' : `npm run ${script}`;
  }
}

function formatPackageBinaryCommand(manager, binary, args) {
  const tail = [binary].concat(args || []).join(' ');
  switch (manager) {
    case 'pnpm':
      return `pnpm exec ${tail}`;
    case 'yarn':
      return `yarn ${tail}`;
    case 'bun':
      return `bun x ${tail}`;
    case 'npm':
    default:
      return `npx ${tail}`;
  }
}

function formatComposerScriptCommand(name) {
  return `composer run ${String(name || '').trim()}`;
}

function detectPythonEnvManager(projectRoot) {
  if (!projectRoot) return null;
  const pyproject = readPyprojectToml(projectRoot);
  for (const candidate of PYTHON_ENV_MANAGER_PRIORITY) {
    if (candidate.files.some((file) => fs.existsSync(path.join(projectRoot, file)))) {
      return candidate.manager;
    }
    if (candidate.pyproject && candidate.pyproject.test(pyproject)) {
      return candidate.manager;
    }
  }
  return null;
}

function isPythonExecCommand(command) {
  const normalized = normalizeCommand(command);
  if (PYTHON_EXEC_BINARIES.some((binary) => new RegExp(`^${binary}(?:\\s|$)`, 'i').test(normalized))) {
    return true;
  }
  return /^python(?:\d(?:\.\d+)*)?\s+-m\s+(pytest|unittest|tox|nox)(?:\s|$)/i.test(normalized);
}

function wrapInferredCommandForProject(command, projectRoot) {
  const normalized = normalizeCommand(command);
  if (!projectRoot || !normalized) return normalized;
  if (isBareJsExecCommand(normalized)) {
    const manager = detectPackageManager(projectRoot);
    switch (manager) {
      case 'pnpm':
        return `pnpm exec ${normalized}`;
      case 'yarn':
        return `yarn ${normalized}`;
      case 'bun':
        return `bun x ${normalized}`;
      case 'npm':
      default:
        return `npx ${normalized}`;
    }
  }
  if (isPythonExecCommand(normalized)) {
    const manager = detectPythonEnvManager(projectRoot);
    switch (manager) {
      case 'uv':
        return `uv run ${normalized}`;
      case 'poetry':
        return `poetry run ${normalized}`;
      case 'pipenv':
        return `pipenv run ${normalized}`;
      default:
        return normalized;
    }
  }
  return normalized;
}

function wrapInferredCommandsForProject(commands, projectRoot) {
  return normalizeCommandList(commands).map((command) => wrapInferredCommandForProject(command, projectRoot));
}

function hasAnyMarkerFile(projectRoot, files) {
  return (files || []).some((file) => fs.existsSync(path.join(projectRoot, file)));
}

function findPriorityTarget(matchTarget) {
  for (const target of SCRIPT_PRIORITY) {
    if (matchTarget(target)) return target;
  }
  return null;
}

function readDirEntries(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
}

function detectMakeConventionCommand(projectRoot) {
  for (const fileName of ['GNUmakefile', 'Makefile', 'makefile']) {
    const raw = readTextFile(path.join(projectRoot, fileName));
    if (!raw) continue;
    const target = findPriorityTarget((name) => new RegExp(`^${name}\\s*:`, 'm').test(raw));
    if (target) {
      return { command: `make ${target}`, source: `${fileName}:${target}` };
    }
  }
  return null;
}

function detectJustConventionCommand(projectRoot) {
  for (const fileName of ['justfile', 'Justfile']) {
    const raw = readTextFile(path.join(projectRoot, fileName));
    if (!raw) continue;
    const target = findPriorityTarget((name) => new RegExp(`^@?${name}(?:\\s+[\\w.-]+)*\\s*:`, 'm').test(raw));
    if (target) {
      return { command: `just ${target}`, source: `${fileName}:${target}` };
    }
  }
  return null;
}

function detectTaskfileConventionCommand(projectRoot) {
  for (const fileName of ['Taskfile.yml', 'Taskfile.yaml', 'taskfile.yml', 'taskfile.yaml']) {
    const raw = readTextFile(path.join(projectRoot, fileName));
    if (!raw) continue;
    const lines = raw.split(/\r?\n/);
    let inTasks = false;
    const targets = new Set();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!inTasks) {
        if (/^tasks:\s*$/.test(trimmed)) inTasks = true;
        continue;
      }
      if (trimmed && /^\S/.test(line)) break;
      const match = line.match(/^\s+["']?([\w:-]+)["']?\s*:\s*(?:#.*)?$/);
      if (match) targets.add(match[1]);
    }
    const target = findPriorityTarget((name) => targets.has(name));
    if (target) {
      return { command: `task ${target}`, source: `${fileName}:${target}` };
    }
  }
  return null;
}

function detectComposerScriptCommand(projectRoot) {
  const composer = readComposerManifest(projectRoot);
  const scripts = composer && typeof composer.scripts === 'object' && composer.scripts
    ? composer.scripts
    : null;
  if (!scripts) return null;
  for (const name of SCRIPT_PRIORITY) {
    if (!scripts[name]) continue;
    return { command: formatComposerScriptCommand(name), source: `composer.json:${name}` };
  }
  return null;
}

function scriptFrontdoorCandidates() {
  const candidates = [];
  for (const dir of SCRIPT_FRONTDOOR_DIRS) {
    for (const name of SCRIPT_PRIORITY) {
      for (const ext of SCRIPT_FRONTDOOR_EXTENSIONS) {
        candidates.push(`${dir}/${name}${ext}`);
      }
    }
  }
  for (const name of ROOT_SCRIPT_FRONTDOOR_NAMES) {
    for (const ext of SCRIPT_FRONTDOOR_EXTENSIONS) {
      candidates.push(`${name}${ext}`);
    }
  }
  return candidates;
}

function detectScriptFrontdoorConventionCommand(projectRoot) {
  for (const relPath of scriptFrontdoorCandidates()) {
    const absPath = path.join(projectRoot, relPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) continue;
    const command = formatScriptFrontdoorCommand(relPath);
    if (!command) continue;
    return {
      command,
      source: `convention:script-frontdoor:${relPath.replace(/\\/g, '/')}`
    };
  }
  return null;
}

function hasDescendantMatch(dirPath, depth, predicate, ignoredNames) {
  if (depth < 0 || !dirPath || !fs.existsSync(dirPath)) return false;
  const ignored = ignoredNames || DEFAULT_SCAN_IGNORES;
  const entries = readDirEntries(dirPath);
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile() && predicate(fullPath, entry)) return true;
    if (entry.isDirectory() && hasDescendantMatch(fullPath, depth - 1, predicate, ignored)) return true;
  }
  return false;
}

function detectJsConventionCommand(projectRoot, manager) {
  for (const convention of JS_TOOL_CONVENTIONS) {
    if (!hasAnyMarkerFile(projectRoot, convention.files)) continue;
    return {
      command: formatPackageBinaryCommand(manager, convention.binary, convention.args),
      source: convention.source
    };
  }
  return null;
}

function fileLooksLikeNodeTest(filePath) {
  if (!NODE_TEST_FILE_RE.test(filePath)) return false;
  try {
    return /node:test/.test(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return false;
  }
}

function hasNodeTestConvention(projectRoot, dirPath, depth) {
  if (depth < 0 || !fs.existsSync(dirPath)) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_e) {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.plan-enforcer') continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile() && fileLooksLikeNodeTest(fullPath)) return true;
    if (entry.isDirectory() && hasNodeTestConvention(projectRoot, fullPath, depth - 1)) return true;
  }
  return false;
}

function detectNodeTestConventionCommand(projectRoot) {
  const roots = [
    projectRoot,
    path.join(projectRoot, 'test'),
    path.join(projectRoot, 'tests'),
    path.join(projectRoot, 'src')
  ];
  for (const root of roots) {
    if (hasNodeTestConvention(projectRoot, root, 2)) {
      return { command: 'node --test', source: 'convention:node-test' };
    }
  }
  return null;
}

function fileLooksLikePythonUnittest(filePath) {
  if (!PYTHON_UNITTEST_FILE_RE.test(filePath)) return false;
  try {
    return /\b(?:import unittest|from unittest import|unittest\.main\s*\()/m.test(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return false;
  }
}

function hasPythonUnittestConvention(dirPath, depth) {
  if (depth < 0 || !fs.existsSync(dirPath)) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_e) {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === '__pycache__' || entry.name === '.git' || entry.name === '.plan-enforcer' || entry.name === 'node_modules' || entry.name === '.venv' || entry.name === 'venv') continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile() && fileLooksLikePythonUnittest(fullPath)) return true;
    if (entry.isDirectory() && hasPythonUnittestConvention(fullPath, depth - 1)) return true;
  }
  return false;
}

function readPyprojectToml(projectRoot) {
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) return '';
  try {
    return fs.readFileSync(pyprojectPath, 'utf8');
  } catch (_e) {
    return '';
  }
}

function detectPythonConventionCommand(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'tox.ini'))) {
    return { command: wrapInferredCommandForProject('tox', projectRoot), source: 'convention:tox' };
  }

  if (fs.existsSync(path.join(projectRoot, 'pytest.ini'))) {
    return { command: wrapInferredCommandForProject('pytest', projectRoot), source: 'convention:pytest' };
  }

  const pyproject = readPyprojectToml(projectRoot);
  if (/^\s*\[(?:tool\.)?tox(?:\.|])?/m.test(pyproject)) {
    return { command: wrapInferredCommandForProject('tox', projectRoot), source: 'convention:tox' };
  }
  if (/^\s*\[tool\.pytest(?:\.ini_options)?\]/m.test(pyproject)) {
    return { command: wrapInferredCommandForProject('pytest', projectRoot), source: 'convention:pytest' };
  }
  if (fs.existsSync(path.join(projectRoot, 'noxfile.py'))) {
    return { command: wrapInferredCommandForProject('nox', projectRoot), source: 'convention:nox' };
  }
  const unittestRoots = [
    projectRoot,
    path.join(projectRoot, 'test'),
    path.join(projectRoot, 'tests'),
    path.join(projectRoot, 'src')
  ];
  for (const root of unittestRoots) {
    if (hasPythonUnittestConvention(root, 2)) {
      return { command: wrapInferredCommandForProject('python -m unittest', projectRoot), source: 'convention:unittest' };
    }
  }
  if (fs.existsSync(path.join(projectRoot, '.ruff.toml')) || fs.existsSync(path.join(projectRoot, 'ruff.toml')) || /^\s*\[tool\.ruff(?:\.|])?/m.test(pyproject)) {
    return { command: wrapInferredCommandForProject('ruff check .', projectRoot), source: 'convention:ruff' };
  }
  if (fs.existsSync(path.join(projectRoot, 'mypy.ini')) || /^\s*\[tool\.mypy(?:\.|])?/m.test(pyproject)) {
    return { command: wrapInferredCommandForProject('mypy .', projectRoot), source: 'convention:mypy' };
  }
  return null;
}

function detectDenoConventionCommand(projectRoot) {
  if (hasAnyMarkerFile(projectRoot, ['deno.json', 'deno.jsonc', 'deno.lock'])) {
    return { command: 'deno test', source: 'convention:deno' };
  }
  const roots = [
    projectRoot,
    path.join(projectRoot, 'test'),
    path.join(projectRoot, 'tests'),
    path.join(projectRoot, 'src')
  ];
  for (const root of roots) {
    if (hasDescendantMatch(root, 2, (filePath) => DENO_TEST_FILE_RE.test(filePath), DEFAULT_SCAN_IGNORES)) {
      return { command: 'deno test', source: 'convention:deno' };
    }
  }
  return null;
}

function detectDotnetConventionCommand(projectRoot) {
  if (hasDescendantMatch(projectRoot, 3, (filePath) => DOTNET_PROJECT_FILE_RE.test(filePath), DEFAULT_SCAN_IGNORES)) {
    return { command: 'dotnet test', source: 'convention:dotnet' };
  }
  return null;
}

function detectRubyConventionCommand(projectRoot) {
  if (!fs.existsSync(path.join(projectRoot, 'Gemfile'))) return null;
  if (fs.existsSync(path.join(projectRoot, '.rspec'))) {
    return { command: 'bundle exec rspec', source: 'convention:rspec' };
  }
  if (hasDescendantMatch(path.join(projectRoot, 'spec'), 3, (filePath) => RUBY_SPEC_FILE_RE.test(filePath), DEFAULT_SCAN_IGNORES)) {
    return { command: 'bundle exec rspec', source: 'convention:rspec' };
  }
  return null;
}

function detectJavaConventionCommand(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'pom.xml'))) {
    return { command: 'mvn test', source: 'convention:maven' };
  }
  const hasGradleBuild = hasAnyMarkerFile(projectRoot, ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']);
  if (!hasGradleBuild) return null;
  if (hasAnyMarkerFile(projectRoot, ['gradlew', 'gradlew.bat'])) {
    return { command: './gradlew test', source: 'convention:gradle' };
  }
  return { command: 'gradle test', source: 'convention:gradle' };
}

function detectPhpConventionCommand(projectRoot) {
  if (!fs.existsSync(path.join(projectRoot, 'composer.json')) && !fs.existsSync(path.join(projectRoot, 'artisan'))) {
    return null;
  }
  if (fs.existsSync(path.join(projectRoot, 'artisan'))) {
    return { command: 'php artisan test', source: 'convention:artisan' };
  }
  if (hasAnyMarkerFile(projectRoot, ['pest.php', 'pest.xml', 'pest.xml.dist']) || fs.existsSync(path.join(projectRoot, 'tests', 'Pest.php'))) {
    return { command: 'vendor/bin/pest', source: 'convention:pest' };
  }
  if (hasAnyMarkerFile(projectRoot, ['phpunit.xml', 'phpunit.xml.dist'])) {
    return { command: 'vendor/bin/phpunit', source: 'convention:phpunit' };
  }
  const testRoots = [
    path.join(projectRoot, 'test'),
    path.join(projectRoot, 'tests')
  ];
  for (const root of testRoots) {
    if (hasDescendantMatch(root, 3, (filePath) => PHP_TEST_FILE_RE.test(filePath), DEFAULT_SCAN_IGNORES)) {
      return { command: 'vendor/bin/phpunit', source: 'convention:phpunit' };
    }
  }
  return null;
}

function detectElixirConventionCommand(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'mix.exs'))) {
    return { command: 'mix test', source: 'convention:mix' };
  }
  return null;
}

function detectSwiftConventionCommand(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'Package.swift'))) {
    return { command: 'swift test', source: 'convention:swift' };
  }
  return null;
}

function detectCTestConventionCommand(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'CMakeLists.txt'))) {
    return { command: 'ctest', source: 'convention:ctest' };
  }
  return null;
}

function detectMesonConventionCommand(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'meson.build'))) {
    return { command: 'meson test', source: 'convention:meson' };
  }
  return null;
}

function detectHaskellConventionCommand(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'stack.yaml'))) {
    return { command: 'stack test', source: 'convention:stack' };
  }
  if (fs.existsSync(path.join(projectRoot, 'cabal.project'))) {
    return { command: 'cabal test', source: 'convention:cabal' };
  }
  if (hasDescendantMatch(projectRoot, 2, (filePath) => HASKELL_CABAL_FILE_RE.test(filePath), DEFAULT_SCAN_IGNORES)) {
    return { command: 'cabal test', source: 'convention:cabal' };
  }
  return null;
}

function detectPackageCommand(projectRoot) {
  const pkg = readPackageManifest(projectRoot);
  const scripts = pkg && pkg.scripts ? pkg.scripts : null;
  const manager = detectPackageManager(projectRoot);
  if (scripts) {
    for (const name of SCRIPT_PRIORITY) {
      if (!scripts[name]) continue;
      const command = formatPackageScriptCommand(manager, name);
      return { command, source: `package.json:${name}` };
    }
  }
  const makeConventionCommand = detectMakeConventionCommand(projectRoot);
  if (makeConventionCommand) return makeConventionCommand;
  const justConventionCommand = detectJustConventionCommand(projectRoot);
  if (justConventionCommand) return justConventionCommand;
  const taskfileConventionCommand = detectTaskfileConventionCommand(projectRoot);
  if (taskfileConventionCommand) return taskfileConventionCommand;
  const composerScriptCommand = detectComposerScriptCommand(projectRoot);
  if (composerScriptCommand) return composerScriptCommand;
  const scriptFrontdoorCommand = detectScriptFrontdoorConventionCommand(projectRoot);
  if (scriptFrontdoorCommand) return scriptFrontdoorCommand;
  const jsConventionCommand = detectJsConventionCommand(projectRoot, manager);
  if (jsConventionCommand) return jsConventionCommand;
  const nodeTestConventionCommand = detectNodeTestConventionCommand(projectRoot);
  if (nodeTestConventionCommand) return nodeTestConventionCommand;
  const pythonConventionCommand = detectPythonConventionCommand(projectRoot);
  if (pythonConventionCommand) return pythonConventionCommand;
  const denoConventionCommand = detectDenoConventionCommand(projectRoot);
  if (denoConventionCommand) return denoConventionCommand;
  const dotnetConventionCommand = detectDotnetConventionCommand(projectRoot);
  if (dotnetConventionCommand) return dotnetConventionCommand;
  const rubyConventionCommand = detectRubyConventionCommand(projectRoot);
  if (rubyConventionCommand) return rubyConventionCommand;
  const javaConventionCommand = detectJavaConventionCommand(projectRoot);
  if (javaConventionCommand) return javaConventionCommand;
  const phpConventionCommand = detectPhpConventionCommand(projectRoot);
  if (phpConventionCommand) return phpConventionCommand;
  const elixirConventionCommand = detectElixirConventionCommand(projectRoot);
  if (elixirConventionCommand) return elixirConventionCommand;
  const swiftConventionCommand = detectSwiftConventionCommand(projectRoot);
  if (swiftConventionCommand) return swiftConventionCommand;
  const ctestConventionCommand = detectCTestConventionCommand(projectRoot);
  if (ctestConventionCommand) return ctestConventionCommand;
  const mesonConventionCommand = detectMesonConventionCommand(projectRoot);
  if (mesonConventionCommand) return mesonConventionCommand;
  const haskellConventionCommand = detectHaskellConventionCommand(projectRoot);
  if (haskellConventionCommand) return haskellConventionCommand;
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    return { command: 'cargo test', source: 'convention:cargo' };
  }
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    return { command: 'go test ./...', source: 'convention:go' };
  }
  return null;
}

function detectVerificationCommand({ projectRoot, config, evidenceText, sessionLogPath }) {
  const evidenceCommands = wrapInferredCommandsForProject(parseEvidenceCommands(evidenceText), projectRoot);
  if (evidenceCommands.length > 0) {
    return buildVerificationTarget(evidenceCommands, 'evidence');
  }
  const checkCmd = config && typeof config.check_cmd === 'string' ? config.check_cmd.trim() : '';
  if (checkCmd) {
    return buildVerificationTarget(checkCmd, 'config:check_cmd');
  }
  const packageCommand = detectPackageCommand(projectRoot);
  if (packageCommand) return buildVerificationTarget(packageCommand.command, packageCommand.source);
  return detectSessionLogCommand(projectRoot, evidenceText, sessionLogPath);
}

function assessExecutedVerification({ projectRoot, enforcerDir, taskId, evidenceText, config, sessionLogPath }) {
  const detected = detectVerificationCommand({ projectRoot, config, evidenceText, sessionLogPath });
  if (!detected) {
    if (evidenceClaimsExecutableVerification(evidenceText)) {
      return {
        required: true,
        state: 'undetected',
        command: null,
        commands: [],
        source: null,
        latest: readLatestExecutedVerification(enforcerDir, taskId)
      };
    }
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
      commands: detected.commands,
      source: detected.source,
      latest: null
    };
  }

  if (latest.ok === false) {
    return {
      required: true,
      state: 'failed',
      command: detected.command,
      commands: detected.commands,
      source: detected.source,
      latest
    };
  }

  const latestCommands = commandSet(latest);
  const detectedCommands = commandSet(detected);
  if (latestCommands.length > 0 && JSON.stringify(latestCommands) !== JSON.stringify(detectedCommands)) {
    return {
      required: true,
      state: 'stale',
      command: detected.command,
      commands: detected.commands,
      source: detected.source,
      latest
    };
  }

  return {
    required: true,
    state: 'ok',
    command: detected.command,
    commands: detected.commands,
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
    return {
      detected: false,
      required: evidenceClaimsExecutableVerification(evidenceText),
      ok: null,
      command: null,
      commands: [],
      source: null
    };
  }

  const checksDir = path.join(enforcerDir, 'checks');
  fs.mkdirSync(checksDir, { recursive: true });
  const startedAt = new Date();
  const stamp = sanitizeStamp(startedAt.toISOString());
  const logPath = path.join(checksDir, `${taskId}-${stamp}.log`);
  const jsonPath = path.join(checksDir, `${taskId}-${stamp}.json`);
  const runs = [];
  const logSections = [];

  for (const command of detected.commands) {
    const started = Date.now();
    const result = spawnSync(command, {
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

    runs.push({
      command,
      ok,
      exitCode,
      timedOut,
      durationMs
    });
    logSections.push([
      `command: ${command}`,
      `ok: ${ok}`,
      `exit_code: ${exitCode == null ? 'timeout' : exitCode}`,
      `duration_ms: ${durationMs}`,
      '',
      '--- stdout ---',
      stdout,
      '',
      '--- stderr ---',
      stderr
    ].join('\n'));
  }

  const ok = runs.every((run) => run.ok);
  const timedOut = runs.some((run) => run.timedOut);
  const firstFailure = runs.find((run) => !run.ok) || null;
  const exitCode = firstFailure ? firstFailure.exitCode : 0;
  const durationMs = runs.reduce((sum, run) => sum + run.durationMs, 0);

  const meta = {
    taskId,
    ts: startedAt.toISOString(),
    command: detected.command,
    commands: detected.commands,
    source: detected.source,
    ok,
    exitCode,
    timedOut,
    durationMs,
    logPath: path.relative(projectRoot, logPath).replace(/\\/g, '/'),
    jsonPath: path.relative(projectRoot, jsonPath).replace(/\\/g, '/'),
    runs
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
    ...logSections.flatMap((section, index) => index === 0
      ? [`--- run ${index + 1}/${logSections.length} ---`, section]
      : ['', `--- run ${index + 1}/${logSections.length} ---`, section])
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
  detectJsConventionCommand,
  detectJustConventionCommand,
  detectMakeConventionCommand,
  detectNodeTestConventionCommand,
  detectPackageCommand,
  detectPythonConventionCommand,
  detectSessionLogCommand,
  detectTaskfileConventionCommand,
  detectVerificationCommand,
  evidenceClaimsExecutableVerification,
  extractEvidenceHints,
  formatCommandSet,
  normalizeCommand,
  normalizeCommandList,
  parseEvidenceCommands,
  parseEvidenceCommand,
  detectPackageManager,
  wrapInferredCommandsForProject,
  wrapInferredCommandForProject,
  readSessionLogRecords,
  readLatestExecutedVerification,
  runExecutedVerification,
  scoreSessionVerificationCommand,
  writeLatestExecutedVerification
};
