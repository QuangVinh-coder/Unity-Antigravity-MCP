---
name: agent-scorecard-repair
description: Dùng khi EXECUTOR hoặc COMMENTER được giao sửa một hoặc nhiều cổng FAIL / BLOCKED từ bảng chấm G1–G10 (agent-review-scorecard) trong dự án Do an 3, tạo test hồi quy RED->GREEN và ghi bài học vào .agents/rules/error-ledger.md Part 2.
---

# Agent Scorecard Repair (Xử lý & Khắc phục Finding từ Bảng cổng G1–G10)

- **Author:** Antigravity (`Gemini 4 Argon`) — viết ngày 2026-11-22 theo quyết định owner `OL-2026-11-22-A01`..`OL-2026-11-22-A12`.
- **SOURCE:** `project-local` · **QUALIFICATION_STATUS:** `PILOT` (kiểm định 4 bước `SG-04` tại `docs/reviews/2026-11-22-agent-skills-sg04-audit.md`).
- **Luật canonical ràng buộc:** `.agents/rules/review-scorecard.md`, `.agents/rules/error-ledger.md` (`TW-08`), `.agents/rules/team-workflow.md` (`TW-10..12`), `.agents/rules/codex-execution-contract.md` (`CE-07`, `CE-10`).

## 1. Phân loại Finding (Triage)

1. Đọc kỹ báo cáo Scorecard `G1–G10` của Reviewer, Plan `ACTIVE` trong `docs/plans/`, dòng khóa trong `docs/STATUS.md`, và handoff của task.
2. **Đọc trọn file theo Read depth `C80`** đối với mọi file có finding và các caller/callee liên quan.
3. Tự chạy lại đúng lệnh mà Reviewer đã dùng để tái hiện cổng `FAIL` hoặc `BLOCKED`. Không tự ý hạ mức severity hay bỏ qua cổng `FAIL`.
4. Nếu việc sửa đòi hỏi phải chạm vào file nằm ngoài Allowed Files của Plan hiện tại → dừng lại và báo `BLOCKED: plan` để Orchestrator lập `## Plan fix N` (`CE-10`).

## 2. Thực thi Sửa lỗi theo Đúng Phân vai (`TW-10`)

- **Nếu lỗi thuộc về Code / Test / Chuẩn UCC (`G2`, `G3`, `G4`, `G5`, `G7 code`, `G9 code`):**
  - Nếu Executor là **Codex**: sửa code và bổ sung test hồi quy (chứng minh RED trước sửa → GREEN sau sửa), **không viết thêm comment mới**; sau khi code xanh, bàn giao để Orchestrator chụp `comment-guard.mjs snapshot` và giao **Gemini `COMMENTER`** cập nhật comment.
  - Nếu Executor là **Gemini**: sửa code, bổ sung test hồi quy RED→GREEN, và cập nhật luôn comment tiếng Việt chuẩn `VCS-01..10`.
- **Nếu lỗi chỉ thuộc về Comment (`G7/G9 comment` hoặc `comment-guard.mjs verify` lệch):**
  - Giao **Gemini `COMMENTER`** khôi phục đúng dòng code gốc từ bản chụp `comment-guard.mjs`, chỉ sửa comment theo nhận xét của Reviewer (không chép nguyên văn câu mẫu nếu có, tự diễn đạt đúng bản chất kỹ thuật theo `VCS-01..10`), rồi chạy `node Tools/AIControlPlane/comment-guard.mjs verify <nhãn>` đạt exit code `0`.

## 3. Ghi Sổ lỗi (`TW-08`) và Trả bài Review

1. **Bắt buộc ghi bài học vào `.agents/rules/error-ledger.md` Part 2 (`TW-08`):**
   Khi sửa xong một lỗi có bằng chứng thật, thêm một dòng vào cuối bảng Part 2 của `.agents/rules/error-ledger.md` theo đúng 5 cột:
   `| Ngày / agent | Triệu chứng | Nguyên nhân đã chứng minh | Cách phòng | Cách kiểm |`
   *(Nếu `.agents/rules/error-ledger.md` chưa nằm trong phạm vi khóa ghi của subagent thì ghi nguyên văn dòng đề xuất đó vào `BRANCH_HANDOFF.md` để Orchestrator/Maintainer chèn vào `error-ledger.md`)*.
2. Chạy lại toàn bộ các lệnh kiểm của cổng vừa sửa (`scan-csharp-rules.mjs`, `scan-secrets.mjs`, `comment-guard.mjs verify`, `validate-control-plane.mjs`, Unity batchmode EditMode test).
3. Cập nhật handoff / `BRANCH_HANDOFF.md` kèm báo cáo đủ 12 trường `CE-07` và chuyển trạng thái về `READY_FOR_REVIEW` để Reviewer tự chạy lại bảng cổng `G1–G10`.
