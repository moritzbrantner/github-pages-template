import {
  acceptCodingToolingAnalysisMessage,
  buildEvidenceDiagnostics,
  readJsonEvidenceResponse,
  reconcileProjectEvidenceFreshness,
} from "./evidence-source.js";
import type {
  EvidenceAccomplishment,
  EvidenceDiagnostic,
  EvidenceDiagnosticRow,
  EvidenceMetric,
  EvidenceResult,
  EvidenceSource,
  NormalizedEvidence,
} from "./evidence-source.js";
import { applyTranslations, translate } from "./site-localization.js";
import {
  LOCALE_SETTING_ID,
  installSitePreferences,
  type SitePreferencesConfig,
} from "./site-preferences.js";

type RuntimeConfig = SitePreferencesConfig & {
  project: {
    name: string;
    repository: string;
    basePath: string;
  };
  evidenceSources?: EvidenceSource[];
};

declare global {
  interface Window {
    __PROJECT_PAGES_CONFIG__?: RuntimeConfig;
  }
}

const config = window.__PROJECT_PAGES_CONFIG__;
const page = document.body.dataset.page;
let preferenceController: ReturnType<typeof installSitePreferences> | null = null;
let renderedResults: EvidenceResult[] = [];

if (config) {
  preferenceController = installSitePreferences(config, {
    onChange({ effective }) {
      applyPageLocalization(effective[LOCALE_SETTING_ID]);
      if (renderedResults.length > 0) rerenderEvidence();
    },
  });
  applyPageLocalization(preferenceController.current()[LOCALE_SETTING_ID]);
}

if (config && (page === "stats" || page === "evidence")) {
  void loadEvidence();
}

function currentLocale(): string {
  return preferenceController?.current()[LOCALE_SETTING_ID] ?? document.documentElement.lang ?? "en";
}

function t(key: string, values: Readonly<Record<string, unknown>> = {}): string {
  return translate(config, currentLocale(), key, values);
}

function applyPageLocalization(locale: string): void {
  applyTranslations(document, config, locale);
  if (!config?.project) return;
  const pageLabel =
    page === "stats"
      ? translate(config, locale, "stats.title")
      : page === "evidence"
        ? translate(config, locale, "evidence.title")
        : page === "preferences"
          ? translate(config, locale, "preferences.summary")
          : null;
  document.title = pageLabel ? `${pageLabel} · ${config.project.name}` : config.project.name;
}

async function loadEvidence(): Promise<void> {
  const sources = await Promise.all((config?.evidenceSources ?? []).map(readSource));
  if (!config) return;
  renderedResults = reconcileProjectEvidenceFreshness(sources, config.project.repository);
  renderCurrentEvidence();
}

function rerenderEvidence(): void {
  if (!config) return;
  renderedResults = renderedResults.map((result) => {
    if (!result.payload) return result;
    const normalized = normalizeSource(result.source, result.payload);
    return { ...result, state: normalized.state, normalized };
  });
  renderedResults = reconcileProjectEvidenceFreshness(renderedResults, config.project.repository);
  renderCurrentEvidence();
}

function renderCurrentEvidence(): void {
  if (page === "stats") renderStats(renderedResults);
  if (page === "evidence") renderEvidence(renderedResults);
}

