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
- Prefer stable URL-addressable routes (`/stats/`, `/evidence/`) over SPA-only state.
- Keep GitHub project-site base paths explicit and tested.
- Favor semantic HTML, keyboard access, reduced-motion behavior, and responsive layouts.
