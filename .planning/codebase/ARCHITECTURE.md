<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│             Cinatra Orchestration Platform (host)               │
│   (email outreach workflow invokes this agent as a flow node)   │
└──────────────────────────┬──────────────────────────────────────┘
                           │  flow input: campaignId (UUID)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│          email-test-delivery-agent  (Flow, kind: agent)         │
│          `cinatra/oas.json`                                      │
│                                                                  │
│   StartNode (start)                                              │
│       │ campaignId (hidden, required)                            │
│       ▼                                                          │
│   InputMessageNode (test_form_gate)                              │
│       │  re-entrant HITL gate                                    │
│       │  renderer: @cinatra-ai/email-test-delivery-agent:input   │
│       │                                                          │
│       │  User fills form → clicks Send                           │
│       │       │                                                  │
│       │       ▼  (outside flow, does NOT advance node)           │
│       │  server action → email_outreach_send_test_start (MCP)   │
│       │       │  lives in packages/trigger-email-send (monorepo) │
│       │       ▼                                                  │
│       │  inline result banner shown to user                      │
│       │                                                          │
│       │  User clicks Continue → node resolves                    │
│       ▼                                                          │
│   EndNode (end)                                                  │
│       output: testResult (JSON-encoded string)                   │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
       downstream flow nodes receive testResult
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Flow definition | OAS spec declaring the 3-node flow graph | `cinatra/oas.json` |
| StartNode (start) | Receives `campaignId` UUID from the host flow | `cinatra/oas.json` → `$referenced_components.start` |
| InputMessageNode (test_form_gate) | Re-entrant HITL gate; holds execution until user continues | `cinatra/oas.json` → `$referenced_components.test_form_gate` |
| EndNode (end) | Propagates `testResult` to downstream flow | `cinatra/oas.json` → `$referenced_components.end` |
| HITL renderer | Form surface (implemented in host monorepo) | `@cinatra-ai/email-test-delivery-agent:input` (external) |
| MCP primitive | Actual test send trigger | `email_outreach_send_test_start` in `packages/trigger-email-send` (monorepo) |
| CI gate | Self-contained validation of OAS + banned primitives | `extension-kind-gate.mjs` |
| Skill documentation | Human-readable flow contract for discovery | `skills/email-test-delivery/SKILL.md` |

## Pattern Overview

**Overall:** Re-entrant Human-in-the-Loop (HITL) Flow Node

**Key Characteristics:**
- No LLM tool calls occur within this agent; it is a pure HITL gate
- The test email send (`email_outreach_send_test_start`) is triggered by a renderer server action, not by advancing the flow
- The node is re-entrant: the user may trigger multiple sends before clicking Continue
- The flow carries only one "real" input (`campaignId`); all other inputs (`recipientEmail`, `selectionMode`, etc.) are collected by the renderer form at runtime
- `testResult` is a JSON-encoded string envelope (`{ userResponse, lastSendResult }`) rather than a structured object, because the InputMessageNode schema uses `x-envelope: json-string`

## Layers

**Flow Manifest Layer:**
- Purpose: Declares the agent's graph topology, I/O contract, and renderer binding for the Cinatra platform
- Location: `cinatra/oas.json`
- Contains: StartNode, InputMessageNode, EndNode, ControlFlowEdges, DataFlowEdges, inputMessageSchema
- Depends on: Cinatra agentspec v26.1.0
- Used by: Cinatra host orchestrator at runtime; marketplace at publish/install

**Skill Documentation Layer:**
- Purpose: Human- and LLM-readable description for agent discovery and developer reference
- Location: `skills/email-test-delivery/SKILL.md`
- Contains: Input descriptions, MCP primitive reference, runtime call path explanation
- Depends on: Nothing (markdown only)
- Used by: Developers, GSD tooling, agent discovery

