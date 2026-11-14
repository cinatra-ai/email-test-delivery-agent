// ---------------------------------------------------------------------------
// The test send keeps its road - zero-dependency, runs under
// `node --test tests/*.test.mjs`. cinatra-ai/cinatra#3745 (the pack's side).
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
//   1. the flow is a well-formed flat graph (every node has its component,
//      every edge ends at a node, every data edge names declared ports), so the
//      reading below is of the graph the flow really has;
//   2. the step and the parse step: exact url, tool names and keys, and the
//      data roads that feed them (the person's answer into the parse step and
//      into the send step, the parsed action into the branch, the run id into
//      both);
//   3. the step is reached only from the gate's "send" action, and every other
//      action goes to the closing statement and the end.
//
// The pins hold at the base: they guard it. Each test names the change that
// turns it red.
//
// Known limits
//   - The flow is read as its root flow. It has no nested flow today; a Flow or
//     FlowNode component, or any component kind not listed in this suite, fails
//     the well-formed test, so a flow-wide claim below is never made over a
//     nested flow this suite did not read.
//   - The pins are of the flow and its names. The host's own check of the
//     person's decision is the platform's pin, not proved here.
//   - Keys of the step outside the ones this suite lists are not allowed; a
//     harmless change to one of them is a change of this suite.
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
const nodeIds = (oas.nodes ?? []).map(refOf);
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
/** The sources feeding one input of one step, as "step.output". */
const sourcesOf = (to, inp) =>
  dataEdges.filter((e) => e.to === to && e.inp === inp).map((e) => `${e.from}.${e.out}`);

const GATE = "test_form_gate";
const PARSE = "parse_action";
const BRANCH = "branch_on_action";
const SEND = "perform_test_send";
const SUMMARY = "test_summary";
const PASSTHROUGH = "{{CINATRA_BASE_URL}}/api/agents/passthrough";
const KINDS = ["ApiNode", "BranchingNode", "EndNode", "InputMessageNode", "OutputMessageNode", "StartNode"];

// The ports a step declares: a start node's inputs are what it hands on, an end
// node's outputs are what it takes in.
const outputsOf = (c) => (c.component_type === "StartNode" ? c.inputs : c.outputs ?? []).map((p) => p.title);
const inputsOf = (c) => (c.component_type === "EndNode" ? c.outputs : c.inputs ?? []).map((p) => p.title);

test("the flow is a well-formed flat graph (red: a node with no component, a component that is not a node, an edge to nowhere, a port that is not declared, a nested flow or another component kind)", () => {
  assert.deepEqual([...nodeIds].sort(), Object.keys(steps).sort(), "a component is not a node of the flow, or a node has no component");
  assert.equal(new Set(nodeIds).size, nodeIds.length, "a node is listed twice");
  for (const [key, c] of Object.entries(steps)) {
    assert.equal(c.id, key, `${key} is stored under another id`);
    assert.ok(KINDS.includes(c.component_type), `${key} is a ${c.component_type}, which this suite does not read`);
  }
  assert.ok(nodeIds.includes(refOf(oas.start_node)), "the start node is not a node of the flow");
  for (const e of edges) assert.ok(nodeIds.includes(e.from) && nodeIds.includes(e.to), `a control edge has an end that is not a node: ${e.from} -> ${e.to}`);
  for (const e of dataEdges) {
    assert.ok(nodeIds.includes(e.from) && nodeIds.includes(e.to), `a data edge has an end that is not a node: ${e.from} -> ${e.to}`);
    assert.ok(outputsOf(steps[e.from]).includes(e.out), `${e.from} declares no output ${e.out}`);
    assert.ok(inputsOf(steps[e.to]).includes(e.inp), `${e.to} declares no input ${e.inp}`);
  }
});

test("every model or passthrough step of the flow is a POST to the passthrough, exactly, and no step is a model-bridge step (red: another origin, path, query or suffix on any step's url)", () => {
  const api = Object.entries(steps).filter(([, c]) => c.component_type === "ApiNode");
  assert.deepEqual(api.map(([id]) => id).sort(), [PARSE, SEND].sort());
  for (const [id, c] of api) {
    assert.equal(c.url, PASSTHROUGH, `${id} calls another url`);
    assert.equal(c.http_method, "POST", `${id} is not a POST`);
  }
});

