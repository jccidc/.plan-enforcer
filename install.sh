#!/usr/bin/env bash
set -euo pipefail

# Plan Enforcer - Install Script
# Cross-platform: Linux, macOS, Git Bash (Windows)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
CLI_BIN_DIR="$HOME/.local/bin"
TIER="structural"
SCOPE="project"
SETTINGS_PATH=""
STATUSLINE_FALLBACK="$HOME/.claude/settings.json"
SKILLS_INSTALLED=0
SKILLS_SKIPPED=0
HOOKS_COPIED=0
HOOKS_SKIPPED=0
MODULES_COPIED=0
MODULES_SKIPPED=0
WRAPPERS_INSTALLED=0

usage() {
  cat <<'USAGE'
Usage: install.sh [OPTIONS]

Options:
  --tier advisory|structural|enforced   Enforcement tier (default: structural)
  --global                              Install hooks to ~/.claude/settings.json
                                        (default: .claude/settings.json in cwd)
  --help                                Show this message

Tiers:
  advisory     Skill only - no hooks, passive guidance
  structural   Skill + auto-activation + hard-integrity guards
  enforced     Skill + SessionStart + PreToolUse + PostToolUse + SessionEnd hooks
USAGE
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)
      TIER="$2"
      if [[ "$TIER" != "advisory" && "$TIER" != "structural" && "$TIER" != "enforced" ]]; then
        echo "Error: --tier must be advisory, structural, or enforced"
        exit 1
      fi
      shift 2
      ;;
    --global)
      SCOPE="global"
      shift
      ;;
    --help)
      usage
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

if [[ "$SCOPE" == "global" ]]; then
  SETTINGS_PATH="$HOME/.claude/settings.json"
else
  SETTINGS_PATH="$(pwd)/.claude/settings.json"
fi

mkdir -p "$SKILLS_DIR"

for skill in plan-enforcer plan-enforcer-discuss plan-enforcer-draft plan-enforcer-review plan-enforcer-status plan-enforcer-logs plan-enforcer-config plan-enforcer-report; do
  src="$SCRIPT_DIR/skills/$skill"
  dest="$SKILLS_DIR/$skill"
  if [[ ! -d "$src" ]]; then
    echo "Warning: $src not found, skipping"
    SKILLS_SKIPPED=$((SKILLS_SKIPPED + 1))
    continue
  fi
  rm -rf "$dest"
  cp -r "$src" "$dest"
  SKILLS_INSTALLED=$((SKILLS_INSTALLED + 1))
done

HOOKS_DEST="$SKILLS_DIR/plan-enforcer/hooks"
mkdir -p "$HOOKS_DEST"
for hook in evidence-gate.js post-tool.js session-start.js session-end.js statusline.js user-message.js chain-guard.js delete-guard.js ledger-schema-guard.js; do
  src="$SCRIPT_DIR/hooks/$hook"
  if [[ ! -f "$src" ]]; then
    echo "Warning: $src not found, skipping"
    HOOKS_SKIPPED=$((HOOKS_SKIPPED + 1))
    continue
  fi
  cp "$src" "$HOOKS_DEST/$hook"
  HOOKS_COPIED=$((HOOKS_COPIED + 1))
done

SRC_DEST="$SKILLS_DIR/plan-enforcer/src"
mkdir -p "$SRC_DEST"
for module in archive.js audit.js audit-cli.js awareness.js awareness-cli.js awareness-parser.js chain.js chain-cli.js config.js config-cli.js doctor-cli.js discuss-cli.js evidence.js executed-verification.js export-cli.js git-worktree.js import-cli.js ledger-parser.js ledger-row-removal.js lint-cli.js logs-cli.js partial-ledger-edit.js phase-verify-cli.js plan-analyzer.js plan-analyzer-cli.js plan-detector.js plan-enforcer-cli.js plan-review.js planned-files.js placeholder-scan.js report-cli.js review-cli.js schema-migrate.js status-cli.js statusline-stage-cli.js statusline-state.js tier.js verify-cli.js why.js why-cli.js; do
  src="$SCRIPT_DIR/src/$module"
  if [[ ! -f "$src" ]]; then
    echo "Warning: $src not found, skipping"
    MODULES_SKIPPED=$((MODULES_SKIPPED + 1))
    continue
  fi
  cp "$src" "$SRC_DEST/$module"
  MODULES_COPIED=$((MODULES_COPIED + 1))
done

