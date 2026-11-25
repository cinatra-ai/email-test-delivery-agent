// ---------------------------------------------------------------------------
// The test send waits on the host's publish card - zero-dependency, runs under
// `node --test tests/*.test.mjs`. cinatra-ai/cinatra#4150 (the pack's side).
//
// A run must not mail anything before a person approved it on the host's
// publish card, and no pack carries an approval of its own. The flow does its
// part as follows:
//
//   1. The form step only collects input: it declares no approval and no risk
//      class, and its words say that the next step shows what will be sent.
//   2. A plan step calls the host's `campaign_test_send_plan`, which sends
//      nothing and answers the sender, the recipient, the drafts and the pinned
//      plan. A branch on its `ok` answer: `false` goes back to the form with
//      the recorded refusal, `true` goes on to the send step, and an answer
//      with no `ok` (a host fault) ends the run with a plain sentence.
//   3. The send step is the flow's one publishing step. The host stops the run
//      in front of it and shows its publish card with exactly three rows: From
//      (sender), To (recipient) and Drafts (drafts, with the columns subject
//      and preview). Its inputs come straight from the plan step, and its call
//      sends only the plan (`planJson`).
//   4. A model-free walk of the flow against stubbed host answers shows the
//      paths: a refused plan returns to the form and sends nothing; an
//      approved card sends exactly the plan; a declined card stops the run and
//      sends nothing; a host without the plan tool fails the run at the plan
//      step and sends nothing.
//
// Each test names the change that turns it red.
//
// Known limits
//   - The walk below re-states the runtime's rules as this suite reads them
//     (data edges push a step's outputs to their destinations; a branch input
//     that is not text is cast to its JSON text; a missing value takes the
//     input's default). It is not the runtime.
//   - The stop in front of the publishing step, the card and the check of the
//     released decision are the host's (cinatra#4809); the walk only stands in
//     for them by name.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const oas = readJson("cinatra/oas.json");
const pkg = readJson("package.json");

const isName = (v) => typeof v === "string" && v !== "";
const refOf = (r) => (isName(r?.$component_ref) ? r.$component_ref : undefined);
const steps = Object.assign(Object.create(null), oas.$referenced_components ?? {});
const edges = (oas.control_flow_connections ?? []).map((e) => ({
  from: refOf(e.from_node),
  to: refOf(e.to_node),
  branch: e.from_branch,
}));
const dataEdges = (oas.data_flow_connections ?? []).map((e) => ({
  from: refOf(e.source_node),
  out: e.source_output,
  to: refOf(e.destination_node),
  inp: e.destination_input,
}));
const into = (id) => edges.filter((e) => e.to === id);
const outOf = (id) => edges.filter((e) => e.from === id);
const sourcesOf = (to, inp) => dataEdges.filter((e) => e.to === to && e.inp === inp).map((e) => `${e.from}.${e.out}`);
function reach(without = null) {
  const seen = new Set();
  const todo = [refOf(oas.start_node)];
  while (todo.length) {
    const id = todo.pop();
    if (id === without || seen.has(id)) continue;
    seen.add(id);
    for (const e of outOf(id)) todo.push(e.to);
  }
  return seen;
}

const GATE = "test_form_gate";
const PARSE = "parse_action";
const ACTION_BRANCH = "branch_on_action";
const PLAN = "plan_test_send";
const PLAN_BRANCH = "branch_on_plan";
const SEND = "perform_test_send";
const SUMMARY = "test_summary";
const PASSTHROUGH = "{{CINATRA_BASE_URL}}/api/agents/passthrough";
const PLAN_TOOL = "campaign_test_send_plan";
const SEND_TOOL = "email_test_delivery_run_send";
const PLAN_OUTPUTS = ["ok", "sender", "recipient", "drafts", "draftCount", "planJson", "lastSendResult", "gateCycle"];
const CARD_INPUTS = ["sender", "recipient", "drafts", "planJson"];

// The branch of PLAN_BRANCH whose edge leads to `to`, read from the mapping.
const branchKeysTo = (to) => {
  const branch = steps[PLAN_BRANCH];
  const names = outOf(PLAN_BRANCH).filter((e) => e.to === to).map((e) => e.branch);
  return Object.entries(branch?.mapping ?? {}).filter(([, name]) => names.includes(name)).map(([key]) => key);
};

// ---------------------------------------------------------------------------
// (1) the form only collects input
// ---------------------------------------------------------------------------

