# Install profiles

`profiles.json` is the executable manifest.

Platform DNA installs **only** into product hubs (`docs` · `fe` · `be` · `tests`).
It does **not** install into MCP tooling repos (`hubdocs`, `bundlekit`, …).

| Type | Required packages | Adapter |
|------|-------------------|---------|
| `docs` | Hubdocs, Bundlekit, Processkit | — |
| `fe` | Codegenkit, Testkit, Processkit | `nuxt4` or `nextjs` |
| `be` | Codegenkit, Processkit | `fastapi` or `laravel` |
| `tests` | Testkit | — |

Optional packages are installed only through `--with`. An optional package
without install metadata fails with an actionable message; it is never silently
treated as required.

Every specialist package remains independently installable. Platform DNA only
coordinates installation and selected-profile initialization for docs/code hubs.
