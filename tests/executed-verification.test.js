const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assessExecutedVerification,
  detectJsConventionCommand,
  detectNodeTestConventionCommand,
  detectPackageCommand,
  detectPackageManager,
  detectPythonConventionCommand,
  detectSessionLogCommand,
  detectVerificationCommand,
  evidenceClaimsExecutableVerification,
  parseEvidenceCommands,
  parseEvidenceCommand,
  readLatestExecutedVerification,
  runExecutedVerification,
  wrapInferredCommandForProject
} = require('../src/executed-verification');

function mkProject(scripts, extraPkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-execverify-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 't',
    scripts: scripts || {},
    ...(extraPkg || {})
  }, null, 2));
  const enforcerDir = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcerDir);
  return { dir, enforcerDir };
}

describe('parseEvidenceCommand', () => {
  it('extracts npm test from evidence text', () => {
    assert.equal(parseEvidenceCommand('verified via npm test before close'), 'npm test');
  });

  it('extracts npm run script command from evidence text', () => {
    assert.equal(parseEvidenceCommand('ran npm run typecheck and saved output'), 'npm run typecheck');
  });

  it('extracts broader command shapes from evidence text', () => {
    assert.equal(parseEvidenceCommand('validated with pnpm lint before verify'), 'pnpm lint');
    assert.equal(parseEvidenceCommand('green after python -m pytest -q'), 'python -m pytest -q');
    assert.equal(parseEvidenceCommand('reran bun test --watch=false before close'), 'bun test --watch=false');
    assert.equal(parseEvidenceCommand('passed after uv run pytest -q'), 'uv run pytest -q');
    assert.equal(parseEvidenceCommand('passed after uv run python -m pytest tests/test_status.py'), 'uv run python -m pytest tests/test_status.py');
    assert.equal(parseEvidenceCommand('reran uv run python -m unittest discover'), 'uv run python -m unittest discover');
    assert.equal(parseEvidenceCommand('green after poetry run pytest -q'), 'poetry run pytest -q');
    assert.equal(parseEvidenceCommand('passed after pipenv run python -m pytest tests/test_status.py'), 'pipenv run python -m pytest tests/test_status.py');
    assert.equal(parseEvidenceCommand('linted with npx eslint src'), 'npx eslint src');
    assert.equal(parseEvidenceCommand('checked with yarn eslint src'), 'yarn eslint src');
    assert.equal(parseEvidenceCommand('checked with yarn run eslint src'), 'yarn run eslint src');
    assert.equal(parseEvidenceCommand('typed with bun x tsc --noEmit'), 'bun x tsc --noEmit');
    assert.equal(parseEvidenceCommand('validated with npm exec -- eslint src'), 'npm exec -- eslint src');
    assert.equal(parseEvidenceCommand('validated with pnpm exec -- eslint src'), 'pnpm exec -- eslint src');
    assert.equal(parseEvidenceCommand('verified after tox -q'), 'tox -q');
    assert.equal(parseEvidenceCommand('verified after python -m tox -q'), 'python -m tox -q');
    assert.equal(parseEvidenceCommand('verified after nox -s tests'), 'nox -s tests');
    assert.equal(parseEvidenceCommand('verified after uv run nox -s lint'), 'uv run nox -s lint');
    assert.equal(parseEvidenceCommand('verified after deno test --allow-env'), 'deno test --allow-env');
    assert.equal(parseEvidenceCommand('verified after dotnet test src/App/App.csproj'), 'dotnet test src/App/App.csproj');
    assert.equal(parseEvidenceCommand('verified after bundle exec rspec spec/models/user_spec.rb'), 'bundle exec rspec spec/models/user_spec.rb');
    assert.equal(parseEvidenceCommand('verified after ./gradlew test --tests AppTest'), './gradlew test --tests AppTest');
    assert.equal(parseEvidenceCommand('verified after mvn test -q'), 'mvn test -q');
    assert.equal(parseEvidenceCommand('verified after composer run test -- --filter UserTest'), 'composer run test -- --filter UserTest');
    assert.equal(parseEvidenceCommand('verified after php artisan test --filter FeatureTest'), 'php artisan test --filter FeatureTest');
    assert.equal(parseEvidenceCommand('verified after vendor/bin/phpunit --filter UserTest'), 'vendor/bin/phpunit --filter UserTest');
    assert.equal(parseEvidenceCommand('verified after vendor/bin/pest --group feature'), 'vendor/bin/pest --group feature');
    assert.equal(parseEvidenceCommand('verified after mix test test/app_test.exs'), 'mix test test/app_test.exs');
    assert.equal(parseEvidenceCommand('verified after swift test --filter PackageTests'), 'swift test --filter PackageTests');
    assert.equal(parseEvidenceCommand('verified after ctest --output-on-failure'), 'ctest --output-on-failure');
    assert.equal(parseEvidenceCommand('verified after meson test -C build'), 'meson test -C build');
    assert.equal(parseEvidenceCommand('verified after stack test --ta "--quiet"'), 'stack test --ta "--quiet"');
    assert.equal(parseEvidenceCommand('verified after cabal test all'), 'cabal test all');
    assert.equal(parseEvidenceCommand('verified after make test'), 'make test');
    assert.equal(parseEvidenceCommand('verified after just lint src-cli'), 'just lint src-cli');
    assert.equal(parseEvidenceCommand('verified after task verify --summary'), 'task verify --summary');
    assert.equal(parseEvidenceCommand('verified after npm test -- --runInBand'), 'npm test -- --runInBand');
    assert.equal(parseEvidenceCommand('verified after node --test tests/smoke.test.js'), 'node --test tests/smoke.test.js');
    assert.equal(parseEvidenceCommand('verified after node scripts/verify.js --quick'), 'node ./scripts/verify.js --quick');
    assert.equal(parseEvidenceCommand('verified after bash scripts/test.sh --smoke'), 'bash ./scripts/test.sh --smoke');
    assert.equal(parseEvidenceCommand('verified after powershell -File scripts/check.ps1 -Verbose'), 'powershell -File ./scripts/check.ps1 -Verbose');
    assert.equal(parseEvidenceCommand('verified after scripts/check.py --quick'), 'python ./scripts/check.py --quick');
  });
});

