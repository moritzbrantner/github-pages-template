# Releasing `@moritzbrantner/github-pages-template`

The package is not published to npm, and no workflow needs a registry token or other repository secret. Consumers depend on a commit-pinned git dependency (see [`consumer-adoption.md`](consumer-adoption.md)).

## Install-time build

- `npm` git installs run `prepack` (`npm run build`) in their own clone with devDependencies installed.
- `bun` git installs run `prepare` (`scripts/prepare-git-install.ts`) for trusted dependencies. bun does not install a git dependency's devDependencies, so the script builds in a temporary copy with its own `npm ci` and copies `build/` back. In a normal checkout it does nothing.

## Release invariants

- `package.json` and `VERSION` contain the same version.
- Version tags, when used, are exactly `v<package-version>`.
- CI runs the generator tests, builds the reference site, verifies the exact `npm pack` payload, then installs that tarball into isolated full-site and augment consumers and executes the packaged CLI.
- Packed-consumer verification must prove the installed package ships the current diagnostics runtime and that augment mode preserves consumer-owned home/application files.

## Cutting a version

1. Change `package.json` and `VERSION` together in a pull request.
2. Run `npm run verify:release`.
3. Merge only after Validate is green.
4. Optionally tag the merged `main` commit as `v<version>` (`node ./scripts/verify-release.ts v<version>` checks the tag).
5. Update consumers to the merged commit SHA.

Use patch versions for compatible fixes, minor versions for new compatible capabilities, and a major version for a stable-contract breaking change once the package reaches `1.x`. While the package remains `0.x`, treat consumer-facing breaking changes as deliberate events.
