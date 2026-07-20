---
name: platform-ai
description: /platform-ai — build and maintain the Platform DNA resolver MCP package.
disable-model-invocation: true
---

# /platform-ai — build Platform DNA

Use this skill to design, implement, test, package, and release Platform DNA
itself. Do not run Platform DNA against toolkit source checkouts.

## Scope

- Own profile resolution for `docs`, `fe`, `be`, and `tests`.
- Own the repo-only `platform-repos` schema/seeding, FE `/platform-base`,
  SSOT `ensureLocalRepoMaps`, and `/configure-repo-maps`.
- Reject MCP targets (`mcp-package.json` or `role=tooling`).
- Never sync `/platform-ai` or lane/meta rules into destination repos.
- Bundlekit owns portable `legacy-repos*`; DNA only ensures
  `legacy-repos.local.json` (create-if-missing) via `ensureLocalRepoMaps`.
- Do not keep a repository-local `platform-repos.json` or sibling topology.

## Workflow

1. Freeze profile and ownership contracts in `profiles.json` and
   `mcp-package.json`.
2. Keep package invocation explicit and independently testable.
3. Preserve portability, conflict protection, and dry-run behavior.
4. Test all supported profiles plus MCP-target rejection.
5. Run `pnpm test` and `pnpm pack --dry-run` before release.

## Done

- Resolver installs only into docs/code hubs.
- Toolkit source checkouts remain independently managed.
- No committed destination map contains machine or sibling paths.
- Version, profiles, docs, and tests agree.