describe('parseEvidenceCommands', () => {
  it('keeps every referenced verification command in evidence order', () => {
    assert.deepEqual(
      parseEvidenceCommands('verified after npm run lint, then npm test, then npm run lint again'),
      ['npm run lint', 'npm test']
    );
  });

  it('prefers the more specific overlapping command match', () => {
    assert.deepEqual(
      parseEvidenceCommands('validated with npm exec -- eslint src and npm test'),
      ['npm exec -- eslint src', 'npm test']
    );
  });

  it('keeps comma-separated explicit command bundles without trailing punctuation', () => {
    assert.deepEqual(
      parseEvidenceCommands(
        'verified after node --test tests/executed-verification.test.js, node --test tests/evidence-gate.test.js, node --test tests/session-end.test.js, npm test.'
      ),
      [
        'node --test tests/executed-verification.test.js',
        'node --test tests/evidence-gate.test.js',
        'node --test tests/session-end.test.js',
        'npm test'
      ]
    );
  });

  it('splits repeated runner bundles across remaining explicit surfaces', () => {
    const cases = [
      {
        input: 'verified after npm exec -- eslint src, npm exec -- eslint tests, npm test',
        expected: ['npm exec -- eslint src', 'npm exec -- eslint tests', 'npm test']
      },
      {
        input: 'verified after playwright test tests/a.spec.ts, playwright test tests/b.spec.ts, npm test',
        expected: ['playwright test tests/a.spec.ts', 'playwright test tests/b.spec.ts', 'npm test']
      },
      {
        input: 'verified after ruff check src, ruff check tests, npm test',
        expected: ['ruff check src', 'ruff check tests', 'npm test']
      },
      {
        input: 'verified after dotnet test src/A.csproj, dotnet test src/B.csproj, npm test',
        expected: ['dotnet test src/A.csproj', 'dotnet test src/B.csproj', 'npm test']
      },
      {
        input: 'verified after vendor/bin/phpunit --filter ATest, vendor/bin/phpunit --filter BTest, npm test',
        expected: ['vendor/bin/phpunit --filter ATest', 'vendor/bin/phpunit --filter BTest', 'npm test']
      },
      {
        input: 'verified after task verify --scope a, task verify --scope b, npm test',
        expected: ['task verify --scope a', 'task verify --scope b', 'npm test']
      },
      {
        input: 'verified after go test ./pkg/a, go test ./pkg/b, npm test',
        expected: ['go test ./pkg/a', 'go test ./pkg/b', 'npm test']
      }
    ];
    for (const { input, expected } of cases) {
      assert.deepEqual(parseEvidenceCommands(input), expected);
    }
  });
});

describe('evidenceClaimsExecutableVerification', () => {
  it('flags command-bearing and verification-bearing prose claims', () => {
    assert.equal(evidenceClaimsExecutableVerification('verified after npm test'), true);
    assert.equal(evidenceClaimsExecutableVerification('3 tests passed, 0 failed'), true);
    assert.equal(evidenceClaimsExecutableVerification('linted clean before close'), true);
  });

  it('does not flag artifact-only evidence', () => {
    assert.equal(evidenceClaimsExecutableVerification('src/status-cli.js'), false);
    assert.equal(evidenceClaimsExecutableVerification('commit abc1234'), false);
  });
});

