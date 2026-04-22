#!/usr/bin/env bash
# Framework Comparison Runner
#
# Usage:
#   bash run-comparison.sh <scenario-id> <system> [--plan-size SIZE]
#   bash run-comparison.sh --all [--plan-size SIZE]
#   bash run-comparison.sh --all-sizes   (iterates small, medium, large across all scenarios/systems)
#
# Scenarios:
#   plan-only              Each system drafts a plan for the scenario goal (no execution)
#   execute-frozen-plan    Each system executes the fixed frozen plan
#   crash-continuity       Execute, interrupt at a size-scaled checkpoint, then resume
#   phased-execution       Execute a plan as multiple bounded phase invocations
#   ask-fidelity-audit-replay  Execute a phased scenario while preserving original-ask truth and emit ask-fidelity.json
#   planning-quality-trace     Compare interpretation + planning quality before execution and emit planning-quality.json
#
# Systems:
#   native        Plan Enforcer (draft + review + enforce)
#   gsd           GSD workflow
#   superpowers   Superpowers workflow
#   gsd-pe        GSD workflow with Plan Enforcer seeded as additive layer
#   superpowers-pe Superpowers workflow with Plan Enforcer seeded as additive layer
#
# Plan sizes:
#   small        8-task URL shortener (benchmarks/plans/simple-8-tasks.md)
#   medium       15-task blog API (benchmarks/plans/medium-15-tasks.md)
#   large        22-task task manager with contradictions (benchmarks/plans/adversarial-22-tasks.md)
#   calculator   4-task legacy fixture (default — backwards compat)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$COMP_ROOT/results"
REPO_ROOT="$(cd "$COMP_ROOT/../.." && pwd)"
SESSION_START_HOOK="$REPO_ROOT/hooks/session-start.js"

SCENARIOS=(plan-only execute-frozen-plan crash-continuity multi-session phased-execution ask-fidelity-audit-replay planning-quality-trace)
SYSTEMS=(native gsd superpowers)
SIZES=(small medium large)

# Per-size config: fixture, frozen plan, crash checkpoint task count, goal summary
# goal is used for plan-only scenarios (system drafts its own plan for this goal)
declare -A FIXTURE_BY_SIZE=(
  [small]="$COMP_ROOT/fixtures/empty-node"
  [medium]="$COMP_ROOT/fixtures/empty-node"
  [large]="$COMP_ROOT/fixtures/empty-node"
  [calculator]="$COMP_ROOT/fixtures/calculator-bug"
)

declare -A FROZEN_PLAN_BY_SIZE=(
  [small]="$COMP_ROOT/frozen-plans/small-url-shortener.md"
  [medium]="$COMP_ROOT/frozen-plans/medium-blog-api.md"
  [large]="$COMP_ROOT/frozen-plans/large-task-manager.md"
  [calculator]="$COMP_ROOT/frozen-plans/calculator-fix.md"
)

declare -A PHASED_PLAN_DIR_BY_SIZE=(
  [small]="$COMP_ROOT/frozen-plans/phased-small"
)

declare -A ASK_FIDELITY_PACK_BY_SIZE=(
  [small]="$COMP_ROOT/frozen-plans/ask-fidelity-small-scenario-a"
)

declare -A PLANNING_QUALITY_PACK_BY_SIZE=(
  [small]="$COMP_ROOT/frozen-plans/planning-quality-small-scenario-a"
  [medium]="$COMP_ROOT/frozen-plans/planning-quality-medium-scenario-c"
)

# Crash checkpoint: agent stops after completing this many tasks in the first pass
declare -A CRASH_CHECKPOINT_BY_SIZE=(
  [small]=3
  [medium]=6
  [large]=11
  [calculator]=1
)

declare -A GOAL_BY_SIZE=(
  [small]="Build a URL shortener CLI tool in Node.js with validation, storage, and help text."
  [medium]="Build a blog API in Express + TypeScript + SQLite with JWT auth, post CRUD, publish/unpublish workflow, full-text search, and tests."
  [large]="Build a task management system as a Node.js monorepo with SQLite storage, REST API, migrations, status-transition state machine, assignee validation, error recovery, WebSocket real-time sync, and comprehensive tests."
  [calculator]="Fix a known sign bug in the percent() function of an existing calculator module, with a regression test first."
)

# Default values
PLAN_SIZE="calculator"
ASK_FIDELITY_PACK="${ASK_FIDELITY_PACK:-}"
PLANNING_QUALITY_FIXTURE_DIR="${PLANNING_QUALITY_FIXTURE_DIR:-}"
RESUME_CELL_DIR="${RESUME_CELL_DIR:-}"
STOP_AFTER_PHASE="${STOP_AFTER_PHASE:-}"
MAX_TURNS_S1="${MAX_TURNS_S1:-60}"
MAX_TURNS_RECOVERY="${MAX_TURNS_RECOVERY:-120}"
MAX_RECOVERY_ATTEMPTS="${MAX_RECOVERY_ATTEMPTS:-3}"

# ── Arg parsing ─────────────────────────────────────────────────────
parse_size_flag() {
  local args=("$@")
  for (( i=0; i<${#args[@]}; i++ )); do
    if [[ "${args[$i]}" == "--plan-size" ]]; then
      PLAN_SIZE="${args[$((i+1))]}"
      if [[ -z "${FIXTURE_BY_SIZE[$PLAN_SIZE]:-}" ]]; then
        echo "Error: unknown plan size '$PLAN_SIZE'. Valid: small medium large calculator"
        exit 1
      fi
    elif [[ "${args[$i]}" == "--fixture-pack" ]]; then
      ASK_FIDELITY_PACK="${args[$((i+1))]}"
    elif [[ "${args[$i]}" == "--resume-cell-dir" ]]; then
      RESUME_CELL_DIR="${args[$((i+1))]}"
    elif [[ "${args[$i]}" == "--stop-after-phase" ]]; then
      STOP_AFTER_PHASE="${args[$((i+1))]}"
    fi
  done
}

usage() {
  cat <<USAGE
Usage:
  bash run-comparison.sh <scenario-id> <system> [--plan-size SIZE] [--fixture-pack NAME_OR_PATH] [--resume-cell-dir CELL_DIR] [--stop-after-phase N]
  bash run-comparison.sh --all [--plan-size SIZE] [--fixture-pack NAME_OR_PATH]
  bash run-comparison.sh --all-sizes

Scenarios:  ${SCENARIOS[*]}
Systems:    ${SYSTEMS[*]}
Sizes:      small, medium, large, calculator  (default: calculator)
Fixture pack override: for ask-fidelity-audit-replay or planning-quality-trace. Example:
  --fixture-pack ask-fidelity-small-scenario-b
Resume phased/ask-fidelity cell:
  --resume-cell-dir benchmarks/framework-comparison/results/.../<system>
Intentional phase-boundary stop for phased/ask-fidelity cells:
  --stop-after-phase 5
USAGE
  exit 1
}

log() { echo "[framework-bench] $*"; }

is_pe_backed_system() {
  case "$1" in
    native|native-*|gsd-pe|superpowers-pe) return 0 ;;
    *) return 1 ;;
  esac
}

parent_system_kind() {
  case "$1" in
    gsd-pe) echo "gsd" ;;
    superpowers-pe) echo "superpowers" ;;
    native|native-* ) echo "native" ;;
    * ) echo "$1" ;;
  esac
}

run_written_judge() {
  local artifact_path="$1"
  shift
  rm -f "$artifact_path"
  if "$@"; then
    return 0
  fi
  local rc=$?
  [[ -f "$artifact_path" ]] && return 0
  return "$rc"
}

capture_session_start_output() {
  local work_dir="$1"
  local out_dir="$2"
  local label="$3"
  local starts_file="$out_dir/session-starts.txt"
  mkdir -p "$out_dir"
  {
    printf '=== %s ===\n' "$label"
    if [[ -f "$SESSION_START_HOOK" ]]; then
      (cd "$work_dir" && node "$SESSION_START_HOOK") || true
    else
      echo "session-start hook not found: $SESSION_START_HOOK"
    fi
    printf '\n'
  } >> "$starts_file" 2>&1
}

