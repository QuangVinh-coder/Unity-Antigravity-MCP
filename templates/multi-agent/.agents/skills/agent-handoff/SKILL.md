---
name: agent-handoff
description: Dùng khi tạo, cập nhật mỗi mốc, khôi phục sau compact/phiên mới (TW-04), hoặc đóng hồ sơ handoff trong docs/handoff/ (và BRANCH_HANDOFF.md trong nhánh ảo agents/branches/) cho dự án Do an 3.
---

# Agent Handoff (Quản lý Trạng thái sống & Khôi phục Ngữ cảnh)

- **Author:** Antigravity (`Gemini 4 Argon`) — viết ngày 2026-11-22 theo quyết định owner `OL-2026-11-22-A01`..`OL-2026-11-22-A12`.
- **SOURCE:** `project-local` · **QUALIFICATION_STATUS:** `PILOT` (kiểm định 4 bước `SG-04` tại `docs/reviews/2026-11-22-agent-skills-sg04-audit.md`).
- **Luật canonical ràng buộc:** `.agents/rules/team-workflow.md` (`TW-02..05`, `TW-09`, `TW-11`), `.agents/rules/owner-dialogue-log.md` (`OL-01..07`), `docs/handoff/README.md`.

## 1. Tạo Handoff và Nhận khóa (`TW-02`)

1. Tên file handoff trên cây chính: `docs/handoff/YYYY-MM-DD-<agent>-<slug>.md` (giữ gọn dưới ~150 dòng; theo đúng template trong `docs/handoff/README.md`).
2. Trước khi tạo handoff:
   - Chạy `cm status --short` để ghi chính xác head changeset (`cs:<N>`) và số lượng đường dẫn pending baseline (`PL-05`).
   - Lấy giờ máy chính xác đến giây kèm múi giờ: `Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"` (định dạng `YYYY-MM-DD HH:MM:SS +07:00`).
3. Cập nhật `docs/STATUS.md` trong cùng lượt:
   - Cập nhật mục `## Ảnh chụp trạng thái` (`**Ghi lúc:** YYYY-MM-DD HH:MM:SS +07:00`, workspace, head, số dòng pending).
   - Thêm đúng 1 dòng vào bảng `## Đang làm`:
     `| <Agent> — <VAI> | <Việc ngắn gọn> | [<file>.md](handoff/<file>.md) | YYYY-MM-DD HH:MM:SS +07:00 | IN_PROGRESS |`
   - Với các nhánh ảo chạy song song trong `agents/branches/<type>/lane<X>-<task-slug>/<agent>-<model>-<effort>/`: chỉ `ORCHESTRATOR` giữ dòng khóa trong `docs/STATUS.md`, còn mỗi subagent ghi tiến độ vào file `BRANCH_HANDOFF.md` bên trong thư mục nhánh ảo của mình (`TW-11`).

## 2. Duy trì Handoff qua từng Mốc & Biên Milestone (Gate 1)

- Ghi đè mục `## Current state (ghi đè mỗi mốc)` và cập nhật dòng `- **Updated:** YYYY-MM-DD HH:MM:SS +07:00`:
  - Ngay sau khi xong một milestone hoặc một bước lớn;
  - Trước khi chạy lệnh dài (Unity batchmode, gọi subagent CLI);
  - Trước khi đổi hướng hoặc dừng báo `BLOCKED: plan`;
  - Tại biên **1–2 milestone lớn** trước khi nhắc owner `/compact` (Gate 1).
- Mục `## Quyết định (chỉ ghi thêm)` luôn trích mã `OL-YYYY-MM-DD-<chữ><NN>` đã có thật trong `docs/owner-log/YYYY-MM.md`. Tuyệt đối không trích một mã `OL-` chưa được ghi vào `docs/owner-log/` (máy kiểm `owner-log-ref` của `validate-control-plane.mjs` sẽ báo `FAIL`).

## 3. Khôi phục Ngữ cảnh sau Compact, Hết Usage hoặc Phiên mới (`TW-04`, `OL-2026-11-22-A18`, `A19`)

Không bao giờ làm tiếp dựa vào trí nhớ cuộc chat hay bản tóm tắt compact. Đọc theo đúng thứ tự:
1. `AGENTS.md`
2. `docs/STATUS.md` (`## Đang làm`)
3. File handoff của task mình trong `docs/handoff/` (chỉ đọc handoff của task mình)
4. File plan `ACTIVE` (hoặc `DRAFT` nếu Planner bị ngắt giữa chừng) trong `docs/plans/`
5. Grep `docs/owner-log/` (tháng hiện tại và tháng trước) theo tên file handoff/plan để đọc nguyên văn lời owner
6. Nếu là Orchestrator có nhánh ảo đang mở dưới `agents/branches/`: chạy ngay `node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs recover --all` để đọc `ORCHESTRATOR_STATE.json` và `BRANCH_MANIFEST.json`, xác định chính xác từng `threadId` đang `PAUSED_QUOTA`/`PAUSED_NETWORK` và bỏ qua các nhánh đã `INTEGRATED`/`COMPLETED`.

## 4. Đóng Handoff sau khi Owner Nghiệm thu (`TW-05`, `TW-09`)

Chỉ thực hiện khi owner đã chính thức nghiệm thu (`ACCEPTED`):
1. **Bước 1 (Ghi lịch sử trước):** Thêm mục tóm tắt vào đầu `docs/DEVELOPMENT_HISTORY.md`. Nếu tổng số mục vượt quá **30**, chuyển nguyên văn mục cũ nhất sang `docs/history/YYYY-MM.md` trong cùng lượt.
2. **Bước 2 (Chuyển bản dễ đọc):** Chuyển bản dễ đọc của task từ `docs/owner_review/` vào `docs/owner_review/DaNghiemThu/` và cập nhật `docs/owner_review/README.md` (`TW-09` mục 6).
3. **Bước 3 (Cập nhật Plan & STATUS):** Đổi banner dòng 3 của plan trong `docs/plans/` sang `COMPLETED` (và chuyển mục trong `docs/plans/README.md`), cập nhật `docs/STATUS.md`.
4. **Bước 4 (Xóa handoff cuối cùng):** Xóa file handoff đã đóng trong `docs/handoff/` và dòng tương ứng trong `docs/STATUS.md` → `## Đang làm`. Không bao giờ xóa handoff trước khi có mục trong `docs/DEVELOPMENT_HISTORY.md`.
5. Chạy `node Tools/AIControlPlane/validate-control-plane.mjs` để xác nhận `FAIL=0`.