describe('detectVerificationCommand', () => {
  it('prefers explicit evidence commands over config check_cmd', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: { check_cmd: 'npm run lint' },
      evidenceText: 'verified after npm test and npm run verify'
    });
    assert.equal(found.command, 'npm test && npm run verify');
    assert.deepEqual(found.commands, ['npm test', 'npm run verify']);
    assert.equal(found.source, 'evidence');
  });

  it('falls back to explicit config check_cmd when evidence names no command', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: { check_cmd: 'npm run lint' },
      evidenceText: 'package.json'
    });
    assert.equal(found.command, 'npm run lint');
    assert.deepEqual(found.commands, ['npm run lint']);
    assert.equal(found.source, 'config:check_cmd');
  });

  it('falls back to package.json test script', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'npm test');
    assert.equal(found.source, 'package.json:test');
  });

  it('falls back to verify/check-style scripts when test is absent', () => {
    const project = mkProject({ verify: 'node -e "process.exit(0)"' });
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'npm run verify');
    assert.equal(found.source, 'package.json:verify');
  });

  it('uses packageManager field to choose pnpm for script fallback', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' }, { packageManager: 'pnpm@9.1.0' });
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'pnpm test');
    assert.equal(found.source, 'package.json:test');
  });

  it('uses lockfile to choose yarn for script fallback', () => {
    const project = mkProject({ lint: 'node -e "process.exit(0)"' });
    fs.writeFileSync(path.join(project.dir, 'yarn.lock'), '# lockfile');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'yarn lint');
    assert.equal(found.source, 'package.json:lint');
  });

  it('uses bun run for package-script fallback', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' }, { packageManager: 'bun@1.1.15' });
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'bun run test');
    assert.equal(found.source, 'package.json:test');
  });

  it('falls back to manager-aware vitest config when scripts are absent', () => {
    const project = mkProject({}, { packageManager: 'pnpm@9.1.0' });
    fs.writeFileSync(path.join(project.dir, 'vitest.config.ts'), 'export default {};');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'pnpm exec vitest run');
    assert.equal(found.source, 'convention:vitest');
  });

  it('falls back to manager-aware eslint config when scripts are absent', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'yarn.lock'), '# lockfile');
    fs.writeFileSync(path.join(project.dir, 'eslint.config.js'), 'export default [];');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'yarn eslint .');
    assert.equal(found.source, 'convention:eslint');
  });

  it('falls back to manager-aware tsc config when scripts are absent', () => {
    const project = mkProject({}, { packageManager: 'bun@1.1.15' });
    fs.writeFileSync(path.join(project.dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true } }, null, 2));
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'bun x tsc --noEmit');
    assert.equal(found.source, 'convention:tsc');
  });

  it('falls back to node --test when node:test files exist and no stronger source exists', () => {
    const project = mkProject({});
    fs.mkdirSync(path.join(project.dir, 'tests'));
    fs.writeFileSync(
      path.join(project.dir, 'tests', 'status-cli.test.js'),
      "const test = require('node:test');\ntest('status', () => {});\n"
    );
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'node --test');
    assert.equal(found.source, 'convention:node-test');
  });

  it('falls back to deno test when deno markers exist', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'deno.json'), '{\n  "tasks": {}\n}\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'deno test');
    assert.equal(found.source, 'convention:deno');
  });

  it('falls back to dotnet test when solution files exist', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'App.sln'), 'Microsoft Visual Studio Solution File\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'dotnet test');
    assert.equal(found.source, 'convention:dotnet');
  });

  it('falls back to bundle exec rspec when Gemfile and specs exist', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'Gemfile'), "source 'https://rubygems.org'\n");
    fs.mkdirSync(path.join(project.dir, 'spec', 'models'), { recursive: true });
    fs.writeFileSync(path.join(project.dir, 'spec', 'models', 'user_spec.rb'), "RSpec.describe 'User' do\nend\n");
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'bundle exec rspec');
    assert.equal(found.source, 'convention:rspec');
  });

  it('falls back to ./gradlew test when Gradle wrapper exists', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'build.gradle.kts'), "plugins { java }\n");
    fs.writeFileSync(path.join(project.dir, 'gradlew'), '#!/bin/sh\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, './gradlew test');
    assert.equal(found.source, 'convention:gradle');
  });

  it('falls back to mvn test when pom.xml exists', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'pom.xml'), '<project></project>\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'mvn test');
    assert.equal(found.source, 'convention:maven');
  });

  it('falls back to composer scripts when package scripts are absent', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'composer.json'), JSON.stringify({
      scripts: {
        lint: 'phpcs',
        test: 'phpunit'
      }
    }, null, 2));
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'composer run test');
    assert.equal(found.source, 'composer.json:test');
  });

  it('falls back to php artisan test for Laravel repos', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'composer.json'), JSON.stringify({ name: 'demo/app' }, null, 2));
    fs.writeFileSync(path.join(project.dir, 'artisan'), '#!/usr/bin/env php\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'php artisan test');
    assert.equal(found.source, 'convention:artisan');
  });

  it('falls back to Pest when pest markers exist', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'composer.json'), JSON.stringify({ name: 'demo/app' }, null, 2));
    fs.mkdirSync(path.join(project.dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(project.dir, 'tests', 'Pest.php'), "<?php\n");
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'vendor/bin/pest');
    assert.equal(found.source, 'convention:pest');
  });

  it('falls back to PHPUnit when phpunit config or tests exist', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'composer.json'), JSON.stringify({ name: 'demo/app' }, null, 2));
    fs.writeFileSync(path.join(project.dir, 'phpunit.xml'), '<phpunit />\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'vendor/bin/phpunit');
    assert.equal(found.source, 'convention:phpunit');
  });

  it('falls back to mix test for Elixir repos', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'mix.exs'), 'defmodule Demo.MixProject do\nend\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'mix test');
    assert.equal(found.source, 'convention:mix');
  });

  it('falls back to swift test for Swift package repos', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'Package.swift'), '// swift-tools-version: 5.9\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'swift test');
    assert.equal(found.source, 'convention:swift');
  });

  it('falls back to ctest when CMake markers exist', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.26)\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'ctest');
    assert.equal(found.source, 'convention:ctest');
  });

  it('falls back to meson test when meson markers exist', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'meson.build'), "project('demo', 'c')\n");
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'meson test');
    assert.equal(found.source, 'convention:meson');
  });

  it('falls back to stack test when stack.yaml exists', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'stack.yaml'), 'resolver: lts-22.0\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'stack test');
    assert.equal(found.source, 'convention:stack');
  });

  it('wraps python convention fallback through uv when repo owns uv env', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'uv.lock'), 'version = 1\n');
    fs.writeFileSync(path.join(project.dir, 'pyproject.toml'), '[tool.pytest.ini_options]\naddopts = "-q"\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'uv run pytest');
    assert.equal(found.source, 'convention:pytest');
  });

  it('wraps unittest convention fallback through poetry when repo owns poetry env', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'poetry.lock'), '# lock\n');
    fs.mkdirSync(path.join(project.dir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(project.dir, 'tests', 'test_status.py'),
      "import unittest\n\nclass StatusTest(unittest.TestCase):\n    pass\n"
    );
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'poetry run python -m unittest');
    assert.equal(found.source, 'convention:unittest');
  });

  it('falls back to cabal test when cabal markers exist', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'demo.cabal'), 'name: demo\n');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'cabal test');
    assert.equal(found.source, 'convention:cabal');
  });

  it('falls back to make targets before lower-level conventions', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'Makefile'), [
      'lint:',
      '\techo lint',
      '',
      'test:',
      '\techo test'
    ].join('\n'));
    fs.writeFileSync(path.join(project.dir, 'vitest.config.ts'), 'export default {};');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'make test');
    assert.equal(found.source, 'Makefile:test');
  });

  it('falls back to just targets when no stronger script source exists', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'justfile'), [
      'lint:',
      '  echo lint',
      '',
      '@verify args:',
      '  echo verify'
    ].join('\n'));
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'just verify');
    assert.equal(found.source, 'justfile:verify');
  });

  it('falls back to taskfile targets when no stronger script source exists', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'Taskfile.yml'), [
      'version: "3"',
      'tasks:',
      '  check:',
      '    cmds:',
      '      - npm test',
      '  lint:',
      '    cmds:',
      '      - npm run lint'
    ].join('\n'));
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'task check');
    assert.equal(found.source, 'Taskfile.yml:check');
  });

  it('falls back to script frontdoor wrappers before lower-level language conventions', () => {
    const project = mkProject({});
    fs.mkdirSync(path.join(project.dir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(project.dir, 'scripts', 'verify.js'),
      "console.log('verify');\nprocess.exit(0);\n"
    );
    fs.writeFileSync(path.join(project.dir, 'vitest.config.ts'), 'export default {};');
    const found = detectPackageCommand(project.dir);
    assert.equal(found.command, 'node ./scripts/verify.js');
    assert.equal(found.source, 'convention:script-frontdoor:scripts/verify.js');
  });

  it('wraps bare JS-tool evidence commands through the repo package manager', () => {
    const project = mkProject({}, { packageManager: 'pnpm@9.1.0' });
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after vitest run tests/status-cli.test.js'
    });
    assert.equal(found.command, 'pnpm exec vitest run tests/status-cli.test.js');
    assert.equal(found.source, 'evidence');
  });

  it('preserves explicit manager-prefixed evidence commands', () => {
    const project = mkProject({}, { packageManager: 'pnpm@9.1.0' });
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after npx eslint src'
    });
    assert.equal(found.command, 'npx eslint src');
    assert.equal(found.source, 'evidence');
  });

  it('preserves explicit npm exec evidence commands', () => {
    const project = mkProject({});
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after npm exec -- eslint src'
    });
    assert.equal(found.command, 'npm exec -- eslint src');
    assert.equal(found.source, 'evidence');
  });

  it('preserves repeated npm exec evidence bundles in order', () => {
    const project = mkProject({});
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after npm exec -- eslint src, npm exec -- eslint tests, npm test'
    });
    assert.equal(found.command, 'npm exec -- eslint src && npm exec -- eslint tests && npm test');
    assert.deepEqual(found.commands, ['npm exec -- eslint src', 'npm exec -- eslint tests', 'npm test']);
    assert.equal(found.source, 'evidence');
  });

  it('preserves explicit yarn run evidence commands', () => {
    const project = mkProject({});
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after yarn run eslint src'
    });
    assert.equal(found.command, 'yarn run eslint src');
    assert.equal(found.source, 'evidence');
  });

  it('preserves explicit poetry and pipenv evidence commands', () => {
    const project = mkProject({});
    const poetry = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after poetry run pytest -q'
    });
    assert.equal(poetry.command, 'poetry run pytest -q');
    assert.equal(poetry.source, 'evidence');

    const pipenv = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after pipenv run python -m pytest tests/test_status.py'
    });
    assert.equal(pipenv.command, 'pipenv run python -m pytest tests/test_status.py');
    assert.equal(pipenv.source, 'evidence');
  });

  it('preserves explicit tox and nox evidence commands', () => {
    const project = mkProject({});
    const tox = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after python -m tox -q'
    });
    assert.equal(tox.command, 'python -m tox -q');
    assert.equal(tox.source, 'evidence');

    const nox = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after uv run nox -s tests'
    });
    assert.equal(nox.command, 'uv run nox -s tests');
    assert.equal(nox.source, 'evidence');
  });

  it('preserves explicit deno, dotnet, ruby, and java evidence commands', () => {
    const project = mkProject({});

    const deno = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after deno test --allow-env'
    });
    assert.equal(deno.command, 'deno test --allow-env');
    assert.equal(deno.source, 'evidence');

    const dotnet = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after dotnet test src/App/App.csproj'
    });
    assert.equal(dotnet.command, 'dotnet test src/App/App.csproj');
    assert.equal(dotnet.source, 'evidence');

    const ruby = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after bundle exec rspec spec/models/user_spec.rb'
    });
    assert.equal(ruby.command, 'bundle exec rspec spec/models/user_spec.rb');
    assert.equal(ruby.source, 'evidence');

    const gradle = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after ./gradlew test --tests AppTest'
    });
    assert.equal(gradle.command, './gradlew test --tests AppTest');
    assert.equal(gradle.source, 'evidence');
  });

  it('preserves explicit php, elixir, and swift evidence commands', () => {
    const project = mkProject({});

    const composer = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after composer run test -- --filter UserTest'
    });
    assert.equal(composer.command, 'composer run test -- --filter UserTest');
    assert.equal(composer.source, 'evidence');

    const artisan = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after php artisan test --filter FeatureTest'
    });
    assert.equal(artisan.command, 'php artisan test --filter FeatureTest');
    assert.equal(artisan.source, 'evidence');

    const phpunit = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after vendor/bin/phpunit --filter UserTest'
    });
    assert.equal(phpunit.command, 'vendor/bin/phpunit --filter UserTest');
    assert.equal(phpunit.source, 'evidence');

    const mix = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after mix test test/app_test.exs'
    });
    assert.equal(mix.command, 'mix test test/app_test.exs');
    assert.equal(mix.source, 'evidence');

    const swift = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after swift test --filter PackageTests'
    });
    assert.equal(swift.command, 'swift test --filter PackageTests');
    assert.equal(swift.source, 'evidence');
  });

  it('preserves explicit ctest, meson, and haskell evidence commands', () => {
    const project = mkProject({});

    const ctest = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after ctest --output-on-failure'
    });
    assert.equal(ctest.command, 'ctest --output-on-failure');
    assert.equal(ctest.source, 'evidence');

    const meson = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after meson test -C build'
    });
    assert.equal(meson.command, 'meson test -C build');
    assert.equal(meson.source, 'evidence');

    const stack = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after stack test --ta "--quiet"'
    });
    assert.equal(stack.command, 'stack test --ta "--quiet"');
    assert.equal(stack.source, 'evidence');

    const cabal = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after cabal test all'
    });
    assert.equal(cabal.command, 'cabal test all');
    assert.equal(cabal.source, 'evidence');
  });

  it('preserves explicit make, just, and task evidence commands', () => {
    const project = mkProject({});

    const make = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after make test'
    });
    assert.equal(make.command, 'make test');
    assert.equal(make.source, 'evidence');

    const just = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after just lint src-cli'
    });
    assert.equal(just.command, 'just lint src-cli');
    assert.equal(just.source, 'evidence');

    const task = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after task verify --summary'
    });
    assert.equal(task.command, 'task verify --summary');
    assert.equal(task.source, 'evidence');
  });

  it('preserves repeated go test evidence bundles in order', () => {
    const project = mkProject({});
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after go test ./pkg/a, go test ./pkg/b, npm test'
    });
    assert.equal(found.command, 'go test ./pkg/a && go test ./pkg/b && npm test');
    assert.deepEqual(found.commands, ['go test ./pkg/a', 'go test ./pkg/b', 'npm test']);
    assert.equal(found.source, 'evidence');
  });

  it('wraps bare python evidence commands through repo-owned env runners', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'Pipfile.lock'), '{}\n');
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'verified after pytest -q'
    });
    assert.equal(found.command, 'pipenv run pytest -q');
    assert.deepEqual(found.commands, ['pipenv run pytest -q']);
    assert.equal(found.source, 'evidence');
  });

  it('falls back to a recent session-log verification command when config/evidence/package miss', () => {
    const project = mkProject({});
    const sessionLogPath = path.join(project.enforcerDir, '.session-log.jsonl');
    fs.writeFileSync(sessionLogPath, [
      JSON.stringify({
        ts: '2026-04-19T10:00:00Z',
        tool: 'Bash',
        input: { command: 'node --test tests/verify-cli.test.js' },
        response: { exit: 0, stdout: 'ok 1 - verify-cli' }
      })
    ].join('\n'));
    const found = detectVerificationCommand({
      projectRoot: project.dir,
      config: {},
      evidenceText: 'tests/verify-cli.test.js',
      sessionLogPath
    });
    assert.equal(found.command, 'node --test tests/verify-cli.test.js');
    assert.equal(found.source, 'session-log:matched-verification');
  });
});

