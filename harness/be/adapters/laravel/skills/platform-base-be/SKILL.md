---
name: platform-base-be
description: Laravel BE conventions — modules-v1, gen-first, thin controllers
disable-model-invocation: true
---

# Platform Base (Laravel BE)

**Owner:** Platform DNA (`--type=be|monolith --be-adapter=laravel`)

Laravel · `nwidart/laravel-modules` (modules-v1) · Codegenkit grill/gen first.

## Gen trước (code)

1. Codegenkit `gen` / repo shim from IR already grilled
2. AI only fills `#needs-*` / gaps not yet in registries
3. Do not hand-write module scaffolding codegen already covers

## Layers

`Http` (controllers/requests) → Actions/Services → Models/Repositories  
Controllers stay thin. Prefer module-local code under `Modules/`.

## Checklist

- [ ] modules-v1 layout · no cross-module leaks
- [ ] Contracts align with docs hub when present
