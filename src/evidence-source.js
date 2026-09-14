export const CODING_TOOLING_ANALYSIS_MESSAGE_TYPE = "coding-tooling.analysis.v1";

export function acceptCodingToolingAnalysisMessage(
  event,
  { sourceWindow, expectedOrigin, repository },
) {
  if (event?.source !== sourceWindow) return null;
  if (event?.origin !== expectedOrigin) return null;

  const data = event?.data;
  if (!data || data.type !== CODING_TOOLING_ANALYSIS_MESSAGE_TYPE) return null;
  if (data.repository !== repository) return null;

  if (data.error?.message) {
    return { error: String(data.error.message) };
  }
  if (!data.analysis || typeof data.analysis !== "object") return null;
  if (data.analysis.schemaVersion !== 1) return null;
  return { analysis: data.analysis };
}

export function reconcileProjectEvidenceFreshness(results) {
  const currentRevision = results.find(
    (result) =>
      result?.source?.kind === "coding-tooling-analysis-v1" &&
      typeof result?.normalized?.revision === "string" &&
      result.normalized.revision.length > 0,
  )?.normalized?.revision;

  return results.map((result) => {
    if (result?.source?.kind !== "project-evidence-v1" || !result?.normalized) return result;

    const revision = result.normalized.revision;
    const freshness = !currentRevision
      ? "revision unverified"
      : !revision
        ? "revision missing"
        : revision === currentRevision
          ? "current"
          : "stale";

    const normalized = {
      ...result.normalized,
      state:
        freshness === "current"
          ? appendFreshness(result.normalized.state, freshness)
          : `incomplete · ${freshness}`,
      metrics: (result.normalized.metrics ?? []).map((metric) => ({
        ...metric,
        state: appendFreshness(metric.state ?? result.normalized.state, freshness),
      })),
      accomplishments: (result.normalized.accomplishments ?? []).map((item) => ({
        ...item,
        state: appendFreshness(item.state ?? result.normalized.state, freshness),
      })),
    };

    return { ...result, normalized, state: normalized.state };
  });
}

function appendFreshness(state, freshness) {
  return `${state ?? "unknown"} · ${freshness}`;
}
