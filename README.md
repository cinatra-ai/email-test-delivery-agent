# Email Test Delivery Agent

Send a test preview of an outreach campaign to a single address before the real launch. Pick which drafts to include — one initial, a chosen handful, or every initial draft — fire the test, inspect the result inline, and re-send as many times as you need before advancing to the live campaign.

Install from the Cinatra marketplace. The agent requires one runtime dependency — `email-delivery-agent` (`^0.1.0`) — which the marketplace installer resolves automatically.

The agent surfaces a human-in-the-loop gate inside the campaign workflow. A user opens the gate, enters a recipient address, and picks a draft selection mode: `random_initial` (one randomly chosen initial draft), `specific_initial` (a named list of draft UUIDs), or `all_initial` (every initial draft). Clicking Send fires the `email_outreach_send_test_start` MCP primitive through the renderer's server action — not via an LLM tool call — and the result appears inline. The user can re-send any number of times without affecting real recipients, then click Continue to emit the `testResult` output and advance the workflow.

Configuration: a Gmail OAuth connection must be active for the workspace; no secrets or environment variables are needed. Flow input: `campaignId` (UUID, injected by the orchestrator). Flow output: `testResult` (JSON-encoded `{ userResponse, lastSendResult }`).

Troubleshooting: if no test email arrives, confirm the Gmail connection and `email-delivery-agent` version, then check the inline result banner for the error in `lastSendResult`. If `specificInitialDraftIds` is ignored, ensure `selectionMode` is `specific_initial`. If the flow does not advance, use Continue to submit — closing the panel without submitting returns to the same gate.

## Works with

- Gmail

## Capabilities

- Send a test preview of a campaign to a single chosen address before any real recipients receive it
- Choose to preview one random initial draft, a specific selection of draft UUIDs, or every initial draft
- Route the test through the same send pipeline and renderer as the live campaign for an accurate preview
- Inspect the test-send result inline via the `lastSendResult` payload before deciding whether to advance
- Re-send the test as many times as needed without affecting real recipients or consuming campaign quota
- Validate the flow spec locally with `node extension-kind-gate.mjs --package-root .` before publishing
