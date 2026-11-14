// ---------------------------------------------------------------------------
// The test send keeps its road — zero-dependency, runs under
// `node --test tests/*.test.mjs`. cinatra-ai/cinatra#3745 (acceptance 5, the
// pack's side).
//
// The platform holds a tool that sends mail on a person's behalf for the
// person's recorded decision. One tool of this flow already reads the person's
// decision on the record it changes, and keeps that road: the host's
// `email_test_delivery_run_send`, which the step `perform_test_send` calls
// through the passthrough, after `email_test_delivery_parse_action` has read the
// person's answer at the gate. The platform pins the tool's behaviour on its own
// side; this suite pins that the pack's flow still reaches it the same way, so
// the road is not changed from this side:
//
//   1. the step and the two tool names;
//   2. the step is a plain passthrough call carrying the person's submission
//      and the run id and nothing else, with no declaration of its own about
//      the decision and no model step offering a tool in its place;
//   3. the step is reached only from the gate's "send" action, and every other
//      action goes to the closing statement and the end.
//
// These pins hold at the base: they guard it. Each test names the change that
// turns it red.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const oas = readJson("cinatra/oas.json");

const refOf = (r) => r?.$component_ref;
const steps = oas.$referenced_components;
const edges = (oas.control_flow_connections ?? []).map((e) => ({
  from: refOf(e.from_node),
  to: refOf(e.to_node),
  branch: e.from_branch,
}));
const into = (id) => edges.filter((e) => e.to === id);
const outOf = (id) => edges.filter((e) => e.from === id);
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
const BRANCH = "branch_on_action";
const SEND = "perform_test_send";
const SUMMARY = "test_summary";
const PASSTHROUGH = /\/api\/agents\/passthrough$/;

test("the send step calls the host's run-send tool through the passthrough (red: another tool name or url on the step)", () => {
  const step = steps[SEND];
  assert.equal(step.component_type, "ApiNode");
  assert.match(step.url, PASSTHROUGH);
  assert.equal(step.http_method, "POST");
  assert.equal(step.data.tool, "email_test_delivery_run_send");
  assert.equal(step.data.result_shape, "test_delivery_send");
});

test("the answer is read by the host's parse tool before the send (red: another tool name or url on the step)", () => {
  const step = steps[PARSE];
  assert.equal(step.component_type, "ApiNode");
  assert.match(step.url, PASSTHROUGH);
  assert.equal(step.data.tool, "email_test_delivery_parse_action");
  assert.equal(step.metadata.cinatra.riskClass, "read_only");
});

test("the send step carries the person's submission and the run id and nothing else (red: another key in the step's input, or another source for the envelope)", () => {
  const step = steps[SEND];
  assert.deepEqual(Object.keys(step.data.input), ["envelopeJson"]);
  assert.equal(step.data.input.envelopeJson, "{{ envelopeJson }}");
  assert.equal(step.data.agent_run_id, "{{ cinatra_run_id }}");
  const sources = (oas.data_flow_connections ?? [])
    .filter((e) => refOf(e.destination_node) === SEND && e.destination_input === "envelopeJson")
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  assert.deepEqual(sources, [`${GATE}.testResult`], "the envelope comes from somewhere else than the gate's answer");
});

test("the step declares nothing about the decision and is the only write step (red: a risk class, an approval flag or a tool list added to the step)", () => {
  const meta = steps[SEND].metadata.cinatra;
  assert.deepEqual(meta, {
    riskClass: "write",
    requiresApproval: false,
    packageName: "@cinatra-ai/email-test-delivery-agent",
  });
  const writing = Object.entries(steps)
    .filter(([, c]) => c?.metadata?.cinatra?.riskClass === "write")
    .map(([id]) => id);
  assert.deepEqual(writing, [SEND]);
});

test("the passthrough tools of the flow are these two and no model step offers a tool in their place (red: a third tool, or a model-bridge step)", () => {
  const tools = Object.values(steps)
    .filter((c) => c?.component_type === "ApiNode" && PASSTHROUGH.test(c.url ?? ""))
    .map((c) => c.data.tool)
    .sort();
  assert.deepEqual(tools, ["email_test_delivery_parse_action", "email_test_delivery_run_send"]);
  const bridge = Object.values(steps).filter((c) => c?.component_type === "ApiNode" && /\/api\/llm-bridge$/.test(c.url ?? ""));
  assert.deepEqual(bridge, []);
});

test("the send step is reached only from the gate's send action (red: an edge into the send step from any other step or branch)", () => {
  assert.deepEqual(into(SEND).map((e) => `${e.from}:${e.branch}`), [`${BRANCH}:send`]);
  assert.deepEqual(into(BRANCH).map((e) => e.from), [PARSE]);
  assert.deepEqual(into(PARSE).map((e) => e.from), [GATE]);
  assert.deepEqual(steps[BRANCH].mapping, { send: "send" });
  assert.deepEqual([...steps[BRANCH].branches].sort(), ["default", "send"]);
  assert.ok(reach().has(SEND), "the send step is not reachable at all");
  assert.equal(reach(GATE).has(SEND), false, "the send step is reachable around the gate");
});

test("every other action leaves by the closing statement to the end (red: a second edge out of the branch, or a default edge into the send step)", () => {
  const out = outOf(BRANCH).map((e) => `${e.branch}>${e.to}`).sort();
  assert.deepEqual(out, [`default>${SUMMARY}`, `send>${SEND}`]);
  assert.deepEqual(outOf(SUMMARY).map((e) => e.to), ["end"]);
  const action = steps[GATE].metadata.cinatra.inputMessageSchema["x-envelope-shape"].action;
  assert.deepEqual(action.enum, ["send", "continue"]);
});

test("the send returns to the gate, which stays re-entrant and bounded (red: another gate, or no bound on its visits)", () => {
  assert.deepEqual(outOf(SEND).map((e) => e.to), [GATE]);
  assert.equal(oas.metadata.cinatra.reentrantGate, GATE);
  assert.equal(steps[GATE].metadata.cinatra.maxGateVisits, 25);
  assert.equal(steps[GATE].metadata.cinatra.requiresApproval, true);
  assert.equal(Object.values(steps).filter((c) => c?.component_type === "InputMessageNode").length, 1);
});
