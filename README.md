# Platform DNA

Profile resolver and repository identity bootstrap for **docs and code repos**
(`docs` · `fe` · `be` · `tests`). Never install into toolkit source checkouts.

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/raintr91/platform-dna/main/install.sh | bash  # install
platform-dna init       # agents → lane → adapter (when required)
platform-dna deinit     # remove Platform DNA from the current repo
platform-dna uninstall  # remove all registered installs and the CLI
```

Run `init` from the destination repo. It detects installed agents and opens
selectors in this order: agents, lane, then the adapter when the lane requires
one. A lane already declared by `platform-repos.json` is locked.

For CI or other non-interactive use, keep using the long flags: `--target`,
`--type`, the required `--adapter`, `--project-root`, and `--yes`. With `--yes`,
the backward-compatible defaults remain `cursor` and `docs`. FE adapters
`nuxt4` and `nextjs` also sync `/platform-base`.

Windows installation remains available with
`irm https://raw.githubusercontent.com/raintr91/platform-dna/main/install.ps1 | iex`.

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
  harness files plus hashes for maps that Platform DNA itself seeded. Switching
  among `docs`, `fe`, `be`, and `tests` marks old profile-only assets stale.
- `status` reports missing, modified, and unmodified managed files. `prune` is
  dry-run by default and deletes only stale files whose current SHA-256 still
  matches the install manifest; use `--yes` to apply.
- Pruning never considers project maps, `.gitignore`, specialist toolkit files,
  or any path absent from the validated Platform DNA install manifest.

## Remove Platform DNA

The lifecycle has two levels:

```bash
platform-dna deinit                         # this destination repo only
platform-dna uninstall                      # every registered repo + CLI
platform-dna uninstall --discover ~/workspace  # include older ledger-less installs
```

Both commands preview changes and ask for confirmation in a TTY. They are
dry-runs outside a TTY unless `--yes` is passed. `init` records destinations in
`$PLATFORM_DNA_STATE_DIR/installs.json`, or under
`$XDG_STATE_HOME/platform-dna` by default.

Removal uses the validated install manifest. Modified harness files and maps
are preserved and reported. `platform-repos.json` and its example are removed
only when Platform DNA created them and their current SHA-256 still matches the
recorded value; pre-existing maps and every specialist toolkit asset are
preserved. `prune` remains stale-only and never removes active assets.

See [docs/PROFILES.md](./docs/PROFILES.md) and
[docs/PROJECT-MAPS.md](./docs/PROJECT-MAPS.md).