test("the form step declares no approval and no risk class (red: requiresApproval or riskClass on the form, or the manifest claiming a gate)", () => {
  const cin = steps[GATE].metadata.cinatra;
  assert.equal(Object.hasOwn(cin, "requiresApproval"), false, "the form declares an approval of its own");
  assert.equal(Object.hasOwn(cin, "riskClass"), false, "the form declares a risk class");
  const approving = Object.values(steps).filter((c) => c?.metadata?.cinatra?.requiresApproval === true).map((c) => c.id);
  assert.deepEqual(approving, [], "a step of the flow carries its own approval");
  assert.equal(pkg.cinatra.hasApprovalGates, false, "the manifest claims an approval gate the flow does not have");
});

test("the form's words say the next step shows what will be sent, and never that pressing it sends (red: a name or description that says it sends)", () => {
  const gate = steps[GATE];
  const words = [gate.name, gate.metadata.cinatra.description, gate.metadata.cinatra.inputMessageSchema?.properties?.testResult?.title]
    .filter((w) => typeof w === "string")
    .join(" \n ");
  assert.ok(isName(gate.metadata.cinatra.description), "the form says nothing about what happens next");
  assert.match(gate.metadata.cinatra.description, /next step shows what will be sent/i);
  assert.doesNotMatch(gate.name, /\bsend\b/i, "the form's name says it sends");
  assert.doesNotMatch(words, /\b(?:sends|is sent|fires|send the test now)\b/i, "the form's words say that pressing it sends");
});

// ---------------------------------------------------------------------------
// (2) the plan step and its branch
// ---------------------------------------------------------------------------

test("the plan step calls the host's plan tool with the person's submission and declares the plan's answers (red: another tool, input, key or output)", () => {
  const plan = steps[PLAN];
  assert.ok(plan, "the flow has no plan step");
  assert.ok((oas.nodes ?? []).some((n) => refOf(n) === PLAN), "the plan step is not a node of the flow");
  assert.equal(plan.component_type, "ApiNode");
  assert.equal(plan.url, PASSTHROUGH);
  assert.equal(plan.http_method, "POST");
  assert.deepEqual(plan.data, {
    tool: PLAN_TOOL,
    input: { envelopeJson: "{{ envelopeJson }}" },
    agent_run_id: "{{ cinatra_run_id }}",
    result_shape: "test_delivery_send",
  });
  assert.deepEqual(sourcesOf(PLAN, "envelopeJson"), [`${GATE}.testResult`]);
  assert.deepEqual(sourcesOf(PLAN, "cinatra_run_id"), ["start.cinatra_run_id"]);
  assert.deepEqual(plan.outputs.map((o) => o.title), PLAN_OUTPUTS);
  assert.equal(plan.outputs.find((o) => o.title === "ok").type, "boolean");
  assert.equal(plan.metadata.cinatra.publishes, false, "the plan step does not say that it publishes nothing");
  assert.equal(plan.metadata.cinatra.requiresApproval, false);
});

test("the plan branch reads only the plan's ok: true goes to the send step, false back to the form, anything else to the closing statement (red: another source, mapping or edge)", () => {
  const branch = steps[PLAN_BRANCH];
  assert.equal(branch?.component_type, "BranchingNode");
  assert.deepEqual(branch.inputs.map((p) => p.title), ["ok"]);
  assert.deepEqual(sourcesOf(PLAN_BRANCH, "ok"), [`${PLAN}.ok`]);
  assert.deepEqual(into(PLAN_BRANCH).map((e) => e.from), [PLAN]);
  assert.deepEqual(outOf(PLAN).map((e) => e.to), [PLAN_BRANCH], "the plan step leads somewhere else than its branch");
  assert.deepEqual(branchKeysTo(SEND), ["true"]);
  assert.deepEqual(branchKeysTo(GATE), ["false"]);
  assert.deepEqual(outOf(PLAN_BRANCH).filter((e) => e.branch === "default").map((e) => e.to), [SUMMARY]);
  assert.equal(outOf(PLAN_BRANCH).length, 3);
  assert.deepEqual(sourcesOf(GATE, "lastSendResult").sort(), [`${PLAN}.lastSendResult`, `${SEND}.lastSendResult`].sort());
  assert.deepEqual(sourcesOf(GATE, "gateCycle").sort(), [`${PLAN}.gateCycle`, `${SEND}.gateCycle`].sort());
});

