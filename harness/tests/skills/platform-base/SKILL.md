---
name: platform-base
description: Tests hub conventions — cases/YAML plans, Playwright ownership, gen-first
disable-model-invocation: true
---

# Platform Base (Tests hub)

**Owner:** Platform DNA (`--type=tests`)

Tests hub owns plans / cases YAML and E2E scripts consumed by FE/BE product repos.
This is a **destination** skill — not `/platform-ai` (toolkit-internal).

## Ownership

- Plans / cases YAML live on this hub
- Playwright (or stack E2E) scripts may live here or under product `/test` per team contract
- Testkit owns runner skills/MCP; DNA only bootstraps hub conventions

## Gen / grill trước

1. Prefer Testkit / docs IR already grilled before inventing cases
2. Keep case IDs stable; do not rename casually

## Checklist

- [ ] `cases/` or `tests/` layout matches team markers
- [ ] Cross-links to FE/BE repos use `platform-repos.local.json` keys — not hard-coded machine paths
