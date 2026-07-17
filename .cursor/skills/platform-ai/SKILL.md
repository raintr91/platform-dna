---
name: platform-ai
description: /platform-ai — build and maintain the Platform DNA resolver MCP package.
disable-model-invocation: true
---

# /platform-ai — build Platform DNA

Use this skill to design, implement, test, package, and release Platform DNA
itself. Do not run Platform DNA against MCP tooling repositories.

## Scope

- Own profile resolution for `docs`, `fe`, `be`, and `tests`.
- Own portable map schemas/seeding and the meta-harness installed into
  destination docs/code hubs.
- Reject MCP targets (`mcp-package.json` or `role=tooling`).
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
- MCP tool repositories remain independently managed.
- No committed destination map contains machine or sibling paths.
- Version, profiles, docs, and tests agree.
