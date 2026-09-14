# GitHub Pages Template

Canonical GitHub Pages presentation foundation for Moritz Brantner's repositories.

The repository provides a zero-dependency static generator that creates standardized project pages for:

- current stats from explicit evidence producers;
- mechanically justified accomplishments;
- evidence provenance, freshness, and exact revision;
- stable `/stats/` and `/evidence/` routes;
- a common accessible/responsive visual shell.

It deliberately does **not** own benchmark semantics, thresholds, or deployment mechanics. `reusable-workflows` owns Pages deployment and artifact transport. `coding-tooling`, Moonlight, runtime-profiler, Unlighthouse, coverage tools, and repository-specific verifiers remain authoritative for the evidence they produce.

## Build the reference site

```sh
node ./bin/github-pages-template.mjs build \
  --config ./site/pages.config.json \
  --out ./dist
```

Run the tests with:

```sh
node --test
```

## One-time GitHub Pages activation

GitHub does not allow a repository `GITHUB_TOKEN` to create the Pages site itself. For a newly created repository, enable **Settings → Pages → Build and deployment → Source: GitHub Actions** once.

The included deployment workflow preflights the Pages API. Before that one-time activation it reports that Pages is unavailable and skips deployment instead of treating the missing repository capability as a successful deployment. After activation, pushes to `main` deploy automatically through `reusable-workflows`.

## Adopt in an existing project site

Install or pin this repository as a development dependency, add a `pages.config.json`, then augment the project's existing static build:

```sh
vite build
github-pages-template build --config ./pages.config.json --out ./dist --augment
```

`--augment` preserves the project's existing `dist/index.html` and adds the shared assets plus `/stats/`, `/evidence/`, and `project-pages.json`.

Augment builds record their owned paths in `project-pages.json`. A later augment build removes only those recorded paths before regenerating them, so removed copy entries do not leave stale files while the consumer's homepage and unrelated assets remain untouched. Configured copy destinations must stay inside the selected output directory, and an existing consumer-owned target is rejected instead of overwritten.

This allows a project-specific demo or playground to remain authoritative for its own UI while sharing the evidence surface.

## Configuration

```json
{
  "schemaVersion": 1,
  "project": {
    "name": "Maps",
    "repository": "moritzbrantner/maps",
    "basePath": "/maps/",
    "description": "Map building blocks and first-party map engine foundations."
  },
  "links": [
    { "label": "Demo", "href": "/maps/" }
  ],
  "evidenceSources": [
    {
      "id": "coding-tooling",
      "label": "Repository verification",
      "kind": "coding-tooling-analysis-v1",
      "url": "https://moritzbrantner.github.io/coding-tooling/analysis.json/?repo=moritzbrantner/maps"
    },
    {
      "id": "runtime",
      "label": "Runtime evidence",
      "kind": "project-evidence-v1",
      "url": "/maps/evidence/runtime.json"
    }
  ]
}
```

See [`docs/project-evidence-v1.md`](docs/project-evidence-v1.md) for the producer-neutral evidence contract.

## Evidence behavior

The renderer is fail-closed:

- missing sources are shown as unavailable;
- malformed sources are incomplete;
- source identity is retained per metric;
- stale or incomplete evidence is not presented as current;
- separate evidence families are not collapsed into a synthetic quality score;
- accomplishments are displayed only when a producer publishes them explicitly.

## Ownership boundaries

| Concern | Authority |
| --- | --- |
| Site shell, navigation, stats/evidence presentation | `github-pages-template` |
| Deployment and artifact transport | `reusable-workflows` |
| Repository analysis/KPI semantics | `coding-tooling` |
| Runtime capture | `runtime-profiler` |
| Baseline/candidate verdict policy | Moonlight |
| Web performance measurements | Unlighthouse/Lighthouse |
| Domain scenarios and meaning | Consuming repository |
