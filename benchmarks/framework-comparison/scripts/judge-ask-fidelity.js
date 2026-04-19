#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readOutcome } = require('./extract-outcome');

function parseArgs(argv) {
  const args = { json: false, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cell-dir') args.cellDir = argv[++i];
    else if (a === '--fixture-dir') args.fixtureDir = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--write') args.write = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: node benchmarks/framework-comparison/scripts/judge-ask-fidelity.js --cell-dir <dir> --fixture-dir <dir> [--json] [--write]',
    '',
    'Emits a separate ask-fidelity judge artifact without mixing it into outcome.json.',
    'Reads benchmark cell artifacts plus fixture-level original ask / evaluator contract / replay prompt.'
  ].join('\n');
}

function walkFiles(root) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function readUtf8Safe(filePath) {
  try {
    if (filePath.endsWith('.json')) {
      return JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8')), null, 2);
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function normalize(text) {
  return String(text || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadFixture(fixtureDir) {
  const originalAsk = path.join(fixtureDir, 'original-ask.md');
  const evaluatorContract = path.join(fixtureDir, 'evaluator-contract.md');
  const replayPrompt = path.join(fixtureDir, 'replay-prompt.md');
  const judgeSpec = path.join(fixtureDir, 'judge-spec.json');
  const oracleCandidates = ['oracle.js', 'oracle.mjs']
    .map((name) => path.join(fixtureDir, name))
    .filter((candidate) => fs.existsSync(candidate));
  if (!fs.existsSync(judgeSpec)) {
    throw new Error(`missing judge spec: ${judgeSpec}`);
  }
  return {
    fixtureDir,
    originalAsk,
    evaluatorContract,
    replayPrompt,
    judgeSpec,
    oracle: oracleCandidates[0] || null,
    spec: JSON.parse(fs.readFileSync(judgeSpec, 'utf8'))
  };
}

function hasRelevantFiles(root) {
  return walkFiles(root).some((filePath) => /\.(md|txt|json|js|ts|tsx|jsx|html|css|mjs)$/i.test(filePath));
}

function chooseArtifactRoots(cellDir) {
  const shippedRoot = path.join(cellDir, 'worktree-artifacts');
  if (fs.existsSync(shippedRoot) && hasRelevantFiles(shippedRoot)) {
    return [shippedRoot];
  }
  return [cellDir];
}

function hasCapturedWorktreeArtifacts(cellDir) {
  const direct = path.join(cellDir, 'worktree-artifacts');
  if (fs.existsSync(direct) && hasRelevantFiles(direct)) return true;
  return walkFiles(cellDir).some((filePath) => /phase-\d+[/\\]worktree-artifacts[/\\].+\.(md|txt|json|js|ts|tsx|jsx|html|css|mjs)$/i.test(filePath));
}

function collectCorpus(cellDir) {
  const roots = chooseArtifactRoots(cellDir);
  const files = roots
    .flatMap((root) => walkFiles(root))
    .filter((filePath) => /\.(md|txt|json|js|ts|tsx|jsx|html|css|mjs)$/i.test(filePath))
    .filter((filePath) => !/[/\\](docs[/\\]plans|phase-\d+[/\\](prompt|output.*|session-starts|phase-context|phase-verdict)|archive[/\\]|session-logs[/\\])/i.test(filePath));
  return files.map((filePath) => ({
    path: path.relative(cellDir, filePath).replace(/\\/g, '/'),
    text: readUtf8Safe(filePath)
  }));
}

function findEvidence(corpus, terms) {
  const lcTerms = terms.map(normalize).filter(Boolean);
  const hits = [];
  for (const file of corpus) {
    const hay = normalize(file.text);
    if (lcTerms.every((term) => hay.includes(term))) {
      hits.push(file.path);
    }
  }
  return hits;
}

function hasNegatedMatch(hay, term) {
  let idx = hay.indexOf(term);
  while (idx !== -1) {
    const before = hay.slice(Math.max(0, idx - 220), idx);
    const after = hay.slice(idx + term.length, Math.min(hay.length, idx + term.length + 220));
    const safeContext = [
      /\b(no|not|never|without|do not|does not|did not|must not|cannot|can't|is not|isn't|should not|may not|must never)\b/,
      /\b(refusing to|refuse to|refuses to|cannot perform|can not perform|does not accept|won't recompute|will not recompute|refusing current state|refusing current-state)\b/,
      /\b(separate from|stays separate from|stay separate from|remains separate from|remain separate from|instead of|rather than|points to|point to|does not replace|must not replace)\b/,
      /\b(rejected|reject|forbidden|banned|superseded|resolved on disk|forbid|forbids|wrong shortcut|danger|dangerous|trap|unsafe shortcut|must not appear|widens the audience|dangerous to reuse|tempting shortcut)\b/,
      /\b(is a fail|is fail|is forbidden|is banned|is rejected|is a failure|would make|would echo|would alter|would leak|shortcut would)\b/
    ].some((pattern) => pattern.test(before) || pattern.test(after) || pattern.test(`${before} ${after}`));
    if (!safeContext) {
      return true;
    }
    idx = hay.indexOf(term, idx + term.length);
  }
  return false;
}

function findForbiddenEvidence(corpus, terms) {
  const lcTerms = terms.map(normalize).filter(Boolean);
  const hits = [];
  for (const file of corpus) {
    const hay = normalize(file.text);
    if (lcTerms.some((term) => hasNegatedMatch(hay, term))) {
      hits.push(file.path);
    }
  }
  return hits;
}

function scoreRequirement(requirement, corpus) {
  const allOf = requirement.all_of || [];
  const anyOf = requirement.any_of || [];
  const noneOf = requirement.none_of || [];
  const allHits = allOf.length > 0 ? findEvidence(corpus, allOf) : [];
  const anyHits = anyOf.length > 0
    ? [...new Set(anyOf.flatMap((term) => findEvidence(corpus, [term])))]
    : [];
  const noneHits = noneOf.length > 0
    ? [...new Set(noneOf.flatMap((term) => findForbiddenEvidence(corpus, [term])))]
    : [];
  const allPass = allOf.length === 0 || allHits.length > 0;
  const anyPass = anyOf.length === 0 || anyHits.length > 0;
  const nonePass = noneOf.length === 0 || noneHits.length === 0;
  const passed = allPass && anyPass && nonePass;
  return {
    id: requirement.id,
    summary: requirement.summary,
    required: requirement.required !== false,
    passed,
    evidence: [...new Set([...allHits, ...anyHits])],
    blockers: noneHits
  };
}

function readPhaseVerdicts(cellDir) {
  return walkFiles(cellDir)
    .filter((filePath) => filePath.endsWith('phase-verdict.json'))
    .sort()
    .map((filePath) => {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function hasDeviationEvidence(phaseVerdicts, corpus) {
  if (phaseVerdicts.some((verdict) => (verdict.decisions || []).length > 0)) return true;
  return corpus.some((file) => {
    const hay = normalize(file.text);
    return hay.includes('deviation') || hay.includes('superseded') || hay.includes('scope changed');
  });
}

function scoreAuditReplay(cellDir, fixture) {
  const checks = [
    fs.existsSync(path.join(cellDir, 'outcome.json')),
    fs.existsSync(path.join(fixture.fixtureDir, 'original-ask.md')),
    fs.existsSync(path.join(fixture.fixtureDir, 'replay-prompt.md')),
    readPhaseVerdicts(cellDir).length > 0
  ];
  return checks.filter(Boolean).length / checks.length;
}

function runOracle(fixture, cellDir) {
  if (!fixture.oracle) return null;
  if (!hasCapturedWorktreeArtifacts(cellDir)) return null;
  const [artifactsDir] = chooseArtifactRoots(cellDir);
  const child = spawnSync(process.execPath, [fixture.oracle, '--artifacts', artifactsDir], {
    encoding: 'utf8'
  });
  if (child.error) {
    return {
      pass: false,
      findings: [{
        kind: 'oracle_error',
        severity: 'high',
        summary: child.error.message
      }]
    };
  }
  if (child.status !== 0) {
    return {
      pass: false,
      findings: [{
        kind: 'oracle_error',
        severity: 'high',
        summary: (child.stderr || child.stdout || `oracle exited ${child.status}`).trim()
      }]
    };
  }
  try {
    return JSON.parse(child.stdout || '{}');
  } catch (error) {
    return {
      pass: false,
      findings: [{
        kind: 'oracle_error',
        severity: 'high',
        summary: `oracle returned invalid JSON: ${error.message}`
      }]
    };
  }
}

function buildAskFidelityJudgment(cellDir, fixtureDir) {
  const fixture = loadFixture(fixtureDir);
  const corpus = collectCorpus(cellDir);
  const phaseVerdicts = readPhaseVerdicts(cellDir);
  const outcome = readOutcome(cellDir);
  const oracle = runOracle(fixture, cellDir);
  const requirements = (fixture.spec.requirements || []).map((requirement) => scoreRequirement(requirement, corpus));
  const required = requirements.filter((requirement) => requirement.required);
  const passedRequired = required.filter((requirement) => requirement.passed);
  const ruleBasedAskFidelity = required.length > 0 ? passedRequired.length / required.length : null;
  const askFidelity = oracle && typeof oracle.pass === 'boolean'
    ? (oracle.pass ? ruleBasedAskFidelity : 0)
    : ruleBasedAskFidelity;
  const executionOutcome = outcome && outcome.total ? outcome.verified / outcome.total : null;
  const continuityWarnings = phaseVerdicts.reduce((sum, verdict) => sum + ((verdict.warnings || []).length > 0 ? 1 : 0), 0);
  const crossPhaseContinuity = phaseVerdicts.length > 0
    ? ((phaseVerdicts.filter((verdict) => verdict.pass).length / phaseVerdicts.length) * 0.7) +
      (((phaseVerdicts.length - continuityWarnings) / phaseVerdicts.length) * 0.3)
    : null;
  const deviationHonesty = askFidelity === null
    ? null
    : (askFidelity === 1 ? 1 : (hasDeviationEvidence(phaseVerdicts, corpus) ? 1 : 0));
  const auditReplay = scoreAuditReplay(cellDir, fixture);
  const falseCompletionResistance = executionOutcome === null || askFidelity === null
    ? null
    : (executionOutcome === 1 && askFidelity < 1 ? 0 : 1);

  const findings = required
    .filter((requirement) => !requirement.passed)
    .map((requirement) => ({
      kind: 'ask_drift',
      severity: 'high',
      requirement_id: requirement.id,
      summary: requirement.summary,
      evidence: requirement.evidence
    }));
  if (oracle && Array.isArray(oracle.findings)) {
    findings.push(...oracle.findings);
  }

  return {
    judge: 'ask-fidelity-judge@v0',
    scenario: fixture.spec.scenario || path.basename(fixtureDir),
    result: askFidelity === 1 ? 'pass' : (askFidelity === 0 ? 'fail' : 'partial'),
    fixture: {
      dir: fixtureDir,
      original_ask: fixture.originalAsk,
      evaluator_contract: fixture.evaluatorContract,
      replay_prompt: fixture.replayPrompt,
      judge_spec: fixture.judgeSpec,
      oracle: fixture.oracle
    },
    outcome_source: outcome ? outcome.source : null,
    oracle,
    scores: {
      execution_outcome: executionOutcome,
      ask_fidelity: askFidelity,
      deviation_honesty: deviationHonesty,
      cross_phase_continuity: crossPhaseContinuity,
      audit_replay: auditReplay,
      false_completion_resistance: falseCompletionResistance
    },
    requirements,
    findings
  };
}

function writeJudgment(cellDir, judgment) {
  const outPath = path.join(cellDir, 'ask-fidelity.json');
  fs.writeFileSync(outPath, JSON.stringify(judgment, null, 2) + '\n', 'utf8');
  return outPath;
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (!args.cellDir || !args.fixtureDir) {
    console.error('Both --cell-dir and --fixture-dir are required.');
    return 2;
  }
  const judgment = buildAskFidelityJudgment(args.cellDir, args.fixtureDir);
  const written = args.write ? writeJudgment(args.cellDir, judgment) : null;
  if (args.json) {
    console.log(JSON.stringify(written ? { ...judgment, written } : judgment, null, 2));
  } else {
    console.log(`Ask Fidelity Judge — ${judgment.scenario}`);
    console.log(`Result: ${judgment.result}`);
    console.log(`Ask fidelity: ${judgment.scores.ask_fidelity}`);
    if (written) console.log(`Wrote: ${written}`);
  }
  return judgment.result === 'fail' ? 1 : 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  buildAskFidelityJudgment,
  collectCorpus,
  findForbiddenEvidence,
  loadFixture,
  main,
  parseArgs,
  scoreRequirement,
  writeJudgment
};
