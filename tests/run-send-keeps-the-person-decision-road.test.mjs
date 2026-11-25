// ---------------------------------------------------------------------------
// The test send keeps its road - zero-dependency, runs under
// `node --test tests/*.test.mjs`. cinatra-ai/cinatra#3745 (the pack's side).
//
// The platform holds a tool that sends mail on a person's behalf for the
// person's recorded decision: the host's `email_test_delivery_run_send`, which
// the step `perform_test_send` calls through the passthrough. Since
// cinatra#4150 that decision is the host's publish card in front of the step:
// `email_test_delivery_parse_action` reads the person's answer at the gate,
// `campaign_test_send_plan` plans the send (and sends nothing), and the send
// step, the flow's one publishing step, sends that plan only after a person
// approved the card. The platform pins the tools' behaviour on its own side;
// this suite pins that the pack's flow reaches them this way, so the road is
// not changed from this side:
//
//   1. the flow is a well-formed flat graph (every node has its component,
//      every edge ends at a node, every data edge names declared ports), so the
//      reading below is of the graph the flow really has;
//   2. the steps: exact url, tool names and keys, and the data roads that feed
//      them (the person's answer into the parse step and into the plan step,
//      the parsed action into the branch, the plan into the send step, the run
//      id into each);
//   3. the send step is reached only from the gate's "send" action through the
//      plan step, and every other action goes to the closing statement and the
//      end.
//
// The card rows and the walk of the flow against stubbed host answers are in
// test-send-waits-on-the-publish-card.test.mjs.
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
//   - A name the flow supplies is read as text and looked up in a table with
//     no prototype, so a name that only Object has is not a component.
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

// A name the flow supplies (a component ref, an edge end) is read as text, and
// components are looked up in a table with no prototype: a name such as
// "constructor", "__proto__" or "toString" finds an own entry of the flow or
// nothing, never a member inherited from Object.
// A name is a non-empty text: a missing, empty or non-text name is never a
// member of anything, so two missing names never match each other.
const isName = (v) => typeof v === "string" && v !== "";
const refOf = (r) => (isName(r?.$component_ref) ? r.$component_ref : undefined);
const table = (obj) => Object.assign(Object.create(null), obj ?? {});
const lookup = (t, key) => (isName(key) ? t[key] : undefined);
const steps = table(oas.$referenced_components);
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
const PLAN = "plan_test_send";
const PLAN_BRANCH = "branch_on_plan";
const SEND = "perform_test_send";
const SUMMARY = "test_summary";
const PASSTHROUGH = "{{CINATRA_BASE_URL}}/api/agents/passthrough";
const KINDS = ["ApiNode", "BranchingNode", "EndNode", "InputMessageNode", "OutputMessageNode", "StartNode"];

// The ports a step declares: a start node's inputs are what it hands on, an end
// node's outputs are what it takes in.
const portNames = (list) => {
  assert.ok(Array.isArray(list), "a component has no port list");
  for (const p of list) assert.ok(isName(p?.title), "a port has no name");
  return list.map((p) => p.title);
};
const outputsOf = (c) => portNames(c.component_type === "StartNode" ? c.inputs : c.outputs ?? []);
const inputsOf = (c) => portNames(c.component_type === "EndNode" ? c.outputs : c.inputs ?? []);