async function readSource(source: EvidenceSource): Promise<EvidenceResult> {
  try {
    const payload =
      source.kind === "coding-tooling-analysis-v1"
        ? await readCodingToolingBrowserSource(source)
        : await fetchJsonSource(source);
    const normalized = normalizeSource(source, payload);
    return { source, state: normalized.state, payload, normalized };
  } catch (error) {
    return {
      source,
      state: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchJsonSource(source: EvidenceSource): Promise<any> {
  const response = await fetch(source.url, { cache: "no-store" });
  return readJsonEvidenceResponse(response);
}

function readCodingToolingBrowserSource(source: EvidenceSource): Promise<any> {
  const url = new URL(source.url, location.href);
  const repository = url.searchParams.get("repo");
  if (!repository) {
    return Promise.reject(
      new Error("coding-tooling analysis source requires ?repo=owner/repository"),
    );
  }
  const requestedRepository = repository;

  const expectedOrigin = url.origin;
  url.searchParams.set("postMessage", "1");

  return new Promise<any>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");
    iframe.title = "coding-tooling analysis transport";

    const timeout = window.setTimeout(() => {
      finish(new Error("Timed out waiting for coding-tooling analysis evidence."));
    }, 30_000);

    function onMessage(event: MessageEvent): void {
      const accepted = acceptCodingToolingAnalysisMessage(event, {
        sourceWindow: iframe.contentWindow,
        expectedOrigin,
        repository: requestedRepository,
      });
      if (!accepted) return;
      if ("error" in accepted) {
        finish(new Error(accepted.error));
        return;
      }
      finish(null, accepted.analysis);
    }

    function finish(error: Error | null, payload?: any): void {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      iframe.remove();
      if (error) reject(error);
      else resolve(payload);
    }

    window.addEventListener("message", onMessage);
    iframe.src = url.href;
    document.body.append(iframe);
  });
}

function normalizeSource(source: EvidenceSource, payload: any): NormalizedEvidence {
  if (source.kind === "coding-tooling-analysis-v1") return normalizeCodingTooling(payload);
  if (source.kind === "project-evidence-v1") return normalizeProjectEvidence(payload);
  return {
    state: "incomplete",
    revision: payload?.revision ?? null,
    producer: source.producer ?? source.kind,
    metrics: [],
    accomplishments: [],
  };
}

function normalizeProjectEvidence(payload: any): NormalizedEvidence {
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload?.metrics)) {
    return {
      state: "incomplete",
      repository: payload?.repository ?? null,
      revision: payload?.revision ?? null,
      producer: payload?.producer ?? "project-evidence-v1",
      metrics: [],
      accomplishments: [],
    };
  }
  const status = payload.status ?? "unknown";
  return {
    state: status,
    repository: payload.repository ?? null,
    revision: payload.revision ?? null,
    producer: payload.producer ?? "project-evidence-v1",
    metrics: payload.metrics.map((metric: any) => ({
      label: metric.label ?? metric.id ?? t("common.unnamedMetric"),
      value: formatMetricValue(metric),
      state: metric.state ?? status,
    })),
    accomplishments: Array.isArray(payload.accomplishments) ? payload.accomplishments : [],
  };
}

function normalizeCodingTooling(payload: any): NormalizedEvidence {
  const kpis = payload?.kpis ?? {};
  const rows: EvidenceMetric[] = [];
  const checklist = kpis?.work?.checklist;
  rows.push({
    label: t("coding.checklist"),
    value:
      checklist?.remaining == null || checklist?.total == null
        ? t("common.unavailable")
        : t("coding.checklistValue", {
            remaining: formatNumber(checklist.remaining),
            completed: formatNumber(checklist.completed),
            total: formatNumber(checklist.total),
          }),
    state: kpiState(checklist),
  });
  rows.push({
    label: t("coding.publicContracts"),
    value: ratioValue(
      kpis?.publicContracts?.contracts?.verified,
      kpis?.publicContracts?.contracts?.discovered,
    ),
    state: kpiState(kpis?.publicContracts),
  });
  rows.push({
    label: t("coding.httpEndpoints"),
    value: ratioValue(
      kpis?.publicContracts?.httpEndpoints?.verified,
      kpis?.publicContracts?.httpEndpoints?.discovered,
    ),
    state: kpiState(kpis?.publicContracts),
  });
  rows.push({
    label: t("coding.functionsCovered"),
    value: coverageValue(kpis?.testCoverage?.functions),
    state: kpiState(kpis?.testCoverage),
  });
  rows.push({
    label: t("coding.linesCovered"),
    value: coverageValue(kpis?.testCoverage?.lines),
    state: kpiState(kpis?.testCoverage),
  });
  rows.push({
    label: t("coding.verificationPassed"),
    value: ratioValue(kpis?.verification?.checks?.passed, kpis?.verification?.checks?.planned),
    state: kpiState(kpis?.verification),
  });
  rows.push({
    label: t("coding.actionableFindings"),
    value:
      kpis?.findings?.total == null
        ? t("common.unavailable")
        : t("coding.findingsValue", {
            total: formatNumber(kpis.findings.total),
            highPriority: formatNumber(kpis.findings.highPriority ?? 0),
          }),
    state: kpiState(kpis?.findings),
  });

  const sourceStates = [
    checklist,
    kpis?.publicContracts,
    kpis?.testCoverage,
    kpis?.verification,
    kpis?.findings,
  ].map(kpiState);

  return {
    state: aggregateState(sourceStates),
    repository: payload?.repository?.fullName ?? null,
    revision: payload?.repository?.revision ?? null,
    producer: "coding-tooling",
    metrics: rows,
    accomplishments: [],
  };
}

