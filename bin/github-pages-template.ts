#!/usr/bin/env node

import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { translate } from "../src/site-localization.js";
import {
  COLOR_SCHEME_SETTING_ID,
  COLOR_SCHEME_VALUES,
  CONTRAST_SETTING_ID,
  CONTRAST_VALUES,
  LOCALE_SETTING_ID,
  PREFERENCE_STORAGE_KEY,
  configuredLocales,
  isRtlLocale,
  preferenceDefaults,
} from "../src/site-preferences.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const managedBy = "@moritzbrantner/github-pages-template";
const coreManagedPaths = [
  "assets/site.css",
  "assets/site-runtime.js",
  "assets/site-preferences.js",
  "assets/site-localization.js",
  "assets/evidence-source.js",
  "stats/index.html",
  "evidence/index.html",
  "preferences/index.html",
  "project-pages.json",
  "agent.json",
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
await mkdir(resolve(outDir, "preferences"), { recursive: true });

await cp(resolve(packageRoot, "src/site.css"), resolve(outDir, "assets/site.css"));
await cp(resolve(packageRoot, "build/src/site-runtime.js"), resolve(outDir, "assets/site-runtime.js"));
await cp(resolve(packageRoot, "build/src/site-preferences.js"), resolve(outDir, "assets/site-preferences.js"));
await cp(resolve(packageRoot, "build/src/site-localization.js"), resolve(outDir, "assets/site-localization.js"));
await cp(resolve(packageRoot, "build/src/evidence-source.js"), resolve(outDir, "assets/evidence-source.js"));

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
await writeFile(resolve(outDir, "preferences/index.html"), renderPage(config, "preferences"));
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
await writeFile(
  resolve(outDir, "agent.json"),
  `${JSON.stringify(renderAgentManifest(config, args.augment ? "augment" : "full"), null, 2)}\n`,
);

type CliArguments = {
  augment: boolean;
  config?: string;
  out?: string;
};

function parseArgs(values: string[]): CliArguments {
  const result: CliArguments = { augment: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--augment") {
      result.augment = true;
      continue;
    }
    if (value === "--config" || value === "--out") {
      const next = values[index + 1];
      if (!next) fail(`${value} requires a value.`);
      result[value.slice(2) as "config" | "out"] = next;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${value}`);
  }
  return result;
}

function validateConfig(config: any): void {
  if (config?.schemaVersion !== 1) fail("pages config schemaVersion must be 1.");
  if (!config?.project?.name) fail("project.name is required.");
  if (!config?.project?.repository) fail("project.repository is required.");
  if (!config?.project?.basePath?.startsWith("/")) fail("project.basePath must start with '/'.");
  for (const source of config.evidenceSources ?? []) {
    if (!source?.id || !source?.label || !source?.kind || !source?.url) {
      fail("Each evidence source requires id, label, kind, and url.");
    }
  }
  validateAgentConfig(config);
  validatePreferences(config);
}

function validateAgentConfig(config: any): void {
  const agent = config.agent;
  if (agent == null) return;
  if (typeof agent !== "object" || Array.isArray(agent)) {
    fail("agent must be an object.");
  }

  if (agent.routes != null) {
    if (!Array.isArray(agent.routes)) {
      fail("agent.routes must be an array when configured.");
    }
    const ids = new Set(["overview", "stats", "evidence", "preferences"]);
    for (const route of agent.routes) {
      if (!route?.id || !route?.label || !route?.href) {
        fail("Each agent route requires id, label, and href.");
      }
      if (ids.has(route.id)) fail(`agent route '${route.id}' is duplicated.`);
      ids.add(route.id);
      for (const field of ["id", "label", "href", "description", "kind", "mediaType"]) {
        if (route[field] != null && typeof route[field] !== "string") {
          fail(`agent.routes.${route.id}.${field} must be a string.`);
        }
      }
    }
  }
}

function validatePreferences(config: any): void {
  const preferences = config.preferences;
  if (preferences == null) return;
  if (typeof preferences !== "object" || Array.isArray(preferences)) {
    fail("preferences must be an object.");
  }

  if (preferences.locales != null) {
    if (!Array.isArray(preferences.locales) || preferences.locales.length === 0) {
      fail("preferences.locales must be a non-empty array when configured.");
    }
    const ids = new Set();
    for (const locale of preferences.locales) {
      if (!locale?.id || !locale?.label) {
        fail("Each preferences locale requires id and label.");
      }
      try {
        Intl.getCanonicalLocales(locale.id);
      } catch {
        fail(`preferences locale '${locale.id}' is not a valid locale identifier.`);
      }
      if (ids.has(locale.id)) fail(`preferences locale '${locale.id}' is duplicated.`);
      ids.add(locale.id);
    }
  }

  if (preferences.defaults != null &&
      (typeof preferences.defaults !== "object" || Array.isArray(preferences.defaults))) {
    fail("preferences.defaults must be an object.");
  }

  const defaults = preferences.defaults ?? {};
  if (
    COLOR_SCHEME_SETTING_ID in defaults &&
    !COLOR_SCHEME_VALUES.includes(defaults[COLOR_SCHEME_SETTING_ID])
  ) {
    fail(`preferences.defaults.${COLOR_SCHEME_SETTING_ID} must be system, light, or dark.`);
  }
  if (
    CONTRAST_SETTING_ID in defaults &&
    !CONTRAST_VALUES.includes(defaults[CONTRAST_SETTING_ID])
  ) {
    fail(`preferences.defaults.${CONTRAST_SETTING_ID} must be system, normal, high, or low.`);
  }

  const localeIds = new Set(configuredLocales(config).map((locale) => locale.id));
  if (LOCALE_SETTING_ID in defaults && !localeIds.has(defaults[LOCALE_SETTING_ID])) {
    fail(`preferences.defaults.${LOCALE_SETTING_ID} must name a configured locale.`);
  }

  if (preferences.messages != null) {
    if (typeof preferences.messages !== "object" || Array.isArray(preferences.messages)) {
      fail("preferences.messages must be an object keyed by configured locale.");
    }
    for (const [locale, messages] of Object.entries(preferences.messages)) {
      if (!localeIds.has(locale)) {
        fail(`preferences.messages.${locale} does not name a configured locale.`);
      }
      if (!messages || typeof messages !== "object" || Array.isArray(messages)) {
        fail(`preferences.messages.${locale} must be an object.`);
      }
      for (const [key, value] of Object.entries(messages)) {
        if (!key || typeof value !== "string") {
          fail(`preferences.messages.${locale} must contain string message values.`);
        }
      }
    }
  }
}

async function readPreviousManifest(outDir: string): Promise<any | null> {
  const manifestPath = resolve(outDir, "project-pages.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
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
    managedPaths: recordedPaths.map((path: string) =>
      resolveManagedOutputPath(outDir, path, "previous managed output").relativePath,
    ),
  };
}

function isTemplateManifest(manifest: any): boolean {
  if (manifest?.managedBy === managedBy) return true;
  return (
    manifest?.schemaVersion === 1 &&
    typeof manifest?.generatedFrom === "string" &&
    manifest?.config?.project?.repository === manifest.generatedFrom
  );
}

async function prepareCopyEntries(entries: any[], options: any): Promise<any[]> {
  const prepared: any[] = [];
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
      if (isNodeError(error) && error.code === "ENOENT") {
        fail(`copy.from '${entry.from}' does not exist.`);
      }
      throw error;
    }

    if (options.augment && (await pathExists(destination.absolutePath))) {
      const previouslyManaged = options.previousManagedPaths.some((managedPath: string) =>
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

async function cleanupPreviousManagedOutputs(outDir: string, managedPaths: string[]): Promise<void> {
  for (const path of managedPaths) {
    if (path === "index.html") continue;
    const managed = resolveManagedOutputPath(outDir, path, "previous managed output");
    await rm(managed.absolutePath, { recursive: true, force: true });
  }
}

function resolveManagedOutputPath(root: string, candidate: string, label: string) {
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

function isSameOrNestedPath(candidate: string, managedPath: string): boolean {
  return candidate === managedPath || candidate.startsWith(`${managedPath}/`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function renderAgentManifest(config: any, mode: "augment" | "full") {
  const project = config.project;
  const routes = [
    {
      id: "overview",
      label: "Overview",
      href: project.basePath,
      kind: "page",
      mediaType: "text/html",
      description: "Human-readable project overview.",
    },
    {
      id: "stats",
      label: "Stats",
      href: `${project.basePath}stats/`,
      kind: "page",
      mediaType: "text/html",
      description: "Current measurements from configured evidence producers.",
    },
    {
      id: "evidence",
      label: "Evidence",
      href: `${project.basePath}evidence/`,
      kind: "page",
      mediaType: "text/html",
      description: "Evidence provenance, freshness, revisions, and diagnostics.",
    },
    {
      id: "preferences",
      label: "Preferences",
      href: `${project.basePath}preferences/`,
      kind: "page",
      mediaType: "text/html",
      description: "Pages presentation preferences.",
    },
    ...(config.agent?.routes ?? []).map((route: any) => ({
      id: route.id,
      label: route.label,
      href: route.href,
      kind: route.kind ?? "page",
      mediaType: route.mediaType ?? "text/html",
      ...(route.description ? { description: route.description } : {}),
    })),
  ];

  const resources = [
    {
      id: "project-pages",
      label: "Project Pages manifest",
      href: `${project.basePath}project-pages.json`,
      kind: "manifest",
      mediaType: "application/json",
    },
    ...(config.evidenceSources ?? []).map((source: any) => ({
      id: `evidence:${source.id}`,
      sourceId: source.id,
      label: source.label,
      href: source.url,
      kind: source.kind,
      mediaType: "application/json",
      ...(source.producer ? { producer: source.producer } : {}),
    })),
  ];

  return {
    schemaVersion: 1,
    kind: "github-pages-agent-discovery",
    generatedBy: managedBy,
    generatedFrom: project.repository,
    mode,
    project: {
      name: project.name,
      repository: project.repository,
      basePath: project.basePath,
      ...(project.description ? { description: project.description } : {}),
    },
    discovery: {
      self: `${project.basePath}agent.json`,
      projectPages: `${project.basePath}project-pages.json`,
      sourceRepository: `https://github.com/${project.repository}`,
      javascriptRequired: false,
    },
    routes,
    resources,
  };
}

