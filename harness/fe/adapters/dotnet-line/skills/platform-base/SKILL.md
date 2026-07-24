---
name: platform-base
description: .NET Line (WinForms) client conventions — gen-first, thin UI, clear boundaries
disable-model-invocation: true
---

# Platform Base (.NET Line / WinForms)

**Owner:** Platform DNA (`--type=fe|monolith --fe-adapter=dotnet-line`)

WinForms Line client · Codegenkit grill/gen first when applicable.  
Not Nuxt/Next — do not apply web FE layer rules here.

## Gen trước (code)

1. Prefer codegen / existing Line templates before free-form UI scaffolding
2. AI fills gaps only — do not duplicate generated surfaces

## Boundaries

- Keep UI (forms/controls) thin; push rules into services/view-models as the stack already does
- Prefer existing Line module/layout conventions in this repo over inventing new trees

## Checklist

- [ ] No web FE assumptions (no Pinia / Playwright / `$apiFetch` patterns)
- [ ] Contracts align with docs / Integration BE when present
