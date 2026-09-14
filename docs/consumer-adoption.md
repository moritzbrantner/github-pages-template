# Consumer adoption

A consuming repository should keep its project-specific demo or documentation home page authoritative and use the shared generator for standardized evidence routes.

1. Pin `github-pages-template` to an exact revision in the consumer toolchain.
2. Add a repository-owned `pages.config.json` describing identity, base path, links, and evidence source URLs.
3. Build the existing project site normally.
4. Run `github-pages-template build --config ./pages.config.json --out ./dist --augment`.
5. Publish `dist/` with `reusable-workflows`.

The consumer owns its scenarios and domain meaning. Evidence producers own measurements and verdicts. The Pages template only presents those facts and their provenance.