function renderPage(config: any, page: string): string {
  const project = config.project;
  const defaults = preferenceDefaults(config);
  const locale = defaults[LOCALE_SETTING_ID];
  const pageLabel =
    page === "stats"
      ? translate(config, locale, "stats.title")
      : page === "evidence"
        ? translate(config, locale, "evidence.title")
        : page === "preferences"
          ? translate(config, locale, "preferences.summary")
          : null;
  const title = page === "overview" ? project.name : `${pageLabel} · ${project.name}`;
  const body =
    page === "overview"
      ? renderOverview(config, locale)
      : page === "preferences"
        ? renderPreferencesPage(config, locale)
        : renderEvidenceSurface(config, page, locale);
  const configJson = JSON.stringify(config).replaceAll("<", "\\u003c");
  const t = (key: string) => escapeHtml(translate(config, locale, key));
  return `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${isRtlLocale(locale) ? "rtl" : "ltr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(project.description ?? "Project evidence and documentation")}" />
    <link rel="alternate" type="application/json" href="${project.basePath}agent.json" title="Agent discovery manifest" />
    <script>${renderPreferenceBootstrap(config)}</script>
    <link rel="stylesheet" href="${project.basePath}assets/site.css" />
  </head>
  <body data-page="${page}">
    <a class="skip-link" href="#main" data-i18n="skip.content">${t("skip.content")}</a>
    <header class="site-header">
      <div class="site-header__inner">
        <a class="site-brand" href="${project.basePath}">${escapeHtml(project.name)}</a>
        <div class="site-header__actions">
          <nav class="site-nav" aria-label="${t("nav.project")}" data-i18n-aria-label="nav.project">
            ${navLink(translate(config, locale, "nav.overview"), project.basePath, page === "overview", "nav.overview")}
            ${navLink(translate(config, locale, "nav.stats"), `${project.basePath}stats/`, page === "stats", "nav.stats")}
            ${navLink(translate(config, locale, "nav.evidence"), `${project.basePath}evidence/`, page === "evidence", "nav.evidence")}
            ${(config.links ?? []).map((link: any) => navLink(link.label, link.href, false)).join("\n            ")}
          </nav>
          ${renderHeaderPreferences(config, locale, page)}
        </div>
      </div>
    </header>
    <main id="main" class="site-main">
      ${body}
    </main>
    <footer class="site-footer">
      <span data-i18n="footer.evidence">${t("footer.evidence")}</span>
      <a href="https://github.com/${escapeHtml(project.repository)}" data-i18n="footer.repository">${t("footer.repository")}</a>
    </footer>
    <script>window.__PROJECT_PAGES_CONFIG__ = ${configJson};</script>
    <script type="module" src="${project.basePath}assets/site-runtime.js"></script>
  </body>
</html>\n`;
}