describe('detectSessionLogCommand', () => {
  it('prefers the command whose session-log payload overlaps evidence hints', () => {
    const project = mkProject({});
    const sessionLogPath = path.join(project.enforcerDir, '.session-log.jsonl');
    fs.writeFileSync(sessionLogPath, [
      JSON.stringify({
        ts: '2026-04-19T10:00:00Z',
        tool: 'Bash',
        input: { command: 'npm run lint' },
        response: { exit: 0, stdout: 'lint ok' }
      }),
      JSON.stringify({
        ts: '2026-04-19T10:05:00Z',
        tool: 'Bash',
        input: { command: 'node --test tests/status-logs-cli.test.js' },
        response: { exit: 0, stdout: 'status-logs-cli ok' }
      })
    ].join('\n'));
    const found = detectSessionLogCommand(project.dir, 'tests/status-logs-cli.test.js', sessionLogPath);
    assert.equal(found.command, 'node --test tests/status-logs-cli.test.js');
    assert.equal(found.source, 'session-log:matched-verification');
  });

  it('wraps bare JS-tool session-log commands through the repo package manager', () => {
    const project = mkProject({}, { packageManager: 'yarn@4.1.0' });
    const sessionLogPath = path.join(project.enforcerDir, '.session-log.jsonl');
    fs.writeFileSync(sessionLogPath, [
      JSON.stringify({
        ts: '2026-04-19T10:00:00Z',
        tool: 'Bash',
        input: { command: 'eslint src' },
        response: { exit: 0, stdout: 'ok' }
      })
    ].join('\n'));
    const found = detectSessionLogCommand(project.dir, 'src/index.js', sessionLogPath);
    assert.equal(found.command, 'yarn eslint src');
    assert.equal(found.source, 'session-log:latest-verification');
  });
});

