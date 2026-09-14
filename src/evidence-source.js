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
  return { analysis: data.analysis };
}