test("no path reaches the send step without passing the plan step and its ok branch (red: an edge into the send step from anywhere else)", () => {
  assert.deepEqual(into(SEND).map((e) => `${e.from}:${e.branch}`), [`${PLAN_BRANCH}:${steps[PLAN_BRANCH].mapping.true}`]);
  assert.deepEqual(into(PLAN).map((e) => `${e.from}:${e.branch}`), [`${ACTION_BRANCH}:send`]);
  assert.ok(reach().has(SEND), "the send step is not reachable at all");
  assert.equal(reach(PLAN).has(SEND), false, "the send step is reachable around the plan step");
  assert.equal(reach(PLAN_BRANCH).has(SEND), false, "the send step is reachable around the plan branch");
  assert.equal(reach(GATE).has(PLAN), false, "the plan step is reachable around the form");
});

// ---------------------------------------------------------------------------
// (3) the send step is the publishing step with the card the host requires
// ---------------------------------------------------------------------------

test("the send step is the flow's one publishing step, with exactly the three card rows (red: another row, label, column, input, or a second publishing step)", () => {
  const cin = steps[SEND].metadata.cinatra;
  assert.equal(cin.publishes, true);
  assert.equal(cin.requiresApproval, false, "the send step asks for an approval of its own beside the publish card");
  assert.deepEqual(cin.publishRows, [
    { label: "From", input: "sender" },
    { label: "To", input: "recipient" },
    {
      kind: "list",
      label: "Drafts",
      input: "drafts",
      columns: [
        { label: "Subject", field: "subject" },
        { label: "Preview", field: "preview" },
      ],
    },
  ]);
  const publishing = Object.values(steps).filter((c) => c?.metadata?.cinatra?.publishes === true).map((c) => c.id);
  assert.deepEqual(publishing, [SEND]);
  assert.ok((oas.nodes ?? []).some((n) => refOf(n) === SEND), "the publishing step is not a top-level node");
  const rowsElsewhere = Object.values(steps).filter((c) => c !== steps[SEND] && Object.hasOwn(c?.metadata?.cinatra ?? {}, "publishRows"));
  assert.deepEqual(rowsElsewhere, []);
});

test("the send step's card values come straight from the plan step, unchanged (red: another source, a second source, a default or a reshaping step)", () => {
  const send = steps[SEND];
  assert.deepEqual(send.inputs.map((p) => p.title).sort(), ["cinatra_run_id", ...CARD_INPUTS].sort());
  for (const title of CARD_INPUTS) {
    assert.deepEqual(sourcesOf(SEND, title), [`${PLAN}.${title}`], `${title} comes from somewhere else than the plan`);
    const port = send.inputs.find((p) => p.title === title);
    assert.equal(Object.hasOwn(port, "default"), false, `${title} has a default, so a card could show a value the plan did not answer`);
    assert.equal(port.type, steps[PLAN].outputs.find((o) => o.title === title).type, `${title} is declared with another type than the plan answers`);
  }
  assert.deepEqual(sourcesOf(SEND, "cinatra_run_id"), ["start.cinatra_run_id"]);
});

