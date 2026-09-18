import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { translate } from "./site-localization";
import {
  COLOR_SCHEME_SETTING_ID,
  COLOR_SCHEME_VALUES,
  configuredLocales,
  CONTRAST_SETTING_ID,
  CONTRAST_VALUES,
  isRtlLocale,
  LOCALE_SETTING_ID,
  PREFERENCE_STORAGE_KEY,
  preferenceDefaults,
} from "./site-preferences";
import type { PageId, ProjectPagesConfig } from "./types";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const managedBy = "@moritzbrantner/github-pages-template";
const coreManagedPaths = [
  "assets/site-runtime.css",
  "assets/site-runtime.js",
  "stats/index.html",
  "evidence/index.html",
  "preferences/index.html",
  "project-pages.json",
];
const reservedCopyPaths = new Set([...coreManagedPaths, "index.html"]);

interface CliArgs {
  augment: boolean;
  config?: string;
  out?: string;
}

interface PreparedCopyEntry {
  source: string;
  destination: string;
  relativeDestination: string;
}

export async function runCli(argv = process.argv.slice(2)) {
  const [command, ...rawArgs] = argv;
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
  const config = JSON.parse(await readFile(configPath, "utf8")) as ProjectPagesConfig;
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

  await cp(resolve(packageRoot, "lib/browser/site-runtime.css"), resolve(outDir, "assets/site-runtime.css"));
  await cp(resolve(packageRoot, "lib/browser/site-runtime.js"), resolve(outDir, "assets/site-runtime.js"));

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
}

function parseArgs(values: string[]): CliArgs {
  const result: CliArgs = { augment: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--augment") {
      result.augment = true;
      continue;
    }
    if (value === "--config" || value === "--out") {
      const next = values[index + 1];
      if (!next) fail(`${value} requires a value.`);
      if (value === "--config") result.config = next;
      else result.out = next;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${value}`);
  }
  return result;
}

function validateConfig(config: ProjectPagesConfig) {
  if (config?.schemaVersion !== 1) fail("pages config schemaVersion must be 1.");
  if (!config.project?.name) fail("project.name is required.");
  if (!config.project?.repository) fail("project.repository is required.");
  if (!config.project?.basePath?.startsWith("/")) fail("project.basePath must start with '/'.");
  for (const source of config.evidenceSources ?? []) {
    if (!source?.id || !source.label || !source.kind || !source.url) {
      fail("Each evidence source requires id, label, kind, and url.");
    }
  }
  validatePreferences(config);
}

function validatePreferences(config: ProjectPagesConfig) {
  const preferences = config.preferences;
  if (preferences == null) return;
  if (typeof preferences !== "object" || Array.isArray(preferences)) {
    fail("preferences must be an object.");
  }

  if (preferences.locales != null) {
    if (!Array.isArray(preferences.locales) || preferences.locales.length === 0) {
      fail("preferences.locales must be a non-empty array when configured.");
    }
    const ids = new Set<string>();
    for (const locale of preferences.locales) {
      if (!locale?.id || !locale.label) fail("Each preferences locale requires id and label.");
      try {
        Intl.getCanonicalLocales(locale.id);
      } catch {
        fail(`preferences locale '${locale.id}' is not a valid locale identifier.`);
      }
      if (ids.has(locale.id)) fail(`preferences locale '${locale.id}' is duplicated.`);
      ids.add(locale.id);
    }
  }

  const defaults = preferences.defaults ?? {};
  const colorScheme = defaults[COLOR_SCHEME_SETTING_ID];
  if (colorScheme != null && !COLOR_SCHEME_VALUES.includes(colorScheme)) {
    fail(`preferences.defaults.${COLOR_SCHEME_SETTING_ID} must be system, light, or dark.`);
  }
  const contrast = defaults[CONTRAST_SETTING_ID];
  if (contrast != null && !CONTRAST_VALUES.includes(contrast)) {
    fail(`preferences.defaults.${CONTRAST_SETTING_ID} must be system, normal, high, or low.`);
  }

  const localeIds = new Set(configuredLocales(config).map((locale) => locale.id));
  const defaultLocale = defaults[LOCALE_SETTING_ID];
  if (defaultLocale != null && !localeIds.has(defaultLocale)) {
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

