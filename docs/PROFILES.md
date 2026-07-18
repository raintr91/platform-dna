# Install profiles

`profiles.json` is the executable manifest.

Platform DNA installs **only** into product hubs (`docs` · `fe` · `be` · `tests`).
It does **not** install into MCP tooling repos (`hubdocs`, `bundlekit`, …).

| Type | Required packages | Adapter |
|------|-------------------|---------|
| `docs` | Hubdocs, Bundlekit, Processkit | — |
| `fe` | Codegenkit, Testkit, Processkit | `nuxt4`, `nextjs`, or `dotnet-line` |
| `be` | Codegenkit, Processkit | `fastapi`, `laravel`, or `dotnet-integration` |

`dotnet-line` drops Testkit from the required set (no web E2E consumption lane).
| `tests` | Testkit | — |

Optional packages are installed only through `--with`. An optional package
without install metadata fails with an actionable message; it is never silently
treated as required.

Every specialist package remains independently installable. Platform DNA only
coordinates installation and selected-profile initialization for docs/code hubs.

## Profile lifecycle

Each successful harness install writes `.platform-dna/install-manifest.json`.
Installing a different `docs`, `fe`, `be`, or `tests` profile keeps shared and
new-profile assets active while marking old profile-only Platform DNA assets
stale.

```bash
platform-dna status --project-root=/path/to/hub
platform-dna prune --project-root=/path/to/hub
platform-dna prune --project-root=/path/to/hub --yes
```

`status` classifies every managed file as `unmodified`, `modified`, or `missing`.
`prune` only plans changes unless `--yes` is supplied. Applied pruning rechecks
the SHA-256 immediately before deletion and removes only unmodified stale files.
Modified stale files remain in place and in the manifest for review.

The manifest schema, package identity, harness API, source/target mapping, and
contained paths are validated before status, install, or prune proceeds.
Project maps (`platform-repos*.json`, `legacy-repos*.json`), `.gitignore`,
specialist package files, and files not recorded by Platform DNA are outside
prune ownership.
