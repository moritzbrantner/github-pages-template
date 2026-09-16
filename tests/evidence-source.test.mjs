import assert from "node:assert/strict";
import test from "node:test";

import {
  CODING_TOOLING_ANALYSIS_MESSAGE_TYPE,
  acceptCodingToolingAnalysisMessage,
} from "../src/evidence-source.js";

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
