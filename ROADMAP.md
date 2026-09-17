# Roadmap

The template should remain a thin, framework-neutral GitHub Pages presentation foundation. Shared domain behavior stays in the repositories that already own it; this repository integrates those capabilities into a coherent Pages shell.

## Completed foundation

### Site preferences and localization

- [x] Add `system` / `light` / `dark` appearance selection.
- [x] Add `system` / `normal` / `high` / `low` contrast selection.
- [x] Use the canonical `settings` IDs `appearance.color_scheme` and `appearance.contrast`.
- [x] Keep project defaults authoritative and persist only user overrides.
- [x] Apply explicit appearance before the stylesheet to avoid a wrong-theme flash.
- [x] Add a unified keyboard-accessible preferences surface.
- [x] Add locale selection with English and German built-in shell copy.
- [x] Use locale-aware `Intl` formatting for evidence dates, numbers, and percentages.
- [x] Apply document language and RTL direction from the selected locale.
- [x] Keep `prefers-reduced-motion` as a baseline browser/system behavior.
- [x] Export preference and localization helpers for consuming Pages applications.

## Next slices

### 1. Responsive application shell

- [ ] Standardize optional `Overview`, `Demo`, `Docs`, `Stats`, `Benchmarks`, and `Repository` navigation slots without forcing every repository to expose every route.
- [ ] Improve narrow-screen navigation and preference controls with touch-first sizing and no hover-only interaction.
- [ ] Define a reusable small-screen table policy: priority columns, horizontal overflow where necessary, and optional stacked rows only when semantics remain clear.
- [ ] Dogfood the shell in representative game, editor, data-heavy, and documentation repositories before freezing the contract.

### 2. Loading, empty, and failure states

- [ ] Add common presentation components for loading, no-data, unavailable evidence, failed WASM/runtime initialization, unsupported browser capability, and stale artifacts.
- [ ] Keep evidence failures fail-closed and preserve producer/revision provenance.
- [ ] Make recovery actions explicit when a user can retry or navigate to diagnostics.
- [ ] Reuse the same states across stats, evidence, charts, tables, and embedded demos where the ownership boundary permits it.

### 3. Pages quality contract

- [ ] Add deterministic generated-site checks for keyboard navigation and focus visibility.
- [ ] Exercise light, dark, system, and high-contrast rendering.
- [ ] Exercise at least two locales and one RTL fixture.
- [ ] Add accessibility checks for landmarks, names, heading order, form labels, and common contrast regressions.
- [ ] Add representative mobile and desktop viewport smoke checks.
- [ ] Add broken-link and base-path checks for GitHub project sites.
- [ ] Keep visual snapshots narrow and semantic; do not make pixel-perfect screenshots the only correctness gate.

### 4. Ecosystem UI integration

- [ ] Reuse `@moritzbrantner/ui` controls where it improves consistency without making the static generator framework-dependent.
- [ ] Reuse `tables` for richer evidence/result explorers where the table package can be consumed without duplicating query or virtualization behavior.
- [ ] Reuse `charts` for time-series and benchmark evidence rather than creating template-local chart implementations.
- [ ] Define adapters so consuming React/TypeScript sites can share the same Pages preferences while keeping their own application shell authoritative in augment mode.

### 5. Deeper settings integration

- [ ] Dogfood `settings` appearance semantics beyond color scheme and contrast once browser-friendly integration remains lightweight.
- [ ] Add night-mode presentation only when the Pages palette has a concrete, testable behavior distinct from dark mode.
- [ ] Add color-vision assistance only together with palettes/redundant cues that materially improve distinguishability; do not implement it as a cosmetic framebuffer/filter effect.
- [ ] Add a manual reduced-motion preference when the shared settings foundation defines a canonical setting for it; until then respect the operating-system preference.
- [ ] Preserve the boundary that `settings` owns reusable preference choices while this repository owns Pages-specific CSS/application.

### 6. Localization maturity

- [ ] Support localized project-owned metadata (`name`, `description`, kicker, and optional links) without making translation mandatory for consumers.
- [ ] Add plural-aware message formatting rather than growing ad-hoc singular/plural keys.
- [ ] Validate configured message coverage and surface missing translations during development/CI.
- [ ] Exercise RTL layout in the generated reference site and quality contract.
- [ ] Decide whether locale should optionally be URL-addressable for shareable localized documentation while keeping personal appearance preferences out of application-state URLs.

### 7. Performance UX and evidence

- [ ] Keep startup work proportional to visible content and avoid materializing hidden table/chart data.
- [ ] Lazy-load expensive chart, WASM, or demo surfaces while preserving useful HTML before enhancement.
- [ ] Publish JS/CSS/WASM transfer sizes and startup/interaction evidence through `/stats/` when an authoritative producer provides it.
- [ ] Integrate runtime-profiler / Performance Evidence outputs as evidence sources rather than inventing template-local performance verdicts.
- [ ] Use Moonlight for baseline/candidate policy where a regression verdict is required.

### 8. Repository convergence and adoption

- [ ] Add a migration checklist for repositories still carrying bespoke Pages theme/navigation/evidence code.
- [ ] Prefer package adoption plus Renovate over copied template source.
- [ ] Use `coding-tooling` and the repository-convergence workflow to find duplicated Pages behavior that can be removed after adoption.
- [ ] Keep `reusable-workflows` authoritative for deployment and artifact transport.
- [ ] Gather dogfooding feedback from several repository shapes before promoting new optional capabilities into default behavior.