# Hook staleness marker: record the commit SHA of the repo copy we just
# installed from. SessionStart reads this and warns if the installed hook
# is behind the current repo hooks/ directory. Caught us once during P0
# self-enforce — worth preventing for real users.
REPO_SHA=""
if command -v git &>/dev/null && [[ -d "$SCRIPT_DIR/.git" ]]; then
  REPO_SHA="$(cd "$SCRIPT_DIR" && git rev-parse --short HEAD 2>/dev/null || true)"
fi
if [[ -n "$REPO_SHA" ]]; then
  echo "$REPO_SHA" > "$SKILLS_DIR/plan-enforcer/.installed-from"
fi

install_command_wrappers() {
  local repo_root="$1"
  local bin_dir="$2"
  local count
  count="$(node - "$repo_root" "$bin_dir" <<'NODEEOF'
const fs = require('fs');
const path = require('path');

const repoRoot = process.argv[2];
const binDir = process.argv[3];
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

fs.mkdirSync(binDir, { recursive: true });

let count = 0;
for (const [name, relTarget] of Object.entries(pkg.bin || {})) {
  const unixTarget = `$HOME/.claude/skills/plan-enforcer/${String(relTarget).replace(/\\/g, '/')}`;
  const cmdTarget = `%USERPROFILE%\\.claude\\skills\\plan-enforcer\\${String(relTarget).replace(/\//g, '\\')}`;
  const shPath = path.join(binDir, name);
  const cmdPath = path.join(binDir, `${name}.cmd`);

  fs.writeFileSync(
    shPath,
    ['#!/usr/bin/env bash', 'set -euo pipefail', `node "${unixTarget}" "$@"`, ''].join('\n'),
    'utf8'
  );
  fs.chmodSync(shPath, 0o755);
  fs.writeFileSync(cmdPath, `@echo off\r\nnode "${cmdTarget}" %*\r\n`, 'utf8');
  count += 1;
}

process.stdout.write(String(count));
NODEEOF
)"
  WRAPPERS_INSTALLED="$count"
}

configure_statusline_only() {
  local settings_file="$1"
  local hooks_dir="$2"
  local fallback_settings="$3"
  node - "$settings_file" "$hooks_dir" "$fallback_settings" <<'NODEEOF'
const fs = require('fs');
const path = require('path');

const settingsPath = process.argv[2];
const hooksDir = process.argv[3];
const fallbackSettingsPath = process.argv[4];
const statuslineCmd = `node "${hooksDir}/statusline.js"`;
const baseCommandPath = path.join(hooksDir, '.statusline-base-command');

function loadSettings(filePath) {
  if (!filePath || filePath === settingsPath || !fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return {};
  }
}

let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}
const fallbackSettings = loadSettings(fallbackSettingsPath);
const existingStatusline = (settings.statusLine && settings.statusLine.command)
  || (fallbackSettings.statusLine && fallbackSettings.statusLine.command)
  || '';

if (existingStatusline && existingStatusline !== statuslineCmd && !/plan-enforcer[\\/].*hooks[\\/]statusline\.js/i.test(existingStatusline)) {
  fs.mkdirSync(path.dirname(baseCommandPath), { recursive: true });
  fs.writeFileSync(baseCommandPath, `${existingStatusline}\n`, 'utf8');
}

settings.statusLine = settings.statusLine || {};
settings.statusLine.type = 'command';
settings.statusLine.command = statuslineCmd;

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(`  statusLine: ${statuslineCmd}`);
NODEEOF
}

merge_with_node_structural() {
  local settings_file="$1"
  local hooks_dir="$2"
  local fallback_settings="$3"
  node - "$settings_file" "$hooks_dir" "$fallback_settings" <<'NODEEOF'
const fs = require('fs');
const path = require('path');

const settingsPath = process.argv[2];
const hooksDir = process.argv[3];
const fallbackSettingsPath = process.argv[4];
const statuslineCmd = `node "${hooksDir}/statusline.js"`;
const baseCommandPath = path.join(hooksDir, '.statusline-base-command');

function loadSettings(filePath) {
  if (!filePath || filePath === settingsPath || !fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return {};
  }
}

let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}
const fallbackSettings = loadSettings(fallbackSettingsPath);
const existingStatusline = (settings.statusLine && settings.statusLine.command)
  || (fallbackSettings.statusLine && fallbackSettings.statusLine.command)
  || '';

