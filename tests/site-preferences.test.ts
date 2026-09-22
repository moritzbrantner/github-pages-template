import assert from "node:assert/strict";
import test from "node:test";
import {
  COLOR_SCHEME_SETTING_ID,
  CONTRAST_SETTING_ID,
  LOCALE_SETTING_ID,
  effectivePreferences,
  isRtlLocale,
  normalizePreferenceOverrides,
  preferenceDefaults,
  readPreferenceOverrides,
  writePreferenceOverrides,
} from "../build/src/site-preferences.js";

function config() {
  return {
    preferences: {
      defaults: {
        [COLOR_SCHEME_SETTING_ID]: "system",
        [CONTRAST_SETTING_ID]: "normal",
        [LOCALE_SETTING_ID]: "en",
      },
      locales: [
        { id: "en", label: "English" },
        { id: "de", label: "Deutsch" },
        { id: "ar", label: "العربية" },
      ],
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

test("preference defaults use the settings appearance identifiers", () => {
  assert.deepEqual(preferenceDefaults(config()), {
    "appearance.color_scheme": "system",
    "appearance.contrast": "normal",
    "localization.locale": "en",
  });
});

test("only valid non-default overrides are persisted", () => {
  const normalized = normalizePreferenceOverrides(config(), {
    [COLOR_SCHEME_SETTING_ID]: "dark",
    [CONTRAST_SETTING_ID]: "normal",
    [LOCALE_SETTING_ID]: "de",
    ignored: "value",
  });

  assert.deepEqual(normalized, {
    [COLOR_SCHEME_SETTING_ID]: "dark",
    [LOCALE_SETTING_ID]: "de",
  });
  assert.deepEqual(effectivePreferences(config(), normalized), {
    [COLOR_SCHEME_SETTING_ID]: "dark",
    [CONTRAST_SETTING_ID]: "normal",
    [LOCALE_SETTING_ID]: "de",
  });
});

test("invalid persisted choices fail closed to project defaults", () => {
  assert.deepEqual(
    normalizePreferenceOverrides(config(), {
      [COLOR_SCHEME_SETTING_ID]: "sepia",
      [CONTRAST_SETTING_ID]: "extreme",
      [LOCALE_SETTING_ID]: "xx-invalid",
    }),
    {},
  );
});

test("storage contains overrides rather than copied defaults", () => {
  const storage = memoryStorage();
  writePreferenceOverrides(storage, config(), {
    [COLOR_SCHEME_SETTING_ID]: "dark",
    [CONTRAST_SETTING_ID]: "normal",
    [LOCALE_SETTING_ID]: "en",
  });

  assert.equal(storage.values.size, 1);
  assert.deepEqual(readPreferenceOverrides(storage, config()), {
    [COLOR_SCHEME_SETTING_ID]: "dark",
  });

  writePreferenceOverrides(storage, config(), preferenceDefaults(config()));
  assert.equal(storage.values.size, 0);
});

test("locale direction follows the selected language", () => {
  assert.equal(isRtlLocale("ar"), true);
  assert.equal(isRtlLocale("ar-EG"), true);
  assert.equal(isRtlLocale("de-DE"), false);
});
