---
name: legacy
description: /legacy — Skill Modifier: Chỉ định thay đổi nguồn tham chiếu từ hệ thống mới sang hệ thống cũ (legacy archaeology). Dùng kết hợp với các skill khác (vd: /legacy /spec).
disable-model-invocation: true
---

# /legacy — Legacy Context Modifier

**Skill Modifier:** Khi người dùng sử dụng skill `/legacy` kèm với một skill chuyên môn khác (ví dụ: `/legacy /spec`, `/legacy /overview`, `/legacy /business-process`), Agent PHẢI tuân thủ các quy tắc thay đổi hành vi sau đây.

## Hành vi bị thay đổi (Context Shift)

1. **Đổi nguồn tham chiếu (Source of Truth):**
   - THAY VÌ đọc từ các repository hiện tại (ví dụ: `platform-repos.local.json`), Agent PHẢI đọc từ `legacy-repos.local.json` và phân tích trên mã nguồn/tài liệu của hệ thống cũ.

2. **Chế độ Khảo cổ (Archaeology Mode):**
   - Không tự động sáng tạo logic mới hay giả định. Bạn đang làm nhiệm vụ "khảo cổ" — chỉ trích xuất, ánh xạ và ghi nhận những gì THỰC SỰ tồn tại trong hệ thống cũ.

3. **Cập nhật Metadata (Nếu áp dụng):**
   - Với một số file thiết kế (ví dụ YAML bundle do `/spec` tạo ra), hãy áp dụng các metadata phù hợp với legacy (ví dụ: `specOrigin: legacy`) theo hướng dẫn trong skill chuyên môn.
   - Luôn tham chiếu về `legacy.dynamics.yaml` thay vì các cấu trúc mặc định khi có chỉ định trong base skill.

**Cách hoạt động (Dành cho Agent):**
Skill này KHÔNG CÓ luồng công việc (workflow) độc lập. Nó chỉ là những ràng buộc bổ sung (constraints) sẽ ghi đè lên hoặc kích hoạt các hướng dẫn dành riêng cho "legacy" bên trong file SKILL.md của skill chính (như `/spec`, `/module`).
