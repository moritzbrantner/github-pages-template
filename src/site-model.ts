import type {
  EvidenceResult,
  EvidenceSource,
  NormalizedEvidence,
  NormalizedMetric,
  ProjectPagesConfig,
} from "./types";
import { translate } from "./site-localization";

export function normalizeEvidenceSource(
  config: ProjectPagesConfig,
  locale: string,
  source: EvidenceSource,
  payload: unknown,
): NormalizedEvidence {
  if (source.kind === "coding-tooling-analysis-v1") {
    return normalizeCodingTooling(config, locale, payload);
  }
  if (source.kind === "project-evidence-v1") {
    return normalizeProjectEvidence(config, locale, payload);
  }
  const record = asRecord(payload);
  return {
    state: "incomplete",
    revision: stringOrNull(record?.revision),
    producer: source.producer ?? source.kind,
    metrics: [],
    accomplishments: [],
  };
}

export function renormalizeEvidenceResults(
  config: ProjectPagesConfig,
  locale: string,
  results: EvidenceResult[],
) {
  return results.map((result) => {
    if (result.payload === undefined) return result;
    const normalized = normalizeEvidenceSource(config, locale, result.source, result.payload);
    return { ...result, state: normalized.state, normalized };
  });
}

function normalizeProjectEvidence(
  config: ProjectPagesConfig,
  locale: string,
  payload: unknown,
): NormalizedEvidence {
  const record = asRecord(payload);
  const metrics = Array.isArray(record?.metrics) ? record.metrics : null;
  if (record?.schemaVersion !== 1 || !metrics) {
    return {
      state: "incomplete",
      repository: stringOrNull(record?.repository),
      revision: stringOrNull(record?.revision),
      producer: stringOrNull(record?.producer) ?? "project-evidence-v1",
      metrics: [],
      accomplishments: [],
    };
  }

  const status = stringOrNull(record.status) ?? "unknown";
  return {
    state: status,
    repository: stringOrNull(record.repository),
    revision: stringOrNull(record.revision),
    producer: stringOrNull(record.producer) ?? "project-evidence-v1",
    metrics: metrics.map((raw) => normalizeProjectMetric(config, locale, raw, status)),
    accomplishments: Array.isArray(record.accomplishments)
      ? record.accomplishments.flatMap((raw) => {
          const item = asRecord(raw);
          if (!item) return [];
          return [{
            title: stringOrNull(item.title) ?? undefined,
            detail: stringOrNull(item.detail) ?? undefined,
            state: stringOrNull(item.state) ?? undefined,
            revision: stringOrNull(item.revision) ?? undefined,
          }];
        })
      : [],
  };
}

function normalizeProjectMetric(
  config: ProjectPagesConfig,
  locale: string,
  raw: unknown,
  defaultState: string,
): NormalizedMetric {
  const metric = asRecord(raw) ?? {};
  const rawValue = metric.value;
  const numericValue = finiteNumber(rawValue);
  const baseline = finiteNumber(metric.baseline);
  const unit = stringOrNull(metric.unit);
  const value = rawValue == null
    ? translate(config, locale, "common.unavailable")
    : formatMetricValue(config, locale, numericValue ?? String(rawValue), baseline, unit);

  return {
    label:
      stringOrNull(metric.label) ??
      stringOrNull(metric.id) ??
      translate(config, locale, "common.unnamedMetric"),
    value,
    state: stringOrNull(metric.state) ?? defaultState,
    numericValue,
    baseline,
    unit,
  };
}