snapshot_session_log() {
  local work_dir="$1"
  local out_dir="$2"
  local label="$3"
  local src="$work_dir/.plan-enforcer/.session-log.jsonl"
  local dest_dir="$out_dir/session-logs"
  mkdir -p "$dest_dir"
  if [[ -f "$src" ]]; then
    cp "$src" "$dest_dir/$label.jsonl"
  else
    : > "$dest_dir/$label.missing"
  fi
}

enforce_native_completion() {
  local work_dir="$1"
  local output_file="$2"
  [[ -f "$output_file" ]] || return 0
  node "$SCRIPT_DIR/enforce-native-completion.js" "$work_dir" "$output_file" >/dev/null
}

set_native_partial_close_marker() {
  local work_dir="$1"
  mkdir -p "$work_dir/.plan-enforcer"
  printf 'benchmark checkpoint close allowed\n' > "$work_dir/.plan-enforcer/.benchmark-allow-partial-close"
}

clear_native_partial_close_marker() {
  local work_dir="$1"
  rm -f "$work_dir/.plan-enforcer/.benchmark-allow-partial-close"
}

native_needs_recovery() {
  local output_file="$1"
  [[ -f "$output_file" ]] || return 1
  grep -q 'PLAN ENFORCER \[hard gate\]: session close refused' "$output_file" && ! grep -q 'BENCHMARK_COMPLETE' "$output_file"
}

# Run claude -p with --output-format json, capture the full json
# response, and extract a plain-text .result file + a .usage.json
# summary sidecar. Preserves sentinel-grep compat (output.txt is still
# a plain text file) while making per-session token/cost data
# available for cross-system comparisons.
#
# Usage:
#   invoke_claude_json <text_output_file> <work_dir> <prompt> [extra_args...]
#
# Writes:
#   <text_output_file>         plain-text .result (same as old text-format flow)
#   <text_output_file>.json    raw claude json response
#   <text_output_file>.usage.json  {input/output/cache tokens, cost, duration}
# Returns the exit code of the claude invocation.
invoke_claude_json() {
  local text_out="$1"; shift
  local work_dir="$1"; shift
  local prompt="$1"; shift
  local json_out="${text_out}.json"
  local base="${text_out%.txt}"
  local rc=0
  (cd "$work_dir" && claude -p "$prompt" --output-format json --no-session-persistence --dangerously-skip-permissions "$@") > "$json_out" 2>&1 || rc=$?
  node "$SCRIPT_DIR/extract-session-usage.js" "$json_out" "$base" || true
  return $rc
}

run_native_recovery_loop() {
  local work_dir="$1"
  local output_file="$2"
  local max_attempts="${3:-$MAX_RECOVERY_ATTEMPTS}"
  local attempts=0

  while native_needs_recovery "$output_file" && [[ $attempts -lt $max_attempts ]]; do
    attempts=$((attempts + 1))
    log "  Native recovery pass $attempts..."
    local open_rows_json
    open_rows_json="$(node "$SCRIPT_DIR/read-native-open-rows.js" "$work_dir" 2>/dev/null || echo '[]')"
    local recovery_prompt="Continue the same work in this directory. The previous session was blocked because the ledger still has open rows. First read .plan-enforcer/ledger.md and reconcile any finished work with evidence. Then complete the remaining rows in order until the ledger reaches 0 remaining rows and archives cleanly. Open rows right now: ${open_rows_json}. Work row-by-row, keep only one row in-progress at a time in the final stretch, claim the next pending row in the ledger before more workspace work, update the ledger after each row, and only then say BENCHMARK_COMPLETE."
    local recovery_output="$output_file.recovery.$attempts"
    if invoke_claude_json "$recovery_output" "$work_dir" "$recovery_prompt" --max-turns "$MAX_TURNS_RECOVERY"; then
      log "  Recovery pass $attempts exited successfully"
    else
      log "  Recovery pass $attempts exited with error (code $?)"
    fi
    {
      printf '\n=== NATIVE RECOVERY PASS %s ===\n\n' "$attempts"
      cat "$recovery_output" 2>/dev/null || true
    } >> "$output_file"
    # Preserve .json + .usage.json sidecars for aggregation; drop the
    # extracted text since it is already folded into $output_file.
    rm -f "$recovery_output"
  done
}

copy_preserving_tree() {
  local work_dir="$1"
  local dest_dir="$2"
  shift 2
  mkdir -p "$dest_dir"
  (
    cd "$work_dir"
    for rel in "$@"; do
      [[ -e "$rel" ]] || continue
      mkdir -p "$dest_dir/$(dirname "$rel")"
      cp -R "$rel" "$dest_dir/$rel"
    done
  )
}

capture_workspace_artifacts() {
  local work_dir="$1"
  local out_dir="$2"
  local artifact_dir="$out_dir/worktree-artifacts"
  node "$SCRIPT_DIR/capture-workspace-artifacts.js" "$work_dir" "$artifact_dir" >/dev/null
}

capture_native_planning_artifacts() {
  local work_dir="$1"
  local out_dir="$2"
  local artifact_dir="$out_dir/worktree-artifacts/.plan-enforcer"
  mkdir -p "$artifact_dir"
  for rel in combobulate.md review.txt plan.md; do
    if [[ -f "$work_dir/.plan-enforcer/$rel" ]]; then
      cp "$work_dir/.plan-enforcer/$rel" "$artifact_dir/$rel"
    fi
  done
}

capture_superpowers_artifacts() {
  local work_dir="$1"
  local out_dir="$2"
  local manifest="$out_dir/superpowers-md-files.txt"
  local artifact_dir="$out_dir/superpowers-artifacts"
  mkdir -p "$artifact_dir"

  (
    cd "$work_dir"
    find "$work_dir" -maxdepth 4 -name "*.md" -not -path "*/node_modules/*" -not -path "*/.plan-enforcer/*" -not -path "*/.planning/*" > "$manifest" 2>/dev/null || true
  )

  if [[ -f "$manifest" ]]; then
    while IFS= read -r abs_path; do
      [[ -n "$abs_path" ]] || continue
      [[ -f "$abs_path" ]] || continue
      local rel="${abs_path#$work_dir/}"
      if [[ "$rel" == "$abs_path" ]]; then
        continue
      fi
      mkdir -p "$artifact_dir/$(dirname "$rel")"
      cp "$abs_path" "$artifact_dir/$rel"
    done < "$manifest"
  fi

  copy_preserving_tree "$work_dir" "$artifact_dir" docs/plans README.md tasks/todo.md DEVIATIONS.md LEDGER.md RESUME_STATE.md
}

capture_gsd_artifacts() {
  local work_dir="$1"
  local out_dir="$2"
  local artifact_dir="$out_dir/gsd-artifacts"
  mkdir -p "$artifact_dir"
  copy_preserving_tree "$work_dir" "$artifact_dir" .planning docs scripts packages src tests migrations tasks README.md DEVIATIONS.md LEDGER.md
}

# ── Prompt composition ──────────────────────────────────────────────

