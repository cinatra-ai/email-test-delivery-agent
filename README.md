# Email Test Delivery Agent

Send a test preview of an outreach campaign to a single address before the real launch. Pick the drafts to include (one random initial draft, a chosen handful, or every initial draft), check what will be sent, send the test, read the result and send again as often as you need.

Install from the Cinatra marketplace. The agent requires `email-delivery-agent` (`^0.1.0`), which the installer resolves. It needs a Cinatra version whose host offers `campaign_test_send_plan` and the publish card; on an older host the run fails at the plan step with the host's refusal and nothing is sent.

The run shows a form for the recipient and the draft selection. The form only collects your choice. The next step plans the test (nothing is sent) and the host shows its publish card: From, To, and each draft's subject and preview. The test email goes out only after a person allows it there, and exactly as the card showed it. If the person declines, or the card expires, the host stops the run and nothing is sent. A refused plan (an invalid address, no drafts, too many drafts) returns to the form with the reason. Continue ends the run with a plain sentence about the last test email.

Configuration: a Gmail connection for the run owner. Flow input: `campaignId` (UUID). Flow output: `testResult`.

## Works with

- Gmail

## Capabilities

- Send a test preview of a campaign to one chosen address before any real recipient gets it
- Preview one random initial draft, chosen drafts, or every initial draft
- Show the sender, the recipient and every draft on the host's publish card before anything is sent
- Send nothing until a person allows the card; a declined card stops the run
- Read the result of each test send on the form and send again, up to 25 times per run
- Validate the flow locally with `node extension-kind-gate.mjs --package-root .`
