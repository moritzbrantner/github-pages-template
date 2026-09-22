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
    agent: {
      routes: [
        {
          id: "demo",
          label: "Interactive demo",
          href: "/fixture/demo/",
          description: "Project-owned interactive demonstration.",
        },
      ],
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

test("build creates human pages plus project and agent discovery manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "pages-template-"));
  const configPath = join(root, "pages.config.json");
  const out = join(root, "dist");
  await writeFile(configPath, `${JSON.stringify(config(), null, 2)}\n`);

  await execFileAsync(process.execPath, [cli, "build", "--config", configPath, "--out", out]);

  const overview = await readFile(join(out, "index.html"), "utf8");
  const stats = await readFile(join(out, "stats/index.html"), "utf8");
  const evidence = await readFile(join(out, "evidence/index.html"), "utf8");
  const manifest = JSON.parse(await readFile(join(out, "project-pages.json"), "utf8"));
  const agent = JSON.parse(await readFile(join(out, "agent.json"), "utf8"));

  assert.match(overview, /Measured project evidence/);
  assert.match(overview, /rel="alternate" type="application\/json" href="\/fixture\/agent\.json"/);
  assert.match(stats, /Current measurements/);
  assert.match(evidence, /Each source retains its producer/);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.managedBy, "@moritzbrantner/github-pages-template");
  assert.equal(manifest.mode, "full");
  assert.equal(manifest.generatedFrom, "example/fixture");
  assert.ok(manifest.managedPaths.includes("index.html"));
  assert.ok(manifest.managedPaths.includes("stats/index.html"));
  assert.ok(manifest.managedPaths.includes("agent.json"));
  assert.equal(agent.schemaVersion, 1);
  assert.equal(agent.kind, "github-pages-agent-discovery");
  assert.equal(agent.generatedFrom, "example/fixture");
  assert.equal(agent.discovery.self, "/fixture/agent.json");
  assert.equal(agent.discovery.javascriptRequired, false);
  assert.ok(agent.routes.some((route) => route.id === "overview" && route.href === "/fixture/"));
  assert.ok(agent.routes.some((route) => route.id === "demo" && route.href === "/fixture/demo/"));
  assert.ok(
    agent.resources.some(
      (resource) =>
        resource.id === "verification" &&
        resource.href === "/fixture/evidence/project.json" &&
        resource.kind === "project-evidence-v1",
    ),
  );
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

test("augment mode removes stale template-owned copies without touching consumer output", async () => {
  const root = await mkdtemp(join(tmpdir(), "pages-template-owned-output-"));
  const configPath = join(root, "pages.config.json");
  const copiedSource = join(root, "runtime.json");
  const out = join(root, "dist");
  const firstConfig = config();
  firstConfig.copy = [{ from: "runtime.json", to: "evidence/runtime.json" }];

  await mkdir(join(out, "assets"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(firstConfig, null, 2)}\n`);
  await writeFile(copiedSource, '{"revision":"first"}\n');
  await writeFile(join(out, "index.html"), "<main>project demo</main>\n");
  await writeFile(join(out, "assets/consumer.js"), "consumer();\n");

  await execFileAsync(process.execPath, [
    cli,
    "build",
    "--config",
    configPath,
    "--out",
    out,
    "--augment",
  ]);
  assert.equal(await readFile(join(out, "evidence/runtime.json"), "utf8"), '{"revision":"first"}\n');

  await writeFile(configPath, `${JSON.stringify(config(), null, 2)}\n`);
  await execFileAsync(process.execPath, [
    cli,
    "build",
    "--config",
    configPath,
    "--out",
    out,
    "--augment",
  ]);

  await assert.rejects(readFile(join(out, "evidence/runtime.json"), "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(join(out, "index.html"), "utf8"), "<main>project demo</main>\n");
  assert.equal(await readFile(join(out, "assets/consumer.js"), "utf8"), "consumer();\n");
  const manifest = JSON.parse(await readFile(join(out, "project-pages.json"), "utf8"));
  assert.equal(manifest.mode, "augment");
  assert.ok(!manifest.managedPaths.includes("index.html"));
  assert.ok(!manifest.managedPaths.includes("evidence/runtime.json"));
});

test("agent routes require unique stable identifiers", async () => {
  const root = await mkdtemp(join(tmpdir(), "pages-template-agent-route-"));
  const configPath = join(root, "pages.config.json");
  const out = join(root, "dist");
  const invalidConfig = config();
  invalidConfig.agent.routes.push({
    id: "demo",
    label: "Duplicate demo",
    href: "/fixture/other-demo/",
  });
  await writeFile(configPath, `${JSON.stringify(invalidConfig, null, 2)}\n`);

  await assert.rejects(
    execFileAsync(process.execPath, [cli, "build", "--config", configPath, "--out", out]),
    (error) => {
      assert.match(error.stderr, /agent route 'demo' is duplicated/);
      return true;
    },
  );
});

test("copy destinations cannot escape the output directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pages-template-copy-boundary-"));
  const configPath = join(root, "pages.config.json");
  const out = join(root, "dist");
  const invalidConfig = config();
  invalidConfig.copy = [{ from: "runtime.json", to: "../runtime.json" }];
  await writeFile(configPath, `${JSON.stringify(invalidConfig, null, 2)}\n`);
  await writeFile(join(root, "runtime.json"), "{}\n");

  await assert.rejects(
    execFileAsync(process.execPath, [cli, "build", "--config", configPath, "--out", out]),
    (error) => {
      assert.match(error.stderr, /must stay within the output directory/);
      return true;
    },
  );
});

test("augment mode refuses to overwrite consumer-owned copy destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "pages-template-copy-owner-"));
  const configPath = join(root, "pages.config.json");
  const out = join(root, "dist");
  const collisionConfig = config();
  collisionConfig.copy = [{ from: "runtime.json", to: "evidence/runtime.json" }];

  await mkdir(join(out, "evidence"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(collisionConfig, null, 2)}\n`);
  await writeFile(join(root, "runtime.json"), "generated\n");
  await writeFile(join(out, "evidence/runtime.json"), "consumer\n");

  await assert.rejects(
    execFileAsync(process.execPath, [
      cli,
      "build",
      "--config",
      configPath,
      "--out",
      out,
      "--augment",
    ]),
    (error) => {
      assert.match(error.stderr, /refusing to overwrite consumer output/);
      return true;
    },
  );
  assert.equal(await readFile(join(out, "evidence/runtime.json"), "utf8"), "consumer\n");
});
