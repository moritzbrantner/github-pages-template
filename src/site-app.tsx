import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@moritzbrantner/charts";
import { Table, type TableColumnDef } from "@moritzbrantner/tables";

import {
  acceptCodingToolingAnalysisMessage,
  buildEvidenceDiagnostics,
  readJsonEvidenceResponse,
  reconcileProjectEvidenceFreshness,
  stateKey,
} from "./evidence-source";
import { translate } from "./site-localization";
import {
  applyDocumentPreferences,
  COLOR_SCHEME_SETTING_ID,
  configuredLocales,
  CONTRAST_SETTING_ID,
  effectivePreferences,
  LOCALE_SETTING_ID,
  PREFERENCE_STORAGE_KEY,
  readPreferenceOverrides,
  resolveColorScheme,
  writePreferenceOverrides,
} from "./site-preferences";
import {
  formatNumber,
  normalizeEvidenceSource,
  renormalizeEvidenceResults,
  shortRevision,
} from "./site-model";
import type {
  EvidenceDiagnostic,
  EvidenceResult,
  EvidenceSource,
  PageId,
  PreferenceOverrides,
  PreferenceValues,
  ProjectPagesConfig,
} from "./types";

type Translate = (key: string, values?: Record<string, string | number>) => string;

interface PreferencesController {
  effective: PreferenceValues;
  resolvedColorScheme: "light" | "dark";
  setPreference: (id: keyof PreferenceValues, value: string) => void;
  reset: () => void;
}

export function SiteApp({ config, page }: { config: ProjectPagesConfig; page: PageId }) {
  const preferences = usePreferences(config);
  const locale = preferences.effective[LOCALE_SETTING_ID];
  const t = useCallback<Translate>(
    (key, values = {}) => translate(config, locale, key, values),
    [config, locale],
  );

  useEffect(() => {
    const label =
      page === "stats"
        ? t("stats.title")
        : page === "evidence"
          ? t("evidence.title")
          : page === "preferences"
            ? t("preferences.summary")
            : null;
    document.title = label ? `${label} · ${config.project.name}` : config.project.name;
  }, [config.project.name, page, t]);

  return (
    <>
      <a className="skip-link" href="#main">{t("skip.content")}</a>
      <Header config={config} page={page} preferences={preferences} t={t} />
      <main id="main" className="site-main">
        {page === "overview" ? <Overview config={config} t={t} /> : null}
        {page === "preferences" ? (
          <Preferences config={config} preferences={preferences} t={t} />
        ) : null}
        {page === "stats" || page === "evidence" ? (
          <EvidenceSurface config={config} page={page} locale={locale} t={t} />
        ) : null}
      </main>
      <footer className="site-footer">
        <span>{t("footer.evidence")}</span>
        <a href={`https://github.com/${config.project.repository}`}>{t("footer.repository")}</a>
      </footer>
    </>
  );
}

