const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPatchedPlanContent,
  buildSuggestedRepairBlock,
  extractPacketSection,
  formatReviewReport,
  packetDriftFindings,
  reviewPlanContent
} = require('../src/plan-review');

describe('reviewPlanContent', () => {
  it('flags plans with no executable tasks as unsafe', () => {
    const result = reviewPlanContent('# Design Doc\n\nThis explains the system.');
    assert.equal(result.summary, 'unsafe');
    assert.ok(result.findings.some((finding) => finding.code === 'no_tasks'));
    assert.ok(result.repairs.some((repair) => repair.code === 'no_tasks'));
  });

  it('flags vague tasks and missing verification guidance', () => {
    const content = [
      '# Plan',
      '',
      '### Task 1: Cleanup auth',
      '',
      '### Task 2: Improve backend'
    ].join('\n');
    const result = reviewPlanContent(content);
    assert.equal(result.summary, 'unsafe');
    assert.ok(result.findings.some((finding) => finding.code === 'vague_task'));
    assert.ok(result.findings.some((finding) => finding.code === 'missing_verification'));
    assert.ok(result.findings.some((finding) => finding.code === 'vague_task' && /Rewrite as:/i.test(finding.suggestion)));
    assert.ok(result.findings.some((finding) => finding.code === 'missing_verification' && /Add verification language/i.test(finding.suggestion)));
  });

  it('flags per-task verification gaps in task-block plans', () => {
    const content = [
      '# Plan',
      '',
      '### Task 1: Add login endpoint',
      '- [ ] Build the route',
      '',
      '### Task 2: Add tests',
      '- [ ] Write tests',
      '- [ ] Verify tests pass'
    ].join('\n');
    const result = reviewPlanContent(content);
    assert.ok(result.findings.some((finding) => finding.code === 'task_missing_verification' && finding.taskRef === 'T1'));
    assert.ok(result.findings.some((finding) => finding.code === 'task_missing_verification' && /Add a verification line/i.test(finding.suggestion)));
  });

  it('flags sequence risk when deploy appears before verification work', () => {
    const content = [
      '# Plan',
      '',
      '1. Deploy the feature',
      '2. Verify smoke tests',
      '3. Confirm expected response'
    ].join('\n');
    const result = reviewPlanContent(content);
    assert.ok(result.findings.some((finding) => finding.code === 'sequence_risk'));
    assert.ok(result.repairs.some((repair) => repair.code === 'sequence_risk' && /Move deploy/i.test(repair.suggestion)));
  });

  it('flags dependency risk for migration/integration plans without ordering notes', () => {
    const content = [
      '# Plan',
      '',
      '### Task 1: Migrate user data to the new schema',
      '- [ ] Run data transform',
      '- [ ] Verify row counts match',
      '',
      '### Task 2: Integrate the new API client',
      '- [ ] Replace old client',
      '- [ ] Verify responses'
    ].join('\n');
    const result = reviewPlanContent(content);
    assert.ok(result.findings.some((finding) => finding.code === 'dependency_risk'));
    assert.ok(result.repairs.some((repair) => repair.code === 'dependency_risk' && /Dependency note/i.test(repair.suggestion)));
  });

  it('flags placeholder guardrails as weak', () => {
    const content = [
      '# Plan',
      '',
      '**Assumptions:** <fill in>',
      '**Constraints:** TBD',
      '**Out of scope:** later',
      '',
      '### Task 1: Add auth regression test',
      '- [ ] Write test',
      '- [ ] Verify test fails'
    ].join('\n');
    const result = reviewPlanContent(content);
    assert.ok(result.findings.some((finding) => finding.code === 'weak_scope_guardrails'));
  });

  it('flags oversized tasks with too many substeps', () => {
    const content = [
      '# Plan',
      '',
      '**Assumptions:** auth bug is isolated to middleware',
      '**Constraints:** do not change cookie shape',
      '**Out of scope:** docs',
      '',
      '### Task 1: Roll auth changes across middleware, session store, API responses, UI copy, and smoke checks',
      '- [ ] Update middleware',
      '- [ ] Update session store',
      '- [ ] Update serializer',
      '- [ ] Update UI copy',
      '- [ ] Update docs',
      '- [ ] Verify smoke checks pass'
    ].join('\n');
    const result = reviewPlanContent(content);
    assert.ok(result.findings.some((finding) => finding.code === 'oversized_task'));
  });

  it('flags verification that only appears in the final task block', () => {
    const content = [
      '# Plan',
      '',
      '**Assumptions:** auth bug is isolated',
      '**Constraints:** keep API stable',
      '**Out of scope:** billing',
      '',
      '### Task 1: Update auth middleware',
      '- [ ] Change middleware behavior',
      '',
      '### Task 2: Update API endpoint',
      '- [ ] Change handler response',
      '',
      '### Task 3: Verify rollout',
      '- [ ] Run targeted tests',
      '- [ ] Verify curl returns 401 for missing auth'
    ].join('\n');
    const result = reviewPlanContent(content);
    assert.ok(result.findings.some((finding) => finding.code === 'verification_backloaded'));
  });

  it('passes a concrete plan with verification and guardrails', () => {
    const content = [
      '# Auth rollout plan',
      '',
      '**Constraints:** keep existing session cookie behavior',
      '**Out of scope:** social login',
      '',
      '### Task 1: Add failing auth middleware test',
      '- [ ] Create regression test for missing session',
      '- [ ] Verify test fails with current middleware',
      '',
      '### Task 2: Implement auth middleware',
      '- [ ] Update middleware to reject missing session',
      '- [ ] Verify targeted test passes',
      '',
      '### Task 3: Ship after verification',
      '- [ ] Run auth test suite',
      '- [ ] Verify deployment smoke test passes before release'
    ].join('\n');
    const result = reviewPlanContent(content);
    assert.equal(result.summary, 'pass');
    assert.equal(result.findings.length, 0);
  });

  it('ignores task-looking examples inside fenced code blocks', () => {
    const content = [
      '# Plan guide',
      '',
      '```md',
      '### Task 1: Example only',
      '- [ ] Verify example',
      '```',
      '',
      '### Task 1: Real task',
      '- [ ] Add route',
      '- [ ] Verify curl returns 200',
      '',
      '**Out of scope:** docs cleanup'
    ].join('\n');
    const result = reviewPlanContent(content);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.summary, 'pass');
    assert.equal(result.repairs.length, 0);
  });

  it('dedupes repeated repair suggestions at plan level', () => {
    const content = [
      '# Plan',
      '',
      '### Task 1: Improve auth',
      '',
      '### Task 2: Improve backend'
    ].join('\n');
    const result = reviewPlanContent(content);
    const verificationRepairs = result.repairs.filter((repair) => repair.code === 'missing_verification');
    assert.equal(verificationRepairs.length, 1);
  });

  it('builds rewritten task blocks when only one or two tasks need repair', () => {
    const content = [
      '# Plan',
      '',
      '### Task 1: Improve backend',
      '',
      '### Task 2: Add tests',
      '- [ ] Verify tests pass',
      '',
      '**Out of scope:** docs'
    ].join('\n');
    const result = reviewPlanContent(content);
    const repairBlock = buildSuggestedRepairBlock(content, result);
    assert.match(repairBlock, /### Task 1: Improve backend for <exact file, subsystem, or behavior target>/);
    assert.match(repairBlock, /- \[ \] Verify <test, command, manual proof, or expected output>/);
  });

  it('formats a review report with findings and a suggested repair block', () => {
    const content = [
      '# Plan',
      '',
      '### Task 1: Improve backend',
      '',
      '### Task 2: Deploy feature'
    ].join('\n');
    const report = formatReviewReport(content);
    assert.match(report, /^Verdict: unsafe/m);
    assert.match(report, /Auto-repair suggestions:/);
    assert.match(report, /Suggested repair block:/);
    assert.match(report, /### Task 1:/);
  });

  it('builds a patched plan draft with normalized guardrails and per-task verification', () => {
    const content = [
      '# API plan',
      '',
      '**Assumptions:** <fill in>',
      '**Constraints:** TBD',
      '',
      '### Task 1: Improve backend',
      '',
      '### Task 2: Integrate the new client',
      '- [ ] Swap the client'
    ].join('\n');
    const review = reviewPlanContent(content);
    const patched = buildPatchedPlanContent(content, review);
    assert.match(patched, /^# API plan/m);
    assert.match(patched, /\*\*Out of scope:\*\*/);
    assert.match(patched, /### Task 1: Improve backend for <exact file, subsystem, or behavior target>/);
    assert.match(patched, /- \[ \] Verify <test, command, manual proof, or expected output>/);
    assert.match(patched, /Dependency note:/);
  });

  it('extracts combobulate packet sections', () => {
    const packet = [
      '# Intent packet',
      '',
      '## Normalized Goal',
      'Ship safer exports without losing analyst visibility.',
      '',
      '## Non-Negotiables',
      '- NN1: Analyst exports never leak internal notes',
      '',
      '## Proof Requirements',
      '- PR1: Capture proof that analyst preview text and CSV column set stay aligned'
    ].join('\n');

    assert.equal(
      extractPacketSection(packet, 'Normalized Goal'),
      'Ship safer exports without losing analyst visibility.'
    );
  });

  it('flags packet-to-plan drift when non-negotiables and proof requirements are dropped', () => {
    const packet = [
      '# Intent packet',
      '',
      '## Normalized Goal',
      'Ship safer exports without losing analyst visibility.',
      '',
      '## Non-Negotiables',
      '- NN1: Analyst exports never leak internal notes',
      '',
      '## Proof Requirements',
      '- PR1: Capture proof that analyst preview text and CSV column set stay aligned'
    ].join('\n');

    const plan = [
      '# Export plan',
      '',
      '**Constraints:** keep UI copy stable',
      '**Out of scope:** admin redesign',
      '',
      '### Task 1: Add export button',
      '- [ ] Build button',
      '- [ ] Verify button renders'
    ].join('\n');

    const findings = packetDriftFindings(plan, packet);
    assert.ok(findings.some((finding) => finding.code === 'packet_non_negotiable_missing'));
    assert.ok(findings.some((finding) => finding.code === 'packet_proof_requirement_missing'));
  });
});
