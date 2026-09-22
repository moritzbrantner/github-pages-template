import assert from "node:assert/strict";
import test from "node:test";

import {
  CODING_TOOLING_ANALYSIS_MESSAGE_TYPE,
  acceptCodingToolingAnalysisMessage,
  readJsonEvidenceResponse,
} from "../build/src/evidence-source.js";

const sourceWindow = {};
const expectedOrigin = "https://moritzbrantner.github.io";
const repository = "moritzbrantner/maps";
const revision = "0123456789abcdef0123456789abcdef01234567";

function accept(event) {
  return acceptCodingToolingAnalysisMessage(event, {
    sourceWindow,
    expectedOrigin,
    repository,
  });
}

test("accepts analysis only from the exact source, origin, type, and repository", () => {
  const analysis = { schemaVersion: 1, repository: { fullName: repository, revision } };
  assert.deepEqual(
    accept({
      source: sourceWindow,
      origin: expectedOrigin,
      data: { type: CODING_TOOLING_ANALYSIS_MESSAGE_TYPE, repository, analysis },
    }),
    { analysis },
  );
});

test("rejects mismatched provenance", () => {
  const data = {
    type: CODING_TOOLING_ANALYSIS_MESSAGE_TYPE,
    repository,
    analysis: { schemaVersion: 1, repository: { fullName: repository, revision } },
  };
  assert.equal(accept({ source: {}, origin: expectedOrigin, data }), null);
  assert.equal(accept({ source: sourceWindow, origin: "https://example.com", data }), null);
  assert.equal(
    accept({ source: sourceWindow, origin: expectedOrigin, data: { ...data, repository: "other/repo" } }),
    null,
  );
});

test("fails closed on malformed matching coding-tooling payloads", () => {
  assert.deepEqual(
    accept({
      source: sourceWindow,
      origin: expectedOrigin,
      data: {
        type: CODING_TOOLING_ANALYSIS_MESSAGE_TYPE,
        repository,
        analysis: { schemaVersion: 2, repository: { fullName: repository, revision } },
      },
    }),
    { error: "coding-tooling analysis schemaVersion must be 1" },
  );
  assert.deepEqual(
    accept({
      source: sourceWindow,
      origin: expectedOrigin,
      data: { type: CODING_TOOLING_ANALYSIS_MESSAGE_TYPE, repository },
    }),
    { error: "coding-tooling analysis payload is missing or malformed" },
  );
});

test("fails closed when embedded analysis repository identity differs", () => {
  assert.deepEqual(
    accept({
      source: sourceWindow,
      origin: expectedOrigin,
      data: {
        type: CODING_TOOLING_ANALYSIS_MESSAGE_TYPE,
        repository,
        analysis: {
          schemaVersion: 1,
          repository: { fullName: "other/repo", revision },
        },
      },
    }),
    { error: "coding-tooling analysis repository does not match requested repository" },
  );
});

test("fails closed when embedded analysis revision is missing", () => {
  for (const missingRevision of [undefined, null, "", "   "]) {
    assert.deepEqual(
      accept({
        source: sourceWindow,
        origin: expectedOrigin,
        data: {
          type: CODING_TOOLING_ANALYSIS_MESSAGE_TYPE,
          repository,
          analysis: {
            schemaVersion: 1,
            repository: { fullName: repository, revision: missingRevision },
          },
        },
      }),
      { error: "coding-tooling analysis is missing an exact repository revision" },
    );
  }
});

test("preserves explicit producer errors", () => {
  assert.deepEqual(
    accept({
      source: sourceWindow,
      origin: expectedOrigin,
      data: {
        type: CODING_TOOLING_ANALYSIS_MESSAGE_TYPE,
        repository,
        error: { message: "unavailable" },
      },
    }),
    { error: "unavailable" },
  );
});

test("reads valid JSON evidence even with a nonstandard content type", async () => {
  const payload = { schemaVersion: 1, metrics: [] };
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

  assert.deepEqual(await readJsonEvidenceResponse(response), payload);
});

test("preserves HTTP errors before reading evidence bodies", async () => {
  await assert.rejects(
    readJsonEvidenceResponse(new Response("missing", { status: 404 })),
    /HTTP 404/,
  );
});

test("reports SPA HTML fallbacks as non-JSON evidence", async () => {
  const response = new Response("<!doctype html><title>fallback</title>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

  await assert.rejects(
    readJsonEvidenceResponse(response),
    /Evidence source returned non-JSON content \(text\/html\)\./,
  );
});

test("reports declared JSON that cannot be parsed as malformed", async () => {
  const response = new Response("{not-json", {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  await assert.rejects(
    readJsonEvidenceResponse(response),
    /Evidence source returned malformed JSON \(application\/json\)\./,
  );
});