test("the flow is a well-formed flat graph (red: a node with no component, a component that is not a node, an edge to nowhere, a port that is not declared, a nested flow or another component kind)", () => {
  assert.deepEqual([...nodeIds].sort(), Object.keys(steps).sort(), "a component is not a node of the flow, or a node has no component");
  assert.ok(nodeIds.every(isName), "a node of the flow has no name");
  assert.equal(new Set(nodeIds).size, nodeIds.length, "a node is listed twice");
  for (const [key, c] of Object.entries(steps)) {
    assert.equal(c.id, key, `${key} is stored under another id`);
    assert.ok(KINDS.includes(c.component_type), `${key} is a ${c.component_type}, which this suite does not read`);
  }
  assert.ok(nodeIds.includes(refOf(oas.start_node)), "the start node is not a node of the flow");
  for (const e of edges) {
    assert.ok(isName(e.from) && isName(e.to), "a control edge has an end with no name");
    assert.ok(nodeIds.includes(e.from) && nodeIds.includes(e.to), `a control edge has an end that is not a node: ${e.from} -> ${e.to}`);
  }
  for (const e of dataEdges) {
    assert.ok(isName(e.from) && isName(e.to), "a data edge has an end with no name");
    assert.ok(nodeIds.includes(e.from) && nodeIds.includes(e.to), `a data edge has an end that is not a node: ${e.from} -> ${e.to}`);
    assert.ok(isName(e.out) && isName(e.inp), `a data edge ${e.from} -> ${e.to} names no port`);
    assert.ok(outputsOf(lookup(steps, e.from)).includes(e.out), `${e.from} declares no output ${e.out}`);
    assert.ok(inputsOf(lookup(steps, e.to)).includes(e.inp), `${e.to} declares no input ${e.inp}`);
  }
});

test("every model or passthrough step of the flow is a POST to the passthrough, exactly, and no step is a model-bridge step (red: another origin, path, query or suffix on any step's url)", () => {
  const api = Object.entries(steps).filter(([, c]) => c.component_type === "ApiNode");
  assert.deepEqual(api.map(([id]) => id).sort(), [PARSE, PLAN, SEND].sort());
  for (const [id, c] of api) {
    assert.equal(c.url, PASSTHROUGH, `${id} calls another url`);
    assert.equal(c.http_method, "POST", `${id} is not a POST`);
  }
});

