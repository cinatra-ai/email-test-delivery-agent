// Lifecycle D W8 — the email test-delivery agent's own steps (cinatra#3096
// items 9 and 19).
//
// (9) The test screen is the one place this run stops for the person. The
// manifest and the flow say so together: the screen is the flow's declared
// pause and its re-entrant gate, the node carries the approval flag, and the
// manifest claims the gate its flow has.
//
// (19) A run that ends — the person pressed Continue, or the run reached its
// limit of test sends — closes with a plain sentence about the last test email,
// never with the raw answer the form produced.
//
// The last two arms re-state the runtime loader's two mount rules over this
// flow, as cinatra-ai/email-outreach-agent holds them in its own suite: (A)
// every input a step requires has a source on every path that reaches it, and
// (B) an OutputMessageNode declares only inputs its template reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const oas = read("cinatra/oas.json");
const pkg = read("package.json");

const refs = oas.$referenced_components;
const nodesOfType = (type) => Object.values(refs).filter((n) => n.component_type === type);
const controlEdges = (oas.control_flow_connections ?? []).map((e) => ({
  from: e.from_node.$component_ref,
  to: e.to_node.$component_ref,
  branch: e.from_branch,
}));
const hasEdge = (from, to, branch) =>
  controlEdges.some((e) => e.from === from && e.to === to && (branch === undefined || e.branch === branch));