test("the send step calls the host's run-send tool and nothing else is on it (red: another tool name, result shape or key on the step)", () => {
  const step = steps[SEND];
  assert.deepEqual(Object.keys(step).sort(), ["component_type", "data", "http_method", "id", "inputs", "metadata", "name", "outputs", "url"]);
  assert.deepEqual(Object.keys(step.data).sort(), ["agent_run_id", "input", "result_shape", "tool"]);
  assert.equal(step.data.tool, "email_test_delivery_run_send");
  assert.equal(step.data.result_shape, "test_delivery_send");
});

test("the parse step reads the person's answer with the host's parse tool (red: another tool name, input or key on the step)", () => {
  const step = steps[PARSE];
  assert.deepEqual(Object.keys(step).sort(), ["component_type", "data", "http_method", "id", "inputs", "metadata", "name", "outputs", "url"]);
  assert.deepEqual(Object.keys(step.data).sort(), ["agent_run_id", "input", "tool"]);
  assert.equal(step.data.tool, "email_test_delivery_parse_action");
  assert.deepEqual(step.data.input, { userResponse: "{{ userResponse }}" });
  assert.equal(step.data.agent_run_id, "{{ cinatra_run_id }}");
  assert.equal(step.metadata.cinatra.riskClass, "read_only");
});

test("the send step carries the person's submission and the run id and nothing else (red: another key in the step's input, or another source for the envelope or the run id)", () => {
  const step = steps[SEND];
  assert.deepEqual(step.data.input, { envelopeJson: "{{ envelopeJson }}" });
  assert.equal(step.data.agent_run_id, "{{ cinatra_run_id }}");
  assert.deepEqual(sourcesOf(SEND, "envelopeJson"), [`${GATE}.testResult`], "the envelope comes from somewhere else than the gate's answer");
  assert.deepEqual(sourcesOf(SEND, "cinatra_run_id"), ["start.cinatra_run_id"], "the run id comes from somewhere else than the flow's run id");
});

test("the person's answer reaches the parse step and the parsed action reaches the branch (red: another source for either input, a constant in place of the answer, or the run id of the parse step rerouted)", () => {
  assert.deepEqual(sourcesOf(PARSE, "userResponse"), [`${GATE}.testResult`], "the parse step reads something else than the gate's answer");
  assert.deepEqual(sourcesOf(PARSE, "cinatra_run_id"), ["start.cinatra_run_id"]);
  assert.deepEqual(sourcesOf(BRANCH, "action"), [`${PARSE}.action`], "the branch reads something else than the parsed action");
  assert.deepEqual(steps[BRANCH].inputs.map((p) => p.title), ["action"]);
});

test("the step declares nothing about the decision and is the only write step (red: a flag, a tool list or another key on the step's metadata, or a second write step)", () => {
  assert.deepEqual(steps[SEND].metadata, {
    cinatra: {
      riskClass: "write",
      requiresApproval: false,
      packageName: "@cinatra-ai/email-test-delivery-agent",
    },
  });
  const writing = Object.entries(steps)
    .filter(([, c]) => c.metadata?.cinatra?.riskClass === "write")
    .map(([id]) => id);
  assert.deepEqual(writing, [SEND]);
});

test("the passthrough tools of the flow are these two (red: a third tool)", () => {
  const tools = Object.values(steps)
    .filter((c) => c.component_type === "ApiNode")
    .map((c) => c.data.tool)
    .sort();
  assert.deepEqual(tools, ["email_test_delivery_parse_action", "email_test_delivery_run_send"]);
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
  assert.deepEqual([...action.enum].sort(), ["continue", "send"]);
});

test("the send returns to the gate, which stays re-entrant and bounded (red: another gate, or no bound on its visits)", () => {
  assert.deepEqual(outOf(SEND).map((e) => e.to), [GATE]);
  assert.equal(oas.metadata.cinatra.reentrantGate, GATE);
  assert.equal(steps[GATE].metadata.cinatra.maxGateVisits, 25);
  assert.equal(steps[GATE].metadata.cinatra.requiresApproval, true);
  assert.equal(Object.values(steps).filter((c) => c.component_type === "InputMessageNode").length, 1);
});
