export type PageId = "overview" | "stats" | "evidence" | "preferences";

export type ColorScheme = "system" | "light" | "dark";
export type Contrast = "system" | "normal" | "high" | "low";

export interface PreferenceValues {
  "appearance.color_scheme": ColorScheme;
  "appearance.contrast": Contrast;
  "localization.locale": string;
}

export type PreferenceOverrides = Partial<PreferenceValues>;

export interface LocaleOption {
  id: string;
  label: string;
}

export interface ProjectPagesConfig {
  schemaVersion: 1;
  project: {
    name: string;
    repository: string;
    basePath: string;
    description?: string;
    kicker?: string;
  };
  preferences?: {
    defaults?: PreferenceOverrides;
    locales?: LocaleOption[];
    messages?: Record<string, Record<string, string>>;
  };
  links?: Array<{
    label: string;
    href: string;
  }>;
  evidenceSources?: EvidenceSource[];
  copy?: Array<{
    from: string;
    to: string;
  }>;
}

export interface EvidenceSource {
  id: string;
  label: string;
  kind: string;
  url: string;
  producer?: string;
}

export interface NormalizedMetric {
  label: string;
  value: string;
  state: string;
  numericValue?: number | null;
  baseline?: number | null;
  unit?: string | null;
}

export interface NormalizedAccomplishment {
  title?: string;
  detail?: string;
  state?: string;
  revision?: string;
}

export interface NormalizedEvidence {
  state: string;
  repository?: string | null;
  revision?: string | null;
  producer: string;
  metrics: NormalizedMetric[];
  accomplishments: NormalizedAccomplishment[];
}

export interface EvidenceResult {
  source: EvidenceSource;
  state: string;
  payload?: unknown;
  normalized?: NormalizedEvidence;
  error?: string;
}

export interface EvidenceDiagnostic {
  source: EvidenceSource;
  repository: string | null;
  producer: string;
  state: string;
  generatedAt: string | null;
  evidenceRevision: string | null;
  currentRevision: string | null;
  diagnostic: {
    code: string;
    message: string;
  };
}
