---
name: platform-base-be
description: FastAPI BE conventions — modules, gen-first, thin routers; see stack docs
disable-model-invocation: true
---

# Platform Base (FastAPI BE)

**Owner:** Platform DNA (`--type=be|monolith --be-adapter=fastapi`)

FastAPI · modular packages · Codegenkit grill/gen first.

## Gen trước (code)

1. Codegenkit `gen` / repo shim from IR already grilled
2. AI only fills `#needs-*` / gaps not yet in `registries/`
3. Do not hand-write boilerplate codegen already covers

## Layers

`router` → `service` / `use-case` → `repository` / adapters → models/schemas  
Keep routers thin. Domain rules stay out of transport.

## Checklist

- [ ] Module boundaries clear · no god routers
- [ ] Contracts align with docs hub OpenAPI / IR when present
