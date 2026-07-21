---
name: configure-repo-maps
description: >-
  /configure-repo-maps — turn a natural-language repo topology into
  platform-repos.local.json / legacy-repos.local.json (merge-by-key, portable
  path policy). Use when a member describes checkouts, portals, APIs, docs,
  tests, or legacy-* roots instead of hand-editing JSON.
disable-model-invocation: true
---

<!-- platform-dna:configure-repo-maps-ssot -->

# /configure-repo-maps

**Owner:** Platform DNA (SSOT). Docskit / Processkit may ship a thin redirect
or copy of this skill for install-order independence — keep semantics identical.

Member describes checkout topology in natural language. You analyze, ask when
required fields are missing, then **merge-by-key** into the correct map files.
Do **not** ask the member to write JSON by hand. Do **not** invent sibling
paths.

## Inputs (NL examples)

- Platform multi-repo: “2 portal: admin ở `~/ws/portal`, line ở `~/ws/line`; 2
  API: core + scenario; docs = base-docs; tests = base-tests”
- Platform-only: “docs = base-docs, portal admin ở `~/ws/portal`, api core ở
  `~/ws/api`”
- Legacy: “legacy ERP cũ ở `D:\legacy\erp`, key `legacy-erp`”

## Routing — which file

| Intent / key | Machine-local file | Portable (optional) |
|--------------|--------------------|---------------------|
| Platform checkout (portal, api, docs, tests, …) | `platform-repos.local.json` | Update current-repo entry in `platform-repos.json` only if needed (`root: "."`, no absolute paths) — DNA `seedProjectMaps` rules |
| `legacy-*` / clear legacy archaeology | `legacy-repos.local.json` | Optional key/`url` (+ `root: "."`) in Docskit `legacy-repos.json` — **never** absolute machine roots in portable maps |

## Procedure

1. **Parse** the prompt into candidate entries: `key`, `root` (absolute or
   `~/…` / drive path), optional `role` (`docs`|`fe`|`be`|`tests`), optional
   public `url`.
2. **Ask** when any of these are missing or ambiguous: role, path, or key.
   Prefer Gaps over guessing. Never invent a sibling checkout.
3. **Read** existing `.local.json` files (create skeletons only via
   `platform-dna init` / toolkit init — if missing, tell member to run init, or
   write the standard `{ "$schema", "projects": {} }` skeleton once).
4. **Merge by key** into the correct file:
   - Same key + same intent → update fields; do not duplicate.
   - New key → add.
   - Same key, conflicting root/role → **ask** before overwrite (unless member
     said replace/wipe).
   - Never wipe the whole `projects` object unless the member explicitly asks
     to replace the map.
5. **Portable path policy:** reject absolute / `~/` / `../` / drive paths in
   committed `platform-repos.json` and `legacy-repos.json`. Machine roots stay
   in `*.local.json` only.
6. **After write:**
   - Suggest or run `platform-dna codegraph:wire` (idempotent).
   - For each checkout without `.codegraph/`: print
     `cd <root> && codegraph init`.
7. **Idempotent:** second run with the same description must not duplicate keys.

## Local entry shape (machine)

```json
{
  "$schema": "…",
  "projects": {
    "portal": { "root": "/home/me/ws/portal" },
    "legacy-erp": { "root": "D:\\legacy\\erp" }
  }
}
```

Minimal required field per project: `root`. Prefer stable keys matching how
Processkit / Docskit skills refer to systems (`portal`, `api`, `legacy-erp`).

## Key collisions (codegraph:wire)

`platform-dna codegraph:wire` reads **platform** local map first, then legacy.
If the same key appears in both with different roots, the **platform** entry
wins and the legacy duplicate is skipped. Prefer `legacy-*` keys for legacy-only
checkouts so names never collide.

## Handoff

Other skills (`/legacy-spec`, `/business-process-trace`, `/business-impact-review`)
that need a missing checkout should Gaps + point here — not paste raw JSON.
