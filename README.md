# Platform DNA

Profile resolver and repository identity bootstrap for **docs and code repos**
(`docs` · `fe` · `be` · `tests`). Never install into toolkit source checkouts.

```bash
platform-dna init --type=docs --project-root=/path/to/base-docs --yes
platform-dna init --type=fe --adapter=nuxt4 --project-root=/path/to/portal --yes
# FE adapters nuxt4/nextjs also sync /platform-base
platform-dna init --type=fe --adapter=nextjs --project-root=/path/to/nextjs --yes
platform-dna init --type=fe --adapter=dotnet-line --project-root=/path/to/line --yes
platform-dna init --type=be --adapter=laravel --project-root=/path/to/api --yes
platform-dna init --type=be --adapter=dotnet-integration --project-root=/path/to/integration --yes
platform-dna init --type=tests --project-root=/path/to/base-tests --yes
platform-dna status --project-root=/path/to/hub
platform-dna prune --project-root=/path/to/hub        # dry-run
platform-dna prune --project-root=/path/to/hub --yes  # delete safe stale files
```

The resolver installs missing recommended toolkits under
`$PLATFORM_DNA_HOME/packages` (default `~/.platform-dna/packages`) and invokes
each toolkit's own `init`. Use `--no-install` to require preinstalled tools or
`--package-root toolkitId=/path` for local development.

Ownership:

- Platform DNA: repo-only `platform-repos` schema/seeding, profile manifest, and
  FE `/platform-base` for the Nuxt/Next adapters.
- Specialist toolkits: all architecture/spec/process/code/test skills and MCP
  tools.
- Each toolkit source keeps its own local `/platform-ai` for improving that
  toolkit; Platform DNA never syncs `/platform-ai` into destination repos.

Safety:

- FE/BE require an explicit adapter.
- A declared or detected lane mismatch fails unless `--force` is explicit.
- Targets with `mcp-package.json` or `role=tooling` are rejected (DNA is not for MCP repos).
- Committed project maps containing sibling or machine paths are rejected.
- `platform-repos.local.json` remains member-owned and is added to `.gitignore`.
- `--dry-run` prints package invocations without writing or cloning.
- `.platform-dna/install-manifest.json` tracks active and stale Platform-DNA-owned
  harness files. Switching among `docs`, `fe`, `be`, and `tests` marks old
  profile-only assets stale.
- `status` reports missing, modified, and unmodified managed files. `prune` is
  dry-run by default and deletes only stale files whose current SHA-256 still
  matches the install manifest; use `--yes` to apply.
- Pruning never considers project maps, `.gitignore`, specialist toolkit files,
  or any path absent from the validated Platform DNA install manifest.

See [docs/PROFILES.md](./docs/PROFILES.md) and
[docs/PROJECT-MAPS.md](./docs/PROJECT-MAPS.md).