**CI Gate Layer:**
- Purpose: Zero-dependency, self-contained pre-publish sanity check for this extracted repo
- Location: `extension-kind-gate.mjs`
- Contains: `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `runGate`, `main`
- Depends on: Node.js builtins only (`fs`, `path`) — intentionally no `@cinatra-ai/*` imports
- Used by: `.github/workflows/ci.yml` (kind-gates job), `.github/workflows/release.yml`

**CI Workflow Layer:**
- Purpose: Orchestrates build, typecheck, test, pack dry-run, and kind-specific gate steps
- Location: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Contains: GitHub Actions jobs for standalone vs. source-mirror repos
- Depends on: `extension-kind-gate.mjs`

## Data Flow

### Primary Flow (happy path)

1. Host flow invokes agent with `campaignId` → `StartNode` (`cinatra/oas.json` → `start`)
2. Execution transitions to `test_form_gate` (`InputMessageNode`) — flow pauses, waiting for user input
3. HITL renderer (`@cinatra-ai/email-test-delivery-agent:input`) displays form to user
4. User fills `recipientEmail`, `selectionMode`, optional `specificInitialDraftIds` / `specificFollowUpDraftIds`, clicks **Send**
5. Renderer server action calls `email_outreach_send_test_start` MCP primitive (in monorepo `packages/trigger-email-send`) — this does NOT advance the flow node
6. Result banner rendered inline; user may repeat step 4–5
7. User clicks **Continue** → `test_form_gate` resolves with `testResult` (JSON string: `{ userResponse, lastSendResult }`)
8. DataFlowEdge carries `testResult` to `EndNode` → agent completes, value available to downstream flow

### CI Validation Path

1. GitHub Actions triggers on push/PR to `main`
2. `build` job: classifies repo (source mirror vs. standalone), conditionally installs, typechecks, tests, runs `npm pack --dry-run`
3. `kind-gates` job (depends on `build`): runs `node extension-kind-gate.mjs --package-root .`
4. Gate reads `cinatra/oas.json`, walks LLM-visible string fields (`system`, `user`, `description`), checks for banned/retired CRM primitives and legacy type hints
5. Exit 0 = pass, exit 1 = violations reported

**State Management:**
- No persistent state within the agent itself. The Cinatra host platform holds flow execution state between the user's "Send" interactions and the final "Continue" action. `testResult` is the only output datum, carried as a JSON-encoded string through the DataFlowEdge.

## Key Abstractions

**InputMessageNode (HITL gate):**
- Purpose: Suspends flow execution at a named node until the host platform receives a structured user message
- Examples: `cinatra/oas.json` → `test_form_gate`
- Pattern: Node declares `inputMessageSchema` with `x-renderer` (identifies the React renderer component) and `x-envelope: json-string` (wraps payload as a JSON string). The renderer's server action fires side-effects (MCP calls) independently of node resolution.

**MCP Primitive (`email_outreach_send_test_start`):**
- Purpose: Canonical pathway for triggering a test email send — called by renderer server action, not the LLM
- Examples: Referenced in `skills/email-test-delivery/SKILL.md`
- Pattern: MCP primitive invoked server-side; result returned to renderer for inline display without advancing the flow node

**Extension Kind Gate:**
- Purpose: Self-contained CI guard ensuring agent OAS does not reference retired CRM primitives
- Examples: `extension-kind-gate.mjs` exports `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `runGate`
- Pattern: Zero-dependency Node.js ESM module; pure functions returning `string[]` errors; dispatches by `cinatra.kind` from `package.json`

## Entry Points

**Flow Entry Point:**
- Location: `cinatra/oas.json` → `start_node.$component_ref: "start"`
- Triggers: Cinatra host orchestrator starting the agent flow with a `campaignId` input
- Responsibilities: Validates `campaignId` is present (marked `required`), marks it `hidden` (not shown in UI), transitions to `test_form_gate`

**CI Entry Point:**
- Location: `extension-kind-gate.mjs` → `main()` function (lines 365–390)
- Triggers: `node extension-kind-gate.mjs --package-root .` in CI
- Responsibilities: Parses `--package-root` arg, dispatches to `validateAgent` or `validateWorkflow`, exits 0 or 1

## Architectural Constraints

- **No source code:** This repo ships no `src/` TypeScript — it is a content-only agent extension (flow manifest + skill doc + CI gate script). The `tsconfig.json` references `src/` but no such directory exists; typecheck is skipped in CI for source-mirror repos.
- **Source mirror pattern:** All `@cinatra-ai/*` dependencies are declared as optional `peerDependencies` — they are provided by the cinatra monorepo workspace, not installed standalone. Standalone install, typecheck, and test are skipped in CI when first-party peers are detected.
- **No LLM tool calls:** The agent contains no LLM-callable tools. The `test_form_gate` node's `riskClass: "test_send"` and `requiresApproval: false` mean the HITL gate does not need human approval to advance — only the user clicking Continue.
- **Global state:** None. No module-level singletons in this repo.
- **Circular imports:** Not applicable (no source files).

## Anti-Patterns

### Calling `email_outreach_send_test_start` from an LLM tool call

**What happens:** Routing the test-send MCP primitive through an LLM tool call rather than through the renderer server action.
**Why it's wrong:** The SKILL.md explicitly documents that the MCP primitive is "not invoked by an LLM tool call." LLM invocation bypasses the renderer's inline result banner and the re-entrant send loop.
**Do this instead:** Wire the renderer server action (the Send button handler) to call `email_outreach_send_test_start` directly. Only the Continue button should advance the flow node. See `skills/email-test-delivery/SKILL.md` for the canonical call path.

### Adding `@cinatra-ai/*` packages to `dependencies` or `devDependencies`

**What happens:** First-party packages are resolved during standalone CI install, causing registry 404 errors (they are not published to any public registry).
**Why it's wrong:** The CI gate (`ci.yml` lines 49–69) explicitly fails with exit code 2 if first-party packages appear outside `peerDependencies`.
**Do this instead:** Declare them as optional `peerDependencies` with `peerDependenciesMeta[pkg].optional: true`.

## Error Handling

**Strategy:** Errors surface through CI gate exit codes and console output; no runtime error handling within the agent itself (no source code).

**Patterns:**
- `extension-kind-gate.mjs` returns `string[]` errors from pure validator functions; `main()` prints violations and exits 1
- CI job `kind-gates` depends on `build` job; both must pass for a green check

## Cross-Cutting Concerns

**Logging:** CI-only — `console.log` / `console.error` in `extension-kind-gate.mjs` for gate results
**Validation:** OAS parse + banned-primitive scan in `extension-kind-gate.mjs`; marketplace re-validates at publish
**Authentication:** Not applicable within this repo; external auth is handled by the Cinatra platform and the MCP primitive's host environment

---

*Architecture analysis: 2026-06-09*
