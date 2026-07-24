# Install profiles

`profiles.json` is the executable manifest.

Platform DNA installs **into** product hubs
(`docs` · `fe` · `be` · `monolith` · `tests`).
It does **not** install into toolkit source checkouts (`docskit`, `codegenkit`, …).

| Type | Destination skills | Adapter |
|------|--------------------|---------|
| `docs` | `/configure-repo-maps`, `/legacy` | — |
| `fe` | + `/platform-base` (Nuxt / Next / WinForms Line) | `nuxt4`, `nextjs`, or `dotnet-line` |
| `be` | + `/platform-base-be` | `fastapi`, `laravel`, or `dotnet-integration` |
| `monolith` | FE + BE bases | **both** `--fe-adapter` and `--be-adapter` |
| `tests` | + `/platform-base` (tests hub) | — |

`/platform-ai` stays local to each toolkit source and is never synced by a
destination profile.

Wizard order: **agents → lane → adapter(s)**. Lane `fe` is labeled
**Frontend / Client** (web or WinForms). Monolith asks FE/client adapter then BE
adapter. Machine id stays `--type=fe` (no separate `client` lane).

Optional toolkits are installed only through `--with`. An optional toolkit
without install metadata fails with an actionable message; it is never silently
promoted into the recommended set.

Recommended toolkits are a convenience bundle, not runtime dependencies. Every
specialist toolkit remains independently installable and runs standalone;
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
When optional Docskit is selected (`--with=docskit`), it wires
`DOCSKIT_ROOT` to the same docs repo and installs only the lightweight
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
Project maps, `.gitignore`, specialist toolkit files, and files not recorded by
Platform DNA are outside prune ownership. Portable maps: Platform DNA owns
`platform-repos*.json`; Docskit owns `legacy-repos*.json`. Machine-local
`*.local.json` skeletons are ensured by any toolkit via `ensureLocalRepoMaps`
(member-owned content; shared `.gitignore`).
