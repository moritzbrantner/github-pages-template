export const PREFERENCE_STORAGE_KEY = "@moritzbrantner/github-pages-template.preferences.v1";

export const COLOR_SCHEME_SETTING_ID = "appearance.color_scheme";
export const CONTRAST_SETTING_ID = "appearance.contrast";
export const LOCALE_SETTING_ID = "localization.locale";

export const COLOR_SCHEME_VALUES = Object.freeze(["system", "light", "dark"] as const);
export const CONTRAST_VALUES = Object.freeze(["system", "normal", "high", "low"] as const);

export type ColorScheme = (typeof COLOR_SCHEME_VALUES)[number];
export type Contrast = (typeof CONTRAST_VALUES)[number];
export type PreferenceId =
  | typeof COLOR_SCHEME_SETTING_ID
  | typeof CONTRAST_SETTING_ID
  | typeof LOCALE_SETTING_ID;
export type PreferenceValues = {
  [COLOR_SCHEME_SETTING_ID]: ColorScheme;
  [CONTRAST_SETTING_ID]: Contrast;
  [LOCALE_SETTING_ID]: string;
};
export type PreferenceOverrides = Partial<PreferenceValues>;
export type SitePreferencesConfig = {
  preferences?: {
    defaults?: Record<string, unknown>;
    locales?: ReadonlyArray<{ id: string; label: string }>;
    messages?: Record<string, Record<string, string>>;
  };
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PreferenceController = {
  current(): PreferenceValues;
  reset(): void;
  dispose(): void;
};
type InstallOptions = {
  window?: Window;
  document?: Document;
  onChange?: (change: {
    reason: string;
    effective: PreferenceValues;
    overrides: PreferenceOverrides;
  }) => void;
};

const DEFAULT_LOCALES = Object.freeze([{ id: "en", label: "English" }]);
const COLOR_SCHEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function configuredLocales(config: SitePreferencesConfig) {
  const configured = config?.preferences?.locales;
  if (!Array.isArray(configured) || configured.length === 0) {
    return DEFAULT_LOCALES.map((locale) => ({ ...locale }));
  }
  return configured.map((locale) => ({ id: String(locale.id), label: String(locale.label) }));
}

export function preferenceDefaults(config: SitePreferencesConfig): PreferenceValues {
  const configured = config?.preferences?.defaults ?? {};
  const locales = configuredLocales(config);
  const localeIds = new Set(locales.map((locale) => locale.id));

  const configuredColorScheme = configured[COLOR_SCHEME_SETTING_ID];
  const colorScheme = COLOR_SCHEME_VALUES.includes(configuredColorScheme as ColorScheme)
    ? (configuredColorScheme as ColorScheme)
    : "system";
  const configuredContrast = configured[CONTRAST_SETTING_ID];
  const contrast = CONTRAST_VALUES.includes(configuredContrast as Contrast)
    ? (configuredContrast as Contrast)
    : "system";
  const configuredLocale = configured[LOCALE_SETTING_ID];
  const locale = typeof configuredLocale === "string" && localeIds.has(configuredLocale)
    ? configuredLocale
    : (locales[0]?.id ?? "en");

  return {
    [COLOR_SCHEME_SETTING_ID]: colorScheme,
    [CONTRAST_SETTING_ID]: contrast,
    [LOCALE_SETTING_ID]: locale,
  };
}

export function normalizePreferenceOverrides(
  config: SitePreferencesConfig,
  candidate: unknown,
): PreferenceOverrides {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};

  const defaults = preferenceDefaults(config);
  const locales = new Set(configuredLocales(config).map((locale) => locale.id));
  const normalized: PreferenceOverrides = {};
  const values = candidate as Record<string, unknown>;

  copyOverride(
    normalized,
    values,
    defaults,
    COLOR_SCHEME_SETTING_ID,
    (value): value is ColorScheme => COLOR_SCHEME_VALUES.includes(value as ColorScheme),
  );
  copyOverride(
    normalized,
    values,
    defaults,
    CONTRAST_SETTING_ID,
    (value): value is Contrast => CONTRAST_VALUES.includes(value as Contrast),
  );
  copyOverride(
    normalized,
    values,
    defaults,
    LOCALE_SETTING_ID,
    (value): value is string => typeof value === "string" && locales.has(value),
  );

  return normalized;
}

export function effectivePreferences(
  config: SitePreferencesConfig,
  overrides: unknown,
): PreferenceValues {
  return {
    ...preferenceDefaults(config),
    ...normalizePreferenceOverrides(config, overrides),
  };
}

