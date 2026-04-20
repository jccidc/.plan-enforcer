#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const {
  addIntent,
  loadAwarenessState,
  normalizePromptText
} = require('./awareness');
const { writeNamedStatuslineStage } = require('./statusline-state');

const DEFAULT_PACKET_BASENAME = 'discuss.md';
const LEGACY_PACKET_BASENAME = 'combobulate.md';

function usage() {
  return [
    'Usage:',
    '  plan-enforcer-discuss [--title <title>] [--packet <path>] [--from-file <path>] [--interactive|--non-interactive] [--json] [ask text...]',
    '  plan-enforcer discuss [args...]',
    '',
    'Examples:',
    '  plan-enforcer discuss "Fix roadmap regression without snapping back to stale plan text"',
    '  plan-enforcer discuss --from-file docs/requests/replay-ask.md',
    '  plan-enforcer discuss --interactive',
    '',
    'Behavior:',
    '  - writes .plan-enforcer/discuss.md',
    '  - also writes .plan-enforcer/combobulate.md for backward compatibility',
    '  - seeds awareness with the exact source ask when not already present',
    '  - interactive mode asks only plan-shaping questions'
  ].join('\n');
}

function createEmptyPacket(sourceAsk = '', title = '') {
  return {
    title,
    sourceAsk,
    normalizedGoal: '',
    nonNegotiables: [],
    hiddenContracts: [],
    plausibleInterpretations: [],
    chosenInterpretation: '',
    forbiddenNarrowings: [],
    inScope: [],
    outOfScope: [],
    constraints: [],
    successSignals: [],
    driftRisks: [],
    proofRequirements: [],
    phaseShapeHint: '',
    planningRedLines: []
  };
}

function parseArgs(argv) {
  const args = {
    _: [],
    json: false,
    interactive: undefined,
    title: '',
    packetPath: '',
    fromFile: ''
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--interactive') args.interactive = true;
    else if (arg === '--non-interactive') args.interactive = false;
    else if (arg === '--title') args.title = argv[++i] || '';
    else if (arg === '--packet') args.packetPath = argv[++i] || '';
    else if (arg === '--from-file') args.fromFile = argv[++i] || '';
    else args._.push(arg);
  }

  return args;
}

function slugTitle(text) {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 8);
  if (words.length === 0) return 'Intent Packet';
  return words
    .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'Intent Packet';
}

function readAskText(args, cwd) {
  const direct = args._.join(' ').trim();
  if (direct) return direct;
  if (args.fromFile) {
    const filePath = path.resolve(cwd, args.fromFile);
    if (!fs.existsSync(filePath)) throw new Error(`Ask file not found: ${filePath}`);
    return fs.readFileSync(filePath, 'utf8').trim();
  }
  if (!process.stdin.isTTY) {
    return fs.readFileSync(0, 'utf8').trim();
  }
  return '';
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function promptList(rl, label) {
  const out = [];
  while (true) {
    const answer = (await rl.question(`${label} (blank to stop): `)).trim();
    if (!answer) break;
    out.push(answer);
  }
  return out;
}

async function collectInteractive(packet) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    if (!packet.sourceAsk) {
      packet.sourceAsk = (await rl.question('Source ask: ')).trim();
    }
    if (!packet.title) {
      const title = (await rl.question(`Packet title [${slugTitle(packet.sourceAsk)}]: `)).trim();
      packet.title = title || slugTitle(packet.sourceAsk);
    }
    if (!packet.normalizedGoal) {
      packet.normalizedGoal = splitLines(await rl.question('Normalized goal (blank to skip): ')).join(' ');
    }
    packet.nonNegotiables = await promptList(rl, 'Non-negotiable');
    packet.hiddenContracts = await promptList(rl, 'Hidden contract');
    packet.plausibleInterpretations = await promptList(rl, 'Plausible interpretation');
    packet.chosenInterpretation = splitLines(await rl.question('Chosen interpretation (blank to skip): ')).join(' ');
    packet.forbiddenNarrowings = await promptList(rl, 'Forbidden narrowing');
    packet.inScope = await promptList(rl, 'In-scope outcome');
    packet.outOfScope = await promptList(rl, 'Out-of-scope item');
    packet.constraints = await promptList(rl, 'Constraint');
    packet.successSignals = await promptList(rl, 'Success signal');
    packet.driftRisks = await promptList(rl, 'Drift risk');
    packet.proofRequirements = await promptList(rl, 'Proof requirement');
    packet.phaseShapeHint = splitLines(await rl.question('Phase shape hint (blank to skip): ')).join(' ');
    packet.planningRedLines = await promptList(rl, 'Planning red line');
  } finally {
    rl.close();
  }

  return packet;
}

function findDiscussProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  const initial = current;

  while (true) {
    if (fs.existsSync(path.join(current, '.plan-enforcer'))) return current;
    if (fs.existsSync(path.join(current, '.git'))) return current;
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return initial;
    current = parent;
  }
}

function resolvePacketPaths(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const projectRoot = findDiscussProjectRoot(cwd);
  const packetPath = opts.packetPath
    ? path.resolve(cwd, opts.packetPath)
    : path.join(projectRoot, '.plan-enforcer', DEFAULT_PACKET_BASENAME);
  const legacyPath = path.join(path.dirname(packetPath), LEGACY_PACKET_BASENAME);
  return {
    projectRoot,
    packetPath,
    legacyPath,
    awarenessPath: path.join(projectRoot, '.plan-enforcer', 'awareness.md')
  };
}

function renderQuotedBlock(text) {
  return splitLines(text).map((line) => `> ${line}`).join('\n');
}

function renderTaggedList(items, tag) {
  return items.map((item, index) => `- ${tag}${index + 1}: ${item}`).join('\n');
}

function renderPlainList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function renderPacket(packet) {
  const sections = [];

  sections.push(`# ${packet.title || slugTitle(packet.sourceAsk)}`);

  if (packet.sourceAsk) {
    sections.push(['## Source Ask', renderQuotedBlock(packet.sourceAsk)].join('\n\n'));
  }
  if (packet.normalizedGoal) {
    sections.push(['## Normalized Goal', packet.normalizedGoal].join('\n\n'));
  }
  if ((packet.nonNegotiables || []).length > 0) {
    sections.push(['## Non-Negotiables', renderTaggedList(packet.nonNegotiables, 'NN')].join('\n\n'));
  }
  if ((packet.hiddenContracts || []).length > 0) {
    sections.push(['## Hidden Contract Candidates', renderTaggedList(packet.hiddenContracts, 'HC')].join('\n\n'));
  }
  if ((packet.plausibleInterpretations || []).length > 0) {
    sections.push(['## Plausible Interpretations', renderTaggedList(packet.plausibleInterpretations, 'PI')].join('\n\n'));
  }
  if (packet.chosenInterpretation) {
    sections.push(['## Chosen Interpretation', packet.chosenInterpretation].join('\n\n'));
  }
  if ((packet.forbiddenNarrowings || []).length > 0) {
    sections.push(['## Rejected / Forbidden Narrowings', renderTaggedList(packet.forbiddenNarrowings, 'FN')].join('\n\n'));
  }
  if ((packet.inScope || []).length > 0) {
    sections.push(['## In Scope', renderPlainList(packet.inScope)].join('\n\n'));
  }
  if ((packet.outOfScope || []).length > 0) {
    sections.push(['## Out of Scope', renderPlainList(packet.outOfScope)].join('\n\n'));
  }
  if ((packet.constraints || []).length > 0) {
    sections.push(['## Constraints', renderPlainList(packet.constraints)].join('\n\n'));
  }
  if ((packet.successSignals || []).length > 0) {
    sections.push(['## Success Signals', renderPlainList(packet.successSignals)].join('\n\n'));
  }
  if ((packet.driftRisks || []).length > 0) {
    sections.push(['## Drift Risks', renderTaggedList(packet.driftRisks, 'DR')].join('\n\n'));
  }
  if ((packet.proofRequirements || []).length > 0) {
    sections.push(['## Proof Requirements', renderTaggedList(packet.proofRequirements, 'PR')].join('\n\n'));
  }
  if (packet.phaseShapeHint || (packet.planningRedLines || []).length > 0) {
    const lines = [];
    if (packet.phaseShapeHint) lines.push(`- phase shape hint: ${packet.phaseShapeHint}`);
    for (const line of packet.planningRedLines || []) {
      lines.push(`- planning red line: ${line}`);
    }
    sections.push(['## Draft Handoff', lines.join('\n')].join('\n\n'));
  }

  return `${sections.join('\n\n')}\n`;
}