if (existingStatusline && existingStatusline !== statuslineCmd && !/plan-enforcer[\\/].*hooks[\\/]statusline\.js/i.test(existingStatusline)) {
  fs.mkdirSync(path.dirname(baseCommandPath), { recursive: true });
  fs.writeFileSync(baseCommandPath, `${existingStatusline}\n`, 'utf8');
}

settings.statusLine = settings.statusLine || {};
settings.statusLine.type = 'command';
settings.statusLine.command = statuslineCmd;
settings.hooks = settings.hooks || {};

const sessionCmd = `node "${hooksDir}/session-start.js"`;
const userPromptCmd = `node "${hooksDir}/user-message.js"`;
const deleteGuardCmd = `node "${hooksDir}/delete-guard.js"`;
const ledgerSchemaGuardCmd = `node "${hooksDir}/ledger-schema-guard.js"`;
const evidenceCmd = `node "${hooksDir}/evidence-gate.js"`;

settings.hooks.SessionStart = settings.hooks.SessionStart || [];
const existingSessionCmds = new Set();
for (const entry of settings.hooks.SessionStart) {
  for (const hook of entry.hooks || []) existingSessionCmds.add(hook.command || '');
}
if (!existingSessionCmds.has(sessionCmd)) {
  settings.hooks.SessionStart.push({
    hooks: [{
      type: 'command',
      command: sessionCmd,
      statusMessage: 'Plan Enforcer: checking for active plan...'
    }]
  });
}

settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];
const existingPromptCmds = new Set();
for (const entry of settings.hooks.UserPromptSubmit) {
  for (const hook of entry.hooks || []) existingPromptCmds.add(hook.command || '');
}
if (!existingPromptCmds.has(userPromptCmd)) {
  settings.hooks.UserPromptSubmit.push({
    hooks: [{
      type: 'command',
      command: userPromptCmd
    }]
  });
}

settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
const existingPreToolCmds = new Set();
for (const entry of settings.hooks.PreToolUse) {
  for (const hook of entry.hooks || []) existingPreToolCmds.add(hook.command || '');
}
for (const command of [deleteGuardCmd, ledgerSchemaGuardCmd]) {
  if (existingPreToolCmds.has(command)) continue;
  settings.hooks.PreToolUse.push({
    hooks: [{
      type: 'command',
      command
    }]
  });
}

settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
const existingPostToolCmds = new Set();
for (const entry of settings.hooks.PostToolUse) {
  for (const hook of entry.hooks || []) existingPostToolCmds.add(hook.command || '');
}
if (!existingPostToolCmds.has(evidenceCmd)) {
  settings.hooks.PostToolUse.push({
    hooks: [{
      type: 'command',
      command: evidenceCmd
    }]
  });
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(`  statusLine: ${statuslineCmd}`);
console.log(`  updated hooks in ${settingsPath}`);
console.log('  enabled: SessionStart, UserPromptSubmit, PreToolUse(delete/ledger), PostToolUse(evidence)');
NODEEOF
}

merge_with_node() {
  local settings_file="$1"
  local hooks_dir="$2"
  local fallback_settings="$3"
  node - "$settings_file" "$hooks_dir" "$fallback_settings" <<'NODEEOF'
const fs = require('fs');
const path = require('path');

const settingsPath = process.argv[2];
const hooksDir = process.argv[3];
const fallbackSettingsPath = process.argv[4];
const statuslineCmd = `node "${hooksDir}/statusline.js"`;
const baseCommandPath = path.join(hooksDir, '.statusline-base-command');

function loadSettings(filePath) {
  if (!filePath || filePath === settingsPath || !fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return {};
  }
}

let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}
const fallbackSettings = loadSettings(fallbackSettingsPath);
const existingStatusline = (settings.statusLine && settings.statusLine.command)
  || (fallbackSettings.statusLine && fallbackSettings.statusLine.command)
  || '';

if (existingStatusline && existingStatusline !== statuslineCmd && !/plan-enforcer[\\/].*hooks[\\/]statusline\.js/i.test(existingStatusline)) {
  fs.mkdirSync(path.dirname(baseCommandPath), { recursive: true });
  fs.writeFileSync(baseCommandPath, `${existingStatusline}\n`, 'utf8');
}

settings.statusLine = settings.statusLine || {};
settings.statusLine.type = 'command';
settings.statusLine.command = statuslineCmd;
settings.hooks = settings.hooks || {};