describe('detectPackageManager', () => {
  it('defaults to npm when no declaration exists', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    assert.equal(detectPackageManager(project.dir), 'npm');
  });

  it('prefers declared packageManager over mixed lockfiles', () => {
    const project = mkProject({}, { packageManager: 'pnpm@9.0.0' });
    fs.writeFileSync(path.join(project.dir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(project.dir, 'yarn.lock'), '# lockfile');
    assert.equal(detectPackageManager(project.dir), 'pnpm');
  });
});

describe('wrapInferredCommandForProject', () => {
  it('keeps non-JS commands unchanged', () => {
    const project = mkProject({}, { packageManager: 'pnpm@9.0.0' });
    assert.equal(wrapInferredCommandForProject('pytest', project.dir), 'pytest');
    assert.equal(wrapInferredCommandForProject('node --test', project.dir), 'node --test');
  });

  it('wraps bare JS commands with npm exec when no manager declared', () => {
    const project = mkProject({});
    assert.equal(wrapInferredCommandForProject('vitest run', project.dir), 'npx vitest run');
  });

  it('wraps python commands through detected repo env managers', () => {
    const uvProject = mkProject({});
    fs.writeFileSync(path.join(uvProject.dir, 'uv.lock'), 'version = 1\n');
    assert.equal(wrapInferredCommandForProject('pytest -q', uvProject.dir), 'uv run pytest -q');
    assert.equal(wrapInferredCommandForProject('python -m unittest', uvProject.dir), 'uv run python -m unittest');

    const poetryProject = mkProject({});
    fs.writeFileSync(path.join(poetryProject.dir, 'poetry.lock'), '# lock\n');
    assert.equal(wrapInferredCommandForProject('ruff check .', poetryProject.dir), 'poetry run ruff check .');

    const pipenvProject = mkProject({});
    fs.writeFileSync(path.join(pipenvProject.dir, 'Pipfile'), "[packages]\npytest = '*'\n");
    assert.equal(wrapInferredCommandForProject('tox -q', pipenvProject.dir), 'pipenv run tox -q');
  });
});