function ensureAwarenessIntent(sourceAsk, opts = {}) {
  const normalizedQuote = normalizePromptText(sourceAsk).trim();
  if (!normalizedQuote) return { created: false, id: '' };
  const loaded = loadAwarenessState({ cwd: opts.cwd, awarenessPath: opts.awarenessPath });
  const existing = (loaded.state.intents || []).find((row) => normalizePromptText(row.quote).trim() === normalizedQuote);
  if (existing) {
    return { created: false, id: existing.id, awarenessPath: loaded.awarenessPath };
  }
  const row = addIntent({
    cwd: opts.cwd,
    awarenessPath: loaded.awarenessPath,
    quote: normalizedQuote,
    source: 'manual'
  });
  return { created: true, id: row.id, awarenessPath: row.awarenessPath };
}

function writeDiscussPacket(packet, opts = {}) {
  const paths = resolvePacketPaths(opts);
  fs.mkdirSync(path.dirname(paths.packetPath), { recursive: true });
  const markdown = renderPacket(packet);
  fs.writeFileSync(paths.packetPath, markdown, 'utf8');
  if (paths.legacyPath !== paths.packetPath) {
    fs.writeFileSync(paths.legacyPath, markdown, 'utf8');
  }
  const awareness = ensureAwarenessIntent(packet.sourceAsk, {
    cwd: paths.projectRoot,
    awarenessPath: paths.awarenessPath
  });
  writeNamedStatuslineStage('discuss', {
    cwd: paths.projectRoot,
    label: '1-DISCUSS',
    source: opts.source || 'discuss-cli',
    title: packet.title || slugTitle(packet.sourceAsk)
  });
  return { paths, awareness, markdown };
}

function buildSummary(packet, paths, awareness) {
  return {
    packetPath: paths.packetPath,
    legacyPacketPath: paths.legacyPath,
    title: packet.title,
    sourceAsk: packet.sourceAsk,
    awareness
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const cwd = process.cwd();
  const sourceAsk = readAskText(args, cwd);
  const interactive = args.interactive != null
    ? args.interactive
    : Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (!sourceAsk && !interactive) {
    console.error('Missing source ask. Pass ask text, --from-file, stdin, or use --interactive.');
    return 2;
  }

  let packet = createEmptyPacket(sourceAsk, args.title || '');

  if (interactive) {
    packet = await collectInteractive(packet);
  }

  packet.title = packet.title || slugTitle(packet.sourceAsk);

  const { paths, awareness } = writeDiscussPacket(packet, {
    cwd,
    packetPath: args.packetPath
  });
  const summary = buildSummary(packet, paths, awareness);

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Discuss packet written to: ${paths.packetPath}`);
    if (paths.legacyPath !== paths.packetPath) {
      console.log(`Compatibility packet written to: ${paths.legacyPath}`);
    }
    if (awareness.id) {
      console.log(`${awareness.created ? 'Seeded' : 'Reused'} awareness intent: ${awareness.id}`);
    }
  }
  return 0;
}

if (require.main === module) {
  Promise.resolve(main())
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error.message || String(error));
      process.exit(1);
    });
}

module.exports = {
  buildSummary,
  collectInteractive,
  createEmptyPacket,
  ensureAwarenessIntent,
  findDiscussProjectRoot,
  main,
  parseArgs,
  readAskText,
  renderPacket,
  resolvePacketPaths,
  slugTitle,
  splitLines,
  usage,
  writeDiscussPacket
};
