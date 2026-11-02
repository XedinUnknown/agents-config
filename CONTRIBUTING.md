# Contributing

[README](./README.md) | [Architecture](./ARCHITECTURE.md) | [Configuration](./docs/configuration.md)

## Development Setup

Requires Node.js 22+, npm, Git, and Make on Linux/WSL.
The main development branch is `0.1.x`; `master` is the stable branch by
repository convention, not the current development baseline.

```bash
git clone https://github.com/XedinUnknown/agents-config.git
cd agents-config
git switch 0.1.x
make setup
npm run agents-config -- --help
```

`make setup` installs the locked npm dependencies. To install this project's
declared coding-agent skills as well, run `npm run agents-config -- install`
after configuring targets as described in the
[configuration guide](./docs/configuration.md#machine-defaults).

## Checks and Builds

```bash
make check      # typecheck and test
make dev        # re-run the tests on every change
make build      # compile to dist/, as published
make pack       # build the npm package tarball
make help       # list all targets
```

Tests use Node's built-in test runner through `tsx`, with local temporary Git
repositories and no network access. TypeScript checks sources and tests with
strict settings, including `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`.

## Installation Verification

Installation mutates skill and agent directories. Verify changes using temporary
project, config, and cache directories before testing against real destinations.
Use `--config <dir>` and `--cache-dir <dir>` to avoid machine defaults and cache
state; use an isolated `HOME` and XDG directories when testing discovery or
configuration resolution.

Check the initial install, an unchanged second run, selection removal and
pruning, and protection of unmanaged content. For copy installs, check repair of
desired modified or missing content and preservation of stale modified content.
Use local Git fixtures when network access is unnecessary.

## Documentation Changes

Keep user onboarding and everyday usage in [README](./README.md), detailed
settings in [Configuration](./docs/configuration.md), and internals in
[Architecture](./ARCHITECTURE.md). Link supporting guides from README.
CLI help is the authoritative flag/default reference.

When adding a linked guide, keep it available in the published package via
`package.json`'s `files` list, and add it to the Makefile's package prerequisites
so documentation changes trigger repacking. Check local links and run the
documented examples in isolation.

## Continuous Integration

CI runs `make check` and `make pack` on pushes to `master` or version branches
such as `0.1.x`, and on every pull request. It installs the packed CLI and runs
its help and config commands to catch build and package-layout failures.

## Releases

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` under a new
   `## [X.Y.Z] - YYYY-MM-DD` heading, add its compare link at the bottom, and
   merge that change.
2. Publish a GitHub Release with tag `vX.Y.Z` on that commit. Mark it as a
   pre-release to publish under npm's `next` tag instead of `latest`.

The release workflow requires a `vX.Y.Z` tag and matching changelog section.
It runs the checks, sets the package version from the tag, publishes to npm,
and attaches the package tarball to the release.

Publishing uses npm trusted publishing (OIDC), not a stored token. The package's
npm settings designate `XedinUnknown/agents-config` and `release.yml` as its
trusted publisher. The workflow installs npm 11 because trusted publishing
requires npm 11.5.1 or later, while Node 22 bundles npm 10.

Repository-specific agent constraints and progress are maintained in
[AGENTS.md](https://github.com/XedinUnknown/agents-config/blob/0.1.x/AGENTS.md).
