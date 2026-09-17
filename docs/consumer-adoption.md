# Consumer adoption

A consuming repository should keep its project-specific demo or documentation home page authoritative and use the shared generator for standardized evidence routes.

## Canonical dependency

Released consumers should install the public npm package rather than cloning this repository during CI:

```sh
npm install --save-dev @moritzbrantner/github-pages-template
```

Use the repository's normal package manager when it is not npm, and commit the resulting lockfile. The package version is the update surface; the lockfile preserves the exact resolved package artifact and integrity hash. Renovate should update this dependency like other package dependencies.

A direct Git revision is acceptable only as a short-lived integration path for an unreleased template change. Do not leave permanent custom `git fetch` logic in consumer workflows once that change has a package release.

## Build integration

1. Add a repository-owned `pages.config.json` describing identity, base path, links, preference defaults/locales when needed, and evidence source URLs.
2. Build the existing project site normally.
3. Run `github-pages-template build --config ./pages.config.json --out ./dist --augment` from the installed package.
4. Publish `dist/` with `reusable-workflows`.

## Shared site preferences

Consumers may configure the common Pages preference surface without taking ownership away from their domain UI:

```json
{
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
  }
}
```

`appearance.color_scheme` and `appearance.contrast` intentionally match the canonical IDs from the `settings` foundation. The consuming repository owns its defaults. Browser storage contains only overrides, not copied defaults, and the Pages shell owns only browser/CSS application.

The built-in shell copy currently covers English and German. Additional locales can be configured by supplying message values under `preferences.messages.<locale>`. Missing messages fall back to the English shell copy rather than producing empty controls.

The helpers are also public package subpaths:

- `@moritzbrantner/github-pages-template/preferences`
- `@moritzbrantner/github-pages-template/localization`

A consuming application may use those helpers when it wants its own Pages-owned UI to share the same preference storage and locale conventions. Project/domain settings should continue to use their authoritative repository or the shared `settings` foundation instead of being moved into this template.

## Augment output ownership

Augment mode treats the consumer build directory as shared output, not as a directory the template may clean wholesale.

- The consumer keeps ownership of its existing `index.html` and unrelated assets.
- The template records every path it owns in `project-pages.json` and removes only those recorded paths before the next augment build. Removing a configured copy therefore cannot leave stale template-owned output behind.
- A configured `copy.to` path must stay inside the selected output directory.
- If a `copy.to` target already exists and was not recorded as template-owned by the previous build, generation fails instead of overwriting consumer output.

This makes repeated augment builds deterministic while preserving the consuming repository's application and asset ownership.

The consumer owns its scenarios and domain meaning. Evidence producers own measurements and verdicts. The Pages template only presents those facts and their provenance.
