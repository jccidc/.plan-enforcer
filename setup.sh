#!/usr/bin/env bash
set -euo pipefail

# Plan Enforcer - One-Line Installer
# Usage:
#   bash <(curl -s https://raw.githubusercontent.com/jccidc/plan-enforcer/main/setup.sh)
#   bash <(curl -s https://raw.githubusercontent.com/jccidc/plan-enforcer/main/setup.sh) --tier enforced

REPO_URL="https://github.com/jccidc/plan-enforcer"
SKILLS_DIR="$HOME/.claude/skills"
CLI_BIN_DIR="$HOME/.local/bin"
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
  for skill in plan-enforcer plan-enforcer-discuss plan-enforcer-draft plan-enforcer-review plan-enforcer-status plan-enforcer-logs plan-enforcer-config plan-enforcer-report; do
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
  for hook in evidence-gate.js post-tool.js session-start.js session-end.js statusline.js user-message.js chain-guard.js delete-guard.js ledger-schema-guard.js; do
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
  for module in archive.js audit.js audit-cli.js awareness.js awareness-cli.js awareness-parser.js chain.js chain-cli.js config.js config-cli.js doctor-cli.js discuss-cli.js evidence.js executed-verification.js export-cli.js git-worktree.js import-cli.js ledger-parser.js ledger-row-removal.js lint-cli.js logs-cli.js partial-ledger-edit.js phase-verify-cli.js plan-analyzer.js plan-analyzer-cli.js plan-detector.js plan-enforcer-cli.js plan-review.js planned-files.js placeholder-scan.js report-cli.js review-cli.js schema-migrate.js status-cli.js statusline-stage-cli.js statusline-state.js tier.js verify-cli.js why.js why-cli.js; do
    local src="$src_root/src/$module"
    if [[ ! -f "$src" ]]; then
      log "Warning: $src not found, skipping"
      continue
    fi
    cp "$src" "$src_dest/$module"
    log "  $src_dest/$module"
  done
}

install_command_wrappers() {
  local src_root="$1"
  local bin_dir="$2"
  mkdir -p "$bin_dir"
  node - "$src_root" "$bin_dir" <<'NODEEOF'
const fs = require('fs');
const path = require('path');

const repoRoot = process.argv[2];
const binDir = process.argv[3];
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

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
}
NODEEOF
  log "Installed command wrappers in $bin_dir"
}

patch_settings_with_node() {
  local settings_file="$1"
  local hooks_dir="$2"
  local tier="$3"
  node - "$settings_file" "$hooks_dir" "$tier" <<'NODEEOF'
const fs = require('fs');
const path = require('path');

const settingsPath = process.argv[2];
const hooksDir = process.argv[3];
const tier = process.argv[4];
const statuslineCmd = `node "${hooksDir}/statusline.js"`;
const baseCommandPath = path.join(hooksDir, '.statusline-base-command');

let settings = {};
if (fs.existsSync(settingsPath)) {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

const existingStatusline = (settings.statusLine && settings.statusLine.command) || '';
if (existingStatusline && existingStatusline !== statuslineCmd && !/plan-enforcer[\\/].*hooks[\\/]statusline\.js/i.test(existingStatusline)) {
  fs.mkdirSync(path.dirname(baseCommandPath), { recursive: true });
  fs.writeFileSync(baseCommandPath, `${existingStatusline}\n`, 'utf8');
}

settings.statusLine = settings.statusLine || {};
settings.statusLine.type = 'command';
settings.statusLine.command = statuslineCmd;

function addHook(event, command, extra) {
  settings.hooks = settings.hooks || {};
  settings.hooks[event] = settings.hooks[event] || [];
  const existing = new Set();
  for (const entry of settings.hooks[event]) {
    for (const hook of entry.hooks || []) existing.add(hook.command || '');
  }
  if (!existing.has(command)) {
    settings.hooks[event].push({
      hooks: [Object.assign({ type: 'command', command }, extra || {})]
    });
  }
}

const sessionCmd = `node "${hooksDir}/session-start.js"`;
const evidenceCmd = `node "${hooksDir}/evidence-gate.js"`;
const postCmd = `node "${hooksDir}/post-tool.js"`;
const endCmd = `node "${hooksDir}/session-end.js"`;
const userPromptCmd = `node "${hooksDir}/user-message.js"`;
const chainGuardCmd = `node "${hooksDir}/chain-guard.js"`;
const deleteGuardCmd = `node "${hooksDir}/delete-guard.js"`;
const ledgerSchemaGuardCmd = `node "${hooksDir}/ledger-schema-guard.js"`;

if (tier === 'structural' || tier === 'enforced') {
  addHook('SessionStart', sessionCmd, { statusMessage: 'Plan Enforcer: checking for active plan...' });
  addHook('UserPromptSubmit', userPromptCmd);
}
if (tier === 'enforced') {
  addHook('PostToolUse', evidenceCmd);
  addHook('PostToolUse', postCmd);
  addHook('SessionEnd', endCmd);
  addHook('PreToolUse', chainGuardCmd);
  addHook('PreToolUse', deleteGuardCmd);
  addHook('PreToolUse', ledgerSchemaGuardCmd);
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(`  statusLine: ${statuslineCmd}`);
if (tier === 'structural') {
  console.log(`  SessionStart: ${sessionCmd}`);
  console.log(`  UserPromptSubmit: ${userPromptCmd}`);
} else if (tier === 'enforced') {
  console.log(`  SessionStart: ${sessionCmd}`);
  console.log(`  UserPromptSubmit: ${userPromptCmd}`);
  console.log(`  PostToolUse:  ${evidenceCmd}`);
  console.log(`  PostToolUse:  ${postCmd}`);
  console.log(`  SessionEnd:   ${endCmd}`);
  console.log(`  PreToolUse:   ${chainGuardCmd}`);
  console.log(`  PreToolUse:   ${deleteGuardCmd}`);
  console.log(`  PreToolUse:   ${ledgerSchemaGuardCmd}`);
}
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
install_command_wrappers "$SRC_ROOT" "$CLI_BIN_DIR"

log "Configuring hooks..."
if command -v node >/dev/null 2>&1; then
  HOOKS_DIR="$SKILLS_DIR/plan-enforcer/hooks"
  patch_settings_with_node "$SETTINGS_PATH" "$HOOKS_DIR" "$TIER"
else
  log "WARNING: node not found, cannot patch settings.json automatically."
  log "Add statusLine + hook settings manually under $SETTINGS_PATH"
fi

write_config

HOOKS_SUMMARY="statusLine"
if [[ "$TIER" == "structural" ]]; then
  HOOKS_SUMMARY="statusLine + SessionStart + UserPromptSubmit"
elif [[ "$TIER" == "enforced" ]]; then
  HOOKS_SUMMARY="statusLine + SessionStart + UserPromptSubmit + PreToolUse + PostToolUse + SessionEnd"
fi

echo ""
echo "============================================"
echo " Plan Enforcer installed!"
echo "============================================"
echo ""
echo "  Skills:     $SKILLS_DIR/plan-enforcer*/"
echo "  Hooks:      $HOOKS_SUMMARY"
echo "  Settings:   $SETTINGS_PATH"
echo "  Tier:       $TIER"
echo "  Config:     .plan-enforcer/config.md"
echo ""
echo "  Commands:"
echo "    plan-enforcer doctor"
echo "    plan-enforcer discuss \"your ask\""
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
