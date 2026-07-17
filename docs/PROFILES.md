# Install profiles

`profiles.json` is the executable manifest.

| Type | Required packages | Adapter |
|------|-------------------|---------|
| `docs` | Hubdocs, Bundlekit, Processkit | — |
| `fe` | Codegenkit, Testkit, Processkit | `nuxt4` or `nextjs` |
| `be` | Codegenkit, Processkit | `fastapi` or `laravel` |
| `tests` | Testkit | — |
| `tooling` | Explicit `--packages` only | — |

Optional packages are installed only through `--with`. An optional package
without install metadata fails with an actionable message; it is never silently
treated as required.

Every specialist package remains independently installable. Platform DNA only
coordinates installation and selected-profile initialization.
