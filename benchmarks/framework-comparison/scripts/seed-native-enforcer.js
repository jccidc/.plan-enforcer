#!/usr/bin/env node
// Seed a work_dir with a Plan Enforcer fixture so the agent edits the canonical
// pipe-table ledger instead of inventing its own format.
//
// Usage: seed-native-enforcer.js <work_dir> <frozen_plan_path> <tier> [scenario]

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const { extractTasksFromContent, generateLedger } = require(path.join(REPO_ROOT, 'src', 'plan-detector.js'));

function extractAllTaskLabels(content) {
  const re = /(?:^|\n)[ \t]*(?:[-*]\s*\[[ x]\]\s*|\d+\.\s*|#{1,4}\s*)?\*?\*?Task\s+(\d+)[:.)*]\s*\*?\*?\s*([^\n\r]+)/gi;
  const byIndex = new Map();
  for (const m of content.matchAll(re)) {
    const n = parseInt(m[1], 10);
    if (!byIndex.has(n)) {
      const name = m[2].replace(/\*+$/, '').replace(/\.\s*$/, '').trim();
      byIndex.set(n, name);
    }
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, name]) => name);
}

function getBenchmarkProfile(rawTier, strictContinuity) {
  const normalizedTier = ['advisory', 'structural', 'enforced'].includes(rawTier)
    ? rawTier
    : 'structural';

  const base = {
    advisory: {
      reconcile_interval: 50,
      stale_threshold: 999,
      completion_gate: 'soft'
    },
    structural: {
      reconcile_interval: 25,
      stale_threshold: 25,
      completion_gate: 'soft'
    },
    enforced: {
      reconcile_interval: 25,
      stale_threshold: 25,
      completion_gate: 'hard'
    }
  }[normalizedTier];

  if (!strictContinuity) return base;

  return {
    ...base,
    reconcile_interval: normalizedTier === 'advisory' ? 25 : 10
  };
}

function main() {
  const workDir = process.argv[2];
  const frozenPlan = process.argv[3];
  const tier = process.argv[4] || 'enforced';
  const scenario = process.argv[5] || 'execute-frozen-plan';

  if (!workDir || !frozenPlan) {
    console.error('Usage: seed-native-enforcer.js <work_dir> <frozen_plan_path> [tier] [scenario]');
    process.exit(1);
  }

  const planContent = fs.readFileSync(frozenPlan, 'utf8');
  let tasks = extractAllTaskLabels(planContent);
  if (tasks.length === 0) {
    const fallback = extractTasksFromContent(planContent);
    tasks = fallback.tasks;
  }
  if (tasks.length === 0) {
    console.error(`No tasks extracted from ${frozenPlan}`);
    process.exit(2);
  }

  const enforcerDir = path.join(workDir, '.plan-enforcer');
  fs.mkdirSync(enforcerDir, { recursive: true });
  const claudeDir = path.join(workDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });

  const relPlan = 'docs/plans/shared-execution-plan.md';
  const ledger = generateLedger(relPlan, tasks, tier);
  fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), ledger);

  const strictContinuity =
    scenario === 'crash-continuity' ||
    scenario === 'multi-session' ||
    scenario === 'phased-execution';
  const profile = getBenchmarkProfile(tier, strictContinuity);
  const config = `---
tier: ${tier}
reconcile_interval: ${profile.reconcile_interval}
stale_threshold: ${profile.stale_threshold}
completion_gate: ${profile.completion_gate}
ledger_path: .plan-enforcer/ledger.md
---
`;
  fs.writeFileSync(path.join(enforcerDir, 'config.md'), config);

  const repoHook = (name) => path.join(REPO_ROOT, 'hooks', name).replace(/\\/g, '/');
  const settings = {
    _comment: 'Benchmark-local Plan Enforcer hooks. Uses repo hook files via absolute paths so native cells exercise the shipped enforcement layer.',
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: `node "${repoHook('session-start.js')}"`
            }
          ]
        }
      ],
      PreToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: `node "${repoHook('chain-guard.js')}"`
            }
          ]
        },
        {
          hooks: [
            {
              type: 'command',
              command: `node "${repoHook('delete-guard.js')}"`
            }
          ]
        },
        {
          hooks: [
            {
              type: 'command',
              command: `node "${repoHook('ledger-schema-guard.js')}"`
            }
          ]
        }
      ],
      PostToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: `node "${repoHook('evidence-gate.js')}"`
            },
            {
              type: 'command',
              command: `node "${repoHook('post-tool.js')}"`
            }
          ]
        }
      ],
      SessionEnd: [
        {
          hooks: [
            {
              type: 'command',
              command: `node "${repoHook('session-end.js')}"`
            }
          ]
        }
      ]
    }
  };
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

  console.log(`Seeded ${enforcerDir} with ${tasks.length} tasks (tier=${tier})`);
}

if (require.main === module) {
  main();
}

module.exports = { extractAllTaskLabels, getBenchmarkProfile, main };
