---
name: platform-ai
description: /platform-ai — maintain docs-hub AI harness; lanes vs plans/FE/BE.
disable-model-invocation: true
---

# /platform-ai — Docs hub harness (meta)

Chỉ sửa `.cursor/` / handbook pointers trên **base-docs**. Không nhồi FE/Plans/BE vào chat docs.

## Lanes (một chat = một lane)

| Lane | Repo | Skills |
|------|------|--------|
| **Docs** | **this** (`base-docs`) | `/architecture` (context/operations/containers/module/function/flow) `/context` `/containers` `/component` **`/journey`** `/deployment` `/cross-cutting` `/decision` **`/hubdocs`** · `/spec` `/legacy-spec` grill `/update-spec*` · **`/business-process-trace`** (`/flow-trace` deprecated) |

People entry: `platform/guide/start-now.md` · Doc tree: `platform/guide/SYSTEM-DOC-STRUCTURE.md`
| **Plans** | `base-tests` | `/testcase` `/grill-testcase` |
| **FE** | portal / FE bases | `/prototype` `/wire` `/test` `/unit` |
| **BE** | api / BE bases | `/api` |

Đừng luônApply Nuxt/E2E. Gen design scripts trên hub; Playwright gen trên FE đọc plans hub.

Flow: `platform/toolchain/FEATURE-ARTIFACT-FLOWS.md` · `TESTS-HUB.md` · router docs.

## Portability (base invariant)

- Không commit link/path phụ thuộc sibling checkout, home directory hoặc ổ đĩa cá nhân.
- File mà skill docs-hub cần đọc/chạy phải nằm trong `base-docs` và dùng path tính từ repo root.
- Repo khác chỉ để tham khảo trong docs: dùng URL Git online ổn định, không dùng local relative link.
- MCP là dependency cài ngoài: link tới upstream/install docs; config do lệnh `init` tạo trên từng máy, không commit path generated.

## Done

- [ ] Docs skills/extracts đúng hub paths
- [ ] Docs-tier skills không bị lẫn FE/Plans/BE skills
- [ ] Không còn path/link phụ thuộc layout máy hoặc sibling repo
