# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Email Provider:**
- Gmail — the only supported send provider (documented in `README.md`)
  - SDK/Client: provided by `@cinatra-ai/email-delivery-agent` (runtime agent dependency)
  - Auth: managed by the Cinatra platform; not configured in this repo

**Cinatra Agent Platform:**
- MCP primitive `email_outreach_send_test_start` — canonical test-send pathway; lives in `packages/trigger-email-send` inside the Cinatra monorepo
  - Called by the HITL renderer's server action (not invoked by an LLM tool call)
  - Auth: internal Cinatra platform routing

## Data Storage

**Databases:**
- Not applicable — this agent holds no direct database connection. Campaign data (identified by `campaignId` UUID input) is accessed through the Cinatra platform layer, not via a direct DB client in this repo.

**File Storage:**
- Not applicable

**Caching:**
- Not applicable

## Authentication & Identity

**Auth Provider:**
- Cinatra platform — identity and Gmail OAuth credentials are managed by the host monorepo and Cinatra platform; no auth configuration exists in this repo.

## Monitoring & Observability

**Error Tracking:**
- Not detected in this repo; expected to be handled at the Cinatra platform layer.

**Logs:**
- Not detected; logging delegated to the Cinatra platform runtime.

## CI/CD & Deployment

**Hosting:**
- Cinatra marketplace / monorepo workspace (agent extension model)

**CI Pipeline:**
- GitHub Actions
  - `ci.yml` — build, typecheck, pack dry-run, and agent OAS validation gate (`extension-kind-gate.mjs`)
  - `release.yml` — release automation (contents not fully inspected)

## Environment Configuration

**Required env vars:**
- None declared in this repo directly; the Cinatra monorepo injects all necessary credentials and platform configuration at runtime.

**Secrets location:**
- No `.env` or secrets files detected in this repo.

## Webhooks & Callbacks

**Incoming:**
- Not applicable — this agent is purely a HITL flow node; it does not expose any webhook endpoints.

**Outgoing:**
- Test email send dispatched via the `email_outreach_send_test_start` MCP primitive (internal Cinatra call path: HITL renderer form → server action → MCP primitive)
  - Documented in `skills/email-test-delivery/SKILL.md`

## Flow Integration

**Agent Dependency:**
- `@cinatra-ai/email-delivery-agent` — declared as a required runtime agent dependency in `package.json` under `cinatra.dependencies`; routes test emails through the same send pipeline used by the live campaign, ensuring preview fidelity.

**Flow Nodes (defined in `cinatra/oas.json`):**
- `start` — StartNode receiving `campaignId` (UUID)
- `test_form_gate` — InputMessageNode (HITL renderer `@cinatra-ai/email-test-delivery-agent:input`); user configures recipient and selection mode, triggers test send, inspects inline result, and optionally re-sends before continuing
- `end` — EndNode emitting `testResult` (JSON-encoded `{ userResponse, lastSendResult }`)

---

*Integration audit: 2026-06-09*
