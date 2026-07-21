---
name: configure-repo-maps
description: /configure-repo-maps — Hướng dẫn tạo và cấu hình các map repository (platform-repos.local.json, legacy-repos.local.json).
disable-model-invocation: true
---

# /configure-repo-maps

**Mục đích:** Khi các toolkits yêu cầu thông tin về đường dẫn local của các repository (platform hoặc legacy) nhưng file `*.local.json` tương ứng chưa được thiết lập chính xác hoặc chưa tồn tại.

## Hướng dẫn sử dụng
1. Bạn hãy cung cấp đường dẫn tuyệt đối (absolute path) trên máy tính của bạn tới thư mục gốc của các repository.
2. Agent sẽ dựa vào thông tin đó để tự động tạo hoặc cập nhật file `.local.json` tương ứng.
3. Không copy paste trực tiếp file JSON; hãy yêu cầu bằng ngôn ngữ tự nhiên.

**Các file map:**
- `platform-repos.local.json`: Đường dẫn tới các repo mới/hiện tại của hệ thống.
- `legacy-repos.local.json`: Đường dẫn tới các repo của hệ thống cũ (dùng cho khảo cổ / archaeology).
