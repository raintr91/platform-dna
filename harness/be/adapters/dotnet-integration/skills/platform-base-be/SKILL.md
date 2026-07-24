---
name: platform-base-be
description: .NET Integration BE conventions — gen-first, clear boundaries
disable-model-invocation: true
---

# Platform Base (.NET Integration BE)

**Owner:** Platform DNA (`--type=be|monolith --be-adapter=dotnet-integration`)

.NET integration host · Codegenkit grill/gen first when applicable.

## Gen trước (code)

1. Prefer codegen / existing templates before free-form scaffolding
2. AI fills gaps only — do not duplicate generated surfaces

## Checklist

- [ ] Clear API / application / infrastructure boundaries
- [ ] Contracts align with docs hub when present
