# Testing Patterns

**Analysis Date:** 2026-06-09

## Overview

This repository is a **content-only Cinatra agent extension** (source mirror). It ships no `src/` TypeScript tree and has no unit test files. The only executable code is `extension-kind-gate.mjs`, which is a self-contained CI validation script — not application logic. There are no test runner config files (`jest.config.*`, `vitest.config.*`, etc.) present.

## Test Framework

**Runner:** Not applicable — no test suite present in this repo.

**Run Commands:**
```bash
# CI runs this when the repo has no first-party @cinatra-ai/* peers:
corepack pnpm test --if-present   # no-op: no test script in package.json

# Kind-specific gate (not a unit test — a CI validation gate):
node extension-kind-gate.mjs --package-root .
```

## What Is Validated

Testing for this repo happens at two levels:

**1. CI gate script (`extension-kind-gate.mjs`):**
- Validates `cinatra/oas.json` parses as valid JSON
- Scans all LLM-visible OAS fields (`system`, `user`, `description`) for retired CRM primitive names
- Checks for banned type-hints (`@cinatra-ai/entity-accounts:account`, `@cinatra-ai/entity-contacts:contact`)
- Checks for retired `objects_list` over CRM entity types
- Enforced by the `kind-gates` CI job in `.github/workflows/ci.yml`

**2. Dependency shape check (inline node script in CI):**
- Asserts no `@cinatra-ai/*` packages appear in `dependencies`, `devDependencies`, or `optionalDependencies`
- Asserts all `@cinatra-ai/*` peer dependencies are marked `peerDependenciesMeta.optional: true`
- Run in the `build` job of `.github/workflows/ci.yml`

**3. Pack dry-run:**
```bash
npm pack --dry-run   # validates package shape and publish payload
```

## Test File Organization

**Location:** No test files exist in this repo.

**CI workflow:** `.github/workflows/ci.yml` — the `kind-gates` job at the bottom runs the gate script.

## Mocking

Not applicable — no test suite.

## Fixtures and Factories

Not applicable — no test suite.

## Coverage

**Requirements:** Not enforced — no coverage tooling configured.

## Test Types

**Unit Tests:** None in this repo. The monorepo owns unit/integration tests for host-internal `@cinatra-ai/*` packages. This extracted repo's CI skips standalone tests when first-party peers are detected (see `first_party=1` branch in `.github/workflows/ci.yml`).

**Integration Tests:** None in this repo. The Cinatra marketplace re-runs a full Profile-1.0 BPMN compile and OAS runtime-invariant validation at publish/install time — this is the authoritative integration gate.

**E2E Tests:** Not used.

## Gate Script Exported Functions (Testable Units)

The gate script `extension-kind-gate.mjs` exports pure functions that could be unit-tested independently:

| Function | Exported | Purpose |
|---|---|---|
| `parseArgs(argv)` | Yes | Parse `--package-root` CLI argument |
| `validateAgent(packageRoot)` | Yes | Scan `cinatra/oas.json` for banned primitives |
| `validateWorkflowPackageShape(pkg)` | Yes | Check `package.json` shape for workflow extensions |
| `validateBpmnSanity(xml)` | Yes | Light XML well-formedness + BPMN structure check |
| `findWorkflowSidecars(packageRoot)` | Yes | Find all `cinatra/workflow.bpmn` files recursively |
| `validateWorkflow(packageRoot)` | Yes | Full workflow extension validation |
| `runGate(packageRoot)` | Yes | Top-level dispatch: detect kind, run appropriate gate |

These are pure (or pure-ish) functions documented explicitly as returning `string[]` errors — well-suited for unit tests if a test suite were added.

## Adding Tests

If tests are added to this repo, the recommended approach (matching Cinatra monorepo patterns):

1. Add `vitest` as a `devDependency` (standalone repos only — not for source mirrors with `@cinatra-ai/*` peers)
2. Create test files co-located or in a `__tests__/` directory, named `*.test.ts` or `*.spec.ts`
3. Add a `"test": "vitest run"` script to `package.json`
4. Test the exported pure functions from `extension-kind-gate.mjs` with fixture XML/OAS strings

---

*Testing analysis: 2026-06-09*