compose_prompt() {
  local scenario="$1"
  local system="$2"
  local size="$3"
  local scenario_file="$COMP_ROOT/scenarios/0${SCENARIO_INDEX}-${scenario}.md"
  local scenario_text; scenario_text="$(cat "$scenario_file")"
  local frozen_plan="${FROZEN_PLAN_BY_SIZE[$size]}"
  local frozen_plan_text=""
  local goal="${GOAL_BY_SIZE[$size]}"
  local planning_quality_original_ask=""
  if [[ "$scenario" == "planning-quality-trace" && -n "${PLANNING_QUALITY_FIXTURE_DIR:-}" && -f "${PLANNING_QUALITY_FIXTURE_DIR}/original-ask.md" ]]; then
    planning_quality_original_ask="$(cat "${PLANNING_QUALITY_FIXTURE_DIR}/original-ask.md")"
    goal="$planning_quality_original_ask"
  fi
  if [[ "$scenario" == "execute-frozen-plan" || "$scenario" == "crash-continuity" || "$scenario" == "multi-session" ]]; then
    frozen_plan_text="$(cat "$frozen_plan")"
  fi

  local system_intro=""
  # Derive tier from system suffix so compose_prompt is self-contained.
  local intro_tier="enforced"
  case "$system" in
    native-advisory)  intro_tier="advisory" ;;
    native-structural) intro_tier="structural" ;;
  esac
  case "$system" in
    native|native-advisory|native-structural|native-enforced)
      if [[ "$scenario" == "plan-only" ]]; then
        system_intro="Use the plan-enforcer-draft skill to draft the plan, then use plan-enforcer-review on the drafted plan. Stop after the reviewed plan is ready. Do not execute."
      elif [[ "$scenario" == "planning-quality-trace" ]]; then
        system_intro="Use plan-enforcer-combobulate first and save the intent packet at .plan-enforcer/combobulate.md. Then use plan-enforcer-draft to write the plan. Then run plan-enforcer-review on that plan and save the review report at .plan-enforcer/review.txt. Stop after the reviewed plan is ready. Do not execute."
      else
        system_intro="Use Plan Enforcer ${intro_tier} tier. A pre-seeded ledger exists at .plan-enforcer/ledger.md with the canonical pipe-table format (| ID | Task | Status | Evidence | Notes |) and a matching Decision Log and Reconciliation History table. Edit that file IN PLACE — do not rewrite its structure or switch to bullets. For each task: flip status pending → in-progress on start, then → verified with a concrete evidence string when done (never mark 'done' if you have evidence — default to verified). Log every deviation as a row in the Decision Log table. Reconcile at meaningful checkpoints and whenever the hook asks by adding a row to Reconciliation History. In the final stretch, keep only one row in-progress at a time, and claim the next pending row in the ledger before more workspace work. Do not end the session while any row is still pending or in-progress; BENCHMARK_COMPLETE is only valid once the ledger is fully reconciled and archive-ready."
      fi
      ;;
    gsd-pe)
      system_intro="Use explicit GSD surfaces, but Plan Enforcer enforced tier is also active in this repo as the additive enforcement layer. A pre-seeded ledger exists at .plan-enforcer/ledger.md and its task/deviation tracking is authoritative for completion truth. Keep GSD planning/progress artifacts on disk, but also update the Plan Enforcer ledger in place, obey PE hooks, log deviations explicitly, and do not claim BENCHMARK_COMPLETE until the PE ledger is reconciled and archive-ready."
      ;;
    gsd)
      if [[ "$scenario" == "plan-only" ]]; then
        system_intro="Use explicit GSD surfaces. Start with /gsd-map-codebase if useful for this repo, then use /gsd-new-project or /gsd-plan-phase to produce the plan. Do not execute."
      elif [[ "$scenario" == "planning-quality-trace" ]]; then
        system_intro="Use explicit GSD surfaces. Before finalizing the plan, save an early interpretation summary to docs/plans/interpretation.md describing what the ask means, what constraints must survive, and what would count as narrowing. Then produce the plan. Do not execute."
      else
        system_intro="Use explicit GSD surfaces. Use /gsd-execute-phase rather than improvising outside GSD. Preserve state on disk as GSD would. Do not silently change scope. If you deviate from the plan, record it clearly."
      fi
      ;;
    superpowers-pe)
      system_intro="Use the Superpowers workflow explicitly, but Plan Enforcer enforced tier is also active in this repo as the additive enforcement layer. A pre-seeded ledger exists at .plan-enforcer/ledger.md and its task/deviation tracking is authoritative for completion truth. Keep Superpowers planning/progress artifacts on disk, but also update the Plan Enforcer ledger in place, obey PE hooks, log deviations explicitly, and do not claim BENCHMARK_COMPLETE until the PE ledger is reconciled and archive-ready."
      ;;
    superpowers)
      if [[ "$scenario" == "plan-only" ]]; then
        system_intro="Use the Superpowers writing-plans skill explicitly. Do not execute."
      elif [[ "$scenario" == "planning-quality-trace" ]]; then
        system_intro="Use the Superpowers writing-plans skill explicitly. Before finalizing the plan, save an early interpretation summary to docs/plans/interpretation.md describing what the ask means, what constraints must survive, and what would count as narrowing. Then produce the plan. Do not execute."
      else
        system_intro="Use the Superpowers executing-plans skill explicitly. Preserve any state on disk. Do not silently change scope. If you deviate, record it clearly."
      fi
      ;;
  esac

  local repo_section="Repository context is available in the current working directory. Inspect the actual files before planning or executing."
  local plan_section=""
  local goal_section=""
  if [[ -n "$frozen_plan_text" ]]; then
    plan_section="Use this exact plan. Do not rewrite it silently.

---FROZEN PLAN START---
${frozen_plan_text}
---FROZEN PLAN END---
"
  else
    goal_section="Goal for this plan:
${goal}
"
  fi

  if [[ "$scenario" == "planning-quality-trace" ]]; then
    goal_section="Original ask to preserve:
${goal}
"
  fi

  cat <<PROMPT
Work in this repo only. Do not touch files outside the current working directory.

${system_intro}

${repo_section}

${goal_section}
${plan_section}

Scenario:
${scenario_text}

When done, say BENCHMARK_COMPLETE.
PROMPT
}

compose_phased_prompt() {
  local system="$1"
  local size="$2"
  local phase_file="$3"
  local phase_name="$4"
  local phase_index="$5"
  local phase_count="$6"
  local scenario_file="$COMP_ROOT/scenarios/06-phased-execution.md"
  local scenario_text; scenario_text="$(cat "$scenario_file")"
  local phase_text; phase_text="$(cat "$phase_file")"

  local system_intro=""
  local intro_tier="enforced"
  case "$system" in
    native-advisory)  intro_tier="advisory" ;;
    native-structural) intro_tier="structural" ;;
  esac
  case "$system" in
    native|native-advisory|native-structural|native-enforced)
      system_intro="Use Plan Enforcer ${intro_tier} tier for this phase only. A pre-seeded ledger exists at .plan-enforcer/ledger.md with canonical pipe-table format. Execute only the current phase tasks, reconcile the ledger honestly, and preserve continuity artifacts on disk for the next phase. If this phase forces a contract deviation from earlier work, log it explicitly instead of silently mutating prior intent."
      ;;
    gsd-pe)
      system_intro="Use explicit GSD surfaces for this bounded phase, but Plan Enforcer enforced tier is also active as the additive enforcement layer. Consume prior phase artifacts from disk, preserve GSD state on disk, and keep the PE ledger authoritative for task completion, deviations, and final close."
      ;;
    gsd)
      system_intro="Use explicit GSD surfaces. Treat this as the current bounded phase only. Consume earlier phase artifacts from disk, preserve state on disk for the next phase, and do not silently change scope."
      ;;
    superpowers-pe)
      system_intro="Use the Superpowers executing-plans workflow for this bounded phase, but Plan Enforcer enforced tier is also active as the additive enforcement layer. Consume prior phase artifacts from disk, preserve Superpowers state on disk, and keep the PE ledger authoritative for task completion, deviations, and final close."
      ;;
    superpowers)
      system_intro="Use the Superpowers executing-plans skill explicitly. Treat this as the current bounded phase only. Consume earlier phase artifacts from disk, preserve state on disk, and record any deviation clearly."
      ;;
  esac

  local late_phase_guidance=""
  if [[ "$phase_index" -ge 5 ]]; then
    late_phase_guidance=$(
      cat <<'GUIDANCE'
Later-phase execution rule:
- treat earlier phases as the baseline unless the current phase explicitly changes them
- prefer the smallest correct diff over broad cleanup or re-explaining prior work
- do not re-audit the whole repo unless the current phase requires it
- verify at the end of the phase once the intended edits are in place
GUIDANCE
    )
  fi

  local focused_execution_guidance=""
  if [[ "$phase_index" -ge 2 ]]; then
    focused_execution_guidance=$(
      cat <<'GUIDANCE'
Focused execution rule:
- start from the phase plan, existing tests/docs for that surface, and `.plan-enforcer/resume.md` if present
- avoid repo-wide rediscovery once the needed files are identified
- avoid chained shell probe commands; prefer small direct file reads and targeted searches
GUIDANCE
    )
  fi

  cat <<PROMPT