describe('detectJsConventionCommand', () => {
  it('prefers test runner conventions ahead of lint/type configs', () => {
    const project = mkProject({}, { packageManager: 'pnpm@9.0.0' });
    fs.writeFileSync(path.join(project.dir, 'vitest.config.ts'), 'export default {};');
    fs.writeFileSync(path.join(project.dir, 'eslint.config.js'), 'export default [];');
    fs.writeFileSync(path.join(project.dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }, null, 2));
    const found = detectJsConventionCommand(project.dir, 'pnpm');
    assert.equal(found.command, 'pnpm exec vitest run');
    assert.equal(found.source, 'convention:vitest');
  });

  it('returns null when no JS/TS convention files exist', () => {
    const project = mkProject({});
    assert.equal(detectJsConventionCommand(project.dir, 'npm'), null);
  });
});

describe('detectNodeTestConventionCommand', () => {
  it('detects nested node:test files inside common test roots', () => {
    const project = mkProject({});
    fs.mkdirSync(path.join(project.dir, 'tests', 'cli'), { recursive: true });
    fs.writeFileSync(
      path.join(project.dir, 'tests', 'cli', 'status.test.js'),
      "import test from 'node:test';\ntest('status', () => {});\n"
    );
    const found = detectNodeTestConventionCommand(project.dir);
    assert.deepEqual(found, { command: 'node --test', source: 'convention:node-test' });
  });

  it('ignores matching filenames that do not use node:test', () => {
    const project = mkProject({});
    fs.mkdirSync(path.join(project.dir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(project.dir, 'tests', 'status.test.js'),
      "describe('status', () => {});\n"
    );
    assert.equal(detectNodeTestConventionCommand(project.dir), null);
  });
});

describe('detectPythonConventionCommand', () => {
  it('detects tox from tox.ini instead of pretending it is pytest', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'tox.ini'), '[tox]\nenvlist = py311\n');
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'tox');
    assert.equal(found.source, 'convention:tox');
  });

  it('detects tox from pyproject tool section', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'pyproject.toml'), '[tool.tox]\nlegacy_tox_ini = """[tox]"""\n');
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'tox');
    assert.equal(found.source, 'convention:tox');
  });

  it('detects pytest from pyproject tool section', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'pyproject.toml'), '[tool.pytest.ini_options]\naddopts = "-q"\n');
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'pytest');
    assert.equal(found.source, 'convention:pytest');
  });

  it('detects ruff from pyproject tool section', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n');
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'ruff check .');
    assert.equal(found.source, 'convention:ruff');
  });

  it('detects unittest from test files when no stronger python source exists', () => {
    const project = mkProject({});
    fs.mkdirSync(path.join(project.dir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(project.dir, 'tests', 'test_status.py'),
      "import unittest\n\nclass StatusTest(unittest.TestCase):\n    pass\n"
    );
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'python -m unittest');
    assert.equal(found.source, 'convention:unittest');
  });

  it('wraps convention commands when python env manager markers exist', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'uv.lock'), 'version = 1\n');
    fs.writeFileSync(path.join(project.dir, 'pyproject.toml'), '[tool.pytest.ini_options]\naddopts = "-q"\n');
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'uv run pytest');
    assert.equal(found.source, 'convention:pytest');
  });

  it('detects nox from noxfile.py when no stronger python source exists', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'noxfile.py'), 'import nox\n');
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'nox');
    assert.equal(found.source, 'convention:nox');
  });

  it('detects mypy from pyproject tool section', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'pyproject.toml'), '[tool.mypy]\npython_version = "3.11"\n');
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'mypy .');
    assert.equal(found.source, 'convention:mypy');
  });

  it('prefers pytest over other python tool sections', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'pyproject.toml'), [
      '[tool.ruff]',
      'line-length = 100',
      '',
      '[tool.pytest.ini_options]',
      'addopts = "-q"'
    ].join('\n'));
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'pytest');
    assert.equal(found.source, 'convention:pytest');
  });

  it('ignores plain pyproject files with no supported verification tool section', () => {
    const project = mkProject({});
    fs.writeFileSync(path.join(project.dir, 'pyproject.toml'), '[project]\nname = "demo"\nversion = "0.1.0"\n');
    assert.equal(detectPythonConventionCommand(project.dir), null);
  });

  it('prefers pytest config over unittest file conventions', () => {
    const project = mkProject({});
    fs.mkdirSync(path.join(project.dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(project.dir, 'pytest.ini'), '[pytest]\n');
    fs.writeFileSync(
      path.join(project.dir, 'tests', 'test_status.py'),
      "import unittest\n\nclass StatusTest(unittest.TestCase):\n    pass\n"
    );
    const found = detectPythonConventionCommand(project.dir);
    assert.equal(found.command, 'pytest');
    assert.equal(found.source, 'convention:pytest');
  });
});

