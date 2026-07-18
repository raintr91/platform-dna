# Platform DNA

Profile resolver and meta-harness bootstrap for **docs and code hubs**
(`docs` · `fe` · `be` · `tests`). Never install into MCP tooling repos.

```bash
platform-dna init --type=docs --project-root=/path/to/base-docs --yes
platform-dna init --type=fe --adapter=nuxt4 --project-root=/path/to/portal --yes
platform-dna init --type=fe --adapter=dotnet-line --project-root=/path/to/line --yes
platform-dna init --type=be --adapter=laravel --project-root=/path/to/api --yes
platform-dna init --type=be --adapter=dotnet-integration --project-root=/path/to/integration --yes
platform-dna init --type=tests --project-root=/path/to/base-tests --yes
platform-dna status --project-root=/path/to/hub
platform-dna prune --project-root=/path/to/hub        # dry-run
platform-dna prune --project-root=/path/to/hub --yes  # delete safe stale files
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
- `.platform-dna/install-manifest.json` tracks active and stale Platform-DNA-owned
  harness files. Switching among `docs`, `fe`, `be`, and `tests` marks old
  profile-only assets stale.
- `status` reports missing, modified, and unmodified managed files. `prune` is
  dry-run by default and deletes only stale files whose current SHA-256 still
  matches the install manifest; use `--yes` to apply.
- Pruning never considers project maps, `.gitignore`, specialist package files,
  or any path absent from the validated Platform DNA install manifest.

See [docs/PROFILES.md](./docs/PROFILES.md) and
[docs/PROJECT-MAPS.md](./docs/PROJECT-MAPS.md).
