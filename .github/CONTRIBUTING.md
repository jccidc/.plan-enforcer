# Contributing to Plan Enforcer

Thanks for your interest in improving Plan Enforcer. This guide covers the workflow, testing expectations, and code conventions.

## Fork and Branch Workflow

1. Fork `jccidc/plan-enforcer` on GitHub.
2. Clone your fork and create a feature branch off `main`:
   ```bash
   git clone https://github.com/YOUR_USERNAME/plan-enforcer.git
   cd plan-enforcer
   git checkout -b feat/your-change main
   ```
3. Make your changes, commit, push to your fork, and open a PR back to `jccidc/plan-enforcer` targeting `main`.

Keep branches focused. One logical change per PR.

## Running Unit Tests

Zero dependencies means zero setup. Just run:

```bash
node --test tests/
```

This uses the Node.js built-in test runner. All test files live in `tests/*.test.js` with shared fixtures in `tests/fixtures/`.

Tests must pass on Node 20+. If you add new functionality in `src/`, add a corresponding test file.

## Manual Testing with Claude CLI

Unit tests cover the logic, but Plan Enforcer is a Claude Code skill, so you should also verify it end-to-end:

1. Install Plan Enforcer locally (if not already):
   ```bash
   bash install.sh --tier structural
   ```
2. Create a small test plan in a scratch project (a markdown file with 3-4 numbered steps).
3. Open Claude Code in that project and tell it to execute the plan.
4. Verify:
   - The ledger file gets created on disk with all steps listed.
   - Steps transition through statuses as the agent works (pending, in-progress, verified).
   - The scoreboard renders after each task.
   - If using **enforced** tier: hooks fire, the completion gate blocks premature "done" claims, and drift detection triggers on skipped steps.
5. Kill the session mid-plan, restart, and confirm the agent resumes from the ledger (crash-proof continuity).

## Code Style

- **No build step.** Ship what you write.
- **Vanilla Node.js only.** Zero `npm install` dependencies. If it's not in Node core, don't add it.
- **ESM modules.** Use `import`/`export`, not `require`.
- Keep files small and focused. Core logic lives in `src/`, hooks in `hooks/`, skill definitions in `skills/`.
- Shell scripts (`.sh`) must be POSIX-compatible where possible.

## Pull Request Requirements

Every PR must include:

- **Passing tests.** Run `node --test tests/` before submitting. If your change touches logic, add or update tests.
- **What changed.** A clear description of the change and why it's needed.
- **How you tested.** Describe both unit test results and any manual testing you did with Claude CLI.
- **No new dependencies.** If you think one is justified, open an issue to discuss it first.

## Reporting Issues

When filing an issue, include:

- **Enforcement tier** you're using (advisory, structural, or enforced).
- **Plan Enforcer version** (check `package.json`).
- **Plan format** -- paste or link the plan file that triggered the issue.
- **What happened** vs. what you expected.
- **Ledger state** -- if relevant, include the ledger file contents showing the bad state.
- **Claude Code version** and Node.js version.

For feature requests, describe the problem you're solving before proposing a solution.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
