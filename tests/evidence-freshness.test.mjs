import assert from "node:assert/strict";
import test from "node:test";

import { reconcileProjectEvidenceFreshness } from "../src/evidence-source.js";

const repository = "moritzbrantner/maps";

function results(currentRevision, evidenceRevision, codingRepository = repository) {
  const codingTooling = currentRevision
    ? {
        source: {
          kind: "coding-tooling-analysis-v1",
          url: `https://moritzbrantner.github.io/coding-tooling/analysis.json/?repo=${codingRepository}`,
        },
        normalized: { repository: codingRepository, revision: currentRevision },
      }
    : {
        source: {
          kind: "coding-tooling-analysis-v1",
          url: `https://moritzbrantner.github.io/coding-tooling/analysis.json/?repo=${codingRepository}`,
        },
        state: "unavailable",
      };
  return [
    codingTooling,
    {
      source: { kind: "project-evidence-v1" },
      state: "passed",
      normalized: {
        state: "passed",
        repository,
        revision: evidenceRevision,
        metrics: [{ label: "Runtime score", value: "90", state: "passed" }],
        accomplishments: [{ title: "Runtime evidence accepted", state: "passed" }],
      },
    },
  ];
}

test("marks exact-head project evidence current", () => {
  const [, evidence] = reconcileProjectEvidenceFreshness(results("abc", "abc"), repository);
  assert.equal(evidence.normalized.state, "passed · current");
  assert.equal(evidence.normalized.metrics[0].state, "passed · current");
  assert.equal(evidence.normalized.accomplishments[0].state, "passed · current");
});

test("marks older project evidence stale even when the producer verdict passed", () => {
  const [, evidence] = reconcileProjectEvidenceFreshness(results("new", "old"), repository);
  assert.equal(evidence.normalized.state, "incomplete · stale");
  assert.equal(evidence.normalized.metrics[0].state, "passed · stale");
  assert.equal(evidence.normalized.accomplishments[0].state, "passed · stale");
});

test("fails closed when the current revision cannot be verified", () => {
  const [, evidence] = reconcileProjectEvidenceFreshness(results(null, "abc"), repository);
  assert.equal(evidence.normalized.state, "incomplete · revision unverified");
  assert.equal(evidence.normalized.metrics[0].state, "passed · revision unverified");
});

test("fails closed when project evidence omits its revision", () => {
  const [, evidence] = reconcileProjectEvidenceFreshness(results("abc", null), repository);
  assert.equal(evidence.normalized.state, "incomplete · revision missing");
});

test("does not use coding-tooling revisions from a different repository", () => {
  const [, evidence] = reconcileProjectEvidenceFreshness(
    results("abc", "abc", "moritzbrantner/other"),
    repository,
  );
  assert.equal(evidence.normalized.state, "incomplete · revision unverified");
  assert.equal(evidence.normalized.metrics[0].state, "passed · revision unverified");
});

test("fails closed when project evidence identifies a different repository", () => {
  const input = results("abc", "abc");
  input[1].normalized.repository = "moritzbrantner/other";
  const [, evidence] = reconcileProjectEvidenceFreshness(input, repository);
  assert.equal(evidence.normalized.state, "incomplete · repository mismatch");
  assert.equal(evidence.normalized.metrics[0].state, "passed · repository mismatch");
});
