export const PREFERENCE_STORAGE_KEY = "@moritzbrantner/github-pages-template.preferences.v1";

export const COLOR_SCHEME_SETTING_ID = "appearance.color_scheme";
export const CONTRAST_SETTING_ID = "appearance.contrast";
export const LOCALE_SETTING_ID = "localization.locale";

export const COLOR_SCHEME_VALUES = Object.freeze(["system", "light", "dark"]);
export const CONTRAST_VALUES = Object.freeze(["system", "normal", "high", "low"]);

const DEFAULT_LOCALES = Object.freeze([{ id: "en", label: "English" }]);
const COLOR_SCHEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function configuredLocales(config) {
  const configured = config?.preferences?.locales;
  if (!Array.isArray(configured) || configured.length === 0) {
    return DEFAULT_LOCALES.map((locale) => ({ ...locale }));
  }
  return configured.map((locale) => ({ id: String(locale.id), label: String(locale.label) }));
}

export function preferenceDefaults(config) {
  const configured = config?.preferences?.defaults ?? {};
  const locales = configuredLocales(config);
  const localeIds = new Set(locales.map((locale) => locale.id));

  const colorScheme = COLOR_SCHEME_VALUES.includes(configured[COLOR_SCHEME_SETTING_ID])
    ? configured[COLOR_SCHEME_SETTING_ID]
    : "system";
  const contrast = CONTRAST_VALUES.includes(configured[CONTRAST_SETTING_ID])
    ? configured[CONTRAST_SETTING_ID]
    : "system";
  const locale = localeIds.has(configured[LOCALE_SETTING_ID])
    ? configured[LOCALE_SETTING_ID]
    : locales[0].id;

  return {
    [COLOR_SCHEME_SETTING_ID]: colorScheme,
    [CONTRAST_SETTING_ID]: contrast,
    [LOCALE_SETTING_ID]: locale,
  };
}

export function normalizePreferenceOverrides(config, candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};

  const defaults = preferenceDefaults(config);
  const locales = new Set(configuredLocales(config).map((locale) => locale.id));
  const normalized = {};

  copyOverride(
    normalized,
    candidate,
    defaults,
    COLOR_SCHEME_SETTING_ID,
    (value) => COLOR_SCHEME_VALUES.includes(value),
  );
  copyOverride(
    normalized,
    candidate,
    defaults,
    CONTRAST_SETTING_ID,
    (value) => CONTRAST_VALUES.includes(value),
  );
  copyOverride(
    normalized,
    candidate,
    defaults,
    LOCALE_SETTING_ID,
    (value) => locales.has(value),
  );

  return normalized;
}

export function effectivePreferences(config, overrides) {
  return {
    ...preferenceDefaults(config),
    ...normalizePreferenceOverrides(config, overrides),
  };
}

export function isRtlLocale(locale) {
  const language = String(locale ?? "")
    .toLowerCase()
    .split(/[-_]/, 1)[0];
  return new Set(["ar", "fa", "he", "ur"]).has(language);
}

export function applyDocumentPreferences(document, preferences) {
  const root = document?.documentElement;
  if (!root) return;

  const colorScheme = preferences?.[COLOR_SCHEME_SETTING_ID] ?? "system";
  if (colorScheme === "system") delete root.dataset.colorScheme;
  else root.dataset.colorScheme = colorScheme;

  const contrast = preferences?.[CONTRAST_SETTING_ID] ?? "system";
  if (contrast === "system") delete root.dataset.contrast;
  else root.dataset.contrast = contrast;

  const locale = preferences?.[LOCALE_SETTING_ID] ?? "en";
  root.lang = locale;
  root.dir = isRtlLocale(locale) ? "rtl" : "ltr";
}