test("the send step's call sends only the plan (red: an envelope, a selection field, another tool or result shape)", () => {
  const send = steps[SEND];
  assert.equal(send.url, PASSTHROUGH);
  assert.equal(send.http_method, "POST");
  assert.deepEqual(Object.keys(send.data).sort(), ["agent_run_id", "input", "result_shape", "tool"]);
  assert.equal(send.data.tool, SEND_TOOL);
  assert.equal(send.data.result_shape, "test_delivery_send");
  assert.equal(send.data.agent_run_id, "{{ cinatra_run_id }}");
  assert.deepEqual(Object.keys(send.data.input), ["planJson"]);
  assert.match(send.data.input.planJson, /\{\{ planJson \}\}$/);
  assert.equal(send.data.input.planJson.replace(/^\{#[\s\S]*?#\}/, ""), "{{ planJson }}");
  assert.deepEqual(sourcesOf(SEND, "envelopeJson"), [], "the send still takes the form's envelope");
});

test("the loop: the send returns to the form, which stays the one bounded re-entrant pause (red: another return, or no bound)", () => {
  assert.deepEqual(outOf(SEND).map((e) => e.to), [GATE]);
  assert.equal(oas.metadata.cinatra.reentrantGate, GATE);
  assert.equal(steps[GATE].metadata.cinatra.maxGateVisits, 25);
  assert.equal(Object.values(steps).filter((c) => c.component_type === "InputMessageNode").length, 1);
  assert.deepEqual(into(PARSE).map((e) => e.from), [GATE]);
  assert.deepEqual(outOf(ACTION_BRANCH).map((e) => `${e.branch}>${e.to}`).sort(), [`default>${SUMMARY}`, `send>${PLAN}`]);
});

// ---------------------------------------------------------------------------
// (4) a model-free walk of the flow against stubbed host answers
// ---------------------------------------------------------------------------

const PLAN_JSON = JSON.stringify({ v: 1, campaignId: "c-1", sender: { email: "owner@example.com", name: "Owner" }, recipientEmail: "tester@example.com", drafts: [{ id: "d-1", revision: "a".repeat(64) }] });
const PLAN_OK = {
  ok: true,
  sender: "Owner <owner@example.com>",
  recipient: "tester@example.com",
  drafts: [{ subject: "Hello", preview: "Hi there", draftId: "d-1", revision: "a".repeat(64) }],
  draftCount: 1,
  planJson: PLAN_JSON,
  lastSendResult: null,
  gateCycle: 0,
};
const PLAN_REFUSED = {
  ok: false, reason: "invalid_recipient", message: "Enter a valid recipient email address for the test send.", seq: 3,
  sender: "", recipient: "", drafts: [], draftCount: 0, planJson: "",
  lastSendResult: { ok: false, message: "Enter a valid recipient email address for the test send." }, gateCycle: 3,
};
const SENT = { lastSendResult: { ok: true, message: "Test email sent to tester@example.com.", sentTo: "tester@example.com" }, gateCycle: 4, recipientEmail: "tester@example.com", selectionMode: "random_initial", specificInitialDraftIds: [], specificFollowUpDraftIds: [] };
const envelope = (action) => JSON.stringify({ action, recipientEmail: "tester@example.com", selectionMode: "random_initial" });

/** Render a call's data the way the passthrough body is built: each "{{ name }}" is the step's input, a leading
 *  {# #} comment is dropped. */
function render(value, inputs) {
  if (typeof value === "string") {
    return value.replace(/^\{#[\s\S]*?#\}/, "").replace(/\{\{ ?([A-Za-z_][A-Za-z0-9_]*) ?\}\}/g, (_, k) => {
      const v = inputs[k];
      return typeof v === "string" ? v : JSON.stringify(v ?? "");
    });
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, inputs)]));
  return value;
}

/**
 * Walk the flow from its start. `answers` lists the form's submissions in order (the run pauses for good when they
 * run out); `host(tool, body)` answers a passthrough call or throws (an HTTP refusal fails the run); `decide(surfaced)`
 * answers the publish card in front of a publishing step with "approve" or "decline".
 */
function walk({ answers, host, decide }) {
  const io = new Map();
  const calls = [];
  const cards = [];
  let gateVisits = 0;
  const inputsOf = (id) => {
    const node = steps[id];
    const ports = node.component_type === "EndNode" ? node.outputs ?? [] : node.inputs ?? [];
    return Object.fromEntries(ports.map((p) => [p.title, io.has(`${id}.${p.title}`) ? io.get(`${id}.${p.title}`) : p.default]));
  };
  const push = (id, outputs) => {
    for (const e of dataEdges) if (e.from === id) io.set(`${e.to}.${e.inp}`, outputs[e.out] ?? null);
  };
  let id = refOf(oas.start_node);
  for (let n = 0; n < 200; n += 1) {
    const node = steps[id];
    const inputs = inputsOf(id);
    let branch;
    switch (node.component_type) {
      case "StartNode":
        push(id, { campaignId: "c-1", cinatra_run_id: "run-1" });
        break;
      case "InputMessageNode": {
        if (gateVisits >= answers.length) return { ended: "paused", at: id, calls, cards, inputs, io };
        push(id, { testResult: answers[gateVisits] });
        gateVisits += 1;
        break;
      }
      case "ApiNode": {
        if (node.metadata?.cinatra?.publishes === true) {
          const surfaced = Object.fromEntries(
            dataEdges.filter((e) => e.to === id).map((e) => [e.inp, io.get(`${id}.${e.inp}`)]),
          );
          cards.push({ rows: node.metadata.cinatra.publishRows, surfaced });
          if (decide(surfaced) !== "approve") return { ended: "stopped", at: id, calls, cards, io };
        }
        const body = render(node.data, inputs);
        calls.push(body);
        let answer;
        try {
          answer = host(body.tool, body);
        } catch (err) {
          return { ended: "failed", at: id, error: String(err.message), calls, cards, io };
        }
        push(id, Object.fromEntries(node.outputs.map((o) => [o.title, answer?.[o.title] ?? null])));
        break;
      }
      case "BranchingNode": {
        const raw = inputs[node.inputs[0].title];
        const key = raw === null || raw === undefined ? null : typeof raw === "string" ? raw : JSON.stringify(raw);
        branch = key !== null && Object.hasOwn(node.mapping, key) ? node.mapping[key] : "default";
        break;
      }
      case "OutputMessageNode":
        io.set("closing", inputs);
        break;
      case "EndNode":
        return { ended: "completed", at: id, calls, cards, io };
      default:
        throw new Error(`the walk does not read a ${node.component_type}`);
    }
    const next = outOf(id).filter((e) => (branch === undefined ? true : e.branch === branch));
    assert.equal(next.length, 1, `${id} has ${next.length} ways on`);
    id = next[0].to;
  }
  throw new Error("the walk did not end");
}

