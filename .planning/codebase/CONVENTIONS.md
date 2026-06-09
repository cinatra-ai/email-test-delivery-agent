# Coding Conventions

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension repository. It ships no TypeScript `src/` tree — only a `package.json` manifest, a `cinatra/oas.json` agent surface descriptor, a `skills/email-test-delivery/SKILL.md` documentation file, and a self-contained CI gate script (`extension-kind-gate.mjs`). Conventions below cover the actual files present.

## Naming Patterns

**Files:**
- Kebab-case for all filenames: `extension-kind-gate.mjs`, `email-test-delivery/SKILL.md`
- Directory names are kebab-case: `email-test-delivery/`, `cinatra/`
- Manifest artifacts use their Cinatra-mandated canonical names: `oas.json`, `workflow.bpmn`, `SKILL.md`

**Functions (in `extension-kind-gate.mjs`):**
- camelCase for all exported and internal functions: `parseArgs`, `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`, `walkLlmStrings`, `scanOasString`, `wordBoundary`
- Verbs that describe action: `validate*`, `find*`, `run*`, `scan*`, `walk*`

**Variables:**
- camelCase throughout: `packageRoot`, `bpmnPath`, `openTags`, `bpmnPrefixes`, `allSidecars`
- SCREAMING_SNAKE_CASE for module-level constants and sets: `LLM_VISIBLE_FIELDS`, `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, `PRIMITIVE_PATTERNS`, `BPMN_MODEL_NS`, `WORKFLOW_PACKAGE_NAME_RE`, `OBJECTS_LIST_CRM_RE`

**Package naming:**
- Scoped packages follow `@cinatra-ai/<slug>-agent` for agents and `@cinatra-ai/<slug>-workflow` for workflows — enforced by `WORKFLOW_PACKAGE_NAME_RE` regex in `extension-kind-gate.mjs`

## Module Format

**ESM-only:** `package.json` declares `"type": "module"`. The gate script uses bare ESM `import` statements from `node:fs`, `node:path` builtins only — zero third-party runtime dependencies.

**File extension:** `.mjs` for the standalone gate script (explicit ESM even in a `"type": "module"` package, per convention).

**TypeScript config** (`tsconfig.json`) targets ESNext modules with `verbatimModuleSyntax: true` — type-only imports must use `import type`.

## Code Style

**Formatting:**
- Not detected (no Prettier/Biome config present). The gate script uses consistent 2-space indentation throughout.

**Linting:**
- Not detected (no ESLint config present).

**Strict mode:**
- `tsconfig.json` sets `"strict": true` with `"noImplicitAny": false` (strict minus implicit-any).

## Function Design

**Size:** Functions are small and single-purpose — the largest (`validateBpmnSanity`) is ~80 lines including comments and handles one well-defined validation step.

**Pure functions preferred:** All validation functions (`validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `validateWorkflowPackageShape`) are explicitly documented as "pure: returns string[] errors". Side effects are isolated to `main()` only.

**Return values:** Validators return `string[]` of error messages (empty array = pass). `runGate` returns `{ kind, errors }`.

**Parameters:** Single `packageRoot: string` parameter for validator entry points.

## Error Handling

**Strategy:** Accumulate errors as strings into an array, return the array. Callers decide whether to halt or continue. `try/catch` blocks wrap all file I/O; errors are formatted as human-readable strings pushed into the errors array.

**Pattern (from `extension-kind-gate.mjs`):**
```js
try {
  parsed = JSON.parse(readFileSync(oasPath, "utf8"));
} catch (err) {
  errors.push(`cinatra/oas.json failed to parse: ${err instanceof Error ? err.message : String(err)}`);
  return errors;
}
```

**Early return on fatal errors:** If a prerequisite fails (e.g., `package.json` unreadable, BPMN file missing), the function returns immediately with current errors rather than continuing.

**Process exit codes:** `main()` exits with `0` (pass) or `1` (violations). A special exit code `2` is used in the CI shell inline-node script to distinguish "first-party dep shape regression" from ordinary failure.

## Comments

**When to comment:** Module-level header blocks explain the file's purpose, scope, and constraints extensively. Section separators use `// ---` dashed lines. Inline comments explain non-obvious decisions (e.g., why `npx` instead of `pnpm dlx` for tsc).

**Style:** Plain `//` comments, no JSDoc on exported functions. Comments are descriptive prose, not restatements of code.

## Import Organization

**Order (in `extension-kind-gate.mjs`):**
1. Node built-in imports only (`node:fs`, `node:path`) — no third-party imports

**Destructuring:** All imports are destructured named imports, not default or namespace imports.

## Manifest Conventions (package.json)

**Required cinatra fields for an agent:**
- `cinatra.apiVersion`: `"cinatra.ai/v1"`
- `cinatra.kind`: `"agent"`
- `cinatra.dependencies[]`: runtime agent dependencies with `packageName`, `edgeType`, `versionConstraint`, `requirement`, `kind`
- `cinatra.agentDependencies`: shorthand map of agent dep names to version ranges

**First-party dependencies:** `@cinatra-ai/*` packages must only appear as optional `peerDependencies` — never in `dependencies`, `devDependencies`, or `optionalDependencies` (enforced by CI gate).

## SKILL.md Conventions

**Frontmatter:** YAML frontmatter with `name` and `description` fields.

**Content:** Documents the runtime call path, inputs, and MCP primitives. Written in plain Markdown prose. Uses backtick inline code for field names, tool names, and path references.

---

*Convention analysis: 2026-06-09*