Work in this repo only. Do not touch files outside the current working directory.

${system_intro}

Repository context is available in the current working directory. Inspect the actual files before acting. Only the current phase plan is shown below; future phases are intentionally hidden.

Current phase: ${phase_name} (${phase_index}/${phase_count})
Benchmark size: ${size}

Use this exact phase plan. Do not silently rewrite it.

${focused_execution_guidance}

${late_phase_guidance}

---PHASE PLAN START---
${phase_text}
---PHASE PLAN END---

Scenario:
${scenario_text}

When the phase is complete, keep the final reply terse:
- shipped work
- verification result
- deviation refs if any
- then BENCHMARK_COMPLETE
Do not write a long narrative summary.

When this phase is complete, say BENCHMARK_COMPLETE.
PROMPT
}

compose_ask_fidelity_prompt() {
  local system="$1"
  local size="$2"
  local fixture_dir="$3"
  local phase_file="$4"
  local phase_name="$5"
  local phase_index="$6"
  local phase_count="$7"
  local scenario_file="$COMP_ROOT/scenarios/07-ask-fidelity-audit-replay.md"
  local scenario_text; scenario_text="$(cat "$scenario_file")"
  local phase_text; phase_text="$(cat "$phase_file")"
  local original_ask_text; original_ask_text="$(cat "$fixture_dir/original-ask.md")"

  local system_intro=""
  local intro_tier="enforced"
  case "$system" in
    native-advisory) intro_tier="advisory" ;;
    native-structural) intro_tier="structural" ;;
  esac
  case "$system" in
    native|native-advisory|native-structural|native-enforced)
      system_intro="Use Plan Enforcer ${intro_tier} tier for this phase only. Preserve the original ask, not just the local phase tasks. If implementation narrows scope, changes interpretation, or leaves any ask-level requirement partial, record that as an explicit deviation instead of silently flattening the request."
      ;;
    gsd-pe)
      system_intro="Use explicit GSD surfaces for this bounded phase, but Plan Enforcer enforced tier is also active as the additive enforcement layer. Preserve the original ask, keep GSD artifacts on disk, and keep the PE ledger authoritative for task completion and deviation truth."
      ;;
    gsd)
      system_intro="Use explicit GSD surfaces. Treat this as a bounded current phase, but keep the original ask in view. Do not silently narrow the request when implementing the phase."
      ;;
    superpowers-pe)
      system_intro="Use the Superpowers executing-plans workflow for this bounded phase, but Plan Enforcer enforced tier is also active as the additive enforcement layer. Preserve the original ask, keep Superpowers artifacts on disk, and keep the PE ledger authoritative for task completion and deviation truth."
      ;;
    superpowers)
      system_intro="Use the Superpowers executing-plans skill explicitly. Treat this as a bounded current phase while preserving the original ask. If scope narrows or interpretation changes, record it clearly."
      ;;
  esac

  cat <<PROMPT
Work in this repo only. Do not touch files outside the current working directory.

${system_intro}

Repository context is available in the current working directory. Inspect the actual files before acting. Only the current phase plan is shown below; future phases are intentionally hidden.

Current phase: ${phase_name} (${phase_index}/${phase_count})
Benchmark size: ${size}

Original ask to preserve:

---ORIGINAL ASK START---
${original_ask_text}
---ORIGINAL ASK END---

Current phase plan:

---PHASE PLAN START---
${phase_text}
---PHASE PLAN END---

Scenario:
${scenario_text}

When the phase is complete, keep the final reply terse:
- shipped work
- verification result
- deviation refs if any
- then BENCHMARK_COMPLETE
Do not write a long narrative summary.

When this phase is complete, say BENCHMARK_COMPLETE.
PROMPT
}

resolve_ask_fidelity_pack_dir() {
  local size="$1"
  local override="$2"
  if [[ -n "$override" ]]; then
    if [[ -d "$override" ]]; then
      printf '%s\n' "$override"
      return 0
    fi
    local candidate="$COMP_ROOT/frozen-plans/$override"
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    echo "Ask-fidelity fixture pack not found: $override" >&2
    exit 1
  fi
  printf '%s\n' "${ASK_FIDELITY_PACK_BY_SIZE[$size]:-}"
}

resolve_planning_quality_pack_dir() {
  local size="$1"
  local override="$2"
  if [[ -n "$override" ]]; then
    if [[ -d "$override" ]]; then
      printf '%s\n' "$override"
      return 0
    fi
    local candidate="$COMP_ROOT/frozen-plans/$override"
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    echo "Planning-quality fixture pack not found: $override" >&2
    exit 1
  fi
  printf '%s\n' "${PLANNING_QUALITY_PACK_BY_SIZE[$size]:-}"
}

resolve_fixture_source() {
  local scenario="$1"
  local size="$2"
  local default_fixture="${FIXTURE_BY_SIZE[$size]}"

  if [[ "$scenario" == "ask-fidelity-audit-replay" && -n "${ASK_FIDELITY_FIXTURE_DIR:-}" && -d "${ASK_FIDELITY_FIXTURE_DIR}/fixture-repo" ]]; then
    printf '%s\n' "${ASK_FIDELITY_FIXTURE_DIR}/fixture-repo"
    return 0
  fi

  if [[ "$scenario" == "planning-quality-trace" && -n "${PLANNING_QUALITY_FIXTURE_DIR:-}" && -d "${PLANNING_QUALITY_FIXTURE_DIR}/fixture-repo" ]]; then
    printf '%s\n' "${PLANNING_QUALITY_FIXTURE_DIR}/fixture-repo"
    return 0
  fi

  printf '%s\n' "$default_fixture"
}

latest_completed_phase_dir() {
  local cell_dir="$1"
  local last=""
  [[ -d "$cell_dir" ]] || return 0
  while IFS= read -r phase_dir; do
    if [[ -d "$phase_dir/worktree-artifacts" ]] && [[ -n "$(find "$phase_dir/worktree-artifacts" -type f -print -quit)" ]]; then
      last="$phase_dir"
    fi
  done < <(find "$cell_dir" -maxdepth 1 -type d -name 'phase-*' | sort)
  [[ -n "$last" ]] && printf '%s\n' "$last"
}

record_phased_invocation() {
  local cell_dir="$1"
  local wall_clock_ms="$2"
  local start_phase="$3"
  local end_phase="$4"
  local interrupted_flag="$5"
  local -a cmd=(node "$SCRIPT_DIR/phased-session-state.js" record --cell-dir "$cell_dir" --wall-clock-ms "$wall_clock_ms" --start-phase "$start_phase" --end-phase "$end_phase")
  if [[ "$interrupted_flag" == "1" ]]; then
    cmd+=(--interrupted)
  fi
  "${cmd[@]}" >/dev/null
}

read_phased_summary_field() {
  local cell_dir="$1"
  local field="$2"
  node "$SCRIPT_DIR/phased-session-state.js" summary --cell-dir "$cell_dir" | node -e "let data='';process.stdin.on('data',c=>data+=c).on('end',()=>{const j=JSON.parse(data||'{}');const v=j['$field'];process.stdout.write(v==null?'null':String(v));});"
}

