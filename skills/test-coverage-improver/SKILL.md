---
name: test-coverage-improver
description: Analyze test coverage gaps and generate tests to improve coverage. Use when improving test coverage, finding untested code, or writing missing tests.
disable-model-invocation: true
---

# Test Coverage Improver

## Scope

Only for code that already exists and shipped without tests (retrofitting coverage). For a NEW feature or bugfix, `tdd-workflow.md` governs instead — the test comes first, this skill does not apply.

## Instructions

When improving test coverage:

1. **Detect the stack first** — check for `package.json` (JS/TS), `pubspec.yaml` (Dart/Flutter), `pyproject.toml`/`setup.py` (Python), and read the project's `CLAUDE.md`/`AGENTS.md` for the declared test command. Route to the matching branch below. If none match, use the project's own declared test command — stop guessing.
2. **Create a bead** for the work: `bd create "Improve test coverage: <area>" -l "src/$(git rev-parse --abbrev-ref HEAD)"` — skip only for a single trivial test file.
3. **Run coverage report** to identify gaps (JS/TS branch below; see stack branches for Dart/Python)
4. **Prioritize** critical/complex code paths
5. **Write tests** for uncovered code
6. **Verify each generated test actually fails** against the original (deliberately break the code under test, or at minimum run and review the test for being a tautology) — a test that passes no matter what is not coverage
7. **Verify coverage improved**

### Stack branches

Everything below "Generate Coverage Report" onward is the **JS/TS branch** (Jest/Vitest/NYC/RTL).

- **Dart/Flutter**: `flutter test --coverage` → `coverage/lcov.info`; view with `genhtml coverage/lcov.info -o coverage/html`. For widget/golden/integration coverage, use the `flutter-quality` skill instead of ad-hoc tests here.
- **Python**: `pytest --cov=<package> --cov-report=html` (coverage.py under the hood); view `htmlcov/index.html`.

## Generate Coverage Report

```bash
# Jest
yarn jest --coverage

# Vitest
yarn vitest --coverage

# NYC (Istanbul) for any test runner
yarn nyc yarn test

# View HTML report
open coverage/lcov-report/index.html
```

## Coverage Targets

| Type | Minimum | Good | Excellent |
|------|---------|------|-----------|
| Lines | 70% | 80% | 90%+ |
| Branches | 60% | 75% | 85%+ |
| Functions | 70% | 80% | 90%+ |
| Statements | 70% | 80% | 90%+ |

## Branch Coverage Checklist

Ensure tests cover:

- [ ] If/else branches
- [ ] Ternary operators
- [ ] Switch cases (including default)
- [ ] Try/catch blocks
- [ ] Early returns
- [ ] Nullish coalescing (`??`)
- [ ] Optional chaining results (`?.`)
- [ ] Loop conditions (0, 1, many iterations)

## Coverage Configuration

```javascript
// vitest.config.ts
export default {
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/types/',
      ],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },
    },
  },
};
```

## Priority Order for Testing

1. **Critical paths**: Auth, payments, data mutations
2. **Complex logic**: Algorithms, state machines, calculations
3. **Error handlers**: Catch blocks, error boundaries
4. **Edge cases**: Empty arrays, null values, boundaries
5. **Integration points**: API calls, database queries
