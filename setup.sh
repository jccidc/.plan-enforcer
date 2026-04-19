#!/usr/bin/env bash
set -euo pipefail

# Plan Enforcer - One-Line Installer
# Usage:
#   bash <(curl -s https://raw.githubusercontent.com/jccidc/plan-enforcer/main/setup.sh)
#   bash <(curl -s https://raw.githubusercontent.com/jccidc/plan-enforcer/main/setup.sh) --tier enforced

REPO_URL="https://github.com/jccidc/plan-enforcer"
SKILLS_DIR="$HOME/.claude/skills"
SETTINGS_PATH="$HOME/.claude/settings.json"
TIER="structural"
TEMP_DIR=""

usage() {
  cat <<'USAGE'
Usage: setup.sh [OPTIONS]

Options:
  --tier advisory|structural|enforced   Enforcement tier (default: structural)
  --help                                Show this message
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
    --help)
      usage
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

log() {
  echo "[plan-enforcer] $*"
}

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

download_repo() {
  TEMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t "plan-enforcer")
  log "Downloading plan-enforcer..."

  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 "$REPO_URL.git" "$TEMP_DIR/plan-enforcer" >/dev/null 2>&1
  else
    log "git not found, falling back to curl"
    curl -sL "$REPO_URL/archive/refs/heads/main.tar.gz" | tar xz -C "$TEMP_DIR"
    mv "$TEMP_DIR/plan-enforcer-main" "$TEMP_DIR/plan-enforcer"
  fi
}

install_skills_and_runtime() {
  local src_root="$1"
  mkdir -p "$SKILLS_DIR"

  log "Installing skills..."
  for skill in plan-enforcer plan-enforcer-draft plan-enforcer-review plan-enforcer-status plan-enforcer-logs plan-enforcer-config plan-enforcer-report; do
    local src="$src_root/skills/$skill"
    local dest="$SKILLS_DIR/$skill"
    if [[ ! -d "$src" ]]; then
      log "Warning: $src not found, skipping"
      continue
    fi
    rm -rf "$dest"
    cp -r "$src" "$dest"
    log "  $dest"
  done

  local hooks_dest="$SKILLS_DIR/plan-enforcer/hooks"
  mkdir -p "$hooks_dest"
  log "Installing hooks..."
  for hook in evidence-gate.js post-tool.js session-start.js session-end.js user-message.js chain-guard.js delete-guard.js ledger-schema-guard.js; do
    local src="$src_root/hooks/$hook"
    if [[ ! -f "$src" ]]; then
      log "Warning: $src not found, skipping"
      continue
    fi
    cp "$src" "$hooks_dest/$hook"
    log "  $hooks_dest/$hook"
  done

  local src_dest="$SKILLS_DIR/plan-enforcer/src"
  mkdir -p "$src_dest"
  log "Installing shared runtime modules..."
  for module in archive.js audit.js audit-cli.js awareness-cli.js awareness-parser.js awareness.js chain.js chain-cli.js config-cli.js config.js evidence.js executed-verification.js export-cli.js ledger-parser.js ledger-row-removal.js lint-cli.js logs-cli.js phase-verify-cli.js plan-detector.js plan-enforcer-cli.js plan-review.js planned-files.js report-cli.js review-cli.js schema-migrate.js status-cli.js tier.js verify-cli.js why.js why-cli.js; do
    local src="$src_root/src/$module"
    if [[ ! -f "$src" ]]; then
      log "Warning: $src not found, skipping"
      continue
    fi
    cp "$src" "$src_dest/$module"
    log "  $src_dest/$module"
  done
}

