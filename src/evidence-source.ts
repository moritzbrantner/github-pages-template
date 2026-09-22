export const CODING_TOOLING_ANALYSIS_MESSAGE_TYPE = "coding-tooling.analysis.v1";

export type EvidenceSource = {
  id: string;
  label: string;
  kind: string;
  url: string;
  producer?: string;
};

export type EvidenceMetric = {
  label?: string;
  value?: string | number;
  unit?: string;
  baseline?: number;
  state?: string;
  source?: EvidenceSource;
};

export type EvidenceAccomplishment = {
  title?: string;
  detail?: string;
  state?: string;
  revision?: string;
  source?: EvidenceSource;
};

export type NormalizedEvidence = {
  state: string;
  repository?: string | null;
  revision?: string | null;
  producer: string;
  metrics: EvidenceMetric[];
  accomplishments: EvidenceAccomplishment[];
};

export type EvidenceResult = {
  source: EvidenceSource;
  state?: string;
  payload?: any;
  normalized?: NormalizedEvidence;
  error?: string;
};

export type EvidenceDiagnostic = {
  code: string;
  message: string;
};

export type EvidenceDiagnosticRow = {
  source: EvidenceSource;
  repository: string | null;
  producer: string;
  state: string;
  generatedAt: string | null;
  evidenceRevision: string | null;
  currentRevision: string | undefined;
  diagnostic: EvidenceDiagnostic;
};

export function acceptCodingToolingAnalysisMessage(
  event: any,
  { sourceWindow, expectedOrigin, repository }: {
    sourceWindow: unknown;
    expectedOrigin: string;
    repository: string;
  },
): { error: string } | { analysis: any } | null {
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

export async function readJsonEvidenceResponse(
  response: Pick<Response, "ok" | "status" | "headers" | "text">,
): Promise<any> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const mediaType =
    ((response.headers.get("content-type") ?? "unknown content type")
      .split(";", 1)[0] ?? "unknown content type")
      .trim()
      .toLowerCase() || "unknown content type";
  const body = await response.text();

  try {
    return JSON.parse(body);
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
    if (result?.source?.kind !== "project-evidence-v1" || !result?.normalized) return result;

    const original = result.normalized;
    const revision = original.revision;
    const repository = original.repository;
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
      ...original,
      state:
        freshness === "current"
          ? appendFreshness(original.state, freshness)
          : `incomplete · ${freshness}`,
      metrics: (original.metrics ?? []).map((metric) => ({
        ...metric,
        state: appendFreshness(metric.state ?? original.state, freshness),
      })),
      accomplishments: (original.accomplishments ?? []).map((item) => ({
        ...item,
        state: appendFreshness(item.state ?? original.state, freshness),
      })),
    };

    return { ...result, normalized, state: normalized.state };
  });
}

export function buildEvidenceDiagnostics(
  results: EvidenceResult[],
  expectedRepository: string,
): EvidenceDiagnosticRow[] {
  const currentRevision = findCurrentRepositoryRevision(results, expectedRepository);

  return results.map((result) => {
    const normalized = result?.normalized;
    const payload = result?.payload;
    const source = result.source;
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
}: {
  result: EvidenceResult;
  source: EvidenceSource;
  payload: any;
  normalized: NormalizedEvidence | undefined;
  expectedRepository: string;
  currentRevision: string | undefined;
  evidenceRevision: string | null;
}): EvidenceDiagnostic {
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

function findCurrentRepositoryRevision(
  results: EvidenceResult[],
  expectedRepository: string,
): string | undefined {
  return results.find(
    (result) =>
      result?.source?.kind === "coding-tooling-analysis-v1" &&
      sourceRepository(result.source) === expectedRepository &&
      result?.normalized?.repository === expectedRepository &&
      typeof result?.normalized?.revision === "string" &&
      result.normalized.revision.length > 0,
  )?.normalized?.revision ?? undefined;
}

function sourceRepository(source: EvidenceSource): string | null {
  try {
    return new URL(source?.url).searchParams.get("repo");
  } catch {
    return null;
  }
}

function appendFreshness(state: string | undefined, freshness: string): string {
  return `${state ?? "unknown"} · ${freshness}`;
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
