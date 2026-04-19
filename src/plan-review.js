// Plan Enforcer - Plan validation heuristics

const { extractTasksFromContent, stripFencedCodeBlocks } = require('./plan-detector');
const { scanPlaceholders } = require('./placeholder-scan');

const VAGUE_PATTERNS = [
  /\bcleanup\b/i,
  /\bclean up\b/i,
  /\bpolish\b/i,
  /\bimprove\b/i,
  /\brefactor\b/i,
  /\boptimize\b/i,
  /\bfix\b$/i,
  /\bfix issues\b/i,
  /\bmisc\b/i,
  /\bvarious\b/i,
  /\betc\b/i,
  /\band so on\b/i
];

const VERIFICATION_PATTERNS = [
  /\bverify\b/i,
  /\bverification\b/i,
  /\btest\b/i,
  /\bassert\b/i,
  /\bconfirm\b/i,
  /\bcheck\b/i,
  /\bcurl\b/i,
  /\bpass(?:es|ed)?\b/i,
  /\bmanual\b/i,
  /\bexpected\b/i
];

const DEPENDENCY_PATTERNS = [
  /\bdepends on\b/i,
  /\bprereq/i,
  /\bblocked by\b/i,
  /\bafter\b/i,
  /\bbefore\b/i
];

const REPAIR_TEMPLATES = {
  guardrails: [
    '**Assumptions:** <state the inputs or environment this plan relies on>',
    '**Constraints:** <state what must not change while executing>',
    '**Out of scope:** <state what this plan explicitly will not do>'
  ].join('\n'),
  verification: '- [ ] Verify <test, command, manual proof, or expected output>',
  dependency: '- [ ] Dependency note: <state what must happen before this task starts>'
};
const GUARDRAIL_HEADINGS = ['Assumptions', 'Constraints', 'Out of scope'];
const PACKET_SECTION_HEADINGS = [
  'Source Ask',
  'Normalized Goal',
  'Non-Negotiables',
  'Hidden Contract Candidates',
  'Plausible Interpretations',
  'Chosen Interpretation',
  'Rejected / Forbidden Narrowings',
  'In Scope',
  'Out of Scope',
  'Constraints',
  'Success Signals',
  'Drift Risks',
  'Proof Requirements',
  'Draft Handoff'
];

function normalizeContent(content) {
  return stripFencedCodeBlocks(content);
}

function hasVerificationLanguage(text) {
  return VERIFICATION_PATTERNS.some((pattern) => pattern.test(text));
}