describe('runExecutedVerification', () => {
  it('writes sidecars and latest index on passing command', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    const result = runExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T1',
      evidenceText: 'package.json',
      config: {}
    });
    assert.equal(result.detected, true);
    assert.equal(result.ok, true);
    assert.equal(result.command, 'npm test');
    assert.ok(fs.existsSync(path.join(project.dir, result.logPath)));
    assert.ok(fs.existsSync(path.join(project.dir, result.jsonPath)));
    const latest = readLatestExecutedVerification(project.enforcerDir, 'T1');
    assert.equal(latest.ok, true);
    assert.equal(latest.command, 'npm test');
  });

  it('records failing command result', () => {
    const project = mkProject({ test: 'node -e "process.exit(1)"' });
    const result = runExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T2',
      evidenceText: 'package.json',
      config: {}
    });
    assert.equal(result.detected, true);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    const latest = readLatestExecutedVerification(project.enforcerDir, 'T2');
    assert.equal(latest.ok, false);
    assert.equal(latest.exitCode, 1);
  });

  it('runs every evidence-cited command and records bundle results', () => {
    const project = mkProject({
      test: 'node -e "process.exit(0)"',
      lint: 'node -e "process.exit(0)"'
    });
    const result = runExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'Tmulti',
      evidenceText: 'verified after npm run lint and npm test',
      config: { check_cmd: 'npm run verify' }
    });
    assert.equal(result.detected, true);
    assert.equal(result.ok, true);
    assert.equal(result.command, 'npm run lint && npm test');
    assert.deepEqual(result.commands, ['npm run lint', 'npm test']);
    assert.equal(result.runs.length, 2);
    assert.equal(result.runs[0].command, 'npm run lint');
    assert.equal(result.runs[1].command, 'npm test');
    const latest = readLatestExecutedVerification(project.enforcerDir, 'Tmulti');
    assert.deepEqual(latest.commands, ['npm run lint', 'npm test']);
    assert.equal(latest.command, 'npm run lint && npm test');
  });

  it('runs node wrapper-script verification commands and records canonical command text', () => {
    const project = mkProject({});
    fs.mkdirSync(path.join(project.dir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(project.dir, 'scripts', 'verify.js'),
      "console.log('wrapper verify');\nprocess.exit(0);\n"
    );
    const result = runExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'Tscript',
      evidenceText: 'verified after node scripts/verify.js --quick',
      config: {}
    });
    assert.equal(result.detected, true);
    assert.equal(result.ok, true);
    assert.equal(result.command, 'node ./scripts/verify.js --quick');
    const latest = readLatestExecutedVerification(project.enforcerDir, 'Tscript');
    assert.equal(latest.command, 'node ./scripts/verify.js --quick');
  });

  it('preserves explicit node --test file arguments in execution and sidecars', () => {
    const project = mkProject({});
    fs.mkdirSync(path.join(project.dir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(project.dir, 'tests', 'smoke.test.js'),
      "const test = require('node:test');\ntest('smoke', () => {});\n"
    );
    const result = runExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'Tnodeargs',
      evidenceText: 'verified after node --test tests/smoke.test.js',
      config: {}
    });
    assert.equal(result.detected, true);
    assert.equal(result.ok, true);
    assert.equal(result.command, 'node --test tests/smoke.test.js');
    const latest = readLatestExecutedVerification(project.enforcerDir, 'Tnodeargs');
    assert.equal(latest.command, 'node --test tests/smoke.test.js');
  });

  it('returns undetected when no command source exists', () => {
    const project = mkProject({});
    const result = runExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T3',
      evidenceText: 'package.json',
      config: {}
    });
    assert.equal(result.detected, false);
  });
});