const dataEdges = (oas.data_flow_connections ?? []).map((e) => [
  e.source_node.$component_ref + "." + e.source_output,
  e.destination_node.$component_ref + "." + e.destination_input,
]);
const countDataEdges = (from, to) => dataEdges.filter(([f, t]) => f === from && t === to).length;
const outsideComment = (message) => String(message ?? "").replace(/\{#[\s\S]*?#\}/g, "");

// ---------------------------------------------------------------------------
// (9) the test-delivery gate declared as the pause it is
// ---------------------------------------------------------------------------

test("(9) the test screen is declared as the one pause it is", () => {
  const pauses = nodesOfType("InputMessageNode");
  assert.equal(pauses.length, 1, "the run does not stop exactly once");
  const [gate] = pauses;
  assert.deepEqual(oas.metadata.cinatra.hitlScreens, [gate.metadata.cinatra.renderer]);
  assert.equal(oas.metadata.cinatra.reentrantGate, gate.id);
  assert.equal(gate.metadata.cinatra.requiresApproval, true, `the "${gate.id}" pause is not declared as a pause`);
});

test("(9) the manifest claims the gate its flow has", () => {
  assert.equal(pkg.cinatra.hasApprovalGates, true, "the manifest denies the pause its flow has");
});

// ---------------------------------------------------------------------------
// (19) a plain-language ending on an empty, failed or capped test run
// ---------------------------------------------------------------------------

test("(19) the run ends in plain language, never in the envelope", () => {
  const summary = refs.test_summary;
  assert.ok(summary, "the run has no closing statement");
  assert.equal(summary.component_type, "OutputMessageNode");
  assert.ok(oas.nodes.some((n) => n.$component_ref === "test_summary"), "the closing statement is not a step of the flow");
  assert.ok(hasEdge("branch_on_action", "test_summary", "default"), "the run's end does not pass the closing statement");
  assert.ok(hasEdge("test_summary", "end"), "the closing statement does not lead to the end");
  assert.ok(!hasEdge("branch_on_action", "end"), "the run still jumps straight to its end");
  assert.deepEqual(
    refs.end.outputs.map((o) => o.title),
    ["testResult"],
    "the end node no longer carries the run's last result",
  );
});

test("(19) an empty, failed or capped test run ends in plain language", () => {
  const summary = refs.test_summary;
  assert.ok(summary, "the run has no closing statement");
  const message = String(summary.message ?? "");
  assert.equal(
    message,
    "{# pyagentspec-input-hint (do not remove): {{ lastSendResult }} {{ action }} #}" +
      "{% if action == 'halt' %}The test run stopped because it reached its limit of test sends. {% endif %}" +
      "{% if not lastSendResult %}No test email was sent in this run." +
      "{% elif lastSendResult.ok %}{{ lastSendResult.message }}" +
      "{% else %}The last test email could not be sent: {{ lastSendResult.message }}{% endif %}",
    "the closing sentence does not branch on a capped, empty, sent or failed run as written",
  );
  assert.match(message, /no test email was sent/i, "an empty run has no plain-language ending");
  assert.match(message, /could not be sent/i, "a failed send has no plain-language ending");
  assert.match(message, /limit of test sends/i, "a capped run has no plain-language ending");
  const rendered = outsideComment(message);
  assert.match(rendered, /\blastSendResult\b/, "the sentence never reads the last send result");
  assert.match(rendered, /\baction\b/, "the sentence never reads why the run ended");
  assert.equal(summary.metadata?.cinatra?.purpose, "plain-language-test-delivery-ending");
  assert.deepEqual(summary.inputs, [
    { title: "lastSendResult", type: "object", default: null },
    { title: "action", type: "string", default: "" },
  ]);
  assert.equal(countDataEdges("perform_test_send.lastSendResult", "test_summary.lastSendResult"), 1);
  assert.equal(countDataEdges("parse_action.action", "test_summary.action"), 1);
});

// ---------------------------------------------------------------------------
// (A) every required step input has a source on every path that reaches it
// ---------------------------------------------------------------------------

/** The inputs a node CONSUMES: an EndNode names them under `outputs`, every
 *  other node declares `inputs`. */
function consumedInputs(node) {
  if (node.component_type === "EndNode") return node.outputs ?? [];
  return node.inputs ?? [];
}

/** Walk the flow the way the runtime loader does, returning each input it
 *  would demand from the StartStep. */
function unsourcedInputs() {
  const steps = new Map();
  for (const ref of oas.nodes ?? []) steps.set(ref.$component_ref, refs[ref.$component_ref]);
  const beginId = oas.start_node.$component_ref;
  const startTitles = new Set((steps.get(beginId)?.inputs ?? []).map((i) => i.title));
  const flowDataEdges = (oas.data_flow_connections ?? []).map((e) => ({
    from: e.source_node.$component_ref,
    key: `${e.destination_node.$component_ref}.${e.destination_input}`,
  }));
  const successors = (id) => controlEdges.filter((e) => e.from === id).map((e) => e.to);

  const violations = [];
  const visited = new Map();
  const queue = [[beginId, new Set()]];
  while (queue.length > 0) {
    const [id, incoming] = queue.pop();
    let produced = incoming;
    if (visited.has(id)) {
      const seen = visited.get(id);
      if ([...seen].every((k) => produced.has(k))) continue;
      produced = new Set([...produced].filter((k) => seen.has(k)));
    }
    visited.set(id, produced);

    const node = steps.get(id);
    if (!node) continue;
    if (id !== beginId) {
      for (const descriptor of consumedInputs(node)) {
        const key = `${id}.${descriptor.title}`;
        if (produced.has(key)) continue;
        if (Object.hasOwn(descriptor, "default")) continue;
        if (startTitles.has(descriptor.title)) continue;
        violations.push(key);
      }
    }

    const next = new Set(produced);
    for (const edge of flowDataEdges) if (edge.from === id) next.add(edge.key);
    for (const child of successors(id)) queue.push([child, new Set(next)]);
  }
  return violations;
}

test("every required step input has a source on every path that reaches it", () => {
  const found = unsourcedInputs();
  assert.deepEqual(
    found,
    [],
    "the runtime refuses to mount a flow whose step requires an input the StartStep does not carry: " + found.join(", "),
  );
});

// ---------------------------------------------------------------------------
// (B) an OutputMessageNode declares only inputs its template reads
// ---------------------------------------------------------------------------

test("an output message declares only inputs its template reads", () => {
  const offenders = [];
  for (const node of nodesOfType("OutputMessageNode")) {
    const rendered = outsideComment(node.message);
    for (const { title } of node.inputs ?? []) {
      if (!new RegExp(`\\b${title}\\b`).test(rendered)) offenders.push(`${node.id}.${title}`);
    }
  }
  assert.deepEqual(offenders, [], "the runtime rejects an input the template never reads: " + offenders.join(", "));
});
