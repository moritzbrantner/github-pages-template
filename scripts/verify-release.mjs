import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const versionFile = (await readFile(new URL("../VERSION", import.meta.url), "utf8")).trim();
const version = packageJson.version;

assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, "package.json version must be semver");
assert.equal(versionFile, version, "VERSION must match package.json version");

const explicitTag = process.argv[2] || null;
const githubTag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : null;
const tag = explicitTag ?? githubTag;
if (tag) {
  assert.equal(tag, `v${version}`, `release tag ${tag} must match package version v${version}`);
}

console.log(`Verified release identity: @moritzbrantner/github-pages-template@${version}${tag ? ` from ${tag}` : ""}.`);