function renderPreferenceBootstrap(config: any): string {
  const defaults = preferenceDefaults(config);
  const locales = configuredLocales(config).map((locale) => locale.id);
  const payload = JSON.stringify({ key: PREFERENCE_STORAGE_KEY, defaults, locales }).replaceAll(
    "<",
    "\\u003c",
  );
  return `(function(settings){try{var stored=JSON.parse(localStorage.getItem(settings.key)||"{}");var values=Object.assign({},settings.defaults,stored);var scheme=values[${JSON.stringify(COLOR_SCHEME_SETTING_ID)}];if(scheme==="light"||scheme==="dark")document.documentElement.dataset.colorScheme=scheme;var contrast=values[${JSON.stringify(CONTRAST_SETTING_ID)}];if(contrast==="normal"||contrast==="high"||contrast==="low")document.documentElement.dataset.contrast=contrast;var locale=values[${JSON.stringify(LOCALE_SETTING_ID)}];if(settings.locales.includes(locale)){document.documentElement.lang=locale;document.documentElement.dir=/^(ar|fa|he|ur)(-|_|$)/i.test(locale)?"rtl":"ltr";}}catch(_error){}})(${payload});`;
}

function renderHeaderPreferences(config: any, locale: string, page: string): string {
  const defaults = preferenceDefaults(config);
  const initialTheme = defaults[COLOR_SCHEME_SETTING_ID] === "dark" ? "dark" : "light";
  const t = (key: string) => escapeHtml(translate(config, locale, key));
  return `<div class="site-quick-preferences">
            <button class="quick-control theme-toggle" type="button" data-preference-action="toggle-color-scheme" data-theme-state="${initialTheme}" aria-pressed="${initialTheme === "dark" ? "true" : "false"}">
              <span class="quick-control__category" data-i18n="preferences.theme">${t("preferences.theme")}</span>
              <span class="theme-toggle__state theme-toggle__light">${icon("sun")}<span data-i18n="preferences.theme.light">${t("preferences.theme.light")}</span></span>
              <span class="theme-toggle__state theme-toggle__dark">${icon("moon")}<span data-i18n="preferences.theme.dark">${t("preferences.theme.dark")}</span></span>
            </button>
            <label class="quick-control quick-control--language">
              ${icon("globe")}
              <span class="quick-control__category" data-i18n="preferences.language">${t("preferences.language")}</span>
              <select data-preference-id="${LOCALE_SETTING_ID}">
                ${configuredLocales(config)
                  .map((item) => preferenceOption(item.id, defaults[LOCALE_SETTING_ID], escapeHtml(item.label)))
                  .join("\n                ")}
              </select>
            </label>
            <a class="quick-control quick-control--link" href="${config.project.basePath}preferences/"${page === "preferences" ? ' aria-current="page"' : ""}>
              ${icon("settings")}
              <span data-i18n="preferences.summary">${t("preferences.summary")}</span>
            </a>
          </div>`;
}

