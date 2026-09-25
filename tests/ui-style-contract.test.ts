import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/site.css", import.meta.url), "utf8");

test("Pages styling follows the shared UI token contract", () => {
  for (const token of [
    "--background",
    "--foreground",
    "--primary",
    "--secondary",
    "--muted",
    "--muted-foreground",
    "--border",
    "--ring",
    "--ui-radius-control",
    "--ui-radius-surface",
    "--ui-shadow-surface",
  ]) {
    assert.match(css, new RegExp(token.replaceAll("-", "\\-")));
  }

  assert.match(css, /@moritzbrantner\/ui 1\.1 design-system contract/);
  assert.doesNotMatch(css, /\b(?:Canvas|CanvasText|LinkText|Highlight)\b/);
  assert.match(css, /:root\[data-color-scheme="dark"\]/);
});
