# Portable and machine-local project maps

## Ownership

| File | Owner | Purpose |
|------|-------|---------|
| `platform-repos.json` · `platform-repos.example.json` | **Platform DNA** | Portable catalog for the current repo (`root: "."` only) |
| `legacy-repos.json` · `legacy-repos.example.json` | **Bundlekit** | Portable legacy evidence catalog (`url` + optional `root: "."`) |
| `platform-repos.local.json` | **Member** (any toolkit `init` ensures skeleton) | Machine checkout roots for platform repos |
| `legacy-repos.local.json` | **Member** (any toolkit `init` ensures skeleton) | Machine checkout roots for `legacy-*` / brownfield |

Schemas:

- `templates/schemas/platform-repos.schema.json` (DNA)
- Bundlekit `templates/schemas/legacy-repos.schema.json` (portable legacy)

Helper SSOT: `ensureLocalRepoMaps(root)` exported from `@platform/platform-dna`.
Every toolkit `init` may call it — **create-if-missing only**; existing member
content is never overwritten. Both `*.local.json` patterns are merged into
`.gitignore` as **shared** entries.

## Portable `platform-repos.json`

Committed map describes the current repository (and, when already present, keeps
sibling catalog keys). DNA `seedProjectMaps` upserts only the current-repo entry
(`root: "."`) — it does not wipe a member catalog.

```json
{
  "defaultGroup": "fe",
  "groups": {
    "fe": { "primary": "portal", "projects": ["portal"] }
  },
  "projects": {
    "portal": {
      "root": ".",
      "role": "fe",
      "repo": "portal",
      "write": true
    }
  }
}
```

Rules:

- `root` is `"."`; no sibling or machine checkout paths.
- Public repository URLs are optional.
- The map contains repositories only. It has no toolkit, skill, adapter, or
  install-state section.
- **Platform DNA is the only writer** of portable `platform-repos*`. Specialist
  kits never create or modify those files; each kit tracks installed skills in
  its own `install-manifest.json`.
- DNA does **not** seed portable `legacy-repos.json` — Bundlekit owns that.

## Machine-local maps

Member checkout roots belong in ignored `*.local.json` files:

```json
{
  "projects": {
    "portal": { "root": "/home/me/ws/portal" },
    "legacy-erp": { "root": "D:\\legacy\\erp" }
  }
}
```

Routing:

- Platform skills / system ids → `platform-repos.local.json`
- Prefix / intent `legacy-*` → `legacy-repos.local.json`

**Do not hand-edit JSON.** Use `/configure-repo-maps` with a natural-language
description; the agent merges by key and enforces portable path policy.

### Example prompts (templates)

Copy into the agent after `/configure-repo-maps`:

**Platform-only**

```text
docs = base-docs ở ~/ws/base-docs, portal admin ở ~/ws/portal, api core ở ~/ws/api
```

→ merge into `platform-repos.local.json` (`base-docs`, `portal`, `api`; ask if
roles/keys are ambiguous).

**Multi portal / API**

```text
2 portal: admin ở ~/ws/portal, line ở ~/ws/line; 2 API: core ở ~/ws/api-core,
scenario ở ~/ws/api-scenario; docs = ~/ws/base-docs; tests = ~/ws/base-tests
```

→ one key per checkout; ask for any path still missing.

**Legacy**

```text
legacy ERP ở D:\legacy\erp, key legacy-erp
```

→ `legacy-repos.local.json` only; optional portable `legacy-repos.json` `url` if
the member supplies one (still `root: "."` in the portable file).

After writing locals: run `platform-dna codegraph:wire`. For each checkout
missing `.codegraph/`: `cd <root> && codegraph init`.

### Key collision (`codegraph:wire`)

Wire reads platform local map first, then legacy. Same key in both maps with
different roots → **platform entry wins**; legacy duplicate is skipped. Prefer
`legacy-*` keys for legacy-only checkouts.

## Lifecycle ownership

When `platform-dna init` creates `platform-repos.json` or
`platform-repos.example.json`, their SHA-256 values are stored in
`.platform-dna/install-manifest.json`. `platform-dna deinit` (one destination
repo) and global `platform-dna uninstall` remove those maps only while the
recorded hash still matches. A map that existed before init, or that a member
modified afterward, is preserved and reported.

Init also ensures both `*.local.json` skeletons (and shared `.gitignore`
lines). Those files are member-owned content: deinit never deletes them, and
shared ignore lines stay so other toolkits can keep using the maps.

`platform-dna prune` is deliberately narrower: it removes only stale,
unmodified harness assets. It never prunes project maps or another toolkit's
files.

Legacy portable evidence seeding lives in Bundlekit, not Platform DNA.