patch_settings_with_node() {
  local settings_file="$1"
  local hooks_dir="$2"
  node - "$settings_file" "$hooks_dir" <<'NODEEOF'
const fs = require('fs');
const path = require('path');

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

settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
const existingPostCmds = new Set();
for (const entry of settings.hooks.PostToolUse) {
  for (const hook of entry.hooks || []) existingPostCmds.add(hook.command || '');
}
if (!existingPostCmds.has(evidenceCmd)) {
  settings.hooks.PostToolUse.push({
    hooks: [{
      type: 'command',
      command: evidenceCmd
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
if (!existingPostCmds.has(postCmd)) {
  settings.hooks.PostToolUse.push({
    hooks: [{
      type: 'command',
      command: postCmd
    }]
  });
}

function addPreTool(command) {
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
  const existing = new Set();
  for (const entry of settings.hooks.PreToolUse) {
    for (const hook of entry.hooks || []) existing.add(hook.command || '');
  }
  if (!existing.has(command)) {
    settings.hooks.PreToolUse.push({
      hooks: [{
        type: 'command',
        command
      }]
    });
  }
}

settings.hooks.SessionEnd = settings.hooks.SessionEnd || [];
const existingEndCmds = new Set();
for (const entry of settings.hooks.SessionEnd) {
  for (const hook of entry.hooks || []) existingEndCmds.add(hook.command || '');
}
if (!existingEndCmds.has(endCmd)) {
  settings.hooks.SessionEnd.push({
    hooks: [{
      type: 'command',
      command: endCmd
    }]
  });
}

addPreTool(chainGuardCmd);
addPreTool(deleteGuardCmd);
addPreTool(ledgerSchemaGuardCmd);

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(`  SessionStart: ${sessionCmd}`);
console.log(`  UserPromptSubmit: ${userPromptCmd}`);
console.log(`  PostToolUse:  ${evidenceCmd}`);
console.log(`  PostToolUse:  ${postCmd}`);
console.log(`  SessionEnd:   ${endCmd}`);
console.log(`  PreToolUse:   ${chainGuardCmd}`);
console.log(`  PreToolUse:   ${deleteGuardCmd}`);
console.log(`  PreToolUse:   ${ledgerSchemaGuardCmd}`);
NODEEOF
}

patch_statusline_with_node() {
  local statusline_path="$1"
  node - "$statusline_path" <<'NODEEOF'
const fs = require('fs');

const statuslinePath = process.argv[2];
if (!fs.existsSync(statuslinePath)) {
  console.log('  No GSD statusline found, skipping badge patch');
  process.exit(0);
}

let content = fs.readFileSync(statuslinePath, 'utf8');
if (content.includes('Plan Enforcer badge')) {
  console.log('  Statusline already has [ENFORCER] badge');
  process.exit(0);
}

const badgeCode = `
    // Plan Enforcer badge - active when .plan-enforcer/ledger.md exists in cwd
    let enforcerBadge = '';
    const ledgerPath = path.join(dir, '.plan-enforcer', 'ledger.md');
    if (fs.existsSync(ledgerPath)) {
      try {
        const ledger = fs.readFileSync(ledgerPath, 'utf8');
        const allTasks = (ledger.match(/^\\|\\s*T\\d+/gm) || []).length;
        const pending = (ledger.match(/\\|\\s*pending\\s*\\|/gm) || []).length;
        const inProg = (ledger.match(/\\|\\s*in-progress\\s*\\|/gm) || []).length;
        const remaining = pending + inProg;
        const done = allTasks - remaining;
        if (remaining === 0 && allTasks > 0) {
          enforcerBadge = \`\\x1b[1;32m[ENFORCER \${done}/\${allTasks} OK]\\x1b[0m | \`;
        } else {
          enforcerBadge = \`\\x1b[1;36m[ENFORCER \${done}/\${allTasks}]\\x1b[0m | \`;
        }
      } catch (error) {
        enforcerBadge = '\\x1b[1;36m[ENFORCER]\\x1b[0m | ';
      }
    }
`;

if (!content.includes('// Output')) {
  console.log('  WARNING: Could not find "// Output" marker in statusline, manual patch needed');
  process.exit(0);
}

content = content.replace('// Output', `${badgeCode}\n    // Output`);
content = content.replace('${cavemanBadge}${gsdUpdate}', '${cavemanBadge}${enforcerBadge}${gsdUpdate}');
fs.writeFileSync(statuslinePath, content);
console.log('  Statusline patched with [ENFORCER] badge');
NODEEOF
}

write_config() {
  local config_dir
  config_dir="$(pwd)/.plan-enforcer"
  mkdir -p "$config_dir"
  cat > "$config_dir/config.md" <<EOF
---
tier: ${TIER}
reconcile_interval: 25
stale_threshold: 10
completion_gate: soft
ledger_path: .plan-enforcer/ledger.md
---
EOF
  log "Config written to $config_dir/config.md"
}

download_repo
SRC_ROOT="$TEMP_DIR/plan-enforcer"
install_skills_and_runtime "$SRC_ROOT"

log "Configuring hooks..."
if command -v node >/dev/null 2>&1; then
  HOOKS_DIR="$SKILLS_DIR/plan-enforcer/hooks"
  patch_settings_with_node "$SETTINGS_PATH" "$HOOKS_DIR"
  patch_statusline_with_node "$HOME/.claude/hooks/gsd-statusline.js"
else
  log "WARNING: node not found, cannot patch settings.json automatically."
  log "Add hooks manually under $SETTINGS_PATH"
fi

write_config

echo ""
echo "============================================"
echo " Plan Enforcer installed!"
echo "============================================"
echo ""
echo "  Skills:     $SKILLS_DIR/plan-enforcer*/"
echo "  Hooks:      SessionStart + PreToolUse + PostToolUse + SessionEnd"
echo "  Settings:   $SETTINGS_PATH"
echo "  Tier:       $TIER"
echo "  Config:     .plan-enforcer/config.md"
echo ""
echo "  Commands:"
echo "    plan-enforcer-review <plan-file>"
echo "    plan-enforcer-status [ledger-file]"
echo "    plan-enforcer-logs [ledger-file]"
echo "    plan-enforcer-report [.plan-enforcer/archive]"
echo "    plan-enforcer-config [config-file] [--tier ...]"
echo "    /plan-enforcer:status"
echo "    /plan-enforcer:logs"
echo "    /plan-enforcer:config"
echo ""
echo "  Uninstall: bash $SKILLS_DIR/plan-enforcer/uninstall.sh"
echo "============================================"