export function readPreferenceOverrides(storage, config) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PREFERENCE_STORAGE_KEY);
    return raw ? normalizePreferenceOverrides(config, JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writePreferenceOverrides(storage, config, candidate) {
  if (!storage) return {};
  const normalized = normalizePreferenceOverrides(config, candidate);
  try {
    if (Object.keys(normalized).length === 0) storage.removeItem(PREFERENCE_STORAGE_KEY);
    else storage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Preferences remain usable for the current page when storage is unavailable.
  }
  return normalized;
}

export function installSitePreferences(config, options = {}) {
  const windowObject = options.window ?? globalThis.window;
  const documentObject = options.document ?? globalThis.document;
  const storage = safeStorage(windowObject);
  const colorSchemeMedia = windowObject?.matchMedia?.(COLOR_SCHEME_MEDIA_QUERY) ?? null;
  let overrides = readPreferenceOverrides(storage, config);
  let effective = effectivePreferences(config, overrides);

  function apply(reason = "initial") {
    effective = effectivePreferences(config, overrides);
    applyDocumentPreferences(documentObject, effective);
    syncControls(documentObject, effective, colorSchemeMedia);
    options.onChange?.({ reason, effective: { ...effective }, overrides: { ...overrides } });
  }

  function update(id, value) {
    overrides = normalizePreferenceOverrides(config, { ...overrides, [id]: value });
    overrides = writePreferenceOverrides(storage, config, overrides);
    apply("user");
  }

  function reset() {
    overrides = writePreferenceOverrides(storage, config, {});
    apply("reset");
  }

  const onInput = (event) => {
    const target = event.target;
    if (!target || target.tagName !== "SELECT") return;
    const id = target.dataset?.preferenceId;
    if (!id) return;
    update(id, target.value);
  };
  documentObject?.addEventListener?.("change", onInput);

  const onClick = (event) => {
    const target = event.target?.closest?.("[data-preference-action]");
    if (target?.dataset?.preferenceAction !== "toggle-color-scheme") return;
    const current = resolvedColorScheme(effective, colorSchemeMedia);
    update(COLOR_SCHEME_SETTING_ID, current === "dark" ? "light" : "dark");
  };
  documentObject?.addEventListener?.("click", onClick);

  const resetButton = documentObject?.querySelector("#site-preferences-reset");
  resetButton?.addEventListener("click", reset);

  const onStorage = (event) => {
    if (event.key !== PREFERENCE_STORAGE_KEY) return;
    overrides = readPreferenceOverrides(storage, config);
    apply("storage");
  };
  windowObject?.addEventListener?.("storage", onStorage);

  const onSystemColorScheme = () => {
    if (effective[COLOR_SCHEME_SETTING_ID] !== "system") return;
    syncControls(documentObject, effective, colorSchemeMedia);
  };
  colorSchemeMedia?.addEventListener?.("change", onSystemColorScheme);

  apply();

  return {
    current() {
      return { ...effective };
    },
    reset,
    dispose() {
      documentObject?.removeEventListener?.("change", onInput);
      documentObject?.removeEventListener?.("click", onClick);
      resetButton?.removeEventListener("click", reset);
      windowObject?.removeEventListener?.("storage", onStorage);
      colorSchemeMedia?.removeEventListener?.("change", onSystemColorScheme);
    },
  };
}

function copyOverride(target, candidate, defaults, id, validate) {
  const value = candidate[id];
  if (!validate(value) || value === defaults[id]) return;
  target[id] = value;
}

function resolvedColorScheme(effective, colorSchemeMedia) {
  const configured = effective?.[COLOR_SCHEME_SETTING_ID];
  if (configured === "light" || configured === "dark") return configured;
  return colorSchemeMedia?.matches ? "dark" : "light";
}

function syncControls(documentObject, effective, colorSchemeMedia) {
  for (const control of documentObject?.querySelectorAll?.("[data-preference-id]") ?? []) {
    const id = control.dataset.preferenceId;
    if (id && id in effective) control.value = effective[id];
  }

  const colorScheme = resolvedColorScheme(effective, colorSchemeMedia);
  for (const toggle of documentObject?.querySelectorAll?.(
    '[data-preference-action="toggle-color-scheme"]',
  ) ?? []) {
    toggle.dataset.themeState = colorScheme;
    toggle.setAttribute?.("aria-pressed", colorScheme === "dark" ? "true" : "false");
  }
}

function safeStorage(windowObject) {
  try {
    return windowObject?.localStorage ?? null;
  } catch {
    return null;
  }
}
