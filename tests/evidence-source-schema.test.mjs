import assert from "node:assert/strict";
import test from "node:test";

import {
  CODING_TOOLING_ANALYSIS_MESSAGE_TYPE,
  acceptCodingToolingAnalysisMessage,
} from "../src/evidence-source.js";

test("fails closed on unsupported coding-tooling analysis schemas", () => {
  const sourceWindow = {};
  const expectedOrigin = "https://moritzbrantner.github.io";
  const repository = "moritzbrantner/maps";

  for (const schemaVersion of [undefined, 0, 2, "1"]) {
    assert.deepEqual(
      acceptCodingToolingAnalysisMessage(
        {
          source: sourceWindow,
          origin: expectedOrigin,
          data: {
            type: CODING_TOOLING_ANALYSIS_MESSAGE_TYPE,
            repository,
            analysis: { schemaVersion },
          },
        },
        { sourceWindow, expectedOrigin, repository },
      ),
      { error: "coding-tooling analysis schemaVersion must be 1" },
    );
  }
});