test("the send step is the host's run-send tool call with exactly the keys this suite lists (red: another tool name or result shape, or another key on the step or its data)", () => {
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

test("the plan step carries the person's submission and the send step only the plan, each with the run id (red: another key in a step's input, or another source for the envelope, the plan or the run id)", () => {
  assert.deepEqual(steps[PLAN].data.input, { envelopeJson: "{{ envelopeJson }}" });
  assert.equal(steps[PLAN].data.agent_run_id, "{{ cinatra_run_id }}");
  assert.deepEqual(sourcesOf(PLAN, "envelopeJson"), [`${GATE}.testResult`], "the envelope comes from somewhere else than the gate's answer");
  assert.deepEqual(sourcesOf(PLAN, "cinatra_run_id"), ["start.cinatra_run_id"]);
  const step = steps[SEND];
  assert.deepEqual(Object.keys(step.data.input), ["planJson"]);
  assert.equal(step.data.agent_run_id, "{{ cinatra_run_id }}");
  assert.deepEqual(sourcesOf(SEND, "envelopeJson"), [], "the send step still takes the gate's answer");
  assert.deepEqual(sourcesOf(SEND, "planJson"), [`${PLAN}.planJson`], "the plan comes from somewhere else than the plan step");
  assert.deepEqual(sourcesOf(SEND, "cinatra_run_id"), ["start.cinatra_run_id"], "the run id comes from somewhere else than the flow's run id");
});

test("the person's answer reaches the parse step and the parsed action reaches the branch (red: another source for either input, a constant in place of the answer in the parse step's input, or the run id of the parse step rerouted)", () => {
  assert.deepEqual(steps[PARSE].data.input, { userResponse: "{{ userResponse }}" }, "the parse step's input is not the slot of the person's answer");
  assert.deepEqual(sourcesOf(PARSE, "userResponse"), [`${GATE}.testResult`], "the parse step reads something else than the gate's answer");
  assert.deepEqual(sourcesOf(PARSE, "cinatra_run_id"), ["start.cinatra_run_id"]);
  assert.deepEqual(sourcesOf(BRANCH, "action"), [`${PARSE}.action`], "the branch reads something else than the parsed action");
  assert.deepEqual(steps[BRANCH].inputs.map((p) => p.title), ["action"]);
});

test("the send step is the one publishing step and asks for no approval of its own; the plan step publishes nothing (red: a flag, a tool list or another key on the step's metadata, or a second sending step)", () => {
  assert.deepEqual(Object.keys(steps[SEND].metadata.cinatra).sort(), ["description", "packageName", "publishRows", "publishes", "requiresApproval", "riskClass"]);
  assert.equal(steps[SEND].metadata.cinatra.publishes, true);
  assert.equal(steps[SEND].metadata.cinatra.requiresApproval, false);
  assert.equal(steps[SEND].metadata.cinatra.riskClass, "test_send");
  assert.equal(steps[SEND].metadata.cinatra.packageName, "@cinatra-ai/email-test-delivery-agent");
  assert.deepEqual(Object.keys(steps[PLAN].metadata.cinatra).sort(), ["description", "packageName", "publishes", "requiresApproval", "riskClass"]);
  assert.equal(steps[PLAN].metadata.cinatra.publishes, false);
  const sending = Object.entries(steps)
    .filter(([, c]) => /_send$/.test(c.metadata?.cinatra?.riskClass ?? ""))
    .map(([id]) => id);
  assert.deepEqual(sending, [SEND], "another step is declared as sending, or the send step is not");
});

test("the passthrough tools of the flow are these three (red: a fourth tool)", () => {
  const tools = Object.values(steps)
    .filter((c) => c.component_type === "ApiNode")
    .map((c) => c.data.tool)
    .sort();
  assert.deepEqual(tools, ["campaign_test_send_plan", "email_test_delivery_parse_action", "email_test_delivery_run_send"]);
});

test("the send step is reached only from the gate's send action through the plan step (red: an edge into the send or plan step from any other step or branch)", () => {
  assert.deepEqual(into(SEND).map((e) => `${e.from}:${e.branch}`), [`${PLAN_BRANCH}:send`]);
  assert.deepEqual(steps[PLAN_BRANCH].mapping, { true: "send", false: "refused" });
  assert.deepEqual(into(PLAN_BRANCH).map((e) => e.from), [PLAN]);
  assert.deepEqual(into(PLAN).map((e) => `${e.from}:${e.branch}`), [`${BRANCH}:send`]);
  assert.deepEqual(into(BRANCH).map((e) => e.from), [PARSE]);
  assert.deepEqual(into(PARSE).map((e) => e.from), [GATE]);
  assert.deepEqual(steps[BRANCH].mapping, { send: "send" });
  assert.deepEqual([...steps[BRANCH].branches].sort(), ["default", "send"]);
  assert.ok(reach().has(SEND), "the send step is not reachable at all");
  assert.equal(reach(GATE).has(SEND), false, "the send step is reachable around the gate");
  assert.equal(reach(PLAN).has(SEND), false, "the send step is reachable around the plan step");
});

test("every other action leaves by the closing statement to the end (red: a second edge out of the branch, or a default edge into the send step)", () => {
  const out = outOf(BRANCH).map((e) => `${e.branch}>${e.to}`).sort();
  assert.deepEqual(out, [`default>${SUMMARY}`, `send>${PLAN}`]);
  assert.deepEqual(outOf(SUMMARY).map((e) => e.to), ["end"]);
  const action = steps[GATE].metadata.cinatra.inputMessageSchema["x-envelope-shape"].action;
  assert.deepEqual([...action.enum].sort(), ["continue", "send"]);
});

test("the send and a refused plan return to the gate, which stays re-entrant and bounded (red: another gate, or no bound on its visits)", () => {
  assert.deepEqual(outOf(SEND).map((e) => e.to), [GATE]);
  assert.deepEqual(outOf(PLAN_BRANCH).filter((e) => e.branch === "refused").map((e) => e.to), [GATE]);
  assert.equal(oas.metadata.cinatra.reentrantGate, GATE);
  assert.equal(steps[GATE].metadata.cinatra.maxGateVisits, 25);
  assert.equal(Object.hasOwn(steps[GATE].metadata.cinatra, "requiresApproval"), false);
  assert.equal(Object.values(steps).filter((c) => c.component_type === "InputMessageNode").length, 1);
});