run_phased_execution() {
  local scenario="$1"
  local system="$2"
  local size="$3"
  local tier="$4"
  local sys_kind="$5"
  local pe_backed="$6"
  local out_dir="$7"
  local work_dir="$8"

  local phase_dir=""
  local scenario_file="$COMP_ROOT/scenarios/06-phased-execution.md"
  local ask_fixture_dir=""
  ASK_FIDELITY_FIXTURE_DIR=""
  if [[ "$scenario" == "ask-fidelity-audit-replay" ]]; then
    phase_dir="$(resolve_ask_fidelity_pack_dir "$size" "$ASK_FIDELITY_PACK")"
    ask_fixture_dir="$phase_dir"
    ASK_FIDELITY_FIXTURE_DIR="$phase_dir"
    scenario_file="$COMP_ROOT/scenarios/07-ask-fidelity-audit-replay.md"
  else
    phase_dir="${PHASED_PLAN_DIR_BY_SIZE[$size]:-}"
  fi
  if [[ -z "$phase_dir" || ! -d "$phase_dir" ]]; then
    log "=== $size / $scenario / $system: skipped (no phased fixture implemented for this size)"
    return 0
  fi

  local -a phase_files=()
  mapfile -t phase_files < <(node "$SCRIPT_DIR/list-phase-plan-files.js" "$phase_dir" --plain | grep -E 'phase-[0-9]+\.md$')
  local phase_count="${#phase_files[@]}"
  if [[ "$phase_count" -eq 0 ]]; then
    echo "No phase plans found in $phase_dir"
    exit 1
  fi

  if [[ -z "$RESUME_CELL_DIR" ]]; then
    : > "$out_dir/output.txt"
  else
    {
      echo ""
      echo "=== RESUME $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
      echo ""
    } >> "$out_dir/output.txt"
  fi
  {
    echo "Scenario: $scenario"
    echo "System: $system"
    echo "Size: $size"
    echo "Phase count: $phase_count"
    echo ""
    echo "Per-phase prompts live under:"
    for phase_file in "${phase_files[@]}"; do
      echo "- $(basename "$phase_file" .md)/prompt.txt"
    done
  } > "$out_dir/prompt.txt"
  CELL_PHASE_COUNT="$phase_count"

  local start_phase_index=1
  if [[ -n "$RESUME_CELL_DIR" ]]; then
    local resume_phase_dir
    resume_phase_dir="$(latest_completed_phase_dir "$RESUME_CELL_DIR")"
    if [[ -n "$resume_phase_dir" && -d "$resume_phase_dir/worktree-artifacts" ]]; then
      log "  Resuming phased cell from snapshot: $resume_phase_dir"
      rm -rf "$work_dir"
      mkdir -p "$work_dir"
      cp -R "$resume_phase_dir/worktree-artifacts"/. "$work_dir/"
      local resume_name
      resume_name="$(basename "$resume_phase_dir")"
      start_phase_index=$((10#$(
        echo "$resume_name" | sed -E 's/^phase-0*([0-9]+)$/\1/'
      ) + 1))
    else
      log "  Resume requested but no completed phase snapshot found; starting from phase 1"
    fi
  fi

  local cell_start_sec=$SECONDS
  local phase_index=0
  local completed_end_phase=$((start_phase_index - 1))
  local interrupted_after_phase=0
  for phase_file in "${phase_files[@]}"; do
    phase_index=$((phase_index + 1))
    if [[ "$phase_index" -lt "$start_phase_index" ]]; then
      continue
    fi
    local phase_name
    phase_name="$(basename "$phase_file" .md)"
    local phase_out_dir="$out_dir/$phase_name"
    mkdir -p "$phase_out_dir" "$work_dir/docs/plans"

    cp "$phase_file" "$work_dir/docs/plans/shared-execution-plan.md"
    cp "$phase_file" "$work_dir/docs/plans/$phase_name.md"
    cp "$phase_file" "$phase_out_dir/plan.md"
    if [[ "$pe_backed" == "1" ]]; then
      node "$SCRIPT_DIR/seed-native-enforcer.js" "$work_dir" "$phase_file" "$tier" "$scenario" > /dev/null
    fi

    local prompt
    if [[ "$scenario" == "ask-fidelity-audit-replay" ]]; then
      prompt="$(compose_ask_fidelity_prompt "$system" "$size" "$ask_fixture_dir" "$phase_file" "$phase_name" "$phase_index" "$phase_count")"
    else
      prompt="$(compose_phased_prompt "$system" "$size" "$phase_file" "$phase_name" "$phase_index" "$phase_count")"
    fi
    echo "$prompt" > "$phase_out_dir/prompt.txt"

    if [[ "$pe_backed" == "1" ]]; then
      capture_session_start_output "$work_dir" "$phase_out_dir" "$phase_name"
    fi

    local phase_output="$phase_out_dir/output.txt"
    local phase_start_sec=$SECONDS
    if invoke_claude_json "$phase_output" "$work_dir" "$prompt"; then
      log "  ${phase_name}: Claude exited successfully"
    else
      log "  ${phase_name}: Claude exited with error (code $?)"
    fi
    if [[ "$pe_backed" == "1" ]]; then
      snapshot_session_log "$work_dir" "$phase_out_dir" "$phase_name"
      run_native_recovery_loop "$work_dir" "$phase_output"
      enforce_native_completion "$work_dir" "$phase_output"
      if [[ -f "$work_dir/.plan-enforcer/phase-context.md" ]]; then
        cp "$work_dir/.plan-enforcer/phase-context.md" "$phase_out_dir/phase-context.md"
      fi
      if [[ -f "$work_dir/.plan-enforcer/phase-verdict.json" ]]; then
        cp "$work_dir/.plan-enforcer/phase-verdict.json" "$phase_out_dir/phase-verdict.json"
      fi
    fi
    capture_workspace_artifacts "$work_dir" "$phase_out_dir"

    local phase_wall_clock_ms=$(( (SECONDS - phase_start_sec) * 1000 ))
    cat > "$phase_out_dir/meta.json" <<META
{
  "phase": "$phase_name",
  "phase_index": ${phase_index},
  "phase_count": ${phase_count},
  "size": "$size",
  "scenario": "phased-execution",
  "system": "$system",
  "wall_clock_ms": ${phase_wall_clock_ms}
}
META

    {
      printf '=== %s (%s/%s) ===\n\n' "$phase_name" "$phase_index" "$phase_count"
      cat "$phase_output"
      printf '\n\n'
    } >> "$out_dir/output.txt"
    completed_end_phase="$phase_index"
    if [[ -n "$STOP_AFTER_PHASE" && "$phase_index" -ge "$STOP_AFTER_PHASE" ]]; then
      interrupted_after_phase=1
      log "  Intentional phased stop after ${phase_name}; resume from this cell to continue."
      break
    fi
  done

  capture_workspace_artifacts "$work_dir" "$out_dir"

  local invocation_wall_clock_ms=$(( (SECONDS - cell_start_sec) * 1000 ))
  record_phased_invocation "$out_dir" "$invocation_wall_clock_ms" "$start_phase_index" "$completed_end_phase" "$interrupted_after_phase"
  CELL_WALL_CLOCK_MS="$(read_phased_summary_field "$out_dir" wall_clock_ms)"
  CELL_SESSION_1_WALL_CLOCK_MS="$(read_phased_summary_field "$out_dir" session_1_wall_clock_ms)"
  CELL_SESSION_2_WALL_CLOCK_MS="$(read_phased_summary_field "$out_dir" session_2_wall_clock_ms)"
  if [[ "$pe_backed" == "1" ]]; then
    if [[ "$interrupted_after_phase" -eq 0 ]] && node "$SCRIPT_DIR/aggregate-phase-verdicts.js" "$out_dir" > "$out_dir/outcome.json"; then
      :
    else
      rm -f "$out_dir/outcome.json"
    fi
    if [[ "$interrupted_after_phase" -eq 0 && "$scenario" == "ask-fidelity-audit-replay" ]]; then
      if run_written_judge "$out_dir/ask-fidelity.json" node "$SCRIPT_DIR/judge-ask-fidelity.js" --cell-dir "$out_dir" --fixture-dir "$ask_fixture_dir" --write >/dev/null; then
        :
      else
        log "  ask-fidelity judge failed without writing artifact"
      fi
    fi
  else
    if [[ "$interrupted_after_phase" -eq 0 && "$scenario" == "ask-fidelity-audit-replay" ]]; then
      if run_written_judge "$out_dir/outcome.json" node "$SCRIPT_DIR/judge-phased-cell.js" --cell-dir "$out_dir" --write >/dev/null; then
        :
      else
        log "  phased outcome judge failed without writing artifact"
      fi
      if run_written_judge "$out_dir/ask-fidelity.json" node "$SCRIPT_DIR/judge-ask-fidelity.js" --cell-dir "$out_dir" --fixture-dir "$ask_fixture_dir" --write >/dev/null; then
        :
      else
        log "  ask-fidelity judge failed without writing artifact"
      fi
    elif [[ "$scenario" == "planning-quality-trace" ]]; then
      node "$SCRIPT_DIR/judge-planning-quality.js" --cell-dir "$out_dir" --fixture-dir "$PLANNING_QUALITY_FIXTURE_DIR" --write >/dev/null || true
    fi
  fi
  CELL_PHASE_INTERRUPTED="$interrupted_after_phase"
  export CELL_WALL_CLOCK_MS CELL_SESSION_1_WALL_CLOCK_MS CELL_PHASE_COUNT
}

