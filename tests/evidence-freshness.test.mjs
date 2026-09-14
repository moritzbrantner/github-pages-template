import assert from "node:assert/strict";
import test from "node:test";

import { reconcileProjectEvidenceFreshness } from "../src/evidence-source.js";

function results(currentRevision, evidenceRevision) {
  const codingTooling = currentRevision
    ? {
        source: { kind: "coding-tooling-analysis-v1" },
        normalized: { revision: currentRevision },
      }
    : { source: { kind: "coding-tooling-analysis-v1" }, state: "unavailable" };
  return [
    codingTooling,
    {
      source: { kind: "project-evidence-v1" },
      state: "passed",
      normalized: {
        state: "passed",
        revision: evidenceRevision,
        metrics: [{ label: "Runtime score", value: "90", state: "passed" }],
        accomplishments: [{ title: "Runtime evidence accepted", state: "passed" }],
      },
    },
  ];
}

test("marks exact-head project evidence current", () => {
  const [, evidence] = reconcileProjectEvidenceFreshness(results("abc", "abc"));
  assert.equal(evidence.normalized.state, "passed · current");
  assert.equal(evidence.normalized.metrics[0].state, "passed · current");
  assert.equal(evidence.normalized.accomplishments[0].state, "passed · current");
});

test("marks older project evidence stale even when the producer verdict passed", () => {
  const [, evidence] = reconcileProjectEvidenceFreshness(results("new", "old"));
  assert.equal(evidence.normalized.state, "incomplete · stale");
  assert.equal(evidence.normalized.metrics[0].state, "passed · stale");
  assert.equal(evidence.normalized.accomplishments[0].state, "passed · stale");
});

test("fails closed when the current revision cannot be verified", () => {
  const [, evidence] = reconcileProjectEvidenceFreshness(results(null, "abc"));
  assert.equal(evidence.normalized.state, "incomplete · revision unverified");
  assert.equal(evidence.normalized.metrics[0].state, "passed · revision unverified");
});

test("fails closed when project evidence omits its revision", () => {
  const [, evidence] = reconcileProjectEvidenceFreshness(results("abc", null));
  assert.equal(evidence.normalized.state, "incomplete · revision missing");
});
