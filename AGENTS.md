# email-test-delivery-agent — AGENTS.md

Agent-specific guidance for `@cinatra-ai/email-test-delivery-agent`. This agent has no LLM prompt node; the stage below is implemented declaratively in `cinatra/oas.json`. It carried a bundled SKILL.md until cinatra#2090 — agent extensions no longer ship skill bundles, so the documentation lives here.

## Test-delivery stage

This stage sends a *test preview only*, not the real campaign batch. Since cinatra#4150 nothing is sent before a person approved the send on the host's publish card; the pack carries no approval of its own. The run path is:

  `test_form_gate` (form, input only) → `parse_action` (`email_test_delivery_parse_action`) → `branch_on_action` → `plan_test_send` (`campaign_test_send_plan`, sends nothing) → `branch_on_plan` → host publish card → `perform_test_send` (`email_test_delivery_run_send` with `{planJson}`) → back to `test_form_gate`

- `branch_on_action`: `send` goes to the plan step; every other action (`continue`, `halt`) goes to `test_summary` and the end.
- `branch_on_plan` on the plan's `ok`: `true` goes to the send step; `false` (a refusal the host recorded) goes back to the form with `lastSendResult` and `gateCycle`; an answer with no `ok` (a host fault) goes to `test_summary`, which says the test send could not be prepared.
- `perform_test_send` declares `publishes: true` and three `publishRows`: From (`sender`), To (`recipient`) and Drafts (`drafts`, columns `subject` and `preview`). Its inputs `sender`, `recipient`, `drafts` and `planJson` come straight from `plan_test_send`. The host stops the run in front of it and shows the card; on approval the step sends exactly `planJson`; on a decline or an expiry the host stops the run.
- The form's defaults (`defaultRecipientEmail`, `defaultSelectionMode`, `defaultSpecificInitialDraftIds`, `defaultSpecificFollowUpDraftIds`) come from `parse_action`'s parsed submission, so the form shows what the person submitted on every road back to it: after a refused plan and after a send.
- A host without `campaign_test_send_plan` refuses the plan call; the run fails at `plan_test_send` and nothing is sent. There is no fall back to the earlier send shape.

## Inputs

- `campaignId` — required, UUID of the campaign whose drafts to preview
- `recipientEmail`, `selectionMode` (`random_initial` | `specific_initial` | `all_initial`), `specificInitialDraftIds`, `specificFollowUpDraftIds` — collected by the form's renderer into its `testResult` envelope, not flow inputs
