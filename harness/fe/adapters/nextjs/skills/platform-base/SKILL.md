---
name: platform-base
description: Next.js FE conventions — layers, testId, gen-first; see invariants (glob)
disable-model-invocation: true
---

# Platform Base (Next.js FE)

**Owner:** Platform DNA (`--type=fe --adapter=nextjs`)

Auth-first Next.js · App Router · shadcn · Playwright. Code under `src/`.

**Rules (FE globs):** `platform-invariants.mdc` · contract-naming · `platform-base-*` · size/split/import · design-vocab (product repo).

## Gen trước (code)

1. Codegenkit `gen` / repo shim from IR already grilled
2. AI only fills gaps: Mo* / `#needs-*` not yet in registries
3. Do not write boilerplate when codegen already covers it

## Layers

`app|pages/components` → hooks/composables → services → models/validations → `apiFetch`  
Form + contract follow the stack in this repo. testId + Playwright: `/test`.

## Checklist

- [ ] Clean layers · testId on interactive controls
- [ ] E2E scripts → `/test`; plans YAML on tests hub