function renderPreferenceMenu(config: any, locale: string): string {
  const defaults = preferenceDefaults(config);
  const t = (key: string) => escapeHtml(translate(config, locale, key));
  return `<details class="site-preferences">
            <summary data-i18n="preferences.summary">${t("preferences.summary")}</summary>
            <div class="site-preferences__panel">
              <p class="site-preferences__description" data-i18n="preferences.description">${t("preferences.description")}</p>
              <form id="site-preferences-form" class="site-preferences__form">
                <label>
                  <span data-i18n="preferences.theme">${t("preferences.theme")}</span>
                  <select data-preference-id="${COLOR_SCHEME_SETTING_ID}">
                    ${preferenceOption("system", defaults[COLOR_SCHEME_SETTING_ID], t("preferences.theme.system"), "preferences.theme.system")}
                    ${preferenceOption("light", defaults[COLOR_SCHEME_SETTING_ID], t("preferences.theme.light"), "preferences.theme.light")}
                    ${preferenceOption("dark", defaults[COLOR_SCHEME_SETTING_ID], t("preferences.theme.dark"), "preferences.theme.dark")}
                  </select>
                </label>
                <label>
                  <span data-i18n="preferences.contrast">${t("preferences.contrast")}</span>
                  <select data-preference-id="${CONTRAST_SETTING_ID}">
                    ${preferenceOption("system", defaults[CONTRAST_SETTING_ID], t("preferences.contrast.system"), "preferences.contrast.system")}
                    ${preferenceOption("normal", defaults[CONTRAST_SETTING_ID], t("preferences.contrast.normal"), "preferences.contrast.normal")}
                    ${preferenceOption("high", defaults[CONTRAST_SETTING_ID], t("preferences.contrast.high"), "preferences.contrast.high")}
                    ${preferenceOption("low", defaults[CONTRAST_SETTING_ID], t("preferences.contrast.low"), "preferences.contrast.low")}
                  </select>
                </label>
                <label>
                  <span data-i18n="preferences.language">${t("preferences.language")}</span>
                  <select data-preference-id="${LOCALE_SETTING_ID}">
                    ${configuredLocales(config)
                      .map((item) => preferenceOption(item.id, defaults[LOCALE_SETTING_ID], escapeHtml(item.label)))
                      .join("\n                    ")}
                  </select>
                </label>
                <button type="button" id="site-preferences-reset" data-i18n="preferences.reset">${t("preferences.reset")}</button>
              </form>
            </div>
          </details>`;
}

