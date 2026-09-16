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
  if (!data.analysis || typeof data.analysis !== "object") {
    return { error: "coding-tooling analysis payload is missing or malformed" };
  }
  if (data.analysis.schemaVersion !== 1) {
    return { error: "coding-tooling analysis schemaVersion must be 1" };
  }
  if (data.analysis.repository?.fullName !== repository) {
    return { error: "coding-tooling analysis repository does not match requested repository" };
  }
  if (
    typeof data.analysis.repository?.revision !== "string" ||
    !data.analysis.repository.revision.trim()
  ) {
    return { error: "coding-tooling analysis is missing an exact repository revision" };
  }
  return { analysis: data.analysis };
}

export function reconcileProjectEvidenceFreshness(results, expectedRepository) {
  const currentRevision = findCurrentRepositoryRevision(results, expectedRepository);

  return results.map((result) => {
    if (result?.source?.kind !== "project-evidence-v1" || !result?.normalized) return result;

    const revision = result.normalized.revision;
    const repository = result.normalized.repository;
    const freshness =
      repository && repository !== expectedRepository
        ? "repository mismatch"
        : !currentRevision
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

export function buildEvidenceDiagnostics(results, expectedRepository) {
  const currentRevision = findCurrentRepositoryRevision(results, expectedRepository);

  return results.map((result) => {
    const normalized = result?.normalized;
    const payload = result?.payload;
    const source = result?.source ?? {};
    const repository = normalized?.repository ?? payload?.repository ?? sourceRepository(source) ?? null;
    const evidenceRevision = normalized?.revision ?? payload?.revision ?? null;
    const generatedAt = typeof payload?.generatedAt === "string" ? payload.generatedAt : null;
    const producer = normalized?.producer ?? payload?.producer ?? source.producer ?? source.kind ?? "unknown";
    const state = normalized?.state ?? result?.state ?? "unavailable";
    const diagnostic = diagnoseResult({
      result,
      source,
      payload,
      normalized,
      expectedRepository,
      currentRevision,
      evidenceRevision,
    });

    return {
      source,
      repository,
      producer,
      state,
      generatedAt,
      evidenceRevision,
      currentRevision,
      diagnostic,
    };
  });
}

function diagnoseResult({
  result,
  source,
  payload,
  normalized,
  expectedRepository,
  currentRevision,
  evidenceRevision,
}) {
  if (!normalized) {
    const message = result?.error || "Evidence source could not be loaded.";
    const code = message.includes("repository does not match")
      ? "repository-identity-mismatch"
      : message.includes("schema") || message.includes("malformed")
        ? "malformed-schema"
        : message.includes("missing an exact repository revision")
          ? "missing-revision"
          : "source-unavailable";
    return { code, message };
  }

  if (source.kind === "project-evidence-v1") {
    if (payload?.schemaVersion !== 1 || !Array.isArray(payload?.metrics)) {
      return {
        code: "malformed-schema",
        message: "Payload does not satisfy the project-evidence-v1 schema.",
      };
    }
    if (payload?.repository && payload.repository !== expectedRepository) {
      return {
        code: "repository-identity-mismatch",
        message: `Evidence repository '${payload.repository}' does not match '${expectedRepository}'.`,
      };
    }
    if (!evidenceRevision) {
      return {
        code: "missing-revision",
        message: "Evidence does not identify the exact repository revision that produced it.",
      };
    }
    if (!currentRevision) {
      return {
        code: "current-revision-unavailable",
        message: "The current repository revision could not be verified through coding-tooling.",
      };
    }
    if (evidenceRevision !== currentRevision) {
      return {
        code: "stale-revision",
        message: "Evidence was produced from a different repository revision.",
      };
    }
  }

  if (String(stateKey(normalized.state)) === "incomplete") {
    return {
      code: "incomplete",
      message: "The producer reported incomplete evidence.",
    };
  }

  return { code: "current", message: "Evidence identity and revision are current." };
}

function findCurrentRepositoryRevision(results, expectedRepository) {
  return results.find(
    (result) =>
      result?.source?.kind === "coding-tooling-analysis-v1" &&
      sourceRepository(result.source) === expectedRepository &&
      result?.normalized?.repository === expectedRepository &&
      typeof result?.normalized?.revision === "string" &&
      result.normalized.revision.length > 0,
  )?.normalized?.revision;
}

function sourceRepository(source) {
  try {
    return new URL(source?.url).searchParams.get("repo");
  } catch {
    return null;
  }
}

function appendFreshness(state, freshness) {
  return `${state ?? "unknown"} · ${freshness}`;
}

function stateKey(value) {
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
