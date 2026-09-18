import type {
  ColorScheme,
  Contrast,
  PreferenceOverrides,
  PreferenceValues,
  ProjectPagesConfig,
} from "./types";

export const PREFERENCE_STORAGE_KEY = "@moritzbrantner/github-pages-template.preferences.v1";

export const COLOR_SCHEME_SETTING_ID = "appearance.color_scheme" as const;
export const CONTRAST_SETTING_ID = "appearance.contrast" as const;
export const LOCALE_SETTING_ID = "localization.locale" as const;

export const COLOR_SCHEME_VALUES = Object.freeze<ColorScheme[]>(["system", "light", "dark"]);
export const CONTRAST_VALUES = Object.freeze<Contrast[]>(["system", "normal", "high", "low"]);

const DEFAULT_LOCALES = Object.freeze([{ id: "en", label: "English" }]);
const COLOR_SCHEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PreferenceSettingId = keyof PreferenceValues;

export function configuredLocales(config: ProjectPagesConfig) {
  const configured = config.preferences?.locales;
  if (!Array.isArray(configured) || configured.length === 0) {
    return DEFAULT_LOCALES.map((locale) => ({ ...locale }));
  }
  return configured.map((locale) => ({ id: String(locale.id), label: String(locale.label) }));
}

export function preferenceDefaults(config: ProjectPagesConfig): PreferenceValues {
  const configured = config.preferences?.defaults ?? {};
  const locales = configuredLocales(config);
  const localeIds = new Set(locales.map((locale) => locale.id));

  const configuredColorScheme = configured[COLOR_SCHEME_SETTING_ID];
  const colorScheme: ColorScheme = COLOR_SCHEME_VALUES.includes(configuredColorScheme as ColorScheme)
    ? (configuredColorScheme as ColorScheme)
    : "system";
  const configuredContrast = configured[CONTRAST_SETTING_ID];
  const contrast: Contrast = CONTRAST_VALUES.includes(configuredContrast as Contrast)
    ? (configuredContrast as Contrast)
    : "system";
  const configuredLocale = configured[LOCALE_SETTING_ID];
  const locale = configuredLocale && localeIds.has(configuredLocale) ? configuredLocale : locales[0].id;

  return {
    [COLOR_SCHEME_SETTING_ID]: colorScheme,
    [CONTRAST_SETTING_ID]: contrast,
    [LOCALE_SETTING_ID]: locale,
  };
}

export function normalizePreferenceOverrides(
  config: ProjectPagesConfig,
  candidate: unknown,
): PreferenceOverrides {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};

  const defaults = preferenceDefaults(config);
  const locales = new Set(configuredLocales(config).map((locale) => locale.id));
  const values = candidate as Record<string, unknown>;
  const normalized: PreferenceOverrides = {};

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
  config: ProjectPagesConfig,
  overrides: PreferenceOverrides,
): PreferenceValues {
  return {
    ...preferenceDefaults(config),
    ...normalizePreferenceOverrides(config, overrides),
  };
}

export function isRtlLocale(locale: string | null | undefined) {
  const language = String(locale ?? "")
    .toLowerCase()
    .split(/[-_]/, 1)[0];
  return new Set(["ar", "fa", "he", "ur"]).has(language);
}

export function applyDocumentPreferences(
  documentObject: Pick<Document, "documentElement"> | null | undefined,
  preferences: PreferenceValues,
) {
  const root = documentObject?.documentElement;
  if (!root) return;

  const colorScheme = preferences[COLOR_SCHEME_SETTING_ID];
  if (colorScheme === "system") delete root.dataset.colorScheme;
  else root.dataset.colorScheme = colorScheme;

  const contrast = preferences[CONTRAST_SETTING_ID];
  if (contrast === "system") delete root.dataset.contrast;
  else root.dataset.contrast = contrast;

  const locale = preferences[LOCALE_SETTING_ID];
  root.lang = locale;
  root.dir = isRtlLocale(locale) ? "rtl" : "ltr";
}