# ── Run a single scenario × system × size combination ───────────────

run_one() {
  local scenario="$1"
  local system="$2"
  local size="$3"
  # Tier suffix support: system can be "native", "native-advisory",
  # "native-structural", or "native-enforced". The suffix routes the
  # cell into its own results dir AND drives the seeded ledger config
  # so we can chart all three tiers side-by-side. Default = enforced
  # (matches historical behavior when system is bare "native").
  local tier="enforced"
  local sys_kind
  sys_kind="$(parent_system_kind "$system")"
  local pe_backed="0"
  if is_pe_backed_system "$system"; then
    pe_backed="1"
  fi
  case "$system" in
    native-advisory)  tier="advisory"; sys_kind="native" ;;
    native-structural) tier="structural"; sys_kind="native" ;;
    native-enforced)  tier="enforced"; sys_kind="native" ;;
  esac
  local out_dir="$RESULTS_DIR/$size/$scenario/$system"
  local work_dir
  work_dir="$(mktemp -d -t "fc-${size}-${scenario}-${system}-XXXXXX")"
  local checkpoint_tasks="null"

  case "$scenario" in
    plan-only) SCENARIO_INDEX=1 ;;
    execute-frozen-plan) SCENARIO_INDEX=2 ;;
    crash-continuity) SCENARIO_INDEX=3 ;;
    multi-session) SCENARIO_INDEX=5 ;;
    phased-execution) SCENARIO_INDEX=6 ;;
    ask-fidelity-audit-replay) SCENARIO_INDEX=7 ;;
    planning-quality-trace) SCENARIO_INDEX=8 ;;
    *) echo "Unknown scenario: $scenario"; exit 1 ;;
  esac

  # Scenario 05 spec is explicitly medium-size (blog API, 15 tasks).
  # Skip other sizes when invoked from --all-sizes.
  if [[ "$scenario" == "multi-session" && "$size" != "medium" ]]; then
    log "=== $size / $scenario / $system: skipped (spec requires size=medium)"
    return 0
  fi
  if [[ "$scenario" == "phased-execution" && "$size" != "small" ]]; then
    log "=== $size / $scenario / $system: skipped (fixture currently implemented for size=small only)"
    return 0
  fi
  if [[ "$scenario" == "ask-fidelity-audit-replay" && "$size" != "small" && -z "$ASK_FIDELITY_PACK" ]]; then
    log "=== $size / $scenario / $system: skipped (fixture currently implemented for size=small only)"
    return 0
  fi
  if [[ "$scenario" == "planning-quality-trace" && "$size" != "small" && -z "$ASK_FIDELITY_PACK" ]]; then
    log "=== $size / $scenario / $system: skipped (fixture currently implemented for size=small only)"
    return 0
  fi
  if [[ "$scenario" == "ask-fidelity-audit-replay" ]]; then
    local ask_fixture_dir
    ask_fixture_dir="$(resolve_ask_fidelity_pack_dir "$size" "$ASK_FIDELITY_PACK")"
    ASK_FIDELITY_FIXTURE_DIR="$ask_fixture_dir"
    local ask_fixture_name
    ask_fixture_name="$(basename "$ask_fixture_dir")"
    out_dir="$RESULTS_DIR/$size/$scenario/$ask_fixture_name/$system"
  elif [[ "$scenario" == "planning-quality-trace" ]]; then
    local planning_fixture_dir
    planning_fixture_dir="$(resolve_planning_quality_pack_dir "$size" "$ASK_FIDELITY_PACK")"
    PLANNING_QUALITY_FIXTURE_DIR="$planning_fixture_dir"
    local planning_fixture_name
    planning_fixture_name="$(basename "$planning_fixture_dir")"
    out_dir="$RESULTS_DIR/$size/$scenario/$planning_fixture_name/$system"
  else
    PLANNING_QUALITY_FIXTURE_DIR=""
  fi
  if [[ "$scenario" != "plan-only" && "$scenario" != "phased-execution" && "$scenario" != "ask-fidelity-audit-replay" && "$scenario" != "planning-quality-trace" ]]; then
    checkpoint_tasks="${CRASH_CHECKPOINT_BY_SIZE[$size]}"
  fi

  log "=== $size / $scenario / $system ==="
  log "  work_dir=$work_dir"

  if [[ -n "$RESUME_CELL_DIR" ]]; then
    out_dir="$RESUME_CELL_DIR"
    mkdir -p "$out_dir"
  else
    rm -rf "$out_dir"
    mkdir -p "$out_dir"
  fi
  out_dir="$(cd "$out_dir" && pwd -P)"
  log "  out_dir=$out_dir"

  local fixture
  fixture="$(resolve_fixture_source "$scenario" "$size")"
  if [[ -z "$RESUME_CELL_DIR" ]]; then
    cp -r "$fixture"/. "$work_dir/"
  fi
  if [[ -z "$RESUME_CELL_DIR" && "$scenario" != "plan-only" && "$scenario" != "phased-execution" && "$scenario" != "planning-quality-trace" ]]; then
    mkdir -p "$work_dir/docs/plans"
    cp "${FROZEN_PLAN_BY_SIZE[$size]}" "$work_dir/docs/plans/shared-execution-plan.md"
  fi
  # Seed .plan-enforcer/ with canonical pipe-table ledger for native runs on
  # frozen-plan scenarios. Without this the agent ad-libs its own format and
  # the parser can't score it. Mirrors what SessionStart auto-activation does
  # in the real product.
  if [[ "$pe_backed" == "1" && "$scenario" != "plan-only" && "$scenario" != "phased-execution" && "$scenario" != "planning-quality-trace" ]]; then
    node "$SCRIPT_DIR/seed-native-enforcer.js" "$work_dir" "${FROZEN_PLAN_BY_SIZE[$size]}" "$tier" "$scenario" > /dev/null
  fi
  if [[ -z "$RESUME_CELL_DIR" ]]; then
    (cd "$work_dir" && git init -q && git add -A && git -c user.email=bench@local -c user.name=bench commit -q -m "fixture baseline")
  fi
  local baseline_sha
  baseline_sha="$(cd "$work_dir" && git rev-parse HEAD 2>/dev/null || echo unknown)"

  if [[ "$scenario" == "phased-execution" || "$scenario" == "ask-fidelity-audit-replay" ]]; then
    run_phased_execution "$scenario" "$system" "$size" "$tier" "$sys_kind" "$pe_backed" "$out_dir" "$work_dir"
  else
  local prompt; prompt="$(compose_prompt "$scenario" "$system" "$size")"
  if [[ "$scenario" == "crash-continuity" ]]; then
    local cp_task="${CRASH_CHECKPOINT_BY_SIZE[$size]}"
    prompt="${prompt}