function Header({
  config,
  page,
  preferences,
  t,
}: {
  config: ProjectPagesConfig;
  page: PageId;
  preferences: PreferencesController;
  t: Translate;
}) {
  const { project } = config;
  const locale = preferences.effective[LOCALE_SETTING_ID];
  const nextTheme = preferences.resolvedColorScheme === "dark" ? "light" : "dark";

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="site-brand" href={project.basePath}>{project.name}</a>
        <div className="site-header__actions">
          <nav className="site-nav" aria-label={t("nav.project")}>
            <Nav current={page === "overview"} href={project.basePath}>{t("nav.overview")}</Nav>
            <Nav current={page === "stats"} href={`${project.basePath}stats/`}>{t("nav.stats")}</Nav>
            <Nav current={page === "evidence"} href={`${project.basePath}evidence/`}>{t("nav.evidence")}</Nav>
            {(config.links ?? []).map((link) => (
              <Nav current={false} href={link.href} key={`${link.label}:${link.href}`}>{link.label}</Nav>
            ))}
          </nav>
          <div className="site-quick-preferences">
            <button
              className="quick-control theme-toggle"
              type="button"
              aria-pressed={preferences.resolvedColorScheme === "dark"}
              onClick={() => preferences.setPreference(COLOR_SCHEME_SETTING_ID, nextTheme)}
            >
              <span aria-hidden="true">{preferences.resolvedColorScheme === "dark" ? "☾" : "☀"}</span>
              <span>{t("preferences.theme")}: {t(`preferences.theme.${preferences.resolvedColorScheme}`)}</span>
            </button>
            <label className="quick-control quick-control--language">
              <span aria-hidden="true">◎</span>
              <span className="quick-control__category">{t("preferences.language")}</span>
              <select
                aria-label={t("preferences.language")}
                value={locale}
                onChange={(event) => preferences.setPreference(LOCALE_SETTING_ID, event.target.value)}
              >
                {configuredLocales(config).map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <a
              className="quick-control quick-control--link"
              href={`${project.basePath}preferences/`}
              aria-current={page === "preferences" ? "page" : undefined}
            >
              <span aria-hidden="true">⚙</span>
              <span>{t("preferences.summary")}</span>
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}

function Nav({ current, href, children }: { current: boolean; href: string; children: ReactNode }) {
  return <a href={href} aria-current={current ? "page" : undefined}>{children}</a>;
}

function Overview({ config, t }: { config: ProjectPagesConfig; t: Translate }) {
  const { project } = config;
  return (
    <>
      <section className="hero" aria-labelledby="project-title">
        <p className="eyebrow">{project.kicker ?? project.repository}</p>
        <h1 id="project-title">{project.name}</h1>
        <p className="lede">{project.description ?? ""}</p>
        <div className="hero-links">
          {(config.links ?? []).map((link) => (
            <a href={link.href} key={`${link.label}:${link.href}`}>{link.label}</a>
          ))}
        </div>
      </section>
      <section className="content-section" aria-labelledby="evidence-summary-title">
        <h2 id="evidence-summary-title">{t("overview.evidenceTitle")}</h2>
        <p>{t("overview.evidenceBody")}</p>
        <p>
          <a href={`${project.basePath}stats/`}>{t("overview.viewStats")}</a>
          {" · "}
          <a href={`${project.basePath}evidence/`}>{t("overview.inspectEvidence")}</a>
        </p>
      </section>
    </>
  );
}

function Preferences({
  config,
  preferences,
  t,
}: {
  config: ProjectPagesConfig;
  preferences: PreferencesController;
  t: Translate;
}) {
  return (
    <>
      <section className="page-heading">
        <h1>{t("preferences.summary")}</h1>
        <p>{t("preferences.description")}</p>
      </section>
      <section className="content-section preferences-page">
        <form className="preferences-page__form" onSubmit={(event) => event.preventDefault()}>
          <PreferenceSelect
            label={t("preferences.theme")}
            value={preferences.effective[COLOR_SCHEME_SETTING_ID]}
            onChange={(value) => preferences.setPreference(COLOR_SCHEME_SETTING_ID, value)}
            options={[
              ["system", t("preferences.theme.system")],
              ["light", t("preferences.theme.light")],
              ["dark", t("preferences.theme.dark")],
            ]}
          />
          <PreferenceSelect
            label={t("preferences.contrast")}
            value={preferences.effective[CONTRAST_SETTING_ID]}
            onChange={(value) => preferences.setPreference(CONTRAST_SETTING_ID, value)}
            options={[
              ["system", t("preferences.contrast.system")],
              ["normal", t("preferences.contrast.normal")],
              ["high", t("preferences.contrast.high")],
              ["low", t("preferences.contrast.low")],
            ]}
          />
          <PreferenceSelect
            label={t("preferences.language")}
            value={preferences.effective[LOCALE_SETTING_ID]}
            onChange={(value) => preferences.setPreference(LOCALE_SETTING_ID, value)}
            options={configuredLocales(config).map((item): [string, string] => [item.id, item.label])}
          />
          <button type="button" onClick={preferences.reset}>{t("preferences.reset")}</button>
        </form>
      </section>
    </>
  );
}

function PreferenceSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="preferences-page__field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
      </select>
    </label>
  );
}