const sessionCmd = `node "${hooksDir}/session-start.js"`;
const evidenceCmd = `node "${hooksDir}/evidence-gate.js"`;
const postCmd = `node "${hooksDir}/post-tool.js"`;
const endCmd = `node "${hooksDir}/session-end.js"`;
const userPromptCmd = `node "${hooksDir}/user-message.js"`;
const chainGuardCmd = `node "${hooksDir}/chain-guard.js"`;
const deleteGuardCmd = `node "${hooksDir}/delete-guard.js"`;
const ledgerSchemaGuardCmd = `node "${hooksDir}/ledger-schema-guard.js"`;

function addHook(event, command, extra) {
  settings.hooks[event] = settings.hooks[event] || [];
  const existing = new Set();
  for (const entry of settings.hooks[event]) {
    for (const hook of entry.hooks || []) existing.add(hook.command || '');
  }
  if (!existing.has(command)) {
    const hook = Object.assign({ type: 'command', command }, extra || {});
    settings.hooks[event].push({ hooks: [hook] });
  }
}

addHook('SessionStart', sessionCmd, { statusMessage: 'Plan Enforcer: checking for active plan...' });
addHook('UserPromptSubmit', userPromptCmd);
addHook('PostToolUse', evidenceCmd);
addHook('PostToolUse', postCmd);
addHook('SessionEnd', endCmd);
addHook('PreToolUse', chainGuardCmd);
addHook('PreToolUse', deleteGuardCmd);
addHook('PreToolUse', ledgerSchemaGuardCmd);

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(`  statusLine: ${statuslineCmd}`);
console.log(`  updated hooks in ${settingsPath}`);
console.log('  enabled: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SessionEnd');
NODEEOF
}

HOOKS_INSTALLED="not installed"
HOOKS_DIR_ESCAPED=$(echo "$HOOKS_DEST" | sed 's/\\/\\\\/g')

if [[ "$TIER" == "advisory" ]]; then
  echo "Hook install skipped: advisory tier"
  HOOKS_INSTALLED="none (advisory tier)"
fi

if command -v node &>/dev/null; then
  install_command_wrappers "$SCRIPT_DIR" "$CLI_BIN_DIR"
  if [[ "$TIER" == "advisory" ]]; then
    configure_statusline_only "$SETTINGS_PATH" "$HOOKS_DIR_ESCAPED" "$STATUSLINE_FALLBACK"
    HOOKS_INSTALLED="statusLine -> $SETTINGS_PATH"
  elif [[ "$TIER" == "structural" ]]; then
    # Structural: auto-activation + hard-integrity guards only
    merge_with_node_structural "$SETTINGS_PATH" "$HOOKS_DIR_ESCAPED" "$STATUSLINE_FALLBACK"
    HOOKS_INSTALLED="statusLine + SessionStart + UserPromptSubmit + PreToolUse(delete/ledger) + PostToolUse(evidence) -> $SETTINGS_PATH"
  else
    # Enforced: full hook bundle
    merge_with_node "$SETTINGS_PATH" "$HOOKS_DIR_ESCAPED" "$STATUSLINE_FALLBACK"
    HOOKS_INSTALLED="statusLine + SessionStart + UserPromptSubmit + PreToolUse + PostToolUse + SessionEnd -> $SETTINGS_PATH"
  fi
else
  echo ""
  echo "WARNING: node not found."
  echo "Add the following to $SETTINGS_PATH manually:"
  echo ""
  if [[ "$TIER" == "advisory" ]]; then
    HOOKS_INSTALLED="MANUAL -- add statusLine"
    echo '  "statusLine": {'
    echo '    "type": "command",'
    echo '    "command": "node ~/.claude/skills/plan-enforcer/hooks/statusline.js"'
    echo '  }'
  elif [[ "$TIER" == "structural" ]]; then
    HOOKS_INSTALLED="MANUAL -- add statusLine + SessionStart + UserPromptSubmit + PreToolUse(delete/ledger) + PostToolUse(evidence)"
    echo '  "statusLine": {'
    echo '    "type": "command",'
    echo '    "command": "node ~/.claude/skills/plan-enforcer/hooks/statusline.js"'
    echo '  },'
    echo '  "hooks": {'
    echo '    "SessionStart": [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/session-start.js", "statusMessage": "Plan Enforcer: checking for active plan..."}]}],'
    echo '    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/user-message.js"}]}],'
    echo '    "PreToolUse":   [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/delete-guard.js"}]}, {"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/ledger-schema-guard.js"}]}],'
    echo '    "PostToolUse":  [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/evidence-gate.js"}]}]'
    echo '  }'
  else
    HOOKS_INSTALLED="MANUAL -- add statusLine + SessionStart + UserPromptSubmit + PreToolUse + PostToolUse + SessionEnd"
    echo '  "statusLine": {'
    echo '    "type": "command",'
    echo '    "command": "node ~/.claude/skills/plan-enforcer/hooks/statusline.js"'
    echo '  },'
    echo '  "hooks": {'
    echo '    "SessionStart": [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/session-start.js", "statusMessage": "Plan Enforcer: checking for active plan..."}]}],'
    echo '    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/user-message.js"}]}],'
    echo '    "PreToolUse":   [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/chain-guard.js"}]}, {"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/delete-guard.js"}]}, {"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/ledger-schema-guard.js"}]}],'
    echo '    "PostToolUse":  [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/evidence-gate.js"}]}, {"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/post-tool.js"}]}],'
    echo '    "SessionEnd":   [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/session-end.js"}]}]'
    echo '  }'
  fi
  echo ""
