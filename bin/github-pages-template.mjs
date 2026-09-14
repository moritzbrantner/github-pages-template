#!/usr/bin/env node

import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const managedBy = "@moritzbrantner/github-pages-template";
const coreManagedPaths = [
  "assets/site.css",
  "assets/site-runtime.js",
  "assets/evidence-source.js",
  "stats/index.html",
  "evidence/index.html",
  "project-pages.json",
];
const reservedCopyPaths = new Set([...coreManagedPaths, "index.html"]);

const [, , command, ...rawArgs] = process.argv;
if (command !== "build") {
  fail("Usage: github-pages-template build --config <file> --out <dir> [--augment]");
}

const args = parseArgs(rawArgs);
if (!args.config || !args.out) {
  fail("Both --config and --out are required.");
}

const configPath = resolve(args.config);
const configDir = dirname(configPath);
const outDir = resolve(args.out);
const config = JSON.parse(await readFile(configPath, "utf8"));
validateConfig(config);

const previous = args.augment ? await readPreviousManifest(outDir) : null;
const copies = await prepareCopyEntries(config.copy ?? [], {
  configDir,
  outDir,
  augment: args.augment,
  previousManagedPaths: previous?.managedPaths ?? [],
});

if (args.augment) {
  await cleanupPreviousManagedOutputs(outDir, previous?.managedPaths ?? []);
} else {
  await rm(outDir, { recursive: true, force: true });
}
await mkdir(resolve(outDir, "assets"), { recursive: true });
await mkdir(resolve(outDir, "stats"), { recursive: true });
await mkdir(resolve(outDir, "evidence"), { recursive: true });

await cp(resolve(packageRoot, "src/site.css"), resolve(outDir, "assets/site.css"));
await cp(resolve(packageRoot, "src/site-runtime.js"), resolve(outDir, "assets/site-runtime.js"));
await cp(resolve(packageRoot, "src/evidence-source.js"), resolve(outDir, "assets/evidence-source.js"));

const managedPaths = new Set(coreManagedPaths);
if (!args.augment) managedPaths.add("index.html");
for (const entry of copies) {
  await mkdir(dirname(entry.destination), { recursive: true });
  await cp(entry.source, entry.destination, { recursive: true });
  managedPaths.add(entry.relativeDestination);
}

if (!args.augment) {
  await writeFile(resolve(outDir, "index.html"), renderPage(config, "overview"));
}
await writeFile(resolve(outDir, "stats/index.html"), renderPage(config, "stats"));
await writeFile(resolve(outDir, "evidence/index.html"), renderPage(config, "evidence"));
await writeFile(
  resolve(outDir, "project-pages.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      managedBy,
      mode: args.augment ? "augment" : "full",
      generatedFrom: config.project.repository,
      managedPaths: [...managedPaths].sort(),
      config,
    },
    null,
    2,
  )}\n`,
);

function parseArgs(values) {
  const result = { augment: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--augment") {
      result.augment = true;
      continue;
    }
    if (value === "--config" || value === "--out") {
      const next = values[index + 1];
      if (!next) fail(`${value} requires a value.`);
      result[value.slice(2)] = next;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${value}`);
  }
  return result;
}

function validateConfig(config) {
  if (config?.schemaVersion !== 1) fail("pages config schemaVersion must be 1.");
  if (!config?.project?.name) fail("project.name is required.");
  if (!config?.project?.repository) fail("project.repository is required.");
  if (!config?.project?.basePath?.startsWith("/")) fail("project.basePath must start with '/'.");
  for (const source of config.evidenceSources ?? []) {
    if (!source?.id || !source?.label || !source?.kind || !source?.url) {
      fail("Each evidence source requires id, label, kind, and url.");
    }
  }
}

