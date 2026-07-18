# Install profiles

`profiles.json` is the executable manifest.

Platform DNA installs **only** into product hubs (`docs` · `fe` · `be` · `tests`).
It does **not** install into MCP tooling repos (`hubdocs`, `bundlekit`, …).

| Type | Recommended kits (installed by the bundle) | Adapter |
|------|--------------------------------------------|---------|
| `docs` | Hubdocs, Bundlekit, Processkit | — |
| `fe` | Codegenkit, Testkit, Processkit | `nuxt4`, `nextjs`, or `dotnet-line` |
| `be` | Codegenkit, Processkit | `fastapi`, `laravel`, or `dotnet-integration` |
| `tests` | Testkit | — |

`dotnet-line` drops Testkit from the recommended set (no web E2E consumption lane).
FE DNA owns `/platform-base` for `nuxt4` / `nextjs` adapters only (not `dotnet-line`).

Optional packages are installed only through `--with`. An optional package
without install metadata fails with an actionable message; it is never silently
promoted into the recommended set.

Recommended kits are a convenience bundle, not runtime dependencies. Every
specialist package remains independently installable and runs standalone;
Platform DNA only coordinates installation and selected-profile initialization
for docs/code hubs.

## Docs registry pointer

The docs repo is the canonical registry/architecture hub. For FE bootstrap,
pass a member-selected machine-local pointer:

```bash
platform-dna init --type=fe --adapter=nuxt4 \
  --docs-root=/absolute/path/to/docs-hub --yes
```

Platform DNA forwards it to Codegenkit (`CODEGENKIT_DOCS_ROOT`) and Testkit.
When optional Hubdocs is selected (`--with=hubdocs`), it wires
`HUBDOCS_ROOT` to the same docs repo and installs only the lightweight
`consumer` harness. ArtifactGraph stays docs-first; FE/BE installs are
local-only hints and do not follow this pointer.

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
