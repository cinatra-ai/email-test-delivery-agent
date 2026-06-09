# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
email-test-delivery-agent/       # repo root
├── cinatra/                     # Cinatra platform manifests
│   └── oas.json                 # Flow definition (agentspec v26.1.0)
├── skills/                      # Skill documentation packages
│   └── email-test-delivery/     # Skill directory
│       └── SKILL.md             # Human/LLM-readable skill contract
├── .github/                     # GitHub Actions CI/CD
│   └── workflows/
│       ├── ci.yml               # Main CI (build, typecheck, test, kind-gate)
│       └── release.yml          # Release workflow
├── .planning/                   # GSD planning artifacts (not shipped)
│   └── codebase/                # Codebase map documents
├── extension-kind-gate.mjs      # Self-contained CI validation script (ESM)
├── package.json                 # npm manifest with cinatra metadata
├── tsconfig.json                # TypeScript config (targets src/ — not present)
├── .npmrc                       # npm/pnpm registry configuration
├── LICENSE                      # Apache-2.0
└── README.md                    # Project readme
```

## Directory Purposes

**`cinatra/`:**
- Purpose: Platform-facing manifests consumed by the Cinatra orchestrator and marketplace
- Contains: `oas.json` — the sole flow definition for this agent
- Key files: `cinatra/oas.json`

**`skills/email-test-delivery/`:**
- Purpose: Skill documentation package for agent discovery and developer reference
- Contains: `SKILL.md` describing inputs, the MCP primitive, and the runtime call path
- Key files: `skills/email-test-delivery/SKILL.md`

**`.github/workflows/`:**
- Purpose: CI/CD pipeline definitions
- Contains: `ci.yml` (build + kind-gate jobs), `release.yml` (release automation)
- Key files: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents written by the gsd-map-codebase command
- Contains: ARCHITECTURE.md, STRUCTURE.md
- Generated: Yes (by GSD tooling)
- Committed: No (planning artifact)

## Key File Locations

**Flow Definition (entry point):**
- `cinatra/oas.json`: Full agent flow graph — StartNode, InputMessageNode (HITL gate), EndNode, control/data flow edges, inputMessageSchema, renderer binding

**Skill Contract:**
- `skills/email-test-delivery/SKILL.md`: Documents inputs, MCP primitive (`email_outreach_send_test_start`), runtime call path, and re-entrant HITL pattern

**CI Gate Script:**
- `extension-kind-gate.mjs`: Zero-dependency ESM script; exports `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`; entry point is `main()` at line 365

**Package Manifest:**
- `package.json`: Declares `cinatra.kind: "agent"`, `cinatra.apiVersion`, and runtime dependency on `@cinatra-ai/email-delivery-agent` via `cinatra.dependencies`

**TypeScript Config:**
- `tsconfig.json`: Standalone strict config targeting `src/` (directory does not exist — this repo ships no TS source; config is present for monorepo compatibility)

## Naming Conventions

**Files:**
- Cinatra manifests: `cinatra/<type>.json` (e.g., `oas.json` for agents, `workflow.bpmn` for workflows)
- Skill docs: `skills/<skill-slug>/SKILL.md`
- CI scripts: `<purpose>.mjs` (e.g., `extension-kind-gate.mjs`)
- GitHub Actions: `.github/workflows/<name>.yml`

**Directories:**
- Skill directories: kebab-case matching the skill slug (e.g., `email-test-delivery`)
- Package name pattern: `@cinatra-ai/<slug>-agent` (e.g., `@cinatra-ai/email-test-delivery-agent`)

**Node IDs in OAS:**
- snake_case node IDs (e.g., `test_form_gate`, `start`, `end`)
- Edge names: `<from>_to_<to>` or `<from>_to_<to>_<output>` (e.g., `start_to_test_form_gate`, `test_form_gate_to_end_testResult`)

## Where to Add New Code

**New flow node (add a step to the HITL sequence):**
- Add node definition to `cinatra/oas.json` → `$referenced_components`
- Add node ref to `cinatra/oas.json` → `nodes` array
- Wire control-flow edges in `control_flow_connections`
- Wire data-flow edges in `data_flow_connections` if output propagation needed

**New skill documentation:**
- Create `skills/<new-slug>/SKILL.md` following the frontmatter + sections pattern in `skills/email-test-delivery/SKILL.md`

**New TypeScript source (if this repo ever gains implementation code):**
- Place under `src/` (per `tsconfig.json` `rootDir: "src"`)
- Output goes to `dist/` (per `tsconfig.json` `outDir: "dist"`)
- Export from an `index.ts` barrel

**New CI validation rule:**
- Add to `extension-kind-gate.mjs` — extend `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, or add a new export function following the pure `string[]`-return pattern

## Special Directories

**`cinatra/`:**
- Purpose: Consumed by the Cinatra marketplace and orchestrator at publish/runtime
- Generated: No (hand-authored or extraction-script-generated)
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning artifacts (codebase maps, phase plans)
- Generated: Yes (by GSD tooling)
- Committed: No

**`node_modules/`** (not present):
- Purpose: Would hold resolved dependencies if installed standalone
- Note: This repo is a source mirror; `@cinatra-ai/*` peers are not installable standalone

---

*Structure analysis: 2026-06-09*