function renderPreferencesPage(config: any, locale: string): string {
  const defaults = preferenceDefaults(config);
  const t = (key: string) => escapeHtml(translate(config, locale, key));
  return `<section class="page-heading preferences-heading">
        <h1 data-i18n="preferences.summary">${t("preferences.summary")}</h1>
        <p data-i18n="preferences.description">${t("preferences.description")}</p>
      </section>
      <section class="content-section preferences-page" aria-labelledby="preferences-form-title">
        <h2 id="preferences-form-title" data-i18n="preferences.summary">${t("preferences.summary")}</h2>
        <form id="site-preferences-form" class="preferences-page__form">
          <label class="preferences-page__field">
            <span data-i18n="preferences.theme">${t("preferences.theme")}</span>
            <select data-preference-id="${COLOR_SCHEME_SETTING_ID}">
              ${preferenceOption("system", defaults[COLOR_SCHEME_SETTING_ID], t("preferences.theme.system"), "preferences.theme.system")}
              ${preferenceOption("light", defaults[COLOR_SCHEME_SETTING_ID], t("preferences.theme.light"), "preferences.theme.light")}
              ${preferenceOption("dark", defaults[COLOR_SCHEME_SETTING_ID], t("preferences.theme.dark"), "preferences.theme.dark")}
            </select>
          </label>
          <label class="preferences-page__field">
            <span data-i18n="preferences.contrast">${t("preferences.contrast")}</span>
            <select data-preference-id="${CONTRAST_SETTING_ID}">
              ${preferenceOption("system", defaults[CONTRAST_SETTING_ID], t("preferences.contrast.system"), "preferences.contrast.system")}
              ${preferenceOption("normal", defaults[CONTRAST_SETTING_ID], t("preferences.contrast.normal"), "preferences.contrast.normal")}
              ${preferenceOption("high", defaults[CONTRAST_SETTING_ID], t("preferences.contrast.high"), "preferences.contrast.high")}
              ${preferenceOption("low", defaults[CONTRAST_SETTING_ID], t("preferences.contrast.low"), "preferences.contrast.low")}
            </select>
          </label>
          <label class="preferences-page__field">
            <span data-i18n="preferences.language">${t("preferences.language")}</span>
            <select data-preference-id="${LOCALE_SETTING_ID}">
              ${configuredLocales(config)
                .map((item) => preferenceOption(item.id, defaults[LOCALE_SETTING_ID], escapeHtml(item.label)))
                .join("\n              ")}
            </select>
          </label>
          <button type="button" id="site-preferences-reset" data-i18n="preferences.reset">${t("preferences.reset")}</button>
        </form>
      </section>`;
}

function preferenceOption(
  value: string,
  selected: string,
  label: string,
  messageKey: string | null = null,
): string {
  return `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}${messageKey ? ` data-i18n="${messageKey}"` : ""}>${label}</option>`;
}

