---
name: agent-plan-executor
description: Dùng khi một agent (Codex hoặc Gemini) giữ vai EXECUTOR thực thi một Plan hoặc milestone đã được owner duyệt trong dự án Do an 3 — làm việc trên cây thư mục chính hoặc trong thư mục nhánh ảo agents/branches/<type>/lane<X>-<task-slug>/<agent>-<model>-<effort>/, tuân thủ phân vai comment (Codex cấm comment vs Gemini tự comment VCS-01..10), tạo bằng chứng test RED->GREEN và báo cáo đủ 12 trường CE-07.
---

# Agent Plan Executor (Thực thi Plan trên Cây chính hoặc Nhánh ảo `agents/branches/`)

- **Author:** Antigravity (`Gemini 4 Argon`) — viết ngày 2026-11-22 theo quyết định owner `OL-2026-11-22-A01`..`OL-2026-11-22-A12`.
- **SOURCE:** `project-local` · **QUALIFICATION_STATUS:** `PILOT` (kiểm định 4 bước `SG-04` tại `docs/reviews/2026-11-22-agent-skills-sg04-audit.md`).
- **Luật canonical ràng buộc:** `AGENTS.md`, `.agents/rules/codex-execution-contract.md` (`CE-00..10`), `.agents/rules/team-workflow.md` (`TW-01..12`), `.agents/rules/coding-convention.md` (`UCC-01..37`), `.agents/rules/unity-runtime-conventions.md` (`UR-01..08`), `.agents/rules/vietnamese-comment-standard.md` (`VCS-01..10`).

## 1. Khởi động & Kiểm tra Khóa / Nhánh ảo (`TW-02`, `TW-11`)

1. Đọc `AGENTS.md` → `docs/STATUS.md` (`## Đang làm`) → handoff của task → plan `ACTIVE` trong `docs/plans/` → grep `docs/owner-log/` theo tên plan/handoff (`TW-04`).
2. **Đọc trọn file theo Read depth `C80` (`TW-12`):** Đọc 100% số dòng của mọi file trong phạm vi sẽ sửa và các file caller/callee/shared contract liên quan trước khi sửa dòng code đầu tiên. Ghi danh sách `Files read in full (C80)`.
3. **Xác định nơi được phép ghi:**
   - **Chế độ Nhánh ảo (`agents/branches/<type>/lane<X>-<task-slug>/<agent>-<model>-<effort>/`):** Khi được Orchestrator giao làm việc trên một nhánh ảo trong `agents/branches/`, Executor **chỉ ghi bên trong thư mục nhánh ảo đó** (theo đúng đường dẫn tương đối của repo, ví dụ `agents/branches/feature/lane1-match-score-core/codex-gpt-6.2-sol-high/Assets/Test_New/Core/MatchScoreCalculator.cs`) và ghi báo cáo tiến độ vào `<branch>/BRANCH_HANDOFF.md`. Tuyệt đối không sửa trực tiếp `docs/STATUS.md` hay `Assets/**` trên cây chính.
   - **Chế độ Cây chính (1 Executor duy nhất):** Chỉ ghi khi chính mình đang giữ dòng `EXECUTOR | IN_PROGRESS` trong `docs/STATUS.md` và đã chụp baseline `cm status --short` vào handoff (`PL-05`).

## 2. Quy tắc Phân vai Comment bắt buộc theo Họ Agent (`TW-10`, `OL-2026-11-22-A02`, `A03`)

- **Nếu bạn là Codex (`gpt-6.2-sol` / `gpt-6.2-astra`):**
  - Bạn **chỉ viết code C#/Node và viết test; TUYỆT ĐỐI KHÔNG viết comment code mới** (`//`, `///`, `/* */`). Nếu sửa vào một file cũ có sẵn comment mà dòng code đổi làm comment cũ trở nên sai sự thật, chỉ xóa dòng comment sai đó (`VCS-08`).
  - Sau khi bạn bàn giao code sạch + test xanh, Orchestrator sẽ chuyển các file `.cs` của bạn cho Gemini (`COMMENTER`) viết comment qua `Tools/AIControlPlane/comment-guard.mjs`.
- **Nếu bạn là Gemini (`Gemini 4 Neon` / `Hydrogen` / `Argon`):**
  - Khi bạn giữ vai `EXECUTOR` viết code, bạn **vừa viết code vừa tự viết comment tiếng Việt có dấu đầy đủ theo chuẩn `.agents/rules/vietnamese-comment-standard.md` (`VCS-01..10`) và skill `.agents/skills/vietnamese-code-comments/SKILL.md` ngay trong lúc code** (không cần tách thêm lượt `COMMENTER`).

## 3. Thực thi từng bước & Quy tắc dừng `BLOCKED: plan` (`CE-03`, `CE-10`)

1. Trước khi sửa code, ghi ngắn gọn **Phản biện 5 giai đoạn** (Biên dịch/phụ thuộc · Serialize/wiring `.meta` · Play Mode · Online/authority · Bảo trì UCC) vào handoff hoặc `BRANCH_HANDOFF.md`.
2. **Chỉ chạm đúng danh sách Allowed Files / Scope của milestone:**
   - Nếu phát hiện cần phải tạo hoặc sửa một file nằm ngoài Allowed Files (kể cả một file helper nhỏ hay thiếu khai báo `Assets/<ThưMụcMới>.meta`), hoặc thấy hai yêu cầu trong plan mâu thuẫn nhau: **DỪNG NGAY LẬP TỨC**.
   - Ghi `BLOCKED: plan` kèm bảng mô tả điểm chặn (`Gap | file:line | Bằng chứng | Đề xuất sửa plan`) vào `BRANCH_HANDOFF.md` (hoặc handoff) và báo về cho Orchestrator/owner. **Tuyệt đối không tự ý sửa file ngoài Allowed Files rồi báo cáo sau.**

## 4. Tự kiểm chứng trước khi bàn giao (`G2–G7`)

1. **Chứng minh test mới RED → GREEN (G4):** Với mỗi test mới kiểm tra bug hoặc hành vi mới, lưu bằng chứng test thất bại (RED) trước khi có code sửa/hoàn thiện và thành công (GREEN) sau khi sửa.
2. **Chạy máy quét chuẩn C# và máy quét bí mật trên phạm vi file đã chạm:**
   ```powershell
   node Tools/AIControlPlane/scan-csharp-rules.mjs <đường-dẫn-file-hoặc-thư-mục>
   node Tools/AIControlPlane/scan-secrets.mjs <đường-dẫn-file-hoặc-thư-mục>
   ```
   Phải đạt `CHẮC = 0` ở cả hai máy quét.
3. **Bàn giao:**
   - Trên nhánh ảo: ghi đầy đủ báo cáo **12 trường của `CE-07`** vào `<branch>/BRANCH_HANDOFF.md`.
   - Trên cây chính: cập nhật handoff và đổi trạng thái sang `READY_FOR_REVIEW`, xuất báo cáo đủ **12 trường của `CE-07`**.
   - **Cấm tuyệt đối** chạy `cm checkin`, `cm undo`, `cm switch` hay các lệnh Git.
