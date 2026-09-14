# Consumer adoption

A consuming repository should keep its project-specific demo or documentation home page authoritative and use the shared generator for standardized evidence routes.

1. Pin `github-pages-template` to an exact revision in the consumer toolchain.
2. Add a repository-owned `pages.config.json` describing identity, base path, links, and evidence source URLs.
3. Build the existing project site normally.
4. Run `github-pages-template build --config ./pages.config.json --out ./dist --augment`.
5. Publish `dist/` with `reusable-workflows`.

## Augment output ownership

Augment mode treats the consumer build directory as shared output, not as a directory the template may clean wholesale.

- The consumer keeps ownership of its existing `index.html` and unrelated assets.
- The template records every path it owns in `project-pages.json` and removes only those recorded paths before the next augment build. Removing a configured copy therefore cannot leave stale template-owned output behind.
- A configured `copy.to` path must stay inside the selected output directory.
- If a `copy.to` target already exists and was not recorded as template-owned by the previous build, generation fails instead of overwriting consumer output.

This makes repeated augment builds deterministic while preserving the consuming repository's application and asset ownership.

The consumer owns its scenarios and domain meaning. Evidence producers own measurements and verdicts. The Pages template only presents those facts and their provenance.