function renderStats(results: EvidenceResult[]): void {
  const table = document.querySelector<HTMLElement>("#stats-table");
  const status = document.querySelector<HTMLElement>("#stats-status");
  const accomplishments = document.querySelector<HTMLElement>("#accomplishments");
  if (!table || !status || !accomplishments) return;

  const rows = results.reduce<Array<EvidenceMetric & { source: EvidenceSource }>>((items, result) => {
    if (!result.normalized) {
      items.push({
        label: result.source.label,
        value: t("common.unavailable"),
        ...(result.state === undefined ? {} : { state: result.state }),
        source: result.source,
      });
      return items;
    }
    items.push(
      ...result.normalized.metrics.map((metric) => ({ ...metric, source: result.source })),
    );
    return items;
  }, []);

  table.replaceChildren(...rows.map(metricRow));
  delete status.dataset.i18n;
  status.textContent = t(
    results.length === 1 ? "stats.status.oneSource" : "stats.status.manySources",
    {
      measurements: formatNumber(rows.length),
      sources: formatNumber(results.length),
    },
  );

  const published = results.flatMap((result) =>
    (result.normalized?.accomplishments ?? []).map((item) => ({ ...item, source: result.source })),
  );
  if (!published.length) {
    accomplishments.replaceChildren(paragraph(t("stats.noAccomplishments")));
    return;
  }
  const list = document.createElement("ol");
  list.className = "accomplishment-list";
  for (const item of published) {
    const li = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = item.title ?? t("stats.recordedAccomplishment");
    const detail = document.createElement("p");
    detail.textContent = item.detail ?? "";
    const meta = document.createElement("small");
    meta.textContent = [
      item.state,
      item.revision ? shortRevision(item.revision) : null,
      item.source.label,
    ]
      .filter(Boolean)
      .join(" · ");
    li.append(heading, detail, meta);
    list.append(li);
  }
  accomplishments.replaceChildren(list);
}

function renderEvidence(results: EvidenceResult[]): void {
  if (!config) return;
  const tableBody = document.querySelector<HTMLElement>("#evidence-table");
  const status = document.querySelector<HTMLElement>("#evidence-status");
  if (!tableBody || !status) return;

  const diagnostics = buildEvidenceDiagnostics(results, config.project.repository);
  tableBody.replaceChildren(...diagnostics.map(evidenceRow));

  const attention = diagnostics.filter((item) => item.diagnostic.code !== "current").length;
  delete status.dataset.i18n;
  status.textContent = attention
    ? t("evidence.status.attention", {
        attention: formatNumber(attention),
        total: formatNumber(diagnostics.length),
      })
    : t(
        diagnostics.length === 1 ? "evidence.status.currentOne" : "evidence.status.currentMany",
        { total: formatNumber(diagnostics.length) },
      );
}

function evidenceRow(item: EvidenceDiagnosticRow): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.id = evidenceAnchor(item.source.id);

  const sourceCell = document.createElement("th");
  sourceCell.scope = "row";
  const link = document.createElement("a");
  link.href = item.source.url;
  link.textContent = item.source.label;
  sourceCell.append(link);

  row.append(
    sourceCell,
    cell(item.repository ?? t("common.unknown")),
    cell(item.producer),
    stateCell(item.state),
    timeCell(item.generatedAt),
    revisionCell(item.evidenceRevision),
    revisionCell(item.currentRevision),
    diagnosticCell(item.diagnostic),
  );
  return row;
}

function metricRow(metric: EvidenceMetric & { source: EvidenceSource }): HTMLTableRowElement {
  const row = document.createElement("tr");
  const labelCell = document.createElement("th");
  labelCell.scope = "row";
  labelCell.textContent = metric.label ?? t("common.unnamedMetric");
  const sourceLink = document.createElement("a");
  sourceLink.href = metric.source.url;
  sourceLink.textContent = metric.source.label;
  const sourceCell = document.createElement("td");
  sourceCell.append(sourceLink);
  row.append(labelCell, cell(metric.value), metricStateCell(metric), sourceCell);
  return row;
}

function metricStateCell(metric: EvidenceMetric & { source: EvidenceSource }): HTMLTableCellElement {
  if (!config) return stateCell(metric.state);
  const td = stateCell(metric.state);
  if (stateKey(metric.state) === "current" || !metric.source?.id) return td;

  const link = document.createElement("a");
  link.href = `${config.project.basePath}evidence/#${evidenceAnchor(metric.source.id)}`;
  link.textContent = td.textContent;
  link.setAttribute(
    "aria-label",
    t("evidence.inspectDiagnostics", { state: td.textContent, source: metric.source.label }),
  );
  td.replaceChildren(link);
  return td;
}

