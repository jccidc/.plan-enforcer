#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readConfig } = require('./config');

const REQUIRED_SKILLS = [
  'plan-enforcer',
  'plan-enforcer-discuss',
  'plan-enforcer-draft',
  'plan-enforcer-review',
  'plan-enforcer-status',
  'plan-enforcer-logs',
  'plan-enforcer-config',
  'plan-enforcer-report'
];

const REQUIRED_RUNTIME_MODULES = [
  'plan-enforcer-cli.js',
  'doctor-cli.js',
  'config.js',
  'discuss-cli.js',
  'git-worktree.js',
  'statusline-state.js',
  'status-cli.js',
  'logs-cli.js',
  'report-cli.js',
  'import-cli.js'
];

const REQUIRED_HOOK_FILES = {
  advisory: [],
  structural: ['session-start.js', 'user-message.js'],
  enforced: [
    'session-start.js',
    'user-message.js',
    'chain-guard.js',
    'delete-guard.js',
    'ledger-schema-guard.js',
    'evidence-gate.js',
    'post-tool.js',
    'session-end.js'
  ]
};

const REQUIRED_HOOK_COMMANDS = {
  advisory: [],
  structural: [
    { event: 'SessionStart', fragment: 'session-start.js' },
    { event: 'UserPromptSubmit', fragment: 'user-message.js' }
  ],
  enforced: [
    { event: 'SessionStart', fragment: 'session-start.js' },
    { event: 'UserPromptSubmit', fragment: 'user-message.js' },
    { event: 'PreToolUse', fragment: 'chain-guard.js' },
    { event: 'PreToolUse', fragment: 'delete-guard.js' },
    { event: 'PreToolUse', fragment: 'ledger-schema-guard.js' },
    { event: 'PostToolUse', fragment: 'evidence-gate.js' },
    { event: 'PostToolUse', fragment: 'post-tool.js' },
    { event: 'SessionEnd', fragment: 'session-end.js' }
  ]
};

function usage() {
  return [
    'Usage: plan-enforcer-doctor [--json]',
    '       plan-enforcer doctor [--json]'
  ].join('\n');
}

function resolveHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function formatPath(targetPath, cwd = process.cwd()) {
  const resolved = path.resolve(targetPath);
  const rel = path.relative(cwd, resolved).replace(/\\/g, '/');
  if (!rel || rel === '') return '.';
  if (!rel.startsWith('..')) return rel;
  return resolved.replace(/\\/g, '/');
}

function collectHookCommands(settings, event) {
  if (!settings || !settings.hooks || !Array.isArray(settings.hooks[event])) return [];
  const commands = [];
  settings.hooks[event].forEach((entry) => {
    (entry.hooks || []).forEach((hook) => {
      if (hook && hook.command) commands.push(String(hook.command));
    });
  });
  return commands;
}

function inspectSettingsFile(settingsPath, tier, cwd = process.cwd()) {
  if (!fs.existsSync(settingsPath)) {
    return {
      path: settingsPath,
      exists: false,
      ok: tier === 'advisory',
      missing: REQUIRED_HOOK_COMMANDS[tier] || [],
      parseError: null,
      detail: `missing ${formatPath(settingsPath, cwd)}`
    };
  }

  let settings = null;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    return {
      path: settingsPath,
      exists: true,
      ok: false,
      missing: [],
      parseError: error.message,
      detail: `invalid JSON in ${formatPath(settingsPath, cwd)}`
    };
  }

  const missing = (REQUIRED_HOOK_COMMANDS[tier] || []).filter(({ event, fragment }) => {
    const commands = collectHookCommands(settings, event);
    return !commands.some((command) => command.includes(fragment));
  });

  return {
    path: settingsPath,
    exists: true,
    ok: missing.length === 0,
    missing,
    parseError: null,
    statusLineCommand: settings.statusLine && settings.statusLine.command ? String(settings.statusLine.command) : '',
    detail: missing.length === 0
      ? `ok ${formatPath(settingsPath, cwd)}`
      : `missing ${missing.map(({ event, fragment }) => `${event}:${fragment}`).join(', ')} in ${formatPath(settingsPath, cwd)}`
  };
}

