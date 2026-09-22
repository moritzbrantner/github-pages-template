import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvidenceDiagnostics,
  reconcileProjectEvidenceFreshness,
} from "../build/src/evidence-source.js";

const repository = "moritzbrantner/maps";
const currentRevision = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const oldRevision = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function codingTooling(revision = currentRevision) {
  return {
    source: {
      id: "coding-tooling",
      label: "Repository verification",
      kind: "coding-tooling-analysis-v1",
      url: `https://moritzbrantner.github.io/coding-tooling/analysis.json/?repo=${repository}`,
    },
    payload: {
      schemaVersion: 1,
      repository: { fullName: repository, revision },
    },
    normalized: {
      state: "current",
      repository,
      revision,
      producer: "coding-tooling",
      metrics: [],
      accomplishments: [],
    },
  };
}

function projectEvidence(overrides = {}) {
  const payload = {
    schemaVersion: 1,
    producer: "runtime-profiler",
    repository,
    revision: currentRevision,
    generatedAt: "2026-09-16T20:00:00Z",
    status: "passed",
    metrics: [],
    ...overrides.payload,
  };
  return {
    source: {
      id: "runtime",
      label: "Runtime evidence",
      kind: "project-evidence-v1",
      url: "/maps/evidence/runtime.json",
    },
    payload,
    state: "passed",
    normalized: {
      state: "passed",
      repository: payload.repository ?? null,
      revision: payload.revision ?? null,
      producer: payload.producer,
      metrics: [],
      accomplishments: [],
      ...overrides.normalized,
    },
    ...overrides.result,
  };
}

function diagnostics(results) {
  const reconciled = reconcileProjectEvidenceFreshness(results, repository);
  return buildEvidenceDiagnostics(reconciled, repository);
}

test("reports exact-head evidence as current and preserves provenance metadata", () => {
  const [, evidence] = diagnostics([codingTooling(), projectEvidence()]);
  assert.equal(evidence.diagnostic.code, "current");
  assert.equal(evidence.repository, repository);
  assert.equal(evidence.generatedAt, "2026-09-16T20:00:00Z");
  assert.equal(evidence.evidenceRevision, currentRevision);
  assert.equal(evidence.currentRevision, currentRevision);
});

test("reports stale revisions without changing the producer verdict into success", () => {
  const [, evidence] = diagnostics([
    codingTooling(),
    projectEvidence({ payload: { revision: oldRevision }, normalized: { revision: oldRevision } }),
  ]);
  assert.equal(evidence.state, "incomplete · stale");
  assert.equal(evidence.diagnostic.code, "stale-revision");
});

test("reports missing evidence revisions", () => {
  const [, evidence] = diagnostics([
    codingTooling(),
    projectEvidence({ payload: { revision: null }, normalized: { revision: null } }),
  ]);
  assert.equal(evidence.state, "incomplete · revision missing");
  assert.equal(evidence.diagnostic.code, "missing-revision");
});

test("reports when the current repository revision cannot be verified", () => {
  const unavailableCodingTooling = {
    source: codingTooling().source,
    state: "unavailable",
    error: "Timed out waiting for coding-tooling analysis evidence.",
  };
  const [, evidence] = diagnostics([unavailableCodingTooling, projectEvidence()]);
  assert.equal(evidence.state, "incomplete · revision unverified");
  assert.equal(evidence.diagnostic.code, "current-revision-unavailable");
});

test("classifies bridge schema and revision errors explicitly", () => {
  const [schema, missingRevision] = buildEvidenceDiagnostics(
    [
      {
        source: codingTooling().source,
        state: "unavailable",
        error: "coding-tooling analysis schemaVersion must be 1",
      },
      {
        source: codingTooling().source,
        state: "unavailable",
        error: "coding-tooling analysis is missing an exact repository revision",
      },
    ],
    repository,
  );
  assert.equal(schema.diagnostic.code, "malformed-schema");
  assert.equal(missingRevision.diagnostic.code, "missing-revision");
});

test("does not invent repository identity for an unavailable project source", () => {
  const [evidence] = buildEvidenceDiagnostics(
    [{ source: projectEvidence().source, state: "unavailable", error: "HTTP 404" }],
    repository,
  );
  assert.equal(evidence.repository, null);
});

test("preserves source retrieval errors", () => {
  const [evidence] = buildEvidenceDiagnostics(
    [
      {
        source: projectEvidence().source,
        state: "unavailable",
        error: "HTTP 404",
      },
    ],
    repository,
  );
  assert.equal(evidence.diagnostic.code, "source-unavailable");
  assert.equal(evidence.diagnostic.message, "HTTP 404");
});

test("reports malformed project evidence schemas", () => {
  const malformed = projectEvidence({
    payload: { schemaVersion: 2, metrics: null },
    normalized: { state: "incomplete", metrics: [] },
  });
  const [, evidence] = diagnostics([codingTooling(), malformed]);
  assert.equal(evidence.diagnostic.code, "malformed-schema");
});

test("fails closed on project evidence repository identity mismatch", () => {
  const mismatched = projectEvidence({
    payload: { repository: "moritzbrantner/other" },
    normalized: { repository: "moritzbrantner/other" },
  });
  const [, evidence] = diagnostics([codingTooling(), mismatched]);
  assert.equal(evidence.state, "incomplete · repository mismatch");
  assert.equal(evidence.diagnostic.code, "repository-identity-mismatch");
});

test("classifies fail-closed coding-tooling identity errors explicitly", () => {
  const [evidence] = buildEvidenceDiagnostics(
    [
      {
        source: codingTooling().source,
        state: "unavailable",
        error: "coding-tooling analysis repository does not match requested repository",
      },
    ],
    repository,
  );
  assert.equal(evidence.diagnostic.code, "repository-identity-mismatch");
});