export function isRtlLocale(locale: unknown): boolean {
  const language = String(locale ?? "")
    .toLowerCase()
    .split(/[-_]/, 1)[0];
  return new Set(["ar", "fa", "he", "ur"]).has(language ?? "");
}

export function applyDocumentPreferences(
  document: Document | null | undefined,
  preferences: PreferenceValues,
): void {
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

export function readPreferenceOverrides(
  storage: StorageLike | null,
  config: SitePreferencesConfig,
): PreferenceOverrides {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PREFERENCE_STORAGE_KEY);
    return raw ? normalizePreferenceOverrides(config, JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writePreferenceOverrides(
  storage: StorageLike | null,
  config: SitePreferencesConfig,
  candidate: unknown,
): PreferenceOverrides {
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

export function installSitePreferences(
  config: SitePreferencesConfig,
  options: InstallOptions = {},
): PreferenceController {
  const windowObject = options.window ?? globalThis.window;
  const documentObject = options.document ?? globalThis.document;
  const storage = safeStorage(windowObject);
  const colorSchemeMedia = windowObject?.matchMedia?.(COLOR_SCHEME_MEDIA_QUERY) ?? null;
  let overrides = readPreferenceOverrides(storage, config);
  let effective = effectivePreferences(config, overrides);

  function apply(reason = "initial"): void {
    effective = effectivePreferences(config, overrides);
    applyDocumentPreferences(documentObject, effective);
    syncControls(documentObject, effective, colorSchemeMedia);
    options.onChange?.({ reason, effective: { ...effective }, overrides: { ...overrides } });
  }

  function update(id: PreferenceId, value: string): void {
    overrides = normalizePreferenceOverrides(config, { ...overrides, [id]: value });
    overrides = writePreferenceOverrides(storage, config, overrides);
    apply("user");
  }

  function reset(): void {
    overrides = writePreferenceOverrides(storage, config, {});
    apply("reset");
  }

  const onInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const id = target.dataset.preferenceId as PreferenceId | undefined;
    if (!id) return;
    update(id, target.value);
  };
  documentObject?.addEventListener?.("change", onInput);

  const onClick = (event: Event) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-preference-action]")
      : null;
    if (target?.dataset?.preferenceAction !== "toggle-color-scheme") return;
    const current = resolvedColorScheme(effective, colorSchemeMedia);
    update(COLOR_SCHEME_SETTING_ID, current === "dark" ? "light" : "dark");
  };
  documentObject?.addEventListener?.("click", onClick);

  const resetButton = documentObject?.querySelector("#site-preferences-reset");
  resetButton?.addEventListener("click", reset);

  const onStorage = (event: StorageEvent) => {
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

function copyOverride<T extends string>(
  target: PreferenceOverrides,
  candidate: Record<string, unknown>,
  defaults: PreferenceValues,
  id: PreferenceId,
  validate: (value: unknown) => value is T,
): void {
  const value = candidate[id];
  if (!validate(value) || value === defaults[id]) return;
  (target as Record<string, unknown>)[id] = value;
}

function resolvedColorScheme(
  effective: PreferenceValues,
  colorSchemeMedia: MediaQueryList | null,
): "light" | "dark" {
  const configured = effective?.[COLOR_SCHEME_SETTING_ID];
  if (configured === "light" || configured === "dark") return configured;
  return colorSchemeMedia?.matches ? "dark" : "light";
}

function syncControls(
  documentObject: Document | undefined,
  effective: PreferenceValues,
  colorSchemeMedia: MediaQueryList | null,
): void {
  for (const control of documentObject?.querySelectorAll<HTMLSelectElement>("[data-preference-id]") ?? []) {
    const id = control.dataset.preferenceId;
    if (id && id in effective) control.value = effective[id as PreferenceId];
  }

  const colorScheme = resolvedColorScheme(effective, colorSchemeMedia);
  for (const toggle of documentObject?.querySelectorAll<HTMLElement>(
    '[data-preference-action="toggle-color-scheme"]',
  ) ?? []) {
    toggle.dataset.themeState = colorScheme;
    toggle.setAttribute?.("aria-pressed", colorScheme === "dark" ? "true" : "false");
  }
}

function safeStorage(windowObject: Window | undefined): StorageLike | null {
  try {
    return windowObject?.localStorage ?? null;
  } catch {
    return null;
  }
}
