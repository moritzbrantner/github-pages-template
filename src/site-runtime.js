import { acceptCodingToolingAnalysisMessage } from "./evidence-source.js";

const config = window.__PROJECT_PAGES_CONFIG__;
const page = document.body.dataset.page;

if (config && (page === "stats" || page === "evidence")) {
  void loadEvidence();
}

async function loadEvidence() {
  const sources = await Promise.all((config.evidenceSources ?? []).map(readSource));
  if (page === "stats") renderStats(sources);
  if (page === "evidence") renderEvidence(sources);
}

async function readSource(source) {
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

async function fetchJsonSource(source) {
  const response = await fetch(source.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function readCodingToolingBrowserSource(source) {
  const url = new URL(source.url, location.href);
  const repository = url.searchParams.get("repo");
  if (!repository) {
    return Promise.reject(
      new Error("coding-tooling analysis source requires ?repo=owner/repository"),
    );
  }

  const expectedOrigin = url.origin;
  url.searchParams.set("postMessage", "1");

  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.setAttribute("aria-hidden", "true");
    iframe.title = "coding-tooling analysis transport";

    const timeout = window.setTimeout(() => {
      finish(new Error("Timed out waiting for coding-tooling analysis evidence."));
    }, 30_000);

    function onMessage(event) {
      const accepted = acceptCodingToolingAnalysisMessage(event, {
        sourceWindow: iframe.contentWindow,
        expectedOrigin,
        repository,
      });
      if (!accepted) return;
      if (accepted.error) {
        finish(new Error(accepted.error));
        return;
      }
      finish(null, accepted.analysis);
    }

    function finish(error, payload) {
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

function normalizeSource(source, payload) {
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

function normalizeProjectEvidence(payload) {
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload?.metrics)) {
    return {
      state: "incomplete",
      revision: payload?.revision ?? null,
      producer: payload?.producer ?? "project-evidence-v1",
      metrics: [],
      accomplishments: [],
    };
  }
  const freshness = payload.freshness ?? "unknown";
  const status = payload.status ?? "current";
  return {
    state: joinState(status, freshness),
    revision: payload.revision ?? null,
    producer: payload.producer ?? "project-evidence-v1",
    metrics: payload.metrics.map((metric) => ({
      label: metric.label ?? metric.id ?? "Unnamed metric",
      value: formatMetricValue(metric),
      state: metric.state ?? joinState(status, freshness),
    })),
    accomplishments: Array.isArray(payload.accomplishments) ? payload.accomplishments : [],
  };
}

function normalizeCodingTooling(payload) {
  const kpis = payload?.kpis ?? {};
  const rows = [];
  const checklist = kpis?.work?.checklist;
  rows.push({
    label: "Checklist work",
    value:
      checklist?.remaining == null || checklist?.total == null
        ? "Unavailable"
        : `${checklist.remaining} remaining · ${checklist.completed}/${checklist.total} complete`,
    state: kpiState(checklist),
  });
  rows.push({
    label: "Public contracts verified",
    value: ratioValue(
      kpis?.publicContracts?.contracts?.verified,
      kpis?.publicContracts?.contracts?.discovered,
    ),
    state: kpiState(kpis?.publicContracts),
  });
  rows.push({
    label: "HTTP endpoints verified",
    value: ratioValue(
      kpis?.publicContracts?.httpEndpoints?.verified,
      kpis?.publicContracts?.httpEndpoints?.discovered,
    ),
    state: kpiState(kpis?.publicContracts),
  });
  rows.push({
    label: "Functions covered by tests",
    value: coverageValue(kpis?.testCoverage?.functions),
    state: kpiState(kpis?.testCoverage),
  });
  rows.push({
    label: "Lines covered by tests",
    value: coverageValue(kpis?.testCoverage?.lines),
    state: kpiState(kpis?.testCoverage),
  });
  rows.push({
    label: "Verification checks passed",
    value: ratioValue(kpis?.verification?.checks?.passed, kpis?.verification?.checks?.planned),
    state: kpiState(kpis?.verification),
  });
  rows.push({
    label: "Actionable findings",
    value:
      kpis?.findings?.total == null
        ? "Unavailable"
        : `${kpis.findings.total} total · ${kpis.findings.highPriority ?? 0} high priority`,
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
    revision: payload?.repository?.revision ?? null,
    producer: "coding-tooling",
    metrics: rows,
    accomplishments: [],
  };
}

function renderStats(results) {
  const table = document.querySelector("#stats-table");
  const status = document.querySelector("#stats-status");
  const accomplishments = document.querySelector("#accomplishments");
  if (!table || !status || !accomplishments) return;

  const rows = results.flatMap((result) => {
    if (!result.normalized) {
      return [
        {
          label: result.source.label,
          value: "Unavailable",
          state: result.state,
          source: result.source,
        },
      ];
    }
    return result.normalized.metrics.map((metric) => ({ ...metric, source: result.source }));
  });

  table.replaceChildren(...rows.map(metricRow));
  status.textContent = `${rows.length} measurements from ${results.length} configured evidence source${results.length === 1 ? "" : "s"}.`;

  const published = results.flatMap((result) =>
    (result.normalized?.accomplishments ?? []).map((item) => ({ ...item, source: result.source })),
  );
  if (!published.length) {
    accomplishments.replaceChildren(
      paragraph("No published accomplishment evidence is available for this revision."),
    );
    return;
  }
  const list = document.createElement("ol");
  list.className = "accomplishment-list";
  for (const item of published) {
    const li = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = item.title ?? "Recorded accomplishment";
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

function renderEvidence(results) {
  const table = document.querySelector("#evidence-table");
  const status = document.querySelector("#evidence-status");
  if (!table || !status) return;
  table.replaceChildren(
    ...results.map((result) => {
      const row = document.createElement("tr");
      const sourceCell = document.createElement("th");
      sourceCell.scope = "row";
      const link = document.createElement("a");
      link.href = result.source.url;
      link.textContent = result.source.label;
      sourceCell.append(link);
      row.append(
        sourceCell,
        cell(result.normalized?.state ?? result.state),
        cell(result.normalized?.revision ? shortRevision(result.normalized.revision) : "Unknown"),
        cell(result.normalized?.producer ?? result.source.producer ?? result.source.kind),
      );
      return row;
    }),
  );
  const unavailable = results.filter((result) => !result.normalized).length;
  status.textContent = unavailable
    ? `${unavailable} of ${results.length} evidence sources unavailable; unavailable evidence is not treated as green.`
    : `${results.length} evidence source${results.length === 1 ? "" : "s"} loaded.`;
}

function metricRow(metric) {
  const row = document.createElement("tr");
  const labelCell = document.createElement("th");
  labelCell.scope = "row";
  labelCell.textContent = metric.label;
  const sourceLink = document.createElement("a");
  sourceLink.href = metric.source.url;
  sourceLink.textContent = metric.source.label;
  const sourceCell = document.createElement("td");
  sourceCell.append(sourceLink);
  row.append(labelCell, cell(metric.value), stateCell(metric.state), sourceCell);
  return row;
}

function cell(value) {
  const td = document.createElement("td");
  td.textContent = value ?? "Unavailable";
  return td;
}

function stateCell(value) {
  const td = cell(value ?? "unavailable");
  td.dataset.state = stateKey(value);
  return td;
}

function paragraph(text) {
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = text;
  return p;
}

function formatMetricValue(metric) {
  if (metric.value == null) return "Unavailable";
  const value = typeof metric.value === "number" ? formatNumber(metric.value) : String(metric.value);
  const unit = metric.unit ? ` ${metric.unit}` : "";
  const baseline =
    metric.baseline == null ? "" : ` · baseline ${formatNumber(metric.baseline)}${unit}`;
  return `${value}${unit}${baseline}`;
}

function coverageValue(metric) {
  if (!metric || metric.covered == null || metric.total == null) return "Unavailable";
  return `${metric.covered}/${metric.total} · ${formatPercent(metric.percent)}`;
}

function ratioValue(numerator, denominator) {
  if (numerator == null || denominator == null) return "Unavailable";
  if (denominator === 0) return "0 discovered";
  return `${numerator}/${denominator} · ${formatPercent((numerator / denominator) * 100)}`;
}

function kpiState(kpi) {
  if (!kpi) return "unavailable";
  return joinState(kpi.status ?? "unavailable", kpi.freshness ?? "unknown");
}

function joinState(status, freshness) {
  return freshness && freshness !== "unknown" ? `${status} · ${freshness}` : status;
}

function aggregateState(states) {
  if (states.some((value) => stateKey(value) === "unavailable")) return "incomplete";
  if (states.some((value) => stateKey(value) === "incomplete")) return "incomplete";
  if (states.some((value) => String(value).includes("stale"))) return "incomplete · stale";
  return "current";
}

function stateKey(value) {
  const normalized = String(value ?? "unavailable").toLowerCase();
  if (normalized.includes("unavailable")) return "unavailable";
  if (normalized.includes("incomplete") || normalized.includes("stale")) return "incomplete";
  if (normalized.includes("failed") || normalized.includes("regression")) return "failed";
  if (normalized.includes("current") || normalized.includes("passed")) return "current";
  return "unknown";
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "n/a";
  return `${Number(value).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : String(value);
}

function shortRevision(value) {
  return String(value).slice(0, 12);
}