describe('assessExecutedVerification', () => {
  it('reports missing when a command is expected but no sidecar exists', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"' });
    const result = assessExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T4',
      evidenceText: 'package.json',
      config: {}
    });
    assert.equal(result.required, true);
    assert.equal(result.state, 'missing');
    assert.equal(result.command, 'npm test');
  });

  it('reports undetected when evidence claims verification but no command source can be resolved', () => {
    const project = mkProject({});
    const result = assessExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'Tundetected',
      evidenceText: '3 tests passed, 0 failed',
      config: {}
    });
    assert.equal(result.required, true);
    assert.equal(result.state, 'undetected');
    assert.equal(result.command, null);
  });

  it('reports stale when expected command differs from latest sidecar', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' });
    const checksDir = path.join(project.enforcerDir, 'checks');
    fs.mkdirSync(checksDir, { recursive: true });
    fs.writeFileSync(path.join(checksDir, 'latest.json'), JSON.stringify({
      T5: { taskId: 'T5', command: 'npm test', ok: true, exitCode: 0 }
    }, null, 2));
    const result = assessExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T5',
      evidenceText: 'package.json',
      config: { check_cmd: 'npm run lint' }
    });
    assert.equal(result.required, true);
    assert.equal(result.state, 'stale');
  });

  it('reports stale when expected command set differs from latest bundle sidecar', () => {
    const project = mkProject({ test: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' });
    const checksDir = path.join(project.enforcerDir, 'checks');
    fs.mkdirSync(checksDir, { recursive: true });
    fs.writeFileSync(path.join(checksDir, 'latest.json'), JSON.stringify({
      T6: {
        taskId: 'T6',
        command: 'npm test',
        commands: ['npm test'],
        ok: true,
        exitCode: 0
      }
    }, null, 2));
    const result = assessExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'T6',
      evidenceText: 'verified after npm run lint and npm test',
      config: {}
    });
    assert.equal(result.required, true);
    assert.equal(result.state, 'stale');
    assert.equal(result.command, 'npm run lint && npm test');
  });

  it('reports stale when latest sidecar used a different script frontdoor command', () => {
    const project = mkProject({});
    const checksDir = path.join(project.enforcerDir, 'checks');
    fs.mkdirSync(checksDir, { recursive: true });
    fs.writeFileSync(path.join(checksDir, 'latest.json'), JSON.stringify({
      Tscriptstale: {
        taskId: 'Tscriptstale',
        command: 'node ./scripts/check.js',
        ok: true,
        exitCode: 0
      }
    }, null, 2));
    const result = assessExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'Tscriptstale',
      evidenceText: 'verified after node scripts/verify.js',
      config: {}
    });
    assert.equal(result.required, true);
    assert.equal(result.state, 'stale');
    assert.equal(result.command, 'node ./scripts/verify.js');
  });

  it('reports stale when latest sidecar broadened an explicit node --test file command', () => {
    const project = mkProject({});
    const checksDir = path.join(project.enforcerDir, 'checks');
    fs.mkdirSync(checksDir, { recursive: true });
    fs.writeFileSync(path.join(checksDir, 'latest.json'), JSON.stringify({
      Tnodeargsstale: {
        taskId: 'Tnodeargsstale',
        command: 'node --test',
        ok: true,
        exitCode: 0
      }
    }, null, 2));
    const result = assessExecutedVerification({
      projectRoot: project.dir,
      enforcerDir: project.enforcerDir,
      taskId: 'Tnodeargsstale',
      evidenceText: 'verified after node --test tests/smoke.test.js',
      config: {}
    });
    assert.equal(result.required, true);
    assert.equal(result.state, 'stale');
    assert.equal(result.command, 'node --test tests/smoke.test.js');
  });
});
