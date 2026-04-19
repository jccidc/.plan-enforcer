#!/usr/bin/env bash
set -euo pipefail

# Plan Enforcer - Install Script
# Cross-platform: Linux, macOS, Git Bash (Windows)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
TIER="structural"
SCOPE="project"
SETTINGS_PATH=""

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
  structural   Skill + SessionStart hook for auto-activation/resume
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

echo "Installing skills..."
for skill in plan-enforcer plan-enforcer-draft plan-enforcer-review plan-enforcer-status plan-enforcer-logs plan-enforcer-config plan-enforcer-report; do
  src="$SCRIPT_DIR/skills/$skill"
  dest="$SKILLS_DIR/$skill"
  if [[ ! -d "$src" ]]; then
    echo "Warning: $src not found, skipping"
    continue
  fi
  rm -rf "$dest"
  cp -r "$src" "$dest"
  echo "  $dest"
done

HOOKS_DEST="$SKILLS_DIR/plan-enforcer/hooks"
mkdir -p "$HOOKS_DEST"
echo "Installing hooks..."
for hook in evidence-gate.js post-tool.js session-start.js session-end.js user-message.js chain-guard.js delete-guard.js ledger-schema-guard.js; do
  src="$SCRIPT_DIR/hooks/$hook"
  if [[ ! -f "$src" ]]; then
    echo "Warning: $src not found, skipping"
    continue
  fi
  cp "$src" "$HOOKS_DEST/$hook"
  echo "  $HOOKS_DEST/$hook"
done

SRC_DEST="$SKILLS_DIR/plan-enforcer/src"
mkdir -p "$SRC_DEST"
echo "Installing shared runtime modules..."
for module in archive.js audit.js audit-cli.js awareness-cli.js awareness-parser.js awareness.js chain.js chain-cli.js config-cli.js config.js evidence.js executed-verification.js export-cli.js ledger-parser.js ledger-row-removal.js lint-cli.js logs-cli.js phase-verify-cli.js plan-detector.js plan-enforcer-cli.js plan-review.js planned-files.js report-cli.js review-cli.js schema-migrate.js status-cli.js tier.js verify-cli.js why.js why-cli.js; do
  src="$SCRIPT_DIR/src/$module"
  if [[ ! -f "$src" ]]; then
    echo "Warning: $src not found, skipping"
    continue
  fi
  cp "$src" "$SRC_DEST/$module"
  echo "  $SRC_DEST/$module"
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
  echo "Installed from repo commit: $REPO_SHA"
fi

