# Releasing `@moritzbrantner/github-pages-template`

The public npm package is the canonical distribution surface for consuming repositories. Consumers should depend on a released package version and commit their package-manager lockfile rather than cloning this repository during their Pages build.

## Release invariants

- `package.json` and `VERSION` contain the same version.
- Release tags are exactly `v<package-version>`.
- CI runs the generator tests, builds the reference site, verifies the exact `npm pack` payload, then installs that tarball into isolated full-site and augment consumers and executes the packaged CLI before a release can publish.
- Packed-consumer verification must prove the installed package ships the current diagnostics runtime and that augment mode preserves consumer-owned home/application files.
- `publishConfig` targets the public npm registry.
- A tag workflow never republishes an existing npm version. Rerunning a partially completed release therefore converges instead of failing on an already-published package.
- A successful tag workflow also creates the matching GitHub Release if it does not already exist.

## First release only

npm trusted publishing can only be configured after the package exists on the registry. Bootstrap `0.1.0` once with a normal npm publish token:

1. Add a publish-capable npm token as the `NPM_TOKEN` secret on the repository's `npm` GitHub environment.
2. Confirm `main` contains the intended `0.1.0` package and that Validate is green.
3. Create and push tag `v0.1.0` at that exact `main` commit.
4. The `Publish package` workflow first attempts trusted publishing, then falls back to the bootstrap token when the package does not yet have an npm trust relationship.
5. After `@moritzbrantner/github-pages-template` exists on npm, configure GitHub Actions as its trusted publisher:

```sh
npm trust github @moritzbrantner/github-pages-template \
  --repo moritzbrantner/github-pages-template \
  --file publish.yml \
  --env npm \
  --allow-publish
```

The trust command requires a current npm CLI, npm account 2FA, and write access to the package.

6. Run a later release through the trusted publisher and then remove the bootstrap `NPM_TOKEN`. Normal releases should not depend on a long-lived publish token.

## Normal release

1. Change `package.json` and `VERSION` together in a pull request.
2. Run `npm run verify:release`.
3. Merge only after Validate is green.
4. Create tag `v<version>` on the exact merged `main` commit and push it.
5. The tag workflow verifies the release identity, publishes the version to public npm with provenance, and creates the GitHub Release.

Use patch releases for compatible fixes, minor releases for new compatible capabilities, and a major release for a stable-contract breaking change once the package reaches `1.x`. While the package remains `0.x`, treat consumer-facing breaking changes as deliberate release events rather than silently changing an existing version.

## Consumer updates

Renovate should update the normal npm dependency in consuming repositories. The consumer lockfile retains the exact resolved version and integrity hash; npm provenance links public releases back to this repository and its publishing workflow.

Do not reintroduce ad hoc `git fetch` installation snippets as the normal consumer path. A Git SHA may still be useful temporarily while developing an unreleased change, but released consumers should converge back to the npm package.
