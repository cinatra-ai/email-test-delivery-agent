# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- JSON — agent flow definition in `cinatra/oas.json` (agentspec v26.1.0)
- Markdown — skill documentation in `skills/email-test-delivery/SKILL.md`

**Secondary:**
- TypeScript (ES2023 target, ESNext modules) — configured for future `src/` sources via `tsconfig.json`
- JavaScript (ESM) — CI gate utility `extension-kind-gate.mjs` (Node builtins only, zero external deps)

## Runtime

**Environment:**
- Node.js 24 (pinned in `.github/workflows/ci.yml`)

**Package Manager:**
- pnpm via corepack (no lockfile committed; standalone install uses `--no-frozen-lockfile`)
- `.npmrc` present (existence noted; contents not read)

## Frameworks

**Core:**
- Cinatra Agent Platform (`cinatra.ai/v1`) — the package is a `kind: agent` extension
- agentspec v26.1.0 — flow definition format used in `cinatra/oas.json`
- HITL (Human-in-the-Loop) InputMessageNode pattern — re-entrant gate node type, declared in `cinatra/oas.json`

**Testing:**
- Not applicable — no test files present; this is a source-mirror repo whose tests run inside the Cinatra monorepo

**Build/Dev:**
- TypeScript compiler (`tsc`) — invoked via corepack or npx in CI for typechecking; no bundler configured
- GitHub Actions — CI defined in `.github/workflows/ci.yml` and `.github/workflows/release.yml`

## Key Dependencies

**Critical:**
- `@cinatra-ai/email-delivery-agent` `^0.1.0` — runtime agent dependency declared in `cinatra.agentDependencies`; routes the actual test send through the same pipeline as the live campaign

**Infrastructure:**
- No npm `dependencies` or `devDependencies` declared; all Cinatra platform deps are host-internal optional peerDependencies provided by the Cinatra monorepo

## Configuration

**Environment:**
- No `.env` files detected; no runtime environment variables required by this repo directly
- Cinatra platform provides environment configuration when the agent runs inside the monorepo

**Build:**
- `tsconfig.json` — standalone strict TypeScript config targeting `src/` (no monorepo extends); outputs to `dist/`
- `package.json` — package name `@cinatra-ai/email-test-delivery-agent`, version `0.1.0`, `"type": "module"`

## Platform Requirements

**Development:**
- Node.js 24+
- corepack + pnpm
- Must be consumed inside the Cinatra monorepo for full install, typecheck, and test (standalone install is intentionally skipped in CI for source-mirror repos)

**Production:**
- Deployed as a Cinatra platform agent extension
- Requires `@cinatra-ai/email-delivery-agent` at runtime (provided by the Cinatra monorepo workspace)

---

*Stack analysis: 2026-06-09*
