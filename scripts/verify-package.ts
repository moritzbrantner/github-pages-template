import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

assert.equal(packageJson.name, "@moritzbrantner/github-pages-template");
assert.equal(packageJson.private, false);
assert.equal(packageJson.repository?.url, "git+https://github.com/moritzbrantner/github-pages-template.git");
assert.equal(packageJson.publishConfig?.registry, "https://registry.npmjs.org");
assert.equal(packageJson.publishConfig?.access, "public");
assert.equal(packageJson.bin?.["github-pages-template"], "./build/bin/github-pages-template.js");
assert.equal(packageJson.exports?.["./preferences"]?.import, "./build/src/site-preferences.js");
assert.equal(packageJson.exports?.["./preferences"]?.types, "./build/src/site-preferences.d.ts");
assert.equal(packageJson.exports?.["./localization"]?.import, "./build/src/site-localization.js");
assert.equal(packageJson.exports?.["./localization"]?.types, "./build/src/site-localization.d.ts");

const output = execFileSync(
  "npm",
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  {
    encoding: "utf8",
    env: { ...process.env, npm_config_loglevel: "error" },
  },
);
const [packed] = JSON.parse(output);
assert.ok(packed, "npm pack did not report a package");
assert.equal(packed.name, packageJson.name);
assert.equal(packed.version, packageJson.version);

const files = new Set((packed.files ?? []).map((file) => file.path));
for (const path of [
  "package.json",
  "README.md",
  "LICENSE",
  "VERSION",
  "build/bin/github-pages-template.js",
  "build/src/site-runtime.js",
  "build/src/site-runtime.d.ts",
  "build/src/site-preferences.js",
  "build/src/site-preferences.d.ts",
  "build/src/site-localization.js",
  "build/src/site-localization.d.ts",
  "build/src/evidence-source.js",
  "build/src/evidence-source.d.ts",
  "src/site.css",
  "docs/consumer-adoption.md",
  "docs/project-evidence-v1.md",
]) {
  assert.ok(files.has(path), `published package is missing ${path}`);
}

for (const path of files) {
  assert.ok(!path.startsWith(".github/"), `workflow file leaked into package: ${path}`);
  assert.ok(!path.startsWith("tests/"), `test file leaked into package: ${path}`);
  assert.ok(!path.startsWith("site/"), `reference-site source leaked into package: ${path}`);
  assert.ok(!path.startsWith("scripts/"), `release script leaked into package: ${path}`);
  assert.ok(!path.startsWith("dist/"), `generated reference site leaked into package: ${path}`);
  assert.ok(
    !path.endsWith(".ts") || path.endsWith(".d.ts"),
    `authored TypeScript leaked into package: ${path}`,
  );
}

console.log(
  `Verified ${packageJson.name}@${packageJson.version}: ${files.size} publishable files, public npm metadata, no repository-only output.`,
);
