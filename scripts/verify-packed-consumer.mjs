import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const tempRoot = await mkdtemp(join(tmpdir(), "github-pages-template-pack-"));

try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", tempRoot],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, npm_config_loglevel: "error" },
    },
  );
  const [packed] = JSON.parse(packOutput);
  assert.ok(packed?.filename, "npm pack did not create a tarball");
  assert.equal(packed.name, packageJson.name);
  assert.equal(packed.version, packageJson.version);

  const tarball = join(tempRoot, packed.filename);
  await lstat(tarball);

  await verifyConsumer({
    root: join(tempRoot, "full-consumer"),
    tarball,
    mode: "full",
    repository: "example/full-consumer",
  });
  await verifyConsumer({
    root: join(tempRoot, "augment-consumer"),
    tarball,
    mode: "augment",
    repository: "example/augment-consumer",
  });

  console.log(
    `Installed and executed ${packageJson.name}@${packageJson.version} from its packed tarball in full and augment consumer fixtures.`,
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function verifyConsumer({ root, tarball, mode, repository }) {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: `fixture-${mode}`, private: true }, null, 2)}\n`,
  );
  await writeFile(
    join(root, "pages.config.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        project: {
          name: mode === "full" ? "Full package fixture" : "Augment package fixture",
          repository,
          basePath: `/${repository.split("/")[1]}/`,
          description: "Packed package consumer verification fixture.",
        },
        evidenceSources: [
          {
            id: "runtime",
            label: "Runtime evidence",
            kind: "project-evidence-v1",
            producer: "runtime-profiler",
            url: `/${repository.split("/")[1]}/evidence/runtime.json`,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  if (mode === "augment") {
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "index.html"), "consumer-owned-home\n");
    await writeFile(join(root, "dist", "consumer-app.js"), "export const consumer = true;\n");
  }

  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarball,
    ],
    {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, npm_config_loglevel: "error" },
    },
  );

  const installedRoot = join(
    root,
    "node_modules",
    "@moritzbrantner",
    "github-pages-template",
  );
  const installedPackage = JSON.parse(
    await readFile(join(installedRoot, "package.json"), "utf8"),
  );
  assert.equal(installedPackage.version, packageJson.version);
  await lstat(join(root, "node_modules", ".bin", "github-pages-template"));

  const cli = join(installedRoot, "bin", "github-pages-template.mjs");
  execFileSync(
    process.execPath,
    [
      cli,
      "build",
      "--config",
      "./pages.config.json",
      "--out",
      "./dist",
      ...(mode === "augment" ? ["--augment"] : []),
    ],
    { cwd: root, stdio: "pipe" },
  );

  const manifest = JSON.parse(await readFile(join(root, "dist", "project-pages.json"), "utf8"));
  assert.equal(manifest.managedBy, "@moritzbrantner/github-pages-template");
  assert.equal(manifest.generatedFrom, repository);
  assert.equal(manifest.mode, mode);
  assert.ok(manifest.managedPaths.includes("assets/site-runtime.js"));
  assert.ok(manifest.managedPaths.includes("assets/site-preferences.js"));
  assert.ok(manifest.managedPaths.includes("assets/site-localization.js"));
  assert.ok(manifest.managedPaths.includes("assets/evidence-source.js"));
  assert.equal(manifest.managedPaths.includes("index.html"), mode === "full");

  const runtime = await readFile(join(root, "dist", "assets", "site-runtime.js"), "utf8");
  const preferences = await readFile(
    join(root, "dist", "assets", "site-preferences.js"),
    "utf8",
  );
  const localization = await readFile(
    join(root, "dist", "assets", "site-localization.js"),
    "utf8",
  );
  const evidenceSource = await readFile(
    join(root, "dist", "assets", "evidence-source.js"),
    "utf8",
  );
  assert.match(runtime, /installSitePreferences/);
  assert.match(preferences, /appearance\.color_scheme/);
  assert.match(localization, /Evidence revision/);
  assert.match(evidenceSource, /repository-identity-mismatch/);
  assert.match(evidenceSource, /Evidence source returned non-JSON content/);

  if (mode === "augment") {
    assert.equal(await readFile(join(root, "dist", "index.html"), "utf8"), "consumer-owned-home\n");
    assert.equal(
      await readFile(join(root, "dist", "consumer-app.js"), "utf8"),
      "export const consumer = true;\n",
    );
  } else {
    assert.match(await readFile(join(root, "dist", "index.html"), "utf8"), /Full package fixture/);
  }
}
