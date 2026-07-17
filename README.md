# Platform DNA

Profile resolver and meta-harness bootstrap for **docs and code hubs**
(`docs` · `fe` · `be` · `tests`). Never install into MCP tooling repos.

```bash
platform-dna init --type=docs --project-root=/path/to/base-docs --yes
platform-dna init --type=fe --adapter=nuxt4 --project-root=/path/to/portal --yes
platform-dna init --type=be --adapter=laravel --project-root=/path/to/api --yes
platform-dna init --type=tests --project-root=/path/to/base-tests --yes
```

The resolver installs missing required packages under
`$PLATFORM_DNA_HOME/packages` (default `~/.platform-dna/packages`) and invokes
each package's own `init`. Use `--no-install` to require preinstalled tools or
`--package-root packageId=/path` for local development.

Ownership:

- Platform DNA: `/platform-ai` (docs), lane router, portability rules, profile
  manifest, portable project-map schemas/templates.
- Specialist packages: all architecture/spec/process/code/test skills and MCP
  tools.

Safety:

- FE/BE require an explicit adapter.
- A declared or detected lane mismatch fails unless `--force` is explicit.
- Targets with `mcp-package.json` or `role=tooling` are rejected (DNA is not for MCP repos).
- Committed project maps containing sibling or machine paths are rejected.
- `*.local.json` remains member-owned and is added to `.gitignore`.
- `--dry-run` prints package invocations without writing or cloning.

See [docs/PROFILES.md](./docs/PROFILES.md) and
[docs/PROJECT-MAPS.md](./docs/PROJECT-MAPS.md).
