#!/usr/bin/env bash
set -euo pipefail

# Plan Enforcer - Uninstall Script
# Cross-platform: Linux, macOS, Git Bash (Windows)

SKILLS_DIR="$HOME/.claude/skills"

echo "Removing skills..."
for skill in plan-enforcer plan-enforcer-draft plan-enforcer-review plan-enforcer-status plan-enforcer-logs plan-enforcer-config plan-enforcer-report; do
  target="$SKILLS_DIR/$skill"
  if [[ -d "$target" ]]; then
    rm -rf "$target"
    echo "  Removed $target"
  fi
done

remove_hooks_node() {
  local settings_file="$1"
  if [[ ! -f "$settings_file" ]]; then
    return
  fi

  echo "Cleaning hooks from $settings_file..."
  node - "$settings_file" <<'NODEEOF'
const fs = require('fs');

const settingsPath = process.argv[2];
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

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

if (changed) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`  Removed plan-enforcer hooks from ${settingsPath}`);
} else {
  console.log(`  No plan-enforcer hooks found in ${settingsPath}`);
}
NODEEOF
}

GLOBAL_SETTINGS="$HOME/.claude/settings.json"
PROJECT_SETTINGS="$(pwd)/.claude/settings.json"

for settings_file in "$GLOBAL_SETTINGS" "$PROJECT_SETTINGS"; do
  if [[ -f "$settings_file" ]]; then
    remove_hooks_node "$settings_file"
  fi
done

echo ""
echo "Plan Enforcer uninstalled."
echo ".plan-enforcer/ directory preserved (contains ledger history)."
echo "Remove manually if desired."
