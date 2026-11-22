---
name: agent-review-scorecard
description: Dùng khi REVIEWER hoặc ORCHESTRATOR (Claude, Codex, hoặc Gemini Neon/Argon) chấm kết quả thực thi của EXECUTOR/COMMENTER trong dự án Do an 3 bằng bảng cổng định lượng G1–G10 (.agents/rules/review-scorecard.md), tự chạy lại mọi lệnh/máy quét và kiểm tra việc gom nhánh ảo agents/branches/.
---

# Agent Review Scorecard (Chấm Bảng cổng Định lượng G1–G10 — Unity & Plastic SCM)

- **Author:** Antigravity (`Gemini 4 Argon`) — viết ngày 2026-11-22 theo quyết định owner `OL-2026-11-22-A01`..`OL-2026-11-22-A12`.
- **SOURCE:** `project-local` · **QUALIFICATION_STATUS:** `PILOT` (kiểm định 4 bước `SG-04` tại `docs/reviews/2026-11-22-agent-skills-sg04-audit.md`).
- **Luật canonical ràng buộc:** `.agents/rules/review-scorecard.md` (`RS-01..05`), `.agents/rules/code-audit.md`, `.agents/rules/team-workflow.md` (`TW-01..13`), `.agents/rules/vietnamese-comment-standard.md` (`VCS-01..10`).

## 1. Nguyên tắc Độc lập & Độ sâu Đọc code (`RS-01`, `C80`)

1. **Không tự chấm bài của chính mình:** Phiên agent vừa viết một diff không tự chấm scorecard pass cho chính diff đó. Model của Reviewer phải tuân theo quy tắc `CPG-02` / `TW-01` (khác họ hoặc dùng model mạnh hơn / effort cao hơn).
2. **Read depth `C80` (`TW-12`):** Trước khi đưa ra verdict, Reviewer phải đọc **trọn vẹn 100% file nguồn** của mọi file non-UI đã thay đổi cùng các file caller/callee/shared contract liên quan. Ghi danh sách `Files read in full (C80)`.
3. **Tự chạy lại mọi lệnh đo được (`EV-09`):** Tuyệt đối không chép số liệu từ báo cáo của Executor. Lệnh nào không tự chạy lại được (ví dụ Unity Editor đang mở khóa project) thì ghi rõ `"chưa tự chạy lại: <lý do>"` và đánh cổng tương ứng là `BLOCKED` (chờ owner kiểm `OWNER-ONLY`), không bao giờ đánh `PASS` cho cổng chưa đo.

## 2. Quy tắc Review theo Loại Nhánh ảo `agents/branches/` (`TW-11`)

- **Với Nhánh Độc quyền (`MODE: DISJOINT` — chỉ có 1 thư mục model dưới `agents/branches/<type>/lane<X>-<task-slug>/`):**
  - Review và tích hợp ngay khi subagent bàn giao `BRANCH_HANDOFF.md`, không cần chờ các `lane` khác.
- **Với Cụm Nhánh Xung đột (`MODE: CONFLICT_CLUSTER` — có $\ge 2$ thư mục model dưới cùng `agents/branches/<type>/lane<X>-<task-slug>/`):**
  - Kiểm tra bằng `node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs status agents/branches/<type>/lane<X>-<task-slug>`.
  - Nếu còn bất kỳ nhánh con nào chưa có `BRANCH_HANDOFF.md` (`WAITING_FOR_CONFLICT_CLUSTER`) → **DỪNG, KHÔNG REVIEW LẺ**.
  - Chỉ khi toàn bộ các nhánh con trong cụm đã bàn giao (`READY_TO_MERGE_CLUSTER`) và đã được merge + chạy `comment-guard.mjs` cho phần code của Codex thì mới chấm `G1–G10` cho cả cụm trong **một lượt duy nhất**.

## 3. Quy trình Chấm 10 Cổng `G1–G10` (`RS-02`)

