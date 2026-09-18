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


function EvidenceSurface({
  config,
  page,
  locale,
  t,
}: {
  config: ProjectPagesConfig;
  page: "stats" | "evidence";
  locale: string;
  t: Translate;
}) {
  const raw = useRawEvidence(config);
  const results = useMemo(() => {
    const localized = renormalizeEvidenceResults(config, locale, raw.results);
    return reconcileProjectEvidenceFreshness(localized, config.project.repository);
  }, [config, locale, raw.results]);

  return page === "stats" ? (
    <StatsPage config={config} locale={locale} results={results} loading={raw.loading} t={t} />
  ) : (
    <EvidencePage config={config} locale={locale} results={results} loading={raw.loading} t={t} />
  );
}

interface MetricRow {
  id: string;
  label: string;
  value: string;
  state: string;
  source: EvidenceSource;
  numericValue?: number | null;
  baseline?: number | null;
  unit?: string | null;
}

function StatsPage({
  config,
  locale,
  results,
  loading,
  t,
}: {
  config: ProjectPagesConfig;
  locale: string;
  results: EvidenceResult[];
  loading: boolean;
  t: Translate;
}) {
  const rows = useMemo<MetricRow[]>(
    () =>
      results.flatMap((result) => {
        if (!result.normalized) {
          return [{
            id: `${result.source.id}:unavailable`,
            label: result.source.label,
            value: t("common.unavailable"),
            state: result.state,
            source: result.source,
          }];
        }
        return result.normalized.metrics.map((metric, index) => ({
          ...metric,
          id: `${result.source.id}:${index}:${metric.label}`,
          source: result.source,
        }));
      }),
    [results, t],
  );

  const columns = useMemo<Array<TableColumnDef<MetricRow>>>(
    () => [
      { id: "metric", header: t("stats.table.metric"), accessor: "label" },
      { id: "value", header: t("stats.table.value"), accessor: "value" },
      {
        id: "state",
        header: t("stats.table.state"),
        accessor: "state",
        cell: (_value, row) => (
          <span className={`evidence-state evidence-state--${stateKey(row.state)}`}>
            {stateKey(row.state) === "current" ? row.state : (
              <a
                href={`${config.project.basePath}evidence/#${evidenceAnchor(row.source.id)}`}
                aria-label={t("evidence.inspectDiagnostics", {
                  state: row.state,
                  source: row.source.label,
                })}
              >
                {row.state}
              </a>
            )}
          </span>
        ),
      },
      {
        id: "source",
        header: t("stats.table.source"),
        accessor: (row) => row.source.label,
        cell: (_value, row) => <a href={row.source.url}>{row.source.label}</a>,
      },
    ],
    [config.project.basePath, t],
  );

  const status = loading
    ? t("stats.loading")
    : t(results.length === 1 ? "stats.status.oneSource" : "stats.status.manySources", {
        measurements: formatNumber(locale, rows.length),
        sources: formatNumber(locale, results.length),
      });
  const accomplishments = results.flatMap((result) =>
    (result.normalized?.accomplishments ?? []).map((item, index) => ({
      ...item,
      id: `${result.source.id}:${index}`,
      source: result.source,
    })),
  );

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">{t("stats.eyebrow")}</p>
        <h1>{t("stats.title")}</h1>
        <p>{t("stats.intro")}</p>
      </section>
      <section className="content-section" aria-labelledby="stats-title">
        <h2 id="stats-title">{t("stats.currentTitle")}</h2>
        <div className="status-line" aria-live="polite">{status}</div>
        <div className="shared-table">
          <Table
            ariaLabel={t("stats.currentTitle")}
            columns={columns}
            density="compact"
            emptyState={loading ? t("stats.loading") : t("common.unavailable")}
            rowKey="id"
            rows={rows}
            striped
          />
        </div>
      </section>
      <MetricCharts results={results} t={t} />
      <section className="content-section" aria-labelledby="accomplishments-title">
        <h2 id="accomplishments-title">{t("stats.accomplishmentsTitle")}</h2>
        {accomplishments.length === 0 ? (
          <p className="muted">{t("stats.noAccomplishments")}</p>
        ) : (
          <ol className="accomplishment-list">
            {accomplishments.map((item) => (
              <li key={item.id}>
                <strong>{item.title ?? t("stats.recordedAccomplishment")}</strong>
                {item.detail ? <p>{item.detail}</p> : null}
                <small>
                  {[item.state, item.revision ? shortRevision(item.revision) : null, item.source.label]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function MetricCharts({ results, t }: { results: EvidenceResult[]; t: Translate }) {
  const groups = useMemo(() => {
    const grouped = new Map<
      string,
      { id: string; label: string; rows: Array<{ label: string; current: number; baseline?: number }> }
    >();

    for (const result of results) {
      for (const metric of result.normalized?.metrics ?? []) {
        if (metric.numericValue == null || !Number.isFinite(metric.numericValue) || !metric.unit) continue;
        const metricState = stateKey(metric.state);
        if (metricState === "unavailable" || metricState === "incomplete") continue;
        const id = `${result.source.id}:${metric.unit}`;
        const group = grouped.get(id) ?? {
          id,
          label: `${result.source.label} · ${metric.unit}`,
          rows: [],
        };
        group.rows.push({
          label: metric.label,
          current: metric.numericValue,
          ...(metric.baseline != null ? { baseline: metric.baseline } : {}),
        });
        grouped.set(id, group);
      }
    }
    return [...grouped.values()].filter((group) => group.rows.length >= 2);
  }, [results]);

  if (groups.length === 0) return null;

  return (
    <section className="content-section" aria-labelledby="stats-charts-title">
      <h2 id="stats-charts-title">{t("stats.chartsTitle")}</h2>
      <p className="muted">{t("stats.chartsIntro")}</p>
      <div className="stats-chart-grid">
        {groups.map((group) => {
          const hasBaseline = group.rows.some((row) => row.baseline != null);
          const chartConfig = {
            current: { label: t("stats.chart.current"), color: "var(--accent)" },
            ...(hasBaseline
              ? { baseline: { label: t("stats.chart.baseline"), color: "var(--muted)" } }
              : {}),
          };
          return (
            <article className="stats-chart-panel" key={group.id}>
              <h3>{group.label}</h3>
              <ChartContainer className="stats-chart" config={chartConfig}>
                <BarChart
                  data={group.rows}
                  layout="vertical"
                  margin={{ top: 8, right: 20, bottom: 8, left: 8 }}
                  accessibilityLayer
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" />
                  <YAxis dataKey="label" type="category" width={180} tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="current" name={t("stats.chart.current")} fill="var(--color-current)" radius={3} />
                  {hasBaseline ? (
                    <Bar dataKey="baseline" name={t("stats.chart.baseline")} fill="var(--color-baseline)" radius={3} />
                  ) : null}
                </BarChart>
              </ChartContainer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

