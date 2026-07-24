# Platform DNA

Profile resolver and repository identity bootstrap for **docs and code repos**
(`docs` · `fe` · `be` · `monolith` · `tests`). Never install into toolkit source checkouts.

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
`nuxt4`, `nextjs`, and `dotnet-line` sync `/platform-base` (stack-specific content).

Windows installation remains available with
`irm https://raw.githubusercontent.com/raintr91/platform-dna/main/install.ps1 | iex`.

The resolver installs missing recommended toolkits under
`$PLATFORM_DNA_HOME/packages` (default `~/.platform-dna/packages`) and invokes
each toolkit's own `init`. Use `--no-install` to require preinstalled tools or
`--package-root toolkitId=/path` for local development.

Ownership:

- Platform DNA: portable `platform-repos*` schema/seeding, profile manifest, FE
  `/platform-base` (Nuxt/Next), and SSOT `/configure-repo-maps` plus
  `ensureLocalRepoMaps` for both machine-local maps.
- Docskit: portable `legacy-repos*`.
- Specialist toolkits: all architecture/spec/process/code/test skills and MCP
  tools. Any toolkit `init` may ensure `*.local.json` skeletons (create-if-missing).
- Each toolkit source keeps its own local `/platform-ai` for improving that
  toolkit; Platform DNA never syncs `/platform-ai` into destination repos.

Maps (see [docs/PROJECT-MAPS.md](./docs/PROJECT-MAPS.md)):

- Portable: DNA = `platform-repos*`; Docskit = `legacy-repos*`.
- Machine-local: both `platform-repos.local.json` and `legacy-repos.local.json`
  — ensured on init, member fills roots via `/configure-repo-maps` (NL).
- Routing: platform skills → platform local map; `legacy-*` → legacy local map.

### `/configure-repo-maps` — example prompts

Do not hand-edit JSON. After `platform-dna init`, open the skill and paste a
topology description:

```text
/configure-repo-maps

docs = base-docs ở ~/ws/base-docs, portal admin ở ~/ws/portal, api core ở ~/ws/api
```

```text
/configure-repo-maps

2 portal: admin ở ~/ws/portal, line ở ~/ws/line; 2 API: core ở ~/ws/api-core,
scenario ở ~/ws/api-scenario; docs = ~/ws/base-docs; tests = ~/ws/base-tests
```

```text
/configure-repo-maps

legacy ERP ở D:\legacy\erp, key legacy-erp
```

Expected: merge-by-key into `platform-repos.local.json` and/or
`legacy-repos.local.json` (never absolute paths in portable `platform-repos.json`).
Then run `platform-dna codegraph:wire`; for each checkout missing `.codegraph/`:
`cd <root> && codegraph init`. More detail in [docs/PROJECT-MAPS.md](./docs/PROJECT-MAPS.md).

Safety:

- FE/BE require an explicit adapter.
- A declared or detected lane mismatch fails unless `--force` is explicit.
- Targets with `mcp-package.json` or `role=tooling` are rejected (DNA is not for MCP repos).
- Committed project maps containing sibling or machine paths are rejected.
- Both `*.local.json` maps remain member-owned and are added to `.gitignore`
  (shared entries — deinit keeps them for other toolkits).
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
