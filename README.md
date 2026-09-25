# GitHub Pages Template

Canonical GitHub Pages presentation foundation for Moritz Brantner's repositories.

The repository provides a zero-dependency static generator that creates standardized project pages for:

- current stats from explicit evidence producers;
- mechanically justified accomplishments;
- evidence provenance, freshness, and exact revision;
- a root `agent.json` discovery manifest for software agents;
- stable `/stats/` and `/evidence/` routes;
- a common accessible/responsive visual shell;
- shared light/dark/system theme and contrast preferences;
- locale selection with locale-aware dates, numbers, percentages, and template-owned copy.

It deliberately does **not** own benchmark semantics, thresholds, or deployment mechanics. `reusable-workflows` owns Pages deployment and artifact transport. `coding-tooling`, Moonlight, runtime-profiler, Unlighthouse, coverage tools, and repository-specific verifiers remain authoritative for the evidence they produce.

## Build the reference site

```sh
npm run build --silent
node ./build/bin/github-pages-template.js build \
  --config ./site/pages.config.json \
  --out ./dist
```

Run the release-grade validation with:

```sh
npm ci
npm run typecheck
npm run verify:release
```

The CLI, browser runtime, tests, and verification scripts are authored in TypeScript. The
published package contains compiled JavaScript and generated declarations for consumers.

## One-time GitHub Pages activation

GitHub does not allow a repository `GITHUB_TOKEN` to create the Pages site itself. For a newly created repository, enable **Settings → Pages → Build and deployment → Source: GitHub Actions** once.

The included deployment workflow preflights the Pages API. Before that one-time activation it reports that Pages is unavailable and skips deployment instead of treating the missing repository capability as a successful deployment. After activation, pushes to `main` deploy automatically through `reusable-workflows`.

## Adopt in an existing project site

Use the public npm package as the canonical dependency:

```sh
npm install --save-dev @moritzbrantner/github-pages-template
```

Commit the consumer lockfile so the build retains an exact resolved artifact and integrity hash. Renovate can then update the normal package dependency without maintaining repository-specific `git fetch` snippets.

Add a `pages.config.json`, build the project's existing static site, then augment that output:

```sh
vite build
github-pages-template build --config ./pages.config.json --out ./dist --augment
```

`--augment` preserves the project's existing `dist/index.html` and adds the shared assets plus `/stats/`, `/evidence/`, `project-pages.json`, and `agent.json`.

Augment builds record their owned paths in `project-pages.json`. A later augment build removes only those recorded paths before regenerating them, so removed copy entries do not leave stale files while the consumer's homepage and unrelated assets remain untouched. Configured copy destinations must stay inside the selected output directory, and an existing consumer-owned target is rejected instead of overwritten.

This allows a project-specific demo or playground to remain authoritative for its own UI while sharing the evidence surface.

See [`docs/consumer-adoption.md`](docs/consumer-adoption.md) for the full consumer contract.

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
  "preferences": {
    "defaults": {
      "appearance.color_scheme": "system",
      "appearance.contrast": "system",
      "localization.locale": "en"
    },
    "locales": [
      { "id": "en", "label": "English" },
      { "id": "de", "label": "Deutsch" }
    ]
  },
  "links": [
    { "label": "Demo", "href": "/maps/" }
  ],
  "relatedRepositories": [
    "moritzbrantner/2d-lab",
    "moritzbrantner/maps"
  ],
  "agent": {
    "routes": [
      {
        "id": "demo",
        "label": "Interactive demo",
        "href": "/maps/",
        "description": "Project-owned interactive map demo."
      }
    ]
  },
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

`relatedRepositories` is optional. When present, the full-mode overview renders the repositories as a compact link list and exposes the same GitHub URLs in `agent.json`; augment mode continues to leave the consumer-owned homepage untouched.

## Agent discovery

Every generated site publishes `agent.json` at the project root and advertises it from generated HTML with a machine-readable alternate link. The manifest is static, requires no JavaScript to discover, and identifies the repository, base path, standard template routes, configured project routes, the project-pages manifest, and configured evidence sources.

Consumers can add repository-specific routes under `agent.routes`. Route identifiers are stable machine-facing keys; labels and descriptions explain their purpose, while the consuming repository remains authoritative for the route's domain semantics. The template does not infer actions, benchmark meaning, or quality judgments from the UI.

See [`docs/agent-discovery-v1.md`](docs/agent-discovery-v1.md) for the contract.

## Preferences, localization, and accessibility

The Pages preference layer is intentionally thin. It uses the canonical `settings` appearance IDs `appearance.color_scheme` and `appearance.contrast`, keeps consumer-selected defaults authoritative, and persists only user overrides. CSS and browser/system preference application remain owned by this presentation consumer, matching the boundary of the `settings` foundation.

Color-scheme choices are `system`, `light`, and `dark`. Contrast choices are `system`, `normal`, `high`, and `low`. System choices remain live because CSS uses the browser's media preferences rather than copying an operating-system value into storage.

The reference site ships English and German template copy. Consumers can configure the available locale list and can provide additional or replacement messages under `preferences.messages.<locale>`. Locale changes also update document language/direction and `Intl` formatting for dates, numbers, and percentages. Right-to-left direction is applied for Arabic, Persian, Hebrew, and Urdu locale families.

The preference storage key is shared on an origin, so repositories hosted below the same GitHub Pages origin can naturally reuse a user's choices. The reusable helpers are exported as `@moritzbrantner/github-pages-template/preferences` and `@moritzbrantner/github-pages-template/localization`.

Keyboard focus, a skip link, semantic landmarks, responsive controls, and `prefers-reduced-motion` remain baseline behavior regardless of the selected appearance.

## Evidence behavior

The renderer is fail-closed:

- missing sources are shown as unavailable;
- malformed sources are incomplete;
- source identity is retained per metric;
- stale or incomplete evidence is not presented as current;
- separate evidence families are not collapsed into a synthetic quality score;
- accomplishments are displayed only when a producer publishes them explicitly.

## Releases

`@moritzbrantner/github-pages-template` is published publicly to npm from version-matched `v*` tags. The tag workflow verifies the package payload, is safe to rerun when an npm version already exists, and creates the corresponding GitHub Release.

See [`docs/releasing.md`](docs/releasing.md) for the first-publish bootstrap and normal trusted-publishing flow.

## Ownership boundaries

| Concern | Authority |
| --- | --- |
| Site shell, navigation, stats/evidence presentation | `github-pages-template` |
| Appearance preference choices and generic setting semantics | `settings` |
| Browser/CSS application of Pages appearance preferences | `github-pages-template` |
| Deployment and artifact transport | `reusable-workflows` |
| Repository analysis/KPI semantics | `coding-tooling` |
| Runtime capture | `runtime-profiler` |
| Baseline/candidate verdict policy | Moonlight |
| Web performance measurements | Unlighthouse/Lighthouse |
| Domain scenarios and meaning | Consuming repository |