const hostWith = (planAnswer) => (tool, body) => {
  if (tool === "email_test_delivery_parse_action") return { action: JSON.parse(body.input.userResponse).action };
  if (tool === PLAN_TOOL) return typeof planAnswer === "function" ? planAnswer(body) : planAnswer;
  if (tool === SEND_TOOL) return SENT;
  throw new Error(`unexpected tool ${tool}`);
};

test("walk: a refused plan goes back to the form with its recorded result, and nothing is sent (red: the refusal reaching the send step or the end)", () => {
  const run = walk({ answers: [envelope("send")], host: hostWith(PLAN_REFUSED), decide: () => "approve" });
  assert.equal(run.ended, "paused");
  assert.equal(run.at, GATE);
  assert.deepEqual(run.calls.map((c) => c.tool), ["email_test_delivery_parse_action", PLAN_TOOL]);
  assert.deepEqual(run.cards, [], "a refused plan reached the publish card");
  assert.deepEqual(run.inputs.lastSendResult, PLAN_REFUSED.lastSendResult);
  assert.equal(run.inputs.gateCycle, 3);
});

test("walk: an approved card sends exactly the plan the card showed, then returns to the form (red: the send carrying anything but planJson, or the card showing another value)", () => {
  const run = walk({ answers: [envelope("send")], host: hostWith(PLAN_OK), decide: () => "approve" });
  assert.equal(run.ended, "paused");
  assert.equal(run.at, GATE);
  assert.deepEqual(run.calls.map((c) => c.tool), ["email_test_delivery_parse_action", PLAN_TOOL, SEND_TOOL]);
  assert.deepEqual(run.calls[1].input, { envelopeJson: envelope("send") });
  assert.deepEqual(run.calls[2].input, { planJson: PLAN_JSON });
  assert.equal(run.cards.length, 1);
  const { surfaced } = run.cards[0];
  for (const title of CARD_INPUTS) assert.deepEqual(surfaced[title], PLAN_OK[title], `the card shows another ${title} than the plan answered`);
  assert.deepEqual(run.inputs.lastSendResult, SENT.lastSendResult);
});

test("walk: a declined card stops the run and nothing is sent (red: the send step running after a decline)", () => {
  const run = walk({ answers: [envelope("send")], host: hostWith(PLAN_OK), decide: () => "decline" });
  assert.equal(run.ended, "stopped");
  assert.equal(run.at, SEND);
  assert.equal(run.calls.some((c) => c.tool === SEND_TOOL), false);
});

test("walk: a host without the plan tool fails the run at the plan step and nothing is sent (red: a fall back to the old send)", () => {
  const run = walk({
    answers: [envelope("send")],
    host: hostWith(() => {
      throw new Error(`403 Tool "${PLAN_TOOL}" is not on the deterministic-passthrough allowlist.`);
    }),
    decide: () => "approve",
  });
  assert.equal(run.ended, "failed");
  assert.equal(run.at, PLAN);
  assert.match(run.error, /campaign_test_send_plan/);
  assert.equal(run.calls.some((c) => c.tool === SEND_TOOL), false);
});

test("walk: a plan answer with no ok (a host fault) ends the run with the closing statement and sends nothing (red: a silent return to the form, or a send)", () => {
  const run = walk({ answers: [envelope("send")], host: hostWith({ error: "Test delivery plan failed" }), decide: () => "approve" });
  assert.equal(run.ended, "completed");
  assert.equal(run.calls.some((c) => c.tool === SEND_TOOL), false);
  assert.equal(run.io.get("closing").action, "send");
  assert.match(steps[SUMMARY].message, /\{% if action == 'send' %\}[^{]*could not be prepared/);
});

test("walk: continue ends the run through the closing statement without a plan or a send", () => {
  const run = walk({ answers: [envelope("continue")], host: hostWith(PLAN_OK), decide: () => "approve" });
  assert.equal(run.ended, "completed");
  assert.deepEqual(run.calls.map((c) => c.tool), ["email_test_delivery_parse_action"]);
});
