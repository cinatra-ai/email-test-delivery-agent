---
name: agent-email-test-delivery
description: Sends a single test preview of an outreach campaign to a designated recipient before the real campaign launch.
---

This skill documents the test-delivery stage of an email outreach workflow. This stage sends a *test preview only* — not the real campaign batch. The actual test send is invoked via the `email_outreach_send_test_start` MCP primitive (in `packages/trigger-email-send`), called from the HITL renderer's server action — not by the LLM.

This SKILL.md exists for documentation and discovery. The runtime call path is:

  HITL renderer (form + Send button) → server action → `email_outreach_send_test_start` MCP primitive

The flow node itself is purely a re-entrant HITL gate: the user can configure a recipient, click Send (which fires the MCP without advancing the flow), inspect the inline result banner, optionally re-send, and finally click Continue to advance.

## Inputs

- `campaignId` — required, UUID of the campaign whose drafts to preview
- `recipientEmail` — collected by the renderer form (not a flow input)
- `selectionMode` — collected by the renderer form: `random_initial` | `specific_initial` | `all_initial`
- `specificInitialDraftIds` — optional, required when `selectionMode === "specific_initial"`
- `specificFollowUpDraftIds` — optional

## MCP primitive

- `email_outreach_send_test_start` — canonical test-send pathway, lives in `packages/trigger-email-send`. Called by the renderer server action; not invoked by an LLM tool call.