export function readPreferenceOverrides(
  storage: StorageLike | null | undefined,
  config: ProjectPagesConfig,
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
  storage: StorageLike | null | undefined,
  config: ProjectPagesConfig,
  candidate: unknown,
): PreferenceOverrides {
  if (!storage) return normalizePreferenceOverrides(config, candidate);
  const normalized = normalizePreferenceOverrides(config, candidate);
  try {
    if (Object.keys(normalized).length === 0) storage.removeItem(PREFERENCE_STORAGE_KEY);
    else storage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Preferences remain usable for the current page when storage is unavailable.
  }
  return normalized;
}

interface InstallSitePreferencesOptions {
  window?: Window;
  document?: Document;
  onChange?: (event: {
    reason: string;
    effective: PreferenceValues;
    overrides: PreferenceOverrides;
  }) => void;
}

export function installSitePreferences(
  config: ProjectPagesConfig,
  options: InstallSitePreferencesOptions = {},
) {
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

  function update(id: PreferenceSettingId, value: string) {
    overrides = normalizePreferenceOverrides(config, { ...overrides, [id]: value });
    overrides = writePreferenceOverrides(storage, config, overrides);
    apply("user");
  }

  function reset() {
    overrides = writePreferenceOverrides(storage, config, {});
    apply("reset");
  }

  const onInput = (event: Event) => {
    const target = event.target as
      | (EventTarget & { tagName?: string; dataset?: DOMStringMap; value?: string })
      | null;
    if (target?.tagName !== "SELECT") return;
    const id = target.dataset?.preferenceId as PreferenceSettingId | undefined;
    if (!id || typeof target.value !== "string") return;
    update(id, target.value);
  };
  documentObject?.addEventListener?.("change", onInput);

  const onClick = (event: Event) => {
    const eventTarget = event.target as
      | (EventTarget & { closest?: (selector: string) => HTMLElement | null })
      | null;
    const target = eventTarget?.closest?.("[data-preference-action]") ?? null;
    if (target?.dataset.preferenceAction !== "toggle-color-scheme") return;
    const current = resolvedColorScheme(effective, colorSchemeMedia);
    update(COLOR_SCHEME_SETTING_ID, current === "dark" ? "light" : "dark");
  };
  documentObject?.addEventListener?.("click", onClick);

  const resetButton = documentObject?.querySelector<HTMLButtonElement>("#site-preferences-reset");
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

export function resolveColorScheme(
  preferences: PreferenceValues,
  colorSchemeMedia: Pick<MediaQueryList, "matches"> | null | undefined,
): "light" | "dark" {
  return resolvedColorScheme(preferences, colorSchemeMedia);
}

function copyOverride<TKey extends PreferenceSettingId>(
  target: PreferenceOverrides,
  candidate: Record<string, unknown>,
  defaults: PreferenceValues,
  id: TKey,
  validate: (value: unknown) => value is PreferenceValues[TKey],
) {
  const value = candidate[id];
  if (!validate(value) || value === defaults[id]) return;
  (target as unknown as Record<string, unknown>)[id] = value;
}

function resolvedColorScheme(
  effective: PreferenceValues,
  colorSchemeMedia: Pick<MediaQueryList, "matches"> | null | undefined,
) {
  const configured = effective[COLOR_SCHEME_SETTING_ID];
  if (configured === "light" || configured === "dark") return configured;
  return colorSchemeMedia?.matches ? "dark" : "light";
}

function syncControls(
  documentObject: Document | null | undefined,
  effective: PreferenceValues,
  colorSchemeMedia: MediaQueryList | null,
) {
  for (const control of documentObject?.querySelectorAll<HTMLSelectElement>("[data-preference-id]") ?? []) {
    const id = control.dataset.preferenceId as PreferenceSettingId | undefined;
    if (id && id in effective) control.value = effective[id];
  }

  const colorScheme = resolvedColorScheme(effective, colorSchemeMedia);
  for (const toggle of documentObject?.querySelectorAll<HTMLElement>(
    '[data-preference-action="toggle-color-scheme"]',
  ) ?? []) {
    toggle.dataset.themeState = colorScheme;
    toggle.setAttribute("aria-pressed", colorScheme === "dark" ? "true" : "false");
  }
}

function safeStorage(windowObject: Window | undefined): StorageLike | null {
  try {
    return windowObject?.localStorage ?? null;
  } catch {
    return null;
  }
}
