---
name: configure-repo-maps
description: /configure-repo-maps — Merge NL checkout paths into platform-repos.local.json / legacy-repos.local.json (no git clone).
disable-model-invocation: true
---

<!-- platform-dna:configure-repo-maps-ssot -->

# /configure-repo-maps

**Mục đích:** Điền đường dẫn checkout local vào map máy — không clone repo, không sửa portable catalog.

## Hard rules (bắt buộc)

1. **Chỉ ghi** `platform-repos.local.json` và/hoặc `legacy-repos.local.json` (merge-by-key).
2. **Không** `git clone` / `git fetch` / connect remote / download source.
3. **Không** sửa `platform-repos.json` / `legacy-repos.json` (portable: `root` chỉ `"."`).
4. **Không** hand-edit JSON hộ member bằng cách paste cả file — nhận NL, hỏi key/path còn thiếu.
5. Absolute path (hoặc `~` / drive Windows) → normalize rồi ghi vào `projects.<key>.root`.

## Routing

| Intent | File |
|--------|------|
| Platform / hub hiện tại (docs, portal, api, tests, …) | `platform-repos.local.json` |
| Prefix / ý `legacy-*`, khảo cổ hệ cũ | `legacy-repos.local.json` |

## Example prompts

**Platform-only**

```text
docs = base-docs ở ~/ws/base-docs, portal admin ở ~/ws/portal, api core ở ~/ws/api
```

→ merge `base-docs`, `portal`, `api` vào `platform-repos.local.json` (hỏi nếu key/role mơ hồ).

**Multi portal / API**

```text
2 portal: admin ở ~/ws/portal, line ở ~/ws/line; 2 API: core ở ~/ws/api-core,
scenario ở ~/ws/api-scenario; docs = ~/ws/base-docs; tests = ~/ws/base-tests
```

→ một key / checkout; hỏi path còn thiếu.

**Legacy**

```text
legacy ERP ở D:\legacy\erp, key legacy-erp
```

→ chỉ `legacy-repos.local.json`.

## After write

1. `platform-dna codegraph:wire` (khi dùng Cursor + CodeGraph).
2. Checkout nào chưa có `.codegraph/`: `cd <root> && codegraph init`.
