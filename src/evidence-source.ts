import type {
  EvidenceDiagnostic,
  EvidenceResult,
  EvidenceSource,
  NormalizedEvidence,
} from "./types";

export const CODING_TOOLING_ANALYSIS_MESSAGE_TYPE = "coding-tooling.analysis.v1";

interface CodingToolingMessageEvent {
  source: MessageEventSource | null;
  origin: string;
  data?: unknown;
}

interface AcceptedCodingToolingMessage {
  analysis?: Record<string, unknown>;
  error?: string;
}

export function acceptCodingToolingAnalysisMessage(
  event: CodingToolingMessageEvent | null | undefined,
  options: {
    sourceWindow: MessageEventSource | null;
    expectedOrigin: string;
    repository: string;
  },
): AcceptedCodingToolingMessage | null {
  if (event?.source !== options.sourceWindow) return null;
  if (event.origin !== options.expectedOrigin) return null;

  const data = asRecord(event.data);
  if (!data || data.type !== CODING_TOOLING_ANALYSIS_MESSAGE_TYPE) return null;
  if (data.repository !== options.repository) return null;

  const error = asRecord(data.error);
  if (typeof error?.message === "string" && error.message) {
    return { error: error.message };
  }
  const analysis = asRecord(data.analysis);
  if (!analysis) {
    return { error: "coding-tooling analysis payload is missing or malformed" };
  }
  if (analysis.schemaVersion !== 1) {
    return { error: "coding-tooling analysis schemaVersion must be 1" };
  }
  const repository = asRecord(analysis.repository);
  if (repository?.fullName !== options.repository) {
    return { error: "coding-tooling analysis repository does not match requested repository" };
  }
  if (typeof repository.revision !== "string" || !repository.revision.trim()) {
    return { error: "coding-tooling analysis is missing an exact repository revision" };
  }
  return { analysis };
}

export async function readJsonEvidenceResponse(response: Pick<Response, "ok" | "status" | "headers" | "text">) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const mediaType =
    (response.headers.get("content-type") ?? "unknown content type")
      .split(";", 1)[0]
      .trim()
      .toLowerCase() || "unknown content type";
  const body = await response.text();

  try {
    return JSON.parse(body) as unknown;
  } catch {
    const declaresJson = mediaType === "application/json" || mediaType.endsWith("+json");
    throw new Error(
      declaresJson
        ? `Evidence source returned malformed JSON (${mediaType}).`
        : `Evidence source returned non-JSON content (${mediaType}).`,
    );
  }
}

export function reconcileProjectEvidenceFreshness(
  results: EvidenceResult[],
  expectedRepository: string,
): EvidenceResult[] {
  const currentRevision = findCurrentRepositoryRevision(results, expectedRepository);

  return results.map((result) => {
    if (result.source.kind !== "project-evidence-v1" || !result.normalized) return result;

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

    const normalized: NormalizedEvidence = {
      ...result.normalized,
      state:
        freshness === "current"
          ? appendFreshness(result.normalized.state, freshness)
          : `incomplete · ${freshness}`,
      metrics: result.normalized.metrics.map((metric) => ({
        ...metric,
        state: appendFreshness(metric.state ?? result.normalized?.state, freshness),
      })),
      accomplishments: result.normalized.accomplishments.map((item) => ({
        ...item,
        state: appendFreshness(item.state ?? result.normalized?.state, freshness),
      })),
    };

    return { ...result, normalized, state: normalized.state };
  });
}

export function buildEvidenceDiagnostics(
  results: EvidenceResult[],
  expectedRepository: string,
): EvidenceDiagnostic[] {
  const currentRevision = findCurrentRepositoryRevision(results, expectedRepository) ?? null;

  return results.map((result) => {
    const normalized = result.normalized;
    const payload = asRecord(result.payload);
    const source = result.source;
    const repository =
      normalized?.repository ?? stringOrNull(payload?.repository) ?? sourceRepository(source) ?? null;
    const evidenceRevision = normalized?.revision ?? stringOrNull(payload?.revision) ?? null;
    const generatedAt = stringOrNull(payload?.generatedAt);
    const producer =
      normalized?.producer ?? stringOrNull(payload?.producer) ?? source.producer ?? source.kind ?? "unknown";
    const state = normalized?.state ?? result.state ?? "unavailable";
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

function diagnoseResult(options: {
  result: EvidenceResult;
  source: EvidenceSource;
  payload: Record<string, unknown> | null;
  normalized: NormalizedEvidence | undefined;
  expectedRepository: string;
  currentRevision: string | null;
  evidenceRevision: string | null;
}) {
  const {
    result,
    source,
    payload,
    normalized,
    expectedRepository,
    currentRevision,
    evidenceRevision,
  } = options;
  if (!normalized) {
    const message = result.error || "Evidence source could not be loaded.";
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
    if (payload?.schemaVersion !== 1 || !Array.isArray(payload.metrics)) {
      return {
        code: "malformed-schema",
        message: "Payload does not satisfy the project-evidence-v1 schema.",
      };
    }
    if (typeof payload.repository === "string" && payload.repository !== expectedRepository) {
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

  if (stateKey(normalized.state) === "incomplete") {
    return {
      code: "incomplete",
      message: "The producer reported incomplete evidence.",
    };
  }

  return { code: "current", message: "Evidence identity and revision are current." };
}

function findCurrentRepositoryRevision(results: EvidenceResult[], expectedRepository: string) {
  return results.find(
    (result) =>
      result.source.kind === "coding-tooling-analysis-v1" &&
      sourceRepository(result.source) === expectedRepository &&
      result.normalized?.repository === expectedRepository &&
      typeof result.normalized.revision === "string" &&
      result.normalized.revision.length > 0,
  )?.normalized?.revision;
}

function sourceRepository(source: EvidenceSource) {
  try {
    return new URL(source.url).searchParams.get("repo");
  } catch {
    return null;
  }
}

function appendFreshness(state: string | undefined, freshness: string) {
  return `${state ?? "unknown"} · ${freshness}`;
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
  ) {
    return "incomplete" as const;
  }
  if (normalized.includes("failed") || normalized.includes("regression")) return "failed" as const;
  if (normalized.includes("current") || normalized.includes("passed")) return "current" as const;
  return "unknown" as const;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}