function isVagueTask(task) {
  const normalized = task.trim();
  if (!normalized) return true;
  if (normalized.length < 12 && /\bfix|update|refactor|cleanup|polish|review\b/i.test(normalized)) {
    return true;
  }
  return VAGUE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isBroadTask(task) {
  const normalized = task.trim();
  const andCount = (normalized.match(/\band\b/gi) || []).length;
  const commaCount = (normalized.match(/,/g) || []).length;
  return normalized.length > 90 || andCount >= 2 || commaCount >= 3;
}

function isOversizedTask(task, blockBody = '') {
  const normalized = task.trim();
  const checklistCount = (blockBody.match(/^- \[[ x]\]/gim) || []).length;
  return normalized.length > 120 || checklistCount >= 5;
}

function getGuardrailValue(content, heading) {
  const match = content.match(new RegExp(`\\*\\*${heading}:\\*\\*\\s*(.+)`, 'i'));
  return match ? match[1].trim() : '';
}

function hasWeakGuardrailValue(value) {
  if (!value) return true;
  if (value.length < 8) return true;
  return /<.+>|tbd|todo|fill in|later|n\/a|none yet/i.test(value);
}

function extractTaskBlocks(content) {
  const normalized = normalizeContent(content);
  const superpowers = [...normalized.matchAll(/^### Task \d+:\s*(.+)$/gm)];
  if (superpowers.length > 0) {
    return superpowers.map((match, index) => {
      const start = match.index || 0;
      const end = index + 1 < superpowers.length ? (superpowers[index + 1].index || normalized.length) : normalized.length;
      return { title: match[1].trim(), body: normalized.slice(start, end) };
    });
  }

  const gsd = [...normalized.matchAll(/^## Task[^:]*:\s*(.+)$/gm)];
  if (gsd.length > 0) {
    return gsd.map((match, index) => {
      const start = match.index || 0;
      const end = index + 1 < gsd.length ? (gsd[index + 1].index || normalized.length) : normalized.length;
      return { title: match[1].trim(), body: normalized.slice(start, end) };
    });
  }

  return [];
}

function buildTaskRepair(task, findingCode) {
  const normalized = task.trim().replace(/[. ]+$/, '');
  const base = normalized || '<rewrite task>';

  switch (findingCode) {
    case 'vague_task':
      return `Rewrite as: "${base} for <exact file, subsystem, or behavior target>."`;
    case 'broad_task':
      return [
        'Split into smaller tasks such as:',
        `1. ${base} for <first concrete target>.`,
        `2. ${base} for <second concrete target>.`,
        `3. ${REPAIR_TEMPLATES.verification.replace('<test, command, manual proof, or expected output>', 'the combined change works end-to-end')}`
      ].join('\n');
    case 'task_missing_verification':
      return [
        `Add a verification line under this task:`,
        REPAIR_TEMPLATES.verification
      ].join('\n');
    case 'oversized_task':
      return [
        'Break this task into smaller executable substeps and keep one proof step per substep.',
        `Start by splitting "${base}" into 2-4 concrete tasks with separate verification lines.`
      ].join('\n');
    default:
      return null;
  }
}

function taskNumberFromRef(taskRef) {
  const match = /^T(\d+)$/.exec(taskRef || '');
  return match ? Number(match[1]) : null;
}

function buildTaskHeading(taskRef, title) {
  const number = taskNumberFromRef(taskRef);
  if (number) {
    return `### Task ${number}: ${title}`;
  }
  return `### Task: ${title}`;
}

function buildPlanRepair(code, context = {}) {
  switch (code) {
    case 'no_tasks':
      return 'Add explicit executable tasks using `### Task N:` blocks, markdown checkboxes, or a numbered list.';
    case 'missing_scope_guardrails':
      return [
        'Add guardrails near the top of the plan:',
        REPAIR_TEMPLATES.guardrails
      ].join('\n');
    case 'weak_scope_guardrails':
      return 'Replace placeholder guardrails with concrete assumptions, constraints, and out-of-scope limits for this specific job.';
    case 'missing_verification':
      return [
        'Add verification language to the plan and at least one proof step per major task. Example:',
        REPAIR_TEMPLATES.verification
      ].join('\n');
    case 'verification_backloaded':
      return 'Move verification into each major task block instead of leaving all proof work at the end.';
    case 'sequence_risk':
      return 'Move deploy/release/ship steps after the proving step so the plan verifies first and ships second.';
    case 'dependency_risk':
      return [
        'Add explicit ordering or prerequisite notes to the migration/integration steps. Example:',
        REPAIR_TEMPLATES.dependency
      ].join('\n');
    default:
      if (context.task && context.code) {
        return buildTaskRepair(context.task, context.code);
      }
      return null;
  }
}

function dedupeRepairs(findings) {
  const seen = new Set();
  return findings
    .map((finding) => {
      const key = `${finding.code}:${finding.taskRef || 'plan'}:${finding.suggestion || ''}`;
      if (!finding.suggestion || seen.has(key)) {
        return null;
      }
      seen.add(key);
      return {
        severity: finding.severity,
        code: finding.code,
        taskRef: finding.taskRef,
        suggestion: finding.suggestion
      };
    })
    .filter(Boolean);
}

function groupFindingsByTask(findings) {
  return findings.reduce((groups, finding) => {
    if (!finding.taskRef) return groups;
    if (!groups[finding.taskRef]) groups[finding.taskRef] = [];
    groups[finding.taskRef].push(finding);
    return groups;
  }, {});
}

function buildTaskRepairBlock(taskRef, title, taskFindings) {
  const lines = [buildTaskHeading(taskRef, title)];
  const codes = new Set(taskFindings.map((finding) => finding.code));
  const normalizedTitle = title.trim().replace(/[. ]+$/, '');
  const concreteTitle = codes.has('vague_task')
    ? `${normalizedTitle} for <exact file, subsystem, or behavior target>`
    : normalizedTitle;

  lines[0] = buildTaskHeading(taskRef, concreteTitle);
  lines.push('- [ ] Implement the concrete change for this task');

  if (codes.has('broad_task') || codes.has('oversized_task')) {
    lines.push('- [ ] Split any multi-part work here into separate substeps before execution');
  }

  if (codes.has('task_missing_verification') || codes.has('vague_task') || codes.has('broad_task')) {
    lines.push(REPAIR_TEMPLATES.verification);
  }

  return lines.join('\n');
}

function extractPlanTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Plan';
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPacketSection(content, heading) {
  const headingsPattern = PACKET_SECTION_HEADINGS.map(escapeRegex).join('|');
  const regex = new RegExp(
    `^## ${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=^## (?:${headingsPattern})\\s*$|$)`,
    'm'
  );
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}

function extractPacketBullets(content, heading) {
  const section = extractPacketSection(content, heading);
  if (!section) return [];
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, '').trim())
    .map((line) => line.replace(/^[A-Z]{2,3}\d+:\s*/, '').trim())
    .filter(Boolean);
}

function normalizeForMatch(value) {
  return value
    .toLowerCase()
    .replace(/[`*_>#:"'()[\],.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesNormalized(haystack, needle) {
  if (!needle) return true;
  const normalizedNeedle = normalizeForMatch(needle);
  if (!normalizedNeedle) return true;
  return normalizeForMatch(haystack).includes(normalizedNeedle);
}

function packetDriftFindings(content, packetContent) {
  if (!packetContent || !packetContent.trim()) return [];

  const findings = [];
  const normalizedPlan = normalizeContent(content);
  const normalizedGoal = extractPacketSection(packetContent, 'Normalized Goal');
  const nonNegotiables = extractPacketBullets(packetContent, 'Non-Negotiables');
  const forbiddenNarrowings = extractPacketBullets(packetContent, 'Rejected / Forbidden Narrowings');
  const proofRequirements = extractPacketBullets(packetContent, 'Proof Requirements');

  if (normalizedGoal && !includesNormalized(normalizedPlan, normalizedGoal)) {
    findings.push({
      severity: 'warning',
      code: 'packet_goal_drift',
      message: 'Plan header/body does not clearly preserve the combobulate normalized goal.',
      suggestion: 'Mirror the packet Normalized Goal in the plan header and keep later tasks aligned to that wording.'
    });
  }

  nonNegotiables.forEach((entry, index) => {
    if (!includesNormalized(normalizedPlan, entry)) {
      findings.push({
        severity: 'warning',
        code: 'packet_non_negotiable_missing',
        message: `Plan does not clearly cover packet non-negotiable NN${index + 1}: "${entry}".`,
        suggestion: `Add a Must-Have and at least one task/proof step that explicitly preserves "${entry}".`
      });
    }
  });

  forbiddenNarrowings.forEach((entry, index) => {
    if (includesNormalized(normalizedPlan, entry)) {
      findings.push({
        severity: 'warning',
        code: 'packet_forbidden_narrowing_present',
        message: `Plan appears to adopt forbidden narrowing FN${index + 1}: "${entry}".`,
        suggestion: `Rewrite the narrowed language or add the missing scope needed to avoid "${entry}".`
      });
    }
  });

  proofRequirements.forEach((entry, index) => {
    if (!includesNormalized(normalizedPlan, entry)) {
      findings.push({
        severity: 'warning',
        code: 'packet_proof_requirement_missing',
        message: `Plan does not clearly encode packet proof requirement PR${index + 1}: "${entry}".`,
        suggestion: `Add an explicit verification or evidence step that proves "${entry}".`
      });
    }
  });

  return findings;
}

function buildPatchedPlanContent(content, review = reviewPlanContent(content)) {
  const normalized = normalizeContent(content);
  const taskBlocks = extractTaskBlocks(content);
  const taskFindings = groupFindingsByTask(review.findings);
  const lines = [`# ${extractPlanTitle(content)}`, ''];

  const guardrailValues = Object.fromEntries(
    GUARDRAIL_HEADINGS.map((heading) => [heading, getGuardrailValue(normalized, heading)])
  );

  GUARDRAIL_HEADINGS.forEach((heading) => {
    const value = guardrailValues[heading];
    const templateValue = REPAIR_TEMPLATES.guardrails
      .split('\n')
      .find((line) => line.startsWith(`**${heading}:**`))
      .replace(`**${heading}:** `, '');
    lines.push(`**${heading}:** ${hasWeakGuardrailValue(value) ? templateValue : value}`);
  });

  if (review.findings.length > 0) {
    lines.push('');
  }

  const blocks = taskBlocks.length > 0
    ? taskBlocks.map((block, index) => ({ title: block.title, taskRef: `T${index + 1}` }))
    : review.tasks.map((task, index) => ({ title: task, taskRef: `T${index + 1}` }));

  blocks.forEach((block, index) => {
    const findings = taskFindings[block.taskRef] || [];
    const codes = new Set(findings.map((finding) => finding.code));
    const title = codes.has('vague_task')
      ? `${block.title.trim().replace(/[. ]+$/, '')} for <exact file, subsystem, or behavior target>`
      : block.title;

    lines.push(buildTaskHeading(block.taskRef, title));
    lines.push('- [ ] Implement the concrete change for this task');

    if (codes.has('broad_task') || codes.has('oversized_task')) {
      lines.push('- [ ] Split multi-part work here into separate substeps before execution');
    }

    if (review.findings.some((finding) => finding.code === 'dependency_risk') && /\bintegrat|migrat|replace|cutover\b/i.test(block.title)) {
      lines.push(REPAIR_TEMPLATES.dependency);
    }

    lines.push(REPAIR_TEMPLATES.verification);
    if (index < blocks.length - 1) lines.push('');
  });

  return lines.join('\n').trimEnd() + '\n';
}

function buildSuggestedRepairBlock(content, review) {
  if (review.summary === 'pass') {
    return '';
  }

  const taskBlocks = extractTaskBlocks(content);
  const taskFindings = groupFindingsByTask(review.findings);
  const taskRefs = Object.keys(taskFindings);
  const repairSections = [];

  if (review.findings.some((finding) => finding.code === 'missing_scope_guardrails')) {
    repairSections.push(REPAIR_TEMPLATES.guardrails);
  }

  if (taskRefs.length > 0 && taskRefs.length <= 2 && taskBlocks.length > 0) {
    const rewrittenBlocks = taskRefs
      .map((taskRef) => {
        const index = taskNumberFromRef(taskRef);
        if (!index || !taskBlocks[index - 1]) return null;
        return buildTaskRepairBlock(taskRef, taskBlocks[index - 1].title, taskFindings[taskRef]);
      })
      .filter(Boolean);

    if (rewrittenBlocks.length > 0) {
      repairSections.push(rewrittenBlocks.join('\n\n'));
    }
  }

  if (repairSections.length === 0) {
    repairSections.push(
      review.repairs
        .map((repair) => `- ${repair.taskRef ? `${repair.taskRef}: ` : ''}${repair.suggestion}`)
        .join('\n')
    );
  }

  return repairSections.join('\n\n');
}

function formatReviewReport(content, review = reviewPlanContent(content)) {
  const lines = [`Verdict: ${review.summary}`, '', 'Findings:'];

  if (review.findings.length === 0) {
    lines.push('- No issues found.');
  } else {
    review.findings.forEach((finding) => {
      lines.push(`- ${finding.message}`);
      if (finding.suggestion) {
        lines.push(`  Fix: ${finding.suggestion}`);
      }
    });
  }

  if (review.repairs.length > 0) {
    lines.push('', 'Auto-repair suggestions:');
    review.repairs.forEach((repair) => {
      lines.push(`- ${repair.taskRef ? `${repair.taskRef}: ` : ''}${repair.suggestion}`);
    });
  }

  const repairBlock = buildSuggestedRepairBlock(content, review);
  if (repairBlock) {
    lines.push('', 'Suggested repair block:', repairBlock);
  }

  return lines.join('\n');
}

function reviewPlanContent(content, opts = {}) {
  const normalized = normalizeContent(content);
  const extraction = extractTasksFromContent(normalized);
  const findings = [];
  const tasks = extraction.tasks;
  const taskBlocks = extractTaskBlocks(content);

  if (tasks.length === 0) {
    findings.push({
      severity: 'error',
      code: 'no_tasks',
      message: 'No executable tasks detected.',
      suggestion: buildPlanRepair('no_tasks')
    });
    return {
      format: extraction.format,
      tasks,
      findings,
      repairs: dedupeRepairs(findings),
      summary: 'unsafe'
    };
  }

  if (!/\bout of scope\b/i.test(normalized) && !/\bconstraints?\b/i.test(normalized) && !/\bassumptions?\b/i.test(normalized)) {
    findings.push({
      severity: 'warning',
      code: 'missing_scope_guardrails',
      message: 'Plan is missing out-of-scope, constraints, or assumptions guidance.',
      suggestion: buildPlanRepair('missing_scope_guardrails')
    });
  } else {
    const presentGuardrails = GUARDRAIL_HEADINGS
      .map((heading) => ({ heading, value: getGuardrailValue(normalized, heading) }))
      .filter((entry) => entry.value);
    const weakGuardrails = presentGuardrails
      .filter((entry) => hasWeakGuardrailValue(entry.value))
      .map((entry) => entry.heading);
    if (weakGuardrails.length > 0) {
      findings.push({
        severity: 'warning',
        code: 'weak_scope_guardrails',
        message: `Plan guardrails are placeholders or too weak: ${weakGuardrails.join(', ')}.`,
        suggestion: buildPlanRepair('weak_scope_guardrails')
      });
    }
  }

  if (!hasVerificationLanguage(normalized)) {
    findings.push({
      severity: 'error',
      code: 'missing_verification',
      message: 'Plan has no clear verification language anywhere.',
      suggestion: buildPlanRepair('missing_verification')
    });
  }

  tasks.forEach((task, index) => {
    const taskRef = `T${index + 1}`;
    const block = taskBlocks[index];
    if (isVagueTask(task)) {
      findings.push({
        severity: 'warning',
        code: 'vague_task',
        taskRef,
        message: `${taskRef} is too vague: "${task}".`,
        suggestion: buildTaskRepair(task, 'vague_task')
      });
    }
    if (isBroadTask(task)) {
      findings.push({
        severity: 'warning',
        code: 'broad_task',
        taskRef,
        message: `${taskRef} is broad and may hide multiple steps: "${task}".`,
        suggestion: buildTaskRepair(task, 'broad_task')
      });
    }
    if (isOversizedTask(task, block ? block.body : '')) {
      findings.push({
        severity: 'warning',
        code: 'oversized_task',
        taskRef,
        message: `${taskRef} is oversized and should be split before execution: "${task}".`,
        suggestion: buildTaskRepair(task, 'oversized_task')
      });
    }
  });

  if (taskBlocks.length > 0) {
    taskBlocks.forEach((block, index) => {
      const taskRef = `T${index + 1}`;
      if (!hasVerificationLanguage(block.body)) {
        findings.push({
          severity: 'warning',
          code: 'task_missing_verification',
          taskRef,
          message: `${taskRef} has no obvious verification step in its block.`,
          suggestion: buildTaskRepair(block.title, 'task_missing_verification')
        });
      }
      // Placeholder scan runs per-block so plan-metadata text
      // ("Out of scope: docs cleanup") doesn't trigger — only task
      // body + checklist steps are scanned. Codes are prefixed to
      // keep them distinct from the structural findings above.
      const seenCodes = new Set();
      for (const hit of scanPlaceholders(block.body)) {
        const key = `${hit.code}:${hit.match.toLowerCase()}`;
        if (seenCodes.has(key)) continue;
        seenCodes.add(key);
        findings.push({
          severity: 'warning',
          code: `placeholder_${hit.code}`,
          taskRef,
          message: `${taskRef} contains a placeholder phrase ("${hit.match}"): ${hit.message}`,
          suggestion: hit.suggestion
        });
      }
    });
  }

  if (taskBlocks.length > 1) {
    const verificationByTask = taskBlocks.map((block) => hasVerificationLanguage(block.body));
    const backloadedVerification =
      verificationByTask[verificationByTask.length - 1] &&
      verificationByTask.slice(0, -1).some((hasVerification) => !hasVerification);

    if (backloadedVerification) {
      findings.push({
        severity: 'warning',
        code: 'verification_backloaded',
        message: 'Verification appears concentrated at the end instead of inside each task block.',
        suggestion: buildPlanRepair('verification_backloaded')
      });
    }
  }

  const deployIndex = tasks.findIndex((task) => /\bdeploy|release|ship\b/i.test(task));
  const verifyIndex = tasks.findIndex((task) => hasVerificationLanguage(task));
  if (deployIndex !== -1 && (verifyIndex === -1 || deployIndex < verifyIndex)) {
    findings.push({
      severity: 'warning',
      code: 'sequence_risk',
      message: 'Deploy/release work appears before verification-oriented work.',
      suggestion: buildPlanRepair('sequence_risk')
    });
  }

  const integrationTasks = tasks.filter((task) => /\bintegrat|migrat|replace|cutover\b/i.test(task));
  if (integrationTasks.length > 0 && !DEPENDENCY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    findings.push({
      severity: 'warning',
      code: 'dependency_risk',
      message: 'Plan includes integration/migration work but does not spell out dependencies or ordering constraints.',
      suggestion: buildPlanRepair('dependency_risk')
    });
  }

  // Adversarial findings: higher-level consistency checks. Gated by
  // opts.adversarial so the default review output isn't overwhelmed;
  // review-cli exposes this via --adversarial.
  if (opts && opts.adversarial) {
    for (const finding of adversarialFindings(tasks, taskBlocks, normalized)) {
      findings.push(finding);
    }
  }

  for (const finding of packetDriftFindings(content, opts.packetContent || '')) {
    findings.push(finding);
  }

  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const summary = errorCount > 0 ? 'unsafe' : warningCount > 0 ? 'weak' : 'pass';

  return { format: extraction.format, tasks, findings, repairs: dedupeRepairs(findings), summary };
}

// === Adversarial consistency checks =====================================
// Four patterns worth catching before execution:
//   1. Multiple tasks touch the same file path without explicit coordination
//   2. A task refers to Tn where Tn doesn't exist in the plan
//   3. Deploy/release/ship tasks have no verification language in their block
//   4. One task says "add X" while another says "remove X" (or vice versa)
// Each is a legitimate red flag but each has clean false-positive cases,
// so they ship as warnings not errors.

const FILE_PATH_LINE_RE = /\b([\w.-]+\/(?:[\w./-]+)\.\w{1,5})\b/g;

function extractFilePathsFromBody(body) {
  const hits = new Set();
  let m;
  const re = new RegExp(FILE_PATH_LINE_RE.source, 'g');
  while ((m = re.exec(body)) !== null) hits.add(m[1]);
  return Array.from(hits);
}

function adversarialFindings(tasks, taskBlocks, normalized) {
  const findings = [];
  if (taskBlocks.length === 0) return findings;

  // 1. Same file owned by multiple tasks.
  const fileOwners = new Map();
  taskBlocks.forEach((block, i) => {
    const taskRef = `T${i + 1}`;
    for (const p of extractFilePathsFromBody(block.body)) {
      if (!fileOwners.has(p)) fileOwners.set(p, []);
      fileOwners.get(p).push(taskRef);
    }
  });
  for (const [filePath, owners] of fileOwners) {
    if (owners.length >= 2) {
      findings.push({
        severity: 'warning',
        code: 'adversarial_multiple_owners',
        taskRef: owners[0],
        message: `${filePath} is named in ${owners.length} tasks (${owners.join(', ')}) — ownership unclear.`,
        suggestion: `Designate one task as the primary owner of ${filePath}; others should reference it via "depends on ${owners[0]}" or explicit ordering.`
      });
    }
  }

  // 2. Dangling Tn references.
  const known = new Set(taskBlocks.map((_b, i) => `T${i + 1}`));
  const refRe = /\bT(\d+)\b/g;
  taskBlocks.forEach((block, i) => {
    const taskRef = `T${i + 1}`;
    let m;
    const seen = new Set();
    while ((m = refRe.exec(block.body)) !== null) {
      const target = `T${m[1]}`;
      if (target === taskRef || seen.has(target)) continue;
      seen.add(target);
      if (!known.has(target)) {
        findings.push({
          severity: 'warning',
          code: 'adversarial_dangling_task_ref',
          taskRef,
          message: `${taskRef} references ${target} but no such task exists in the plan.`,
          suggestion: `Remove the stale reference or add the missing task. Dangling refs often mark where a plan was edited without updating cross-references.`
        });
      }
    }
  });

  // 3. Unverified deploy/release/ship tasks.
  taskBlocks.forEach((block, i) => {
    const taskRef = `T${i + 1}`;
    if (/\b(deploy|release|ship|rollout|cutover)\b/i.test(block.title) && !hasVerificationLanguage(block.body)) {
      findings.push({
        severity: 'warning',
        code: 'adversarial_unverified_deploy',
        taskRef,
        message: `${taskRef} is a deploy/release task with no verification language in its block.`,
        suggestion: `Name the verification step that proves the deploy succeeded (health check, smoke test, rollback criteria). Ship without proof is the failure mode this catches.`
      });
    }
  });

  // 4. Contradicting verbs on the same noun.
  // Example: T2 says "add the retry middleware", T4 says "remove the retry middleware".
  // [^\S\n] = horizontal whitespace only; stops noun-phrase capture at
  // newlines. Phrase minimum 2 tokens (e.g. "retry middleware") to
  // avoid matching bare path prefixes like "src".
  const addPatterns = [];
  const removePatterns = [];
  taskBlocks.forEach((block, i) => {
    const ref = `T${i + 1}`;
    let m;
    const addRe = /\b(add|introduce|create|install)[^\S\n]+(?:the[^\S\n]+|a[^\S\n]+|an[^\S\n]+)?([\w-]+(?:[^\S\n]+[\w-]+){1,2})/gi;
    const rmRe = /\b(remove|delete|drop|retire|uninstall|rip[^\S\n]+out)[^\S\n]+(?:the[^\S\n]+|a[^\S\n]+|an[^\S\n]+)?([\w-]+(?:[^\S\n]+[\w-]+){1,2})/gi;
    while ((m = addRe.exec(block.body)) !== null) {
      const phrase = m[2].toLowerCase().replace(/\s+/g, ' ').trim();
      if (phrase.length >= 5 && /\s/.test(phrase)) addPatterns.push({ ref, phrase });
    }
    while ((m = rmRe.exec(block.body)) !== null) {
      const phrase = m[2].toLowerCase().replace(/\s+/g, ' ').trim();
      if (phrase.length >= 5 && /\s/.test(phrase)) removePatterns.push({ ref, phrase });
    }
  });
  const reportedPairs = new Set();
  for (const add of addPatterns) {
    for (const rm of removePatterns) {
      if (add.ref === rm.ref) continue;
      if (add.phrase !== rm.phrase) continue;
      const key = `${add.ref}|${rm.ref}|${add.phrase}`;
      if (reportedPairs.has(key)) continue;
      reportedPairs.add(key);
      findings.push({
        severity: 'warning',
        code: 'adversarial_contradicting_tasks',
        taskRef: add.ref,
        message: `${add.ref} adds "${add.phrase}" while ${rm.ref} removes "${add.phrase}".`,
        suggestion: 'Either reconcile the two tasks (add then remove suggests a miscopied plan) or make the ordering + motivation explicit in the Decision Log.'
      });
    }
  }

  return findings;
}

module.exports = {
  adversarialFindings,
  buildPatchedPlanContent,
  buildPlanRepair,
  buildSuggestedRepairBlock,
  buildTaskHeading,
  buildTaskRepairBlock,
  buildTaskRepair,
  dedupeRepairs,
  extractPacketBullets,
  extractPacketSection,
  extractTaskBlocks,
  formatReviewReport,
  groupFindingsByTask,
  hasVerificationLanguage,
  isBroadTask,
  isVagueTask,
  packetDriftFindings,
  taskNumberFromRef,
  reviewPlanContent
};