function inspectInstall(cwd = process.cwd()) {
  const homeDir = resolveHomeDir();
  const skillsDir = path.join(homeDir, '.claude', 'skills');
  const installedRoot = path.join(skillsDir, 'plan-enforcer');
  const hooksDir = path.join(installedRoot, 'hooks');
  const runtimeDir = path.join(installedRoot, 'src');
  const statuslineHookPath = path.join(hooksDir, 'statusline.js');
  const configPath = path.join(cwd, '.plan-enforcer', 'config.md');
  const hasConfig = fs.existsSync(configPath);
  const config = hasConfig ? readConfig(configPath) : null;
  const tier = hasConfig ? config.tier : 'structural';
  const activeLedgerPath = path.join(cwd, '.plan-enforcer', 'ledger.md');

  const missingSkills = REQUIRED_SKILLS.filter((skill) => !fs.existsSync(path.join(skillsDir, skill)));
  const missingRuntimeModules = REQUIRED_RUNTIME_MODULES.filter((file) => !fs.existsSync(path.join(runtimeDir, file)));
  const missingHookFiles = (REQUIRED_HOOK_FILES[tier] || []).filter((file) => !fs.existsSync(path.join(hooksDir, file)));

  const settingsReports = [
    { scope: 'project', ...inspectSettingsFile(path.join(cwd, '.claude', 'settings.json'), tier, cwd) },
    { scope: 'global', ...inspectSettingsFile(path.join(homeDir, '.claude', 'settings.json'), tier, cwd) }
  ];
  const settings = settingsReports.find((report) => report.ok)
    || settingsReports.find((report) => report.exists)
    || settingsReports[0];
  const statusline = settingsReports.find((report) => (report.statusLineCommand || '').includes('statusline.js'))
    || settingsReports.find((report) => report.statusLineCommand)
    || settings;

  const checks = {
    node: {
      status: Number(process.versions.node.split('.')[0]) >= 18 ? 'ok' : 'fail',
      detail: `Node ${process.versions.node}`
    },
    skills: {
      status: missingSkills.length === 0 ? 'ok' : 'fail',
      detail: missingSkills.length === 0
        ? `${REQUIRED_SKILLS.length}/${REQUIRED_SKILLS.length} skill surfaces installed`
        : `missing ${missingSkills.join(', ')}`
    },
    runtime: {
      status: missingRuntimeModules.length === 0 ? 'ok' : 'fail',
      detail: missingRuntimeModules.length === 0
        ? `${REQUIRED_RUNTIME_MODULES.length}/${REQUIRED_RUNTIME_MODULES.length} runtime modules present`
        : `missing ${missingRuntimeModules.join(', ')}`
    },
    hooks: {
      status: missingHookFiles.length === 0 ? 'ok' : 'fail',
      detail: (REQUIRED_HOOK_FILES[tier] || []).length === 0
        ? 'advisory tier needs no hook files'
        : missingHookFiles.length === 0
          ? `${REQUIRED_HOOK_FILES[tier].length}/${REQUIRED_HOOK_FILES[tier].length} hook files present for ${tier}`
          : `missing ${missingHookFiles.join(', ')}`
    },
    settings: {
      status: settings.ok ? 'ok' : 'fail',
      detail: tier === 'advisory'
        ? 'advisory tier needs no hook settings'
        : `${settings.scope} ${settings.detail}`
    },
    statusline: {
      status: fs.existsSync(statuslineHookPath) && (statusline.statusLineCommand || '').includes('statusline.js') ? 'ok' : 'fail',
      detail: fs.existsSync(statuslineHookPath) && (statusline.statusLineCommand || '').includes('statusline.js')
        ? `${statusline.scope} statusLine -> ${statusline.statusLineCommand}`
        : `missing statusline hook or command (${formatPath(statuslineHookPath, cwd)})`
    },
    config: {
      status: hasConfig ? 'ok' : 'warn',
      detail: hasConfig
        ? `${tier} ${formatPath(configPath, cwd)}`
        : `missing ${formatPath(configPath, cwd)}`
    }
  };

  const hasFailures = Object.values(checks).some((check) => check.status === 'fail');
  const next = [];

  if (hasFailures) {
    next.push('rerun ./install.sh from the repo root');
    next.push('then rerun: plan-enforcer doctor');
  } else if (!hasConfig) {
    next.push('run ./install.sh from the repo root to seed .plan-enforcer/config.md');
    next.push('then start with discuss: plan-enforcer discuss "your ask"');
  } else if (fs.existsSync(activeLedgerPath)) {
    next.push('inspect live state: plan-enforcer status');
    next.push('report surface: plan-enforcer report --active');
  } else {
    next.push('start with discuss: plan-enforcer discuss "your ask"');
    next.push('or seed existing plan: plan-enforcer import docs/plans/<plan-file>.md');
  }

  return {
    cwd: cwd.replace(/\\/g, '/'),
    tier,
    hasFailures,
    checks,
    paths: {
      skills_dir: skillsDir.replace(/\\/g, '/'),
      config: formatPath(configPath, cwd),
      active_ledger: formatPath(activeLedgerPath, cwd)
    },
    next
  };
}

function formatDoctorReport(report) {
  const lines = [
    '---Plan Enforcer Doctor ------------------------------',
    ` Node: ${report.checks.node.status}  ${report.checks.node.detail}`,
    ` Skills: ${report.checks.skills.status}  ${report.checks.skills.detail}`,
    ` Runtime: ${report.checks.runtime.status}  ${report.checks.runtime.detail}`,
    ` Hooks: ${report.checks.hooks.status}  ${report.checks.hooks.detail}`,
    ` Settings: ${report.checks.settings.status}  ${report.checks.settings.detail}`,
    ` StatusLine: ${report.checks.statusline.status}  ${report.checks.statusline.detail}`,
    ` Config: ${report.checks.config.status}  ${report.checks.config.detail}`,
    '-----------------------------------------------------',
    'Next:'
  ];
  report.next.forEach((step) => lines.push(`  ${step}`));
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return 0;
  }

  const json = argv.includes('--json');
  const report = inspectInstall(process.cwd());
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report));
  }
  return report.hasFailures ? 1 : 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  REQUIRED_HOOK_COMMANDS,
  REQUIRED_HOOK_FILES,
  REQUIRED_RUNTIME_MODULES,
  REQUIRED_SKILLS,
  collectHookCommands,
  formatDoctorReport,
  inspectInstall,
  inspectSettingsFile,
  main,
  usage
};