merge_with_node_session_only() {
  local settings_file="$1"
  local hooks_dir="$2"
  node - "$settings_file" "$hooks_dir" <<'NODEEOF'
const fs = require('fs');

const settingsPath = process.argv[2];
const hooksDir = process.argv[3];

let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

settings.hooks = settings.hooks || {};

const sessionCmd = `node "${hooksDir}/session-start.js"`;
const userPromptCmd = `node "${hooksDir}/user-message.js"`;

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

fs.mkdirSync(require('path').dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(`  SessionStart: ${sessionCmd}`);
console.log(`  UserPromptSubmit: ${userPromptCmd}`);
console.log(`  (PostToolUse skipped - structural tier)`);
NODEEOF
}

merge_with_node() {
  local settings_file="$1"
  local hooks_dir="$2"
  node - "$settings_file" "$hooks_dir" <<'NODEEOF'
const fs = require('fs');

const settingsPath = process.argv[2];
const hooksDir = process.argv[3];

let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

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

fs.mkdirSync(require('path').dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(`  SessionStart: ${sessionCmd}`);
console.log(`  UserPromptSubmit: ${userPromptCmd}`);
console.log(`  PostToolUse:  ${evidenceCmd}`);
console.log(`  PreToolUse:   ${chainGuardCmd}`);
console.log(`  PreToolUse:   ${deleteGuardCmd}`);
console.log(`  PreToolUse:   ${ledgerSchemaGuardCmd}`);
console.log(`  PostToolUse:  ${postCmd}`);
console.log(`  SessionEnd:   ${endCmd}`);
NODEEOF
}

HOOKS_INSTALLED="not installed"
HOOKS_DIR_ESCAPED=$(echo "$HOOKS_DEST" | sed 's/\\/\\\\/g')

if [[ "$TIER" == "advisory" ]]; then
  echo "Advisory tier: no hooks installed (skill-only guidance)"
  HOOKS_INSTALLED="none (advisory tier)"
elif command -v node &>/dev/null; then
  echo "Installing hooks into settings.json..."
  if [[ "$TIER" == "structural" ]]; then
    # Structural: session-start only (auto-creates ledger, no ongoing enforcement)
    merge_with_node_session_only "$SETTINGS_PATH" "$HOOKS_DIR_ESCAPED"
    HOOKS_INSTALLED="SessionStart + UserPromptSubmit -> $SETTINGS_PATH"
  else
    # Enforced: full hook bundle
    merge_with_node "$SETTINGS_PATH" "$HOOKS_DIR_ESCAPED"
    HOOKS_INSTALLED="SessionStart + UserPromptSubmit + PreToolUse + PostToolUse + SessionEnd -> $SETTINGS_PATH"
  fi
else
  echo ""
  echo "WARNING: node not found."
  echo "Add the following to $SETTINGS_PATH manually:"
  echo ""
  if [[ "$TIER" == "structural" ]]; then
    echo '  "hooks": {'
    echo '    "SessionStart": [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/session-start.js", "statusMessage": "Plan Enforcer: checking for active plan..."}]}],'
    echo '    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/user-message.js"}]}]'
    echo '  }'
  else
    echo '  "hooks": {'
    echo '    "SessionStart": [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/session-start.js", "statusMessage": "Plan Enforcer: checking for active plan..."}]}],'
    echo '    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/user-message.js"}]}],'
    echo '    "PreToolUse":   [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/chain-guard.js"}]}, {"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/delete-guard.js"}]}, {"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/ledger-schema-guard.js"}]}],'
    echo '    "PostToolUse":  [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/evidence-gate.js"}]}, {"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/post-tool.js"}]}],'
    echo '    "SessionEnd":   [{"hooks": [{"type": "command", "command": "node ~/.claude/skills/plan-enforcer/hooks/session-end.js"}]}]'
    echo '  }'
  fi
  echo ""
  HOOKS_INSTALLED="MANUAL -- see instructions above"
fi

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
- structural: warn on soft deviations, block on hard integrity breaks
              (unlogged deletion, evidence-less verification).
- enforced:   block every unplanned edit, unlogged deletion, phase pivot,
              and evidence-less verification until resolved.

Ledger schema v2 adds:
- Chain column on task rows (comma-separated refs — D-row IDs,
  C:<commit-sha>, V<n>)
- Typed Decision Log: deviation | unplanned | delete | pivot | override

Hooks active at this tier:
- SessionStart:  ledger activation, session log truncation,
                 hook-staleness check
- UserPromptSubmit: raw user-prompt capture to `.user-messages.jsonl`
                    for awareness quote verification
- PreToolUse:    chain-guard (unplanned edits), delete-guard (deletions), ledger-schema-guard (T-row tampering)
                 [enforced tier only]
- PostToolUse:   evidence gate, counters, reconciliation nudges, session log append
                 [enforced tier only]
- SessionEnd:    missing-ledger assertion, chain integrity check, orphan-intent check
                 [enforced tier only]
EOF
echo "Config written to $CONFIG_DIR/config.md"

echo ""
echo "Plan Enforcer installed successfully!"
echo ""
echo "  Skills: ~/.claude/skills/plan-enforcer*/"
echo "  Tier:   ${TIER}"
echo "  Hooks:  ${HOOKS_INSTALLED}"
echo "  Config: .plan-enforcer/config.md"
echo ""
echo "  Activate: /plan-enforcer <plan-file>"
echo "  Review:   plan-enforcer-review <plan-file>"
echo "  Status:   plan-enforcer-status [.plan-enforcer/ledger.md]"
echo "  Logs:     plan-enforcer-logs [.plan-enforcer/ledger.md]"
echo "  Report:   plan-enforcer-report [.plan-enforcer/archive]"
echo "  Config:   plan-enforcer-config [.plan-enforcer/config.md] [--tier ...]"
echo "  Commands: /plan-enforcer:status, /plan-enforcer:logs, /plan-enforcer:config"
