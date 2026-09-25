import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cli = resolve("build/bin/github-pages-template.js");

function config() {
  return {
    schemaVersion: 1,
    project: {
      name: "Fixture",
      repository: "example/fixture",
      basePath: "/fixture/",
      description: "Fixture project",
    },
    preferences: {
      defaults: {
        "appearance.color_scheme": "system",
        "appearance.contrast": "system",
        "localization.locale": "de",
      },
      locales: [
        { id: "en", label: "English" },
        { id: "de", label: "Deutsch" },
      ],
    },
    evidenceSources: [],
  };
}

test("generated pages expose compact mobile navigation and icon-first preferences", async () => {
  const root = await mkdtemp(join(tmpdir(), "pages-template-preferences-"));
  const configPath = join(root, "pages.config.json");
  const out = join(root, "dist");
  await writeFile(configPath, `${JSON.stringify(config(), null, 2)}\n`);

  await execFileAsync(process.execPath, [cli, "build", "--config", configPath, "--out", out]);

  const overview = await readFile(join(out, "index.html"), "utf8");
  const stats = await readFile(join(out, "stats", "index.html"), "utf8");
  const evidence = await readFile(join(out, "evidence", "index.html"), "utf8");
  const preferences = await readFile(join(out, "preferences", "index.html"), "utf8");
  const stylesheet = await readFile(join(out, "assets", "site.css"), "utf8");
  const manifest = JSON.parse(await readFile(join(out, "project-pages.json"), "utf8"));

  assert.match(overview, /<html lang="de" dir="ltr">/);
  assert.match(overview, /<details class="site-navigation">/);
  assert.match(overview, /class="site-menu-toggle"/);
  assert.match(overview, /data-i18n="nav\.menu"/);
  assert.match(overview, /data-preference-action="toggle-color-scheme"/);
  assert.match(overview, /class="theme-toggle__track"/);
  assert.match(overview, /class="quick-control quick-control--language"/);
  assert.match(overview, /data-language-flag/);
  assert.match(overview, /data-flag="🇩🇪"/);
  assert.match(overview, /data-preference-id="localization\.locale"/);
  assert.match(overview, /href="\/fixture\/preferences\/"/);
  assert.doesNotMatch(overview, /quick-control__category/);
  assert.doesNotMatch(overview, /class="hero"/);
  assert.doesNotMatch(overview, /class="lede"/);
  assert.doesNotMatch(overview, /data-i18n="overview\.evidenceBody"/);
  assert.doesNotMatch(overview, /data-i18n="footer\.evidence"/);
  assert.doesNotMatch(overview, /class="site-footer"/);
  assert.match(overview, /<h1 id="overview-title" class="visually-hidden">Fixture<\/h1>/);
  assert.match(overview, />Statistiken<\/a>/);
  assert.match(overview, />Nachweise<\/a>/);
  assert.doesNotMatch(overview, />Gemessene Projektnachweise</);

  assert.doesNotMatch(stats, /data-i18n="stats\.intro"/);
  assert.doesNotMatch(stats, /data-i18n="stats\.eyebrow"/);
  assert.doesNotMatch(evidence, /data-i18n="evidence\.intro"/);
  assert.doesNotMatch(evidence, /data-i18n="evidence\.eyebrow"/);

  assert.match(preferences, /data-page="preferences"/);
  assert.match(preferences, /data-preference-id="appearance\.color_scheme"/);
  assert.match(preferences, /data-preference-id="appearance\.contrast"/);
  assert.match(preferences, /data-preference-id="localization\.locale"/);
  assert.doesNotMatch(preferences, /data-i18n="preferences\.description"/);
  assert.match(preferences, />Einstellungen</);

  assert.match(stylesheet, /@media \(max-width: 42rem\)/);
  assert.match(stylesheet, /\.site-navigation:not\(\[open\]\) > \.site-nav/);
  assert.match(stylesheet, /\.quick-control--language select/);
  assert.match(stylesheet, /opacity: 0/);

  assert.ok(manifest.managedPaths.includes("preferences/index.html"));
  assert.ok(manifest.managedPaths.includes("assets/site-preferences.js"));
  assert.ok(manifest.managedPaths.includes("assets/site-localization.js"));
  assert.match(await readFile(join(out, "assets/site-preferences.js"), "utf8"), /appearance\.color_scheme/);
});

test("generator rejects preference defaults outside configured choices", async () => {
  const root = await mkdtemp(join(tmpdir(), "pages-template-invalid-preferences-"));
  const configPath = join(root, "pages.config.json");
  const out = join(root, "dist");
  const invalid = config();
  invalid.preferences.defaults["appearance.color_scheme"] = "sepia";
  await writeFile(configPath, `${JSON.stringify(invalid, null, 2)}\n`);

  await assert.rejects(
    execFileAsync(process.execPath, [cli, "build", "--config", configPath, "--out", out]),
    (error) => {
      assert.match(error.stderr, /appearance\.color_scheme must be system, light, or dark/);
      return true;
    },
  );
});
