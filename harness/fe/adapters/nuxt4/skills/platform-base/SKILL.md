---
name: platform-base
description: Nuxt 4 FE conventions — layers, testId, gen-first; see invariants (glob)
disable-model-invocation: true
---

# Platform Base (Nuxt 4 FE)

**Owner:** Platform DNA (`--type=fe --adapter=nuxt4`)

Auth-first Nuxt 4 · Pinia · vee-validate+Zod · shadcn · Playwright.

**Rules (FE globs):** `platform-invariants.mdc` · `platform-contract-naming.mdc` · `platform-base-*` · size/split/import · design-vocab (product repo).

## Gen trước (code)

1. Codegenkit `gen` / repo shim from IR already grilled
2. AI only fills gaps: Mo* / `#needs-*` not yet in `registries/`
3. Do not write layer boilerplate when codegen already covers it

## Layers

`pages/components` → `composables` → `services`+`stores` → `models`+`validations` → `$apiFetch`  
No `$apiFetch` in page/component. Form: `useApiForm`.

UI: `ui/` → `Mo*` → `Data*|OrGlobal*` · shell `DataListPage`.

testId: `{module}-{field|action}-input|btn|dialog|alert` · `page.getByTestId()`.

## Checklist

- [ ] 4 layers · lean files · testId on interactive controls
- [ ] E2E scripts → `/test` (Playwright); plans YAML live on tests hub