Crash checkpoint (plan size: ${size}, total tasks vary):
- Execute tasks 1 through ${cp_task} of the plan to completion.
- Stop BEFORE starting task $((cp_task + 1)).
- When you finish task ${cp_task}, say BENCHMARK_CRASH_POINT_REACHED and stop.
- Do NOT continue past that point."
  elif [[ "$scenario" == "multi-session" ]]; then
    local cp_task="${CRASH_CHECKPOINT_BY_SIZE[$size]}"
    prompt="${prompt}

Session 1 pause point (multi-session continuity scenario):
- Execute tasks 1 through ${cp_task} of the plan to completion.
- Persist any state you want preserved to disk now — the next session
  will start from a completely fresh process with no in-memory context.
- Stop cleanly. Do NOT start task $((cp_task + 1)).
- When you finish task ${cp_task}, say BENCHMARK_SESSION_1_COMPLETE and exit.
- A different, stateless session will resume with only the terse prompt
  'Continue the work. Finish what's left.' — plan your persistence
  accordingly."
  fi
  echo "$prompt" > "$out_dir/prompt.txt"
  if [[ "$pe_backed" == "1" ]]; then
    capture_session_start_output "$work_dir" "$out_dir" "session-1"
  fi

  # Generous turn budget. The semantic checkpoint above is the real stop signal.
  local -a cli_extra=()
  if [[ "$scenario" == "crash-continuity" || "$scenario" == "multi-session" ]]; then
    cli_extra+=(--max-turns "$MAX_TURNS_S1")
  fi

  log "  Launching claude CLI..."
  # For multi-session, session-1 output lives in its own file; for all
  # other scenarios output.txt is the single-session record. At cell end
  # multi-session concatenates both sessions into output.txt so that
  # rerun-failed.sh's sentinel check (BENCHMARK_COMPLETE on output.txt's
  # last line) still works uniformly across scenarios.
  local output_file="$out_dir/output.txt"
  if [[ "$scenario" == "multi-session" ]]; then
    output_file="$out_dir/output-session-1.txt"
  fi
  # Wall-clock: measure the full CLI invocation including resume on
  # crash-continuity. Use $SECONDS (bash builtin, 1-second resolution)
  # — good enough for runs that take minutes; finer-grained probes
  # live in individual tool calls.
  local cell_start_sec=$SECONDS
  local session_1_start_sec=$SECONDS
  if [[ "$pe_backed" == "1" && ( "$scenario" == "crash-continuity" || "$scenario" == "multi-session" ) ]]; then
    set_native_partial_close_marker "$work_dir"
  fi
  if invoke_claude_json "$output_file" "$work_dir" "$prompt" "${cli_extra[@]}"; then
    log "  Claude exited successfully"
  else
    log "  Claude exited with error (code $?)"
  fi
  if [[ "$pe_backed" == "1" && ( "$scenario" == "crash-continuity" || "$scenario" == "multi-session" ) ]]; then
    clear_native_partial_close_marker "$work_dir"
  fi
  CELL_SESSION_1_WALL_CLOCK_MS=$(( (SECONDS - session_1_start_sec) * 1000 ))

  if [[ "$scenario" == "crash-continuity" ]]; then
    if [[ "$pe_backed" == "1" ]]; then
      snapshot_session_log "$work_dir" "$out_dir" "session-1"
      capture_session_start_output "$work_dir" "$out_dir" "session-2"
    fi
    log "  Resuming after interruption..."
    local resume_prompt="Resume the work you were doing in this directory. Detect any prior state you left behind (ledger, planning files, task trackers) and pick up where you stopped. Do not restart from scratch. Continue the remaining frozen-plan work after the crash checkpoint. When done, say BENCHMARK_COMPLETE."
    local resume_output="$out_dir/output-resumed.txt"
    if invoke_claude_json "$resume_output" "$work_dir" "$resume_prompt"; then
      log "  Resume exited successfully"
    else
      log "  Resume exited with error (code $?)"
    fi
    if [[ "$pe_backed" == "1" ]]; then
      snapshot_session_log "$work_dir" "$out_dir" "session-2"
      run_native_recovery_loop "$work_dir" "$resume_output"
      enforce_native_completion "$work_dir" "$resume_output"
    fi
  fi

  if [[ "$scenario" == "multi-session" ]]; then
    if [[ "$pe_backed" == "1" ]]; then
      snapshot_session_log "$work_dir" "$out_dir" "session-1"
      capture_session_start_output "$work_dir" "$out_dir" "session-2"
    fi
    log "  Session 1 complete. Starting Session 2 (fresh PID, terse prompt)..."
    # Spec-required terse prompt: system must self-orient from disk state.
    local s2_prompt="Continue the work. Finish what's left."
    local s2_output="$out_dir/output-session-2.txt"
    local session_2_start_sec=$SECONDS
    if invoke_claude_json "$s2_output" "$work_dir" "$s2_prompt" --max-turns "$MAX_TURNS_S1"; then
      log "  Session 2 exited successfully"
    else
      log "  Session 2 exited with error (code $?)"
    fi
    CELL_SESSION_2_WALL_CLOCK_MS=$(( (SECONDS - session_2_start_sec) * 1000 ))
    # Produce the canonical output.txt so rerun-failed.sh sentinel logic
    # sees BENCHMARK_COMPLETE on the final line.
    {
      cat "$output_file"
      echo ""
      echo "=== SESSION 2 (fresh PID, terse resume prompt) ==="
      echo ""
      cat "$s2_output"
    } > "$out_dir/output.txt"
    if [[ "$pe_backed" == "1" ]]; then
      snapshot_session_log "$work_dir" "$out_dir" "session-2"
      run_native_recovery_loop "$work_dir" "$out_dir/output.txt"
      enforce_native_completion "$work_dir" "$out_dir/output.txt"
    fi
    export CELL_SESSION_2_WALL_CLOCK_MS
  fi
  if [[ "$pe_backed" == "1" && "$scenario" != "crash-continuity" && "$scenario" != "multi-session" ]]; then
    snapshot_session_log "$work_dir" "$out_dir" "session-1"
    run_native_recovery_loop "$work_dir" "$output_file"
    enforce_native_completion "$work_dir" "$output_file"
  fi
  export CELL_SESSION_1_WALL_CLOCK_MS
  fi

  # Wall-clock always measurable. Token + cost capture is now live
  # across every session: invoke_claude_json wraps each claude call
  # with --output-format json and writes a *.usage.json sidecar per
  # session. aggregate-cell-usage.js sums them across the cell (s1 +
  # s2 + every recovery pass) into totals for meta.json. modelUsage
  # includes subagent calls (GSD/Superpowers), so cross-system
  # comparisons are fair. total_cost_usd is Anthropic's own
  # cache-adjusted bill, not a derived estimate.
  if [[ -z "${CELL_WALL_CLOCK_MS:-}" ]]; then
    CELL_WALL_CLOCK_MS=$(( (SECONDS - cell_start_sec) * 1000 ))
  fi
  export CELL_WALL_CLOCK_MS

  log "  Collecting artifacts..."

  (cd "$work_dir" && git diff "$baseline_sha" > "$out_dir/final.diff" 2>/dev/null || true)
  (cd "$work_dir" && git diff --stat "$baseline_sha" > "$out_dir/final-diff-stat.txt" 2>/dev/null || true)

  # Fallback artifact listing. A nested `git init` inside a subdir
  # (e.g. small-url-shortener.md Task 1) hides subdir contents from the
  # outer git diff — empty final.diff alongside "100% complete" is the
  # exact silent-artifact pattern Plan Enforcer exists to prevent.
  # final-tree.txt gives judges a reliable file inventory regardless.
  (cd "$work_dir" && find . -type f \
     -not -path './node_modules/*' \
     -not -path './.git/*' \
     -not -path './*/node_modules/*' \
     -not -path './*/.git/*' \
     | sort > "$out_dir/final-tree.txt" 2>/dev/null || true)

  # P0a 2026-04-15: was [[ "$system" == "native" ]] which fails for
  # tier-suffix variants (native-advisory etc). Resulted in lost
  # ledger / archive / nudge-log data on every tier rerun.
  if [[ "$pe_backed" == "1" && -f "$work_dir/.plan-enforcer/ledger.md" ]]; then
    cp "$work_dir/.plan-enforcer/ledger.md" "$out_dir/ledger.md"
  fi
  if [[ "$pe_backed" == "1" && -d "$work_dir/.plan-enforcer/archive" ]]; then
    cp -r "$work_dir/.plan-enforcer/archive" "$out_dir/archive"
  fi
  if [[ "$pe_backed" == "1" && -f "$work_dir/.plan-enforcer/.nudge-log" ]]; then
    cp "$work_dir/.plan-enforcer/.nudge-log" "$out_dir/nudge-log.jsonl"
  fi

  if [[ "$sys_kind" == "gsd" && -d "$work_dir/.planning" ]]; then
    cp -r "$work_dir/.planning" "$out_dir/planning"
  fi

  if [[ "$sys_kind" == "superpowers" ]]; then
    capture_superpowers_artifacts "$work_dir" "$out_dir"
  fi

  if [[ "$sys_kind" == "gsd" ]]; then
    capture_gsd_artifacts "$work_dir" "$out_dir"
  fi

  capture_workspace_artifacts "$work_dir" "$out_dir"
  if [[ "$pe_backed" == "1" && ( "$scenario" == "plan-only" || "$scenario" == "planning-quality-trace" ) ]]; then
    capture_native_planning_artifacts "$work_dir" "$out_dir"
  fi
  if [[ "$scenario" == "planning-quality-trace" && -n "${PLANNING_QUALITY_FIXTURE_DIR:-}" ]]; then
    node "$SCRIPT_DIR/judge-planning-quality.js" --cell-dir "$out_dir" --fixture-dir "$PLANNING_QUALITY_FIXTURE_DIR" --write >/dev/null || true
  fi

  # Aggregate per-session usage sidecars into cell-level totals.
  # invoke_claude_json wrote a *.usage.json next to every session
  # output (session-1, session-2, resume, recovery passes). This
  # sums them — modelUsage already includes subagent tokens so the
  # totals are comparable across native/gsd/superpowers.
  local usage_summary_path="$out_dir/usage-summary.json"
  node "$SCRIPT_DIR/aggregate-cell-usage.js" "$out_dir" > "$usage_summary_path" 2>/dev/null || echo '{}' > "$usage_summary_path"

  local agg_total_tokens agg_cost_usd agg_input agg_output agg_cache_read agg_cache_create agg_sessions
  agg_total_tokens=$(node "$SCRIPT_DIR/read-summary-field.js" "$usage_summary_path" total_tokens)
  agg_cost_usd=$(node "$SCRIPT_DIR/read-summary-field.js" "$usage_summary_path" total_cost_usd)
  agg_input=$(node "$SCRIPT_DIR/read-summary-field.js" "$usage_summary_path" input_tokens)
  agg_output=$(node "$SCRIPT_DIR/read-summary-field.js" "$usage_summary_path" output_tokens)
  agg_cache_read=$(node "$SCRIPT_DIR/read-summary-field.js" "$usage_summary_path" cache_read_input_tokens)
  agg_cache_create=$(node "$SCRIPT_DIR/read-summary-field.js" "$usage_summary_path" cache_creation_input_tokens)
  agg_sessions=$(node "$SCRIPT_DIR/read-summary-field.js" "$usage_summary_path" sessions_counted)
  if [[ "$scenario" == "phased-execution" || "$scenario" == "ask-fidelity-audit-replay" ]]; then
    agg_sessions=$(read_phased_summary_field "$out_dir" sessions_counted)
  fi

  local phased_interrupted_json="false"
  if [[ "${CELL_PHASE_INTERRUPTED:-0}" == "1" ]]; then
    phased_interrupted_json="true"
  fi
  cat > "$out_dir/meta.json" <<META
{
  "size": "$size",
  "scenario": "$scenario",
  "system": "$system",
  "phase_count": ${CELL_PHASE_COUNT:-null},
  "work_dir": "$work_dir",
  "baseline_sha": "$baseline_sha",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "crash_checkpoint_tasks": ${checkpoint_tasks},
  "phased_interrupted": ${phased_interrupted_json},
  "wall_clock_ms": ${CELL_WALL_CLOCK_MS:-null},
  "session_1_wall_clock_ms": ${CELL_SESSION_1_WALL_CLOCK_MS:-null},
  "session_2_wall_clock_ms": ${CELL_SESSION_2_WALL_CLOCK_MS:-null},
  "sessions_counted": ${agg_sessions:-null},
  "input_tokens": ${agg_input:-null},
  "output_tokens": ${agg_output:-null},
  "cache_read_input_tokens": ${agg_cache_read:-null},
  "cache_creation_input_tokens": ${agg_cache_create:-null},
  "total_tokens": ${agg_total_tokens:-null},
  "total_cost_usd": ${agg_cost_usd:-null}
}
META

  if [[ "${CELL_PHASE_INTERRUPTED:-0}" == "0" && ( "$scenario" == "phased-execution" || "$scenario" == "ask-fidelity-audit-replay" ) ]]; then
    node "$SCRIPT_DIR/phased-session-state.js" clear --cell-dir "$out_dir" >/dev/null 2>&1 || true
  fi

  log "  Done: $size / $scenario / $system"
  echo ""
}

