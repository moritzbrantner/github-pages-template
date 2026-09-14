import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cli = resolve("bin/github-pages-template.mjs");

function config() {
  return {
    schemaVersion: 1,
    project: {
      name: "Fixture",
      repository: "example/fixture",
      basePath: "/fixture/",
      description: "Fixture project",
    },
    evidenceSources: [
      {
        id: "verification",
        label: "Verification",
        kind: "project-evidence-v1",
        url: "/fixture/evidence/project.json",
      },
    ],
  };
}

test("build creates overview, stats, evidence, and machine-readable manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "pages-template-"));
  const configPath = join(root, "pages.config.json");
  const out = join(root, "dist");
  await writeFile(configPath, `${JSON.stringify(config(), null, 2)}\n`);

  await execFileAsync(process.execPath, [cli, "build", "--config", configPath, "--out", out]);

  const overview = await readFile(join(out, "index.html"), "utf8");
  const stats = await readFile(join(out, "stats/index.html"), "utf8");
  const evidence = await readFile(join(out, "evidence/index.html"), "utf8");
  const manifest = JSON.parse(await readFile(join(out, "project-pages.json"), "utf8"));

  assert.match(overview, /Measured project evidence/);
  assert.match(stats, /Current measurements/);
  assert.match(evidence, /Each source retains its producer/);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generatedFrom, "example/fixture");
});

test("augment mode preserves an existing project index", async () => {
  const root = await mkdtemp(join(tmpdir(), "pages-template-augment-"));
  const configPath = join(root, "pages.config.json");
  const out = join(root, "dist");
  await mkdir(out, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config(), null, 2)}\n`);
  await writeFile(join(out, "index.html"), "<main>project demo</main>\n");

  await execFileAsync(process.execPath, [
    cli,
    "build",
    "--config",
    configPath,
    "--out",
    out,
    "--augment",
  ]);

  assert.equal(await readFile(join(out, "index.html"), "utf8"), "<main>project demo</main>\n");
  assert.match(await readFile(join(out, "stats/index.html"), "utf8"), /Stats/);
});