async function readPreviousManifest(outDir) {
  const manifestPath = resolve(outDir, "project-pages.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail(
      `Cannot safely augment because existing project-pages.json is unreadable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isTemplateManifest(manifest)) {
    fail(
      "Cannot safely augment because existing project-pages.json is not recognized as github-pages-template output.",
    );
  }

  const recordedPaths = Array.isArray(manifest.managedPaths)
    ? manifest.managedPaths
    : coreManagedPaths;
  return {
    manifest,
    managedPaths: recordedPaths.map((path) =>
      resolveManagedOutputPath(outDir, path, "previous managed output").relativePath,
    ),
  };
}

function isTemplateManifest(manifest) {
  if (manifest?.managedBy === managedBy) return true;
  return (
    manifest?.schemaVersion === 1 &&
    typeof manifest?.generatedFrom === "string" &&
    manifest?.config?.project?.repository === manifest.generatedFrom
  );
}

async function prepareCopyEntries(entries, options) {
  const prepared = [];
  for (const entry of entries) {
    if (!entry?.from || !entry?.to) fail("Each copy entry needs from and to.");
    const destination = resolveManagedOutputPath(options.outDir, entry.to, "copy.to");
    if (reservedCopyPaths.has(destination.relativePath)) {
      fail(`copy.to '${entry.to}' conflicts with a github-pages-template owned output.`);
    }

    const source = resolve(options.configDir, entry.from);
    try {
      await lstat(source);
    } catch (error) {
      if (error?.code === "ENOENT") fail(`copy.from '${entry.from}' does not exist.`);
      throw error;
    }

    if (options.augment && (await pathExists(destination.absolutePath))) {
      const previouslyManaged = options.previousManagedPaths.some((managedPath) =>
        isSameOrNestedPath(destination.relativePath, managedPath),
      );
      if (!previouslyManaged) {
        fail(
          `copy.to '${entry.to}' already exists and is not recorded as template-owned; refusing to overwrite consumer output.`,
        );
      }
    }

    prepared.push({
      source,
      destination: destination.absolutePath,
      relativeDestination: destination.relativePath,
    });
  }
  return prepared;
}

async function cleanupPreviousManagedOutputs(outDir, managedPaths) {
  for (const path of managedPaths) {
    if (path === "index.html") continue;
    const managed = resolveManagedOutputPath(outDir, path, "previous managed output");
    await rm(managed.absolutePath, { recursive: true, force: true });
  }
}

function resolveManagedOutputPath(root, candidate, label) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    fail(`${label} must be a non-empty relative path.`);
  }
  const portable = candidate.replaceAll("\\", "/");
  if (isAbsolute(candidate) || /^[A-Za-z]:\//.test(portable)) {
    fail(`${label} '${candidate}' must stay within the output directory.`);
  }
  if (portable.split("/").includes("..")) {
    fail(`${label} '${candidate}' must stay within the output directory.`);
  }

  const absolutePath = resolve(root, candidate);
  const relativePath = relative(root, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    fail(`${label} '${candidate}' must stay within the output directory.`);
  }

  return {
    absolutePath,
    relativePath: relativePath.split(sep).join("/"),
  };
}

function isSameOrNestedPath(candidate, managedPath) {
  return candidate === managedPath || candidate.startsWith(`${managedPath}/`);
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function renderPage(config, page) {
  const project = config.project;
  const title = page === "overview" ? project.name : `${titleCase(page)} · ${project.name}`;
  const body = page === "overview" ? renderOverview(config) : renderEvidenceSurface(page);
  const configJson = JSON.stringify(config).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(project.description ?? "Project evidence and documentation")}" />
    <link rel="stylesheet" href="${project.basePath}assets/site.css" />
  </head>
  <body data-page="${page}">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="site-header__inner">
        <a class="site-brand" href="${project.basePath}">${escapeHtml(project.name)}</a>
        <nav aria-label="Project">
          ${navLink(config, "Overview", project.basePath, page === "overview")}
          ${navLink(config, "Stats", `${project.basePath}stats/`, page === "stats")}
          ${navLink(config, "Evidence", `${project.basePath}evidence/`, page === "evidence")}
          ${(config.links ?? []).map((link) => navLink(config, link.label, link.href, false)).join("\n          ")}
        </nav>
      </div>
    </header>
    <main id="main" class="site-main">
      ${body}
    </main>
    <footer class="site-footer">
      <span>Evidence is observational and revision-bound; missing or malformed evidence is never treated as success.</span>
      <a href="https://github.com/${escapeHtml(project.repository)}">Repository</a>
    </footer>
    <script>window.__PROJECT_PAGES_CONFIG__ = ${configJson};</script>
    <script type="module" src="${project.basePath}assets/site-runtime.js"></script>
  </body>
</html>\n`;
}

function renderOverview(config) {
  const project = config.project;
  return `<section class="hero" aria-labelledby="project-title">
        <p class="eyebrow">${escapeHtml(project.kicker ?? project.repository)}</p>
        <h1 id="project-title">${escapeHtml(project.name)}</h1>
        <p class="lede">${escapeHtml(project.description ?? "")}</p>
        <div class="hero-links">
          ${(config.links ?? []).map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("\n          ")}
        </div>
      </section>
      <section class="content-section" aria-labelledby="evidence-summary-title">
        <h2 id="evidence-summary-title">Measured project evidence</h2>
        <p>Stats and accomplishments are rendered from explicit evidence producers. The template does not reinterpret benchmark semantics or manufacture a synthetic quality score.</p>
        <p><a href="${project.basePath}stats/">View stats</a> · <a href="${project.basePath}evidence/">Inspect evidence provenance</a></p>
      </section>`;
}

function renderEvidenceSurface(page) {
  if (page === "stats") {
    return `<section class="page-heading"><p class="eyebrow">Measured evidence</p><h1>Stats</h1><p>Current measurements remain separate by producer and evidence family.</p></section>
      <section class="content-section" aria-labelledby="stats-title"><h2 id="stats-title">Current measurements</h2><div id="stats-status" class="status-line" aria-live="polite">Loading published evidence…</div><div class="table-scroll"><table><thead><tr><th scope="col">Metric</th><th scope="col">Value</th><th scope="col">State</th><th scope="col">Source</th></tr></thead><tbody id="stats-table"></tbody></table></div></section>
      <section class="content-section" aria-labelledby="accomplishments-title"><h2 id="accomplishments-title">Accomplishments</h2><div id="accomplishments"></div></section>`;
  }
  return `<section class="page-heading"><p class="eyebrow">Provenance</p><h1>Evidence</h1><p>Each source retains its producer, freshness, revision, and retrieval state.</p></section>
      <section class="content-section"><div id="evidence-status" class="status-line" aria-live="polite">Loading evidence sources…</div><div class="table-scroll"><table><thead><tr><th scope="col">Source</th><th scope="col">State</th><th scope="col">Revision</th><th scope="col">Producer</th></tr></thead><tbody id="evidence-table"></tbody></table></div></section>`;
}

function navLink(_config, label, href, current) {
  return `<a href="${escapeHtml(href)}"${current ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
