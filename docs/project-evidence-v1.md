# Project evidence v1

`project-evidence-v1` is the producer-neutral input consumed by the shared GitHub Pages stats surface. It transports evidence; it does not redefine benchmark semantics owned by Moonlight, runtime-profiler, Unlighthouse, coverage tools, or domain-specific verifiers.

```json
{
  "schemaVersion": 1,
  "producer": "moonlight-runtime-profile",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "generatedAt": "2026-09-14T02:00:00Z",
  "status": "passed",
  "metrics": [
    {
      "id": "camera-world-pan-p95-frame-time",
      "label": "Camera world pan p95 frame time",
      "value": 8.4,
      "unit": "ms",
      "baseline": 9.1,
      "state": "passed"
    }
  ],
  "accomplishments": [
    {
      "title": "Camera world pan runtime improved",
      "detail": "Moonlight accepted the candidate against its comparable baseline.",
      "state": "passed",
      "revision": "0123456789abcdef0123456789abcdef01234567"
    }
  ]
}
```

## Rules

- `revision` is the exact source revision that produced the evidence and is required for evidence to be presented as current.
- Producers own `status`, metric states, thresholds, comparability, units, and verdicts. They do not own repository freshness.
- The Pages renderer derives freshness by comparing the evidence revision with the current repository revision supplied by the configured `coding-tooling-analysis-v1` source.
- An exact revision match is displayed as current. A mismatch is stale. A missing evidence revision or unavailable current-revision source fails closed as incomplete.
- A stored `freshness` field, if present in older producer output, is ignored; persisted evidence cannot know whether a later default-branch commit has superseded it.
- Missing or malformed evidence is unavailable/incomplete, never zero or green.
- Accomplishments should only be emitted when the producer or a repository-owned policy can mechanically justify them.
- Different evidence families remain separate. The Pages template does not collapse them into a synthetic quality score.
- A consumer may publish multiple sources. The renderer preserves source identity for every metric.