function renderOverview(config: any, locale: string): string {
  const project = config.project;
  const t = (key: string) => escapeHtml(translate(config, locale, key));
  return `<section class="hero" aria-labelledby="project-title">
        <p class="eyebrow">${escapeHtml(project.kicker ?? project.repository)}</p>
        <h1 id="project-title">${escapeHtml(project.name)}</h1>
        <p class="lede">${escapeHtml(project.description ?? "")}</p>
        <div class="hero-links">
          ${(config.links ?? []).map((link: any) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("\n          ")}
        </div>
      </section>
      <section class="content-section" aria-labelledby="evidence-summary-title">
        <h2 id="evidence-summary-title" data-i18n="overview.evidenceTitle">${t("overview.evidenceTitle")}</h2>
        <p data-i18n="overview.evidenceBody">${t("overview.evidenceBody")}</p>
        <p><a href="${project.basePath}stats/" data-i18n="overview.viewStats">${t("overview.viewStats")}</a> · <a href="${project.basePath}evidence/" data-i18n="overview.inspectEvidence">${t("overview.inspectEvidence")}</a></p>
      </section>`;
}

function renderEvidenceSurface(config: any, page: string, locale: string): string {
  const t = (key: string) => escapeHtml(translate(config, locale, key));
  if (page === "stats") {
    return `<section class="page-heading"><p class="eyebrow" data-i18n="stats.eyebrow">${t("stats.eyebrow")}</p><h1 data-i18n="stats.title">${t("stats.title")}</h1><p data-i18n="stats.intro">${t("stats.intro")}</p></section>
      <section class="content-section" aria-labelledby="stats-title"><h2 id="stats-title" data-i18n="stats.currentTitle">${t("stats.currentTitle")}</h2><div id="stats-status" class="status-line" aria-live="polite" data-i18n="stats.loading">${t("stats.loading")}</div><div class="table-scroll"><table><thead><tr><th scope="col" data-i18n="stats.table.metric">${t("stats.table.metric")}</th><th scope="col" data-i18n="stats.table.value">${t("stats.table.value")}</th><th scope="col" data-i18n="stats.table.state">${t("stats.table.state")}</th><th scope="col" data-i18n="stats.table.source">${t("stats.table.source")}</th></tr></thead><tbody id="stats-table"></tbody></table></div></section>
      <section class="content-section" aria-labelledby="accomplishments-title"><h2 id="accomplishments-title" data-i18n="stats.accomplishmentsTitle">${t("stats.accomplishmentsTitle")}</h2><div id="accomplishments"></div></section>`;
  }
  return `<section class="page-heading"><p class="eyebrow" data-i18n="evidence.eyebrow">${t("evidence.eyebrow")}</p><h1 data-i18n="evidence.title">${t("evidence.title")}</h1><p data-i18n="evidence.intro">${t("evidence.intro")}</p></section>
      <section class="content-section"><div id="evidence-status" class="status-line" aria-live="polite" data-i18n="evidence.loading">${t("evidence.loading")}</div><div class="table-scroll"><table><thead><tr><th scope="col" data-i18n="evidence.table.source">${t("evidence.table.source")}</th><th scope="col" data-i18n="evidence.table.repository">${t("evidence.table.repository")}</th><th scope="col" data-i18n="evidence.table.producer">${t("evidence.table.producer")}</th><th scope="col" data-i18n="evidence.table.state">${t("evidence.table.state")}</th><th scope="col" data-i18n="evidence.table.generated">${t("evidence.table.generated")}</th><th scope="col" data-i18n="evidence.table.evidenceRevision">${t("evidence.table.evidenceRevision")}</th><th scope="col" data-i18n="evidence.table.currentRevision">${t("evidence.table.currentRevision")}</th><th scope="col" data-i18n="evidence.table.diagnostic">${t("evidence.table.diagnostic")}</th></tr></thead><tbody id="evidence-table"></tbody></table></div></section>`;
}

function icon(name: string): string {
  const paths: Record<string, string> = {
    sun: '<circle cx="12" cy="12" r="3.5"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path>',
    moon: '<path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5 8.5 8.5 0 1 0 20.5 14.1Z"></path>',
    globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"></path>',
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.11.36.32.7.6 1 .3.28.68.4 1.1.4h.09v4h-.09c-.42 0-.8.12-1.1.4-.28.3-.49.64-.6 1Z"></path>',
  };
  const path = paths[name];
  return `<svg class="quick-control__icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path ?? ""}</svg>`;
}

function navLink(
  label: string,
  href: string,
  current: boolean,
  messageKey: string | null = null,
): string {
  return `<a href="${escapeHtml(href)}"${current ? ' aria-current="page"' : ""}${messageKey ? ` data-i18n="${messageKey}"` : ""}>${escapeHtml(label)}</a>`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