| Cổng | Lệnh / Cách Reviewer tự kiểm | Ngưỡng `PASS` |
| --- | --- | --- |
| **G1 Quy trình** | Kiểm báo cáo `CE-07` đủ 12 trường; có danh sách `Files read in full (C80)`; có phản biện 5 giai đoạn; quyết định owner có mã `OL-` trong `docs/owner-log/`; tuân thủ đúng `TW-10` (Codex 0 comment → Gemini `COMMENTER` có `comment-guard.mjs verify` exit 0; hoặc Gemini Executor tự comment) | Đủ 12 trường + đúng quy trình |
| **G2 Compile** | Chạy Unity batchmode (`RS-03`) xuất log ra `%TEMP%\do-an-3-verify\` rồi chạy `Select-String -Pattern 'error CS'` (hoặc owner xác nhận Console sạch khi Editor đang mở) | `0 error CS`, `0` warning mới ở file task |
| **G3 Test EditMode** | Đọc `TestNewEditModeResults.xml` / `EditModeResults.xml` ở `%TEMP%\do-an-3-verify\` | `failed=0`, `passed >= baseline + số test mới`, không xóa test cũ |
| **G4 Test có thật** | Kiểm tra cặp bằng chứng test mới **RED** trước khi sửa code sản phẩm → **GREEN** sau khi sửa | 100% test mới có cặp bằng chứng RED → GREEN |
| **G5 Truy vết AC** | Đối chiếu từng dòng bảng Acceptance Criteria (`CE-09`) trong Plan với Trường 7 của báo cáo | 100% dòng có bằng chứng đo được hoặc checklist `OWNER-ONLY` |
| **G6 Phạm vi** | Chạy `cm status --short`, đối chiếu với baseline handoff và Allowed Files của Plan | `0` file ngoài Scope, `0` vùng cấm, thư mục mới dưới `Assets/` có khai báo `.meta` (`TW-02`) |
| **G7 Rủi ro tĩnh & Comment** | Reviewer **tự chạy lại** `node Tools/AIControlPlane/comment-guard.mjs verify <nhãn>` (với code do Codex viết + Gemini comment), `node Tools/AIControlPlane/scan-csharp-rules.mjs <file/thư mục task>`, `node Tools/AIControlPlane/scan-secrets.mjs <file/thư mục task>`, đọc thủ công từng `NGHI VẤN` và chấm chất lượng comment theo `RS-02A` / `VCS-01..10` | `comment-guard verify` exit 0; `CHẮC=0` ở cả 2 máy quét; mọi `NGHI VẤN` được giải trình; comment tự nhiên, đúng nghiệp vụ |
| **G8 Tài liệu & Control-Plane** | Chạy `node Tools/AIControlPlane/validate-control-plane.mjs` | `FAIL=0` (và `WARN=0`), STATUS ↔ handoff ↔ plan ↔ `owner_review` đồng bộ |
| **G9 Finding nặng** | Rà theo `.agents/rules/code-audit.md` (và `.claude/skills/security-review/SKILL.md` nếu chạm biên client ↔ server ↔ backend) | `0` finding mức `Critical` / `Required` |
| **G10 Runtime** | Kiểm tra kết quả Play Mode của owner hoặc xuất checklist `OWNER-ONLY` | Owner đã tích hoặc ghi rõ `NEEDS_EDITOR_VERIFICATION` / `NEEDS_RUNTIME_VERIFICATION` |

## 4. Suy ra Verdict và Đóng Review (`RS-04`, `RS-05`)

1. **Suy ra Verdict chỉ từ bảng cổng:**
   - Có $\ge 1$ cổng `FAIL` → **`Changes required`** (trả khóa về `IN_PROGRESS` và giao sửa theo skill `agent-scorecard-repair`).
   - Không có `FAIL` nhưng G2 `BLOCKED` → **`Unable to determine`**.
   - Còn lại → **`Conformant within audited scope`** (kèm danh sách mục `OWNER-ONLY` ở G10 nếu còn chờ owner).
2. Cập nhật trạng thái trong `docs/STATUS.md` và handoff sang `REVIEWED` (hoặc trả về `IN_PROGRESS`), ghi mục `REVIEW` vào `docs/DEVELOPMENT_HISTORY.md`, và cập nhật bản dễ đọc trong `docs/owner_review/` (`TW-09`).