function diagnosticCell(diagnostic: EvidenceDiagnostic): HTMLTableCellElement {
  const td = document.createElement("td");
  const strong = document.createElement("strong");
  strong.textContent = diagnostic.code;
  const detail = document.createElement("small");
  detail.textContent = diagnostic.message;
  td.append(strong, document.createElement("br"), detail);
  return td;
}

function timeCell(value: string | null): HTMLTableCellElement {
  const td = document.createElement("td");
  if (!value) {
    td.textContent = t("common.unknown");
    return td;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    td.textContent = value;
    return td;
  }
  const time = document.createElement("time");
  time.dateTime = value;
  time.title = value;
  time.textContent = date.toLocaleString(currentLocale());
  td.append(time);
  return td;
}

function revisionCell(value: string | null | undefined): HTMLTableCellElement {
  const td = document.createElement("td");
  if (!value) {
    td.textContent = t("common.unknown");
    return td;
  }
  const code = document.createElement("code");
  code.title = String(value);
  code.textContent = shortRevision(value);
  td.append(code);
  return td;
}

function evidenceAnchor(sourceId: unknown): string {
  return `source-${String(sourceId ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function cell(value: unknown): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = value == null ? t("common.unavailable") : String(value);
  return td;
}

function stateCell(value: unknown): HTMLTableCellElement {
  const td = cell(value ?? "unavailable");
  td.dataset.state = stateKey(value);
  return td;
}

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = text;
  return p;
}

function formatMetricValue(metric: EvidenceMetric): string {
  if (metric.value == null) return t("common.unavailable");
  const value = typeof metric.value === "number" ? formatNumber(metric.value) : String(metric.value);
  const unit = metric.unit ? ` ${metric.unit}` : "";
  const baseline =
    metric.baseline == null
      ? ""
      : ` · ${t("common.baseline", { value: `${formatNumber(metric.baseline)}${unit}` })}`;
  return `${value}${unit}${baseline}`;
}

function coverageValue(metric: any): string {
  if (!metric || metric.covered == null || metric.total == null) return t("common.unavailable");
  return `${formatNumber(metric.covered)}/${formatNumber(metric.total)} · ${formatPercent(metric.percent)}`;
}

function ratioValue(numerator: unknown, denominator: unknown): string {
  if (numerator == null || denominator == null) return t("common.unavailable");
  const numericNumerator = Number(numerator);
  const numericDenominator = Number(denominator);
  if (numericDenominator === 0) return t("coding.discoveredZero");
  return `${formatNumber(numerator)}/${formatNumber(denominator)} · ${formatPercent((numericNumerator / numericDenominator) * 100)}`;
}

function kpiState(kpi: any): string {
  if (!kpi) return "unavailable";
  return joinState(kpi.status ?? "unavailable", kpi.freshness ?? "unknown");
}

function joinState(status: string, freshness: string): string {
  return freshness && freshness !== "unknown" ? `${status} · ${freshness}` : status;
}

function aggregateState(states: string[]): string {
  if (states.some((value) => stateKey(value) === "unavailable")) return "incomplete";
  if (states.some((value) => stateKey(value) === "incomplete")) return "incomplete";
  if (states.some((value) => String(value).includes("stale"))) return "incomplete · stale";
  return "current";
}

function stateKey(value: unknown): string {
  const normalized = String(value ?? "unavailable").toLowerCase();
  if (normalized.includes("unavailable")) return "unavailable";
  if (
    normalized.includes("incomplete") ||
    normalized.includes("stale") ||
    normalized.includes("unverified") ||
    normalized.includes("revision missing") ||
    normalized.includes("repository mismatch")
  )
    return "incomplete";
  if (normalized.includes("failed") || normalized.includes("regression")) return "failed";
  if (normalized.includes("current") || normalized.includes("passed")) return "current";
  return "unknown";
}

function formatPercent(value: unknown): string {
  if (!Number.isFinite(Number(value))) return "n/a";
  return new Intl.NumberFormat(currentLocale(), {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(Number(value) / 100);
}

function formatNumber(value: unknown): string {
  return Number.isFinite(Number(value))
    ? new Intl.NumberFormat(currentLocale()).format(Number(value))
    : String(value);
}

function shortRevision(value: unknown): string {
  return String(value).slice(0, 12);
}