function normalizeCodingTooling(
  config: ProjectPagesConfig,
  locale: string,
  payload: unknown,
): NormalizedEvidence {
  const record = asRecord(payload) ?? {};
  const repository = asRecord(record.repository);
  const kpis = asRecord(record.kpis) ?? {};
  const work = asRecord(kpis.work);
  const checklist = asRecord(work?.checklist);
  const publicContracts = asRecord(kpis.publicContracts);
  const contracts = asRecord(publicContracts?.contracts);
  const httpEndpoints = asRecord(publicContracts?.httpEndpoints);
  const testCoverage = asRecord(kpis.testCoverage);
  const functionsCoverage = asRecord(testCoverage?.functions);
  const linesCoverage = asRecord(testCoverage?.lines);
  const verification = asRecord(kpis.verification);
  const checks = asRecord(verification?.checks);
  const findings = asRecord(kpis.findings);

  const rows: NormalizedMetric[] = [
    ratioMetric(
      config,
      locale,
      "coding.checklist",
      finiteNumber(checklist?.completed),
      finiteNumber(checklist?.total),
      kpiState(checklist),
      checklist && finiteNumber(checklist.remaining) != null && finiteNumber(checklist.completed) != null && finiteNumber(checklist.total) != null
        ? translate(config, locale, "coding.checklistValue", {
            remaining: formatNumber(locale, finiteNumber(checklist.remaining)),
            completed: formatNumber(locale, finiteNumber(checklist.completed)),
            total: formatNumber(locale, finiteNumber(checklist.total)),
          })
        : null,
    ),
    ratioMetric(
      config,
      locale,
      "coding.publicContracts",
      finiteNumber(contracts?.verified),
      finiteNumber(contracts?.discovered),
      kpiState(publicContracts),
    ),
    ratioMetric(
      config,
      locale,
      "coding.httpEndpoints",
      finiteNumber(httpEndpoints?.verified),
      finiteNumber(httpEndpoints?.discovered),
      kpiState(publicContracts),
    ),
    coverageMetric(config, locale, "coding.functionsCovered", functionsCoverage, kpiState(testCoverage)),
    coverageMetric(config, locale, "coding.linesCovered", linesCoverage, kpiState(testCoverage)),
    ratioMetric(
      config,
      locale,
      "coding.verificationPassed",
      finiteNumber(checks?.passed),
      finiteNumber(checks?.planned),
      kpiState(verification),
    ),
    {
      label: translate(config, locale, "coding.actionableFindings"),
      value:
        finiteNumber(findings?.total) == null
          ? translate(config, locale, "common.unavailable")
          : translate(config, locale, "coding.findingsValue", {
              total: formatNumber(locale, finiteNumber(findings.total)),
              highPriority: formatNumber(locale, finiteNumber(findings.highPriority) ?? 0),
            }),
      state: kpiState(findings),
      numericValue: finiteNumber(findings?.total),
      unit: "count",
    },
  ];

  const sourceStates = [checklist, publicContracts, testCoverage, verification, findings].map(kpiState);
  return {
    state: aggregateState(sourceStates),
    repository: stringOrNull(repository?.fullName),
    revision: stringOrNull(repository?.revision),
    producer: "coding-tooling",
    metrics: rows,
    accomplishments: [],
  };
}

function ratioMetric(
  config: ProjectPagesConfig,
  locale: string,
  key: string,
  numerator: number | null,
  denominator: number | null,
  state: string,
  explicitValue: string | null = null,
): NormalizedMetric {
  const percentage = denominator && numerator != null ? (numerator / denominator) * 100 : null;
  return {
    label: translate(config, locale, key),
    value:
      explicitValue ??
      (numerator == null || denominator == null
        ? translate(config, locale, "common.unavailable")
        : denominator === 0
          ? translate(config, locale, "coding.discoveredZero")
          : `${formatNumber(locale, numerator)}/${formatNumber(locale, denominator)} · ${formatPercent(locale, percentage)}`),
    state,
    numericValue: percentage,
    unit: "%",
  };
}

function coverageMetric(
  config: ProjectPagesConfig,
  locale: string,
  key: string,
  metric: Record<string, unknown> | null,
  state: string,
): NormalizedMetric {
  const covered = finiteNumber(metric?.covered);
  const total = finiteNumber(metric?.total);
  const percent = finiteNumber(metric?.percent);
  return {
    label: translate(config, locale, key),
    value:
      covered == null || total == null
        ? translate(config, locale, "common.unavailable")
        : `${formatNumber(locale, covered)}/${formatNumber(locale, total)} · ${formatPercent(locale, percent)}`,
    state,
    numericValue: percent,
    unit: "%",
  };
}

function formatMetricValue(
  config: ProjectPagesConfig,
  locale: string,
  value: number | string,
  baseline: number | null,
  unit: string | null,
) {
  const formattedValue = typeof value === "number" ? formatNumber(locale, value) : value;
  const suffix = unit ? ` ${unit}` : "";
  const baselineText =
    baseline == null
      ? ""
      : ` · ${translate(config, locale, "common.baseline", {
          value: `${formatNumber(locale, baseline)}${suffix}`,
        })}`;
  return `${formattedValue}${suffix}${baselineText}`;
}

function kpiState(kpi: Record<string, unknown> | null) {
  if (!kpi) return "unavailable";
  return joinState(stringOrNull(kpi.status) ?? "unavailable", stringOrNull(kpi.freshness) ?? "unknown");
}

function joinState(status: string, freshness: string) {
  return freshness && freshness !== "unknown" ? `${status} · ${freshness}` : status;
}

function aggregateState(states: string[]) {
  if (states.some((value) => stateKey(value) === "unavailable")) return "incomplete";
  if (states.some((value) => stateKey(value) === "incomplete")) return "incomplete";
  if (states.some((value) => String(value).includes("stale"))) return "incomplete · stale";
  return "current";
}

export function stateKey(value: string | null | undefined) {
  const normalized = String(value ?? "unavailable").toLowerCase();
  if (normalized.includes("unavailable")) return "unavailable" as const;
  if (
    normalized.includes("incomplete") ||
    normalized.includes("stale") ||
    normalized.includes("unverified") ||
    normalized.includes("revision missing") ||
    normalized.includes("repository mismatch")
  ) return "incomplete" as const;
  if (normalized.includes("failed") || normalized.includes("regression")) return "failed" as const;
  if (normalized.includes("current") || normalized.includes("passed")) return "current" as const;
  return "unknown" as const;
}

export function formatNumber(locale: string, value: number | null) {
  return value == null ? "n/a" : new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(locale: string, value: number | null) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function shortRevision(value: string) {
  return value.slice(0, 12);
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