fi

CONFIG_NOTE="skipped (--global install; bootstraps on first discuss/import)"
if [[ "$SCOPE" != "global" ]]; then
CONFIG_DIR="$(pwd)/.plan-enforcer"
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_DIR/config.md" <<EOF
---
tier: ${TIER}
reconcile_interval: 25
stale_threshold: 10
completion_gate: soft
ledger_path: .plan-enforcer/ledger.md
schema: v2
---

# Plan Enforcer Config

Tier controls enforcement strictness:
- advisory:   audit-only. Hooks log violations; nothing ever blocks.
- structural: auto-activate + warn on soft deviations visible in reports,
              block on hard integrity breaks (unlogged deletion, bulk
              pending closure, evidence-less verification).
- enforced:   block every unplanned edit, unlogged deletion, phase pivot,
              and evidence-less verification until resolved.

Ledger schema v2 adds:
- Chain column on task rows (comma-separated refs — D-row IDs,
  C:<commit-sha>, V<n>)
- Typed Decision Log: deviation | unplanned | delete | pivot | override

Hooks active at this tier:
- SessionStart:  ledger activation, session log truncation,
                 hook-staleness check
- UserPromptSubmit: raw user-prompt capture to '.user-messages.jsonl'
                    for awareness quote verification
- PreToolUse:    delete-guard (deletions), ledger-schema-guard (T-row tampering, bulk pending closure)
                 [structural + enforced]
- PostToolUse:   evidence gate
                 [structural + enforced]
- PreToolUse:    chain-guard (unplanned edits)
- PostToolUse:   counters, reconciliation nudges, session log append
- SessionEnd:    missing-ledger assertion, chain integrity check, orphan-intent check
                 [enforced tier only]
EOF
echo "Config written to $CONFIG_DIR/config.md"
CONFIG_NOTE=".plan-enforcer/config.md"
fi

echo ""
echo "Plan Enforcer installed."
echo "  tier: ${TIER}"
echo -n "  skills: ${SKILLS_INSTALLED} copied"
if [[ "$SKILLS_SKIPPED" -gt 0 ]]; then
  echo ", ${SKILLS_SKIPPED} skipped"
else
  echo ""
fi
echo -n "  hooks: ${HOOKS_COPIED} copied"
if [[ "$HOOKS_SKIPPED" -gt 0 ]]; then
  echo ", ${HOOKS_SKIPPED} skipped"
else
  echo ""
fi
echo -n "  runtime modules: ${MODULES_COPIED} copied"
if [[ "$MODULES_SKIPPED" -gt 0 ]]; then
  echo ", ${MODULES_SKIPPED} skipped"
else
  echo ""
fi
echo "  commands: ${WRAPPERS_INSTALLED} wrappers in ${CLI_BIN_DIR}"
echo "  hook settings: ${HOOKS_INSTALLED}"
if [[ -n "$REPO_SHA" ]]; then
  echo "  repo commit: ${REPO_SHA}"
fi
echo "  config: ${CONFIG_NOTE}"
echo ""
echo "Next:"
echo "  check install: plan-enforcer doctor"
echo "  start with discuss: plan-enforcer discuss \"your ask\""
echo "  or seed existing plan: plan-enforcer import docs/plans/<plan-file>.md"
echo "  inspect live state: plan-enforcer status | plan-enforcer report --active"