# ── Main ────────────────────────────────────────────────────────────

if [[ $# -eq 0 ]]; then
  usage
fi

# Parse plan-size flag out of args
parse_size_flag "$@"

# Strip --plan-size flag from positional args
POSITIONAL=()
i=0
args=("$@")
while [[ $i -lt ${#args[@]} ]]; do
  if [[ "${args[$i]}" == "--plan-size" || "${args[$i]}" == "--fixture-pack" || "${args[$i]}" == "--resume-cell-dir" || "${args[$i]}" == "--stop-after-phase" ]]; then
    i=$((i + 2))
    continue
  fi
  POSITIONAL+=("${args[$i]}")
  i=$((i + 1))
done

if [[ ${#POSITIONAL[@]} -eq 0 ]]; then
  usage
fi

case "${POSITIONAL[0]}" in
  --all-sizes)
    log "Running all sizes × all scenarios × all systems (27 base + 9 resume)..."
    for size in "${SIZES[@]}"; do
      for scenario in "${SCENARIOS[@]}"; do
        for system in "${SYSTEMS[@]}"; do
          run_one "$scenario" "$system" "$size"
        done
      done
    done
    log "All runs complete. Check emitted judge artifacts and update current comparison docs if needed."
    ;;
  --all)
    log "Running all scenarios × all systems at size=$PLAN_SIZE..."
    for scenario in "${SCENARIOS[@]}"; do
      for system in "${SYSTEMS[@]}"; do
        run_one "$scenario" "$system" "$PLAN_SIZE"
      done
    done
    log "Done. Check emitted judge artifacts and update current comparison docs if needed."
    ;;
  *)
    if [[ ${#POSITIONAL[@]} -lt 2 ]]; then
      usage
    fi
    run_one "${POSITIONAL[0]}" "${POSITIONAL[1]}" "$PLAN_SIZE"
    ;;
esac
