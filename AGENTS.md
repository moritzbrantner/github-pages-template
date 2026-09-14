# Repository guidance

## Authority boundaries

- This repository owns shared GitHub Pages presentation and static generation only.
- Do not duplicate benchmark thresholds, comparability rules, or verdict logic from Moonlight, runtime-profiler, Unlighthouse/Lighthouse, coding-tooling, or consuming repositories.
- Do not replace `reusable-workflows` deployment/artifact authority with repository-local deployment logic.
- Treat missing, malformed, stale, or incomparable evidence as unavailable/incomplete; never infer success.
- Keep evidence families separate rather than inventing a synthetic quality score.
- Accomplishments must be mechanically justified by an evidence producer or explicit repository-owned policy.

## Compatibility

- Keep the generator framework-neutral and dependency-light.
- Preserve existing project home/demo pages when using augment mode.
- In augment mode, delete only paths previously recorded as template-owned; never clean the consumer build directory broadly or overwrite an unowned copy target.
- Prefer stable URL-addressable routes (`/stats/`, `/evidence/`) over SPA-only state.
- Keep GitHub project-site base paths explicit and tested.
- Favor semantic HTML, keyboard access, reduced-motion behavior, and responsive layouts.

## Distribution

- Public npm package `@moritzbrantner/github-pages-template` is the canonical released consumer surface.
- Keep `package.json` and `VERSION` synchronized and require release tags to match `v<version>` exactly.
- Validate the real npm pack payload before publishing; repository-only tests, workflows, scripts, reference-site input, and generated reference output must not leak into the package.
- Prefer npm trusted publishing with provenance. A long-lived `NPM_TOKEN` is only an initial-package bootstrap fallback and should be removed after trusted publishing is established.
- Consumer repositories should use the package dependency plus their lockfile and Renovate rather than permanent repository-specific source-fetch logic.
