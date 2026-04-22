#!/usr/bin/env bash
set -euo pipefail

# Plan Enforcer - Uninstall Script
# Cross-platform: Linux, macOS, Git Bash (Windows)

SKILLS_DIR="$HOME/.claude/skills"
CLI_BIN_DIR="$HOME/.local/bin"
STATUSLINE_BASE="$SKILLS_DIR/plan-enforcer/hooks/.statusline-base-command"
SKILLS_REMOVED=0
HOOK_SETTINGS_CLEANED=0
WRAPPERS_REMOVED=0

remove_hooks_node() {
  local settings_file="$1"
  local base_command_file="$2"
  if [[ ! -f "$settings_file" ]]; then
    return
  fi

  local result
  result="$(node - "$settings_file" "$base_command_file" <<'NODEEOF'
const fs = require('fs');

const settingsPath = process.argv[2];
const baseCommandPath = process.argv[3];
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const baseCommand = fs.existsSync(baseCommandPath) ? fs.readFileSync(baseCommandPath, 'utf8').trim() : '';

let changed = false;
if (settings.hooks && typeof settings.hooks === 'object') {
  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    const filteredEntries = entries
      .map((entry) => {
        const hooks = Array.isArray(entry.hooks)
          ? entry.hooks.filter((hook) => !(hook.command || '').includes('plan-enforcer'))
          : [];
        return hooks.length > 0 ? { ...entry, hooks } : null;
      })
      .filter(Boolean);

    if (filteredEntries.length !== entries.length) changed = true;
    if (filteredEntries.length > 0) settings.hooks[event] = filteredEntries;
    else delete settings.hooks[event];
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
    changed = true;
  }
}

if (settings.statusLine && /plan-enforcer[\\/].*hooks[\\/]statusline\.js/i.test(settings.statusLine.command || '')) {
  if (baseCommand) {
    settings.statusLine.type = 'command';
    settings.statusLine.command = baseCommand;
  } else {
    delete settings.statusLine;
  }
  changed = true;
}

if (changed) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  process.stdout.write('changed');
} else {
  process.stdout.write('unchanged');
}
NODEEOF
)"
  if [[ "$result" == "changed" ]]; then
    HOOK_SETTINGS_CLEANED=$((HOOK_SETTINGS_CLEANED + 1))
  fi
}

GLOBAL_SETTINGS="$HOME/.claude/settings.json"
PROJECT_SETTINGS="$(pwd)/.claude/settings.json"

for settings_file in "$GLOBAL_SETTINGS" "$PROJECT_SETTINGS"; do
  if [[ -f "$settings_file" ]]; then
    remove_hooks_node "$settings_file" "$STATUSLINE_BASE"
  fi
done

for skill in plan-enforcer plan-enforcer-discuss plan-enforcer-draft plan-enforcer-review plan-enforcer-status plan-enforcer-logs plan-enforcer-config plan-enforcer-receipt plan-enforcer-report; do
  target="$SKILLS_DIR/$skill"
  if [[ -d "$target" ]]; then
    rm -rf "$target"
    SKILLS_REMOVED=$((SKILLS_REMOVED + 1))
  fi
done

for command in plan-enforcer plan-enforcer-discuss plan-enforcer-awareness plan-enforcer-audit plan-enforcer-chain plan-enforcer-config plan-enforcer-doctor plan-enforcer-export plan-enforcer-import plan-enforcer-lint plan-enforcer-logs plan-enforcer-receipt plan-enforcer-report plan-enforcer-review plan-enforcer-phase-verify plan-enforcer-status plan-enforcer-verify plan-enforcer-why; do
  for target in "$CLI_BIN_DIR/$command" "$CLI_BIN_DIR/$command.cmd"; do
    if [[ -f "$target" ]]; then
      rm -f "$target"
      WRAPPERS_REMOVED=$((WRAPPERS_REMOVED + 1))
    fi
  done
done

echo ""
echo "Plan Enforcer uninstalled."
echo "  skills removed: ${SKILLS_REMOVED}"
echo "  command wrappers removed: ${WRAPPERS_REMOVED}"
echo "  settings cleaned: ${HOOK_SETTINGS_CLEANED}"
echo "  preserved: .plan-enforcer/ history"
