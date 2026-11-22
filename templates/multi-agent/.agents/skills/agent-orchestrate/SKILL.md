---
name: agent-orchestrate
description: Dùng khi một agent (Claude, Codex hoặc Gemini Orchestrator Neon/Argon) giữ vai ORCHESTRATOR của dự án Do an 3 — lập plan theo Gates 0–7, trình Delegation brief, điều phối subagent trên nhánh ảo agents/branches/, xử lý báo cáo BLOCKED bằng Plan fix, gom/merge nhánh Disjoint và cụm Conflict Cluster, điều phối Gemini COMMENTER qua comment-guard.mjs, và chấm bảng cổng G1–G10.
---

# Agent Orchestrate (Điều phối đa-agent — Unity 6 & Plastic SCM)

- **Author:** Antigravity (`Gemini 4 Argon`) — viết ngày 2026-11-22 theo quyết định owner `OL-2026-11-22-A01`..`OL-2026-11-22-A12`.
- **SOURCE:** `project-local` · **QUALIFICATION_STATUS:** `PILOT` (kiểm định 4 bước `SG-04` tại `docs/reviews/2026-11-22-agent-skills-sg04-audit.md`).
- **Luật canonical ràng buộc:** `AGENTS.md`, `.agents/rules/control-plane-governance.md` (`CPG-01..04`), `.agents/rules/team-workflow.md` (`TW-01..13`), `.agents/rules/codex-execution-contract.md` (`CE-00..10`), `.agents/rules/review-scorecard.md` (`RS-01..05`). Luật thắng skill.
- **Skill con phối hợp:** `agent-plan`, `agent-research`, `agent-plan-executor`, `agent-handoff`, `agent-review-scorecard`, `agent-scorecard-repair`, `vietnamese-code-comments`.

## 0. Khởi động phiên Orchestrator (Không làm từ trí nhớ)

1. Đọc `AGENTS.md` → `docs/STATUS.md` (`## Đang làm`) → handoff của task trong `docs/handoff/` → plan `ACTIVE` trong `docs/plans/` → grep `docs/owner-log/` (tháng này và tháng trước) theo tên file handoff/plan (`TW-04`).
2. Ghi nguyên văn mọi lời owner vào `docs/owner-log/YYYY-MM.md` **ngay trong cùng lượt, trước khi làm tiếp** (`owner-dialogue-log.md` OL-02). Chữ định danh: `C` Claude, `X` Codex, `A` Antigravity/Gemini.
3. Chạy `cm status --short` để lấy baseline Plastic SCM (`PL-05`) và cập nhật mục `## Ảnh chụp trạng thái` của `docs/STATUS.md` khi nhận hoặc mở lại khóa (`TW-02`).

## 1. Lập Plan và Rà soát Độc lập (Gates 0–7)

1. Lập Plan trong `docs/plans/<YYYY-MM-DD-slug>.md` và đăng ký vào `docs/plans/README.md` theo đúng thủ tục của skill `.agents/skills/agent-plan/SKILL.md` (đủ **Gates 0–7**, đọc trọn file theo **Read depth `C80`** và **Evidence basis `C51`**).
2. Chạy bước rà soát độc lập Gate 7 qua skill `.agents/skills/agent-research/SKILL.md` (dùng model mạnh hơn hoặc cùng model với effort cao hơn theo bảng `CPG-02`). Tự kiểm chứng từng phát hiện `BLOCKER`/`RISK` bằng `file:line` hoặc lệnh thật trước khi trình owner.
3. **Gate 1 (Biên Milestone):** Sau mỗi **1–2 milestone lớn** (hoặc khi context lớn), cập nhật đầy đủ `docs/STATUS.md` và `docs/handoff/<file>`, rồi nhắc owner `/compact` trước khi đi tiếp (`OL-2026-11-22-A04`).

## 2. Trình Delegation Brief và Điều phối Subagent trên `agents/branches/`

1. **Trình Delegation brief trên khung chat để owner duyệt (`OL-2026-11-22-A03`):**
   - **Executor & Vai:** Codex (`EXECUTOR` — chỉ code/test, **0 comment**) hoặc Gemini (`EXECUTOR` — code + tự comment `VCS-01..10`, hoặc `COMMENTER` / `RESEARCHER`).
   - **Model & Effort:** Chọn đúng từ bảng `CPG-02` (cấm `Gemini 3.8 Flash`, cấm model Claude trong hệ Gemini, cấm Claude `Max` effort).
   - **Độ khó & Rủi ro công việc:** Nêu rõ vì sao xếp độ khó đó và vì sao chọn model/effort này.
   - **Đường dẫn nhánh ảo & Phạm vi file:** Nêu rõ nhánh `agents/branches/<type>/lane<X>-<task-slug>/<agent>-<model>-<effort>/` và danh sách Allowed Files (nhớ kèm `Assets/<ThưMụcMới>.meta` theo `TW-02`).
2. **Khởi tạo nhánh ảo bằng script chuẩn (`TW-11`):**
   ```powershell
   node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs init `
     agents/branches/<type>/lane<X>-<task-slug>/<agent>-<model>-<effort> `
     [danh-sách-file-hiện-có-cần-clone...]
   ```

   - Chỉ `ORCHESTRATOR` giữ dòng khóa `IN_PROGRESS` trong `docs/STATUS.md`. Subagent chỉ ghi trong thư mục nhánh ảo của mình và ghi báo cáo bàn giao vào `<branch>/BRANCH_HANDOFF.md`.
3. **Gọi Subagent thực thi (`OL-2026-11-22-A11`):**

| Họ Subagent                                                  | Lệnh khởi chạy lượt đầu                                                                                                                         | Lệnh nối tiếp (Resume sau Plan fix / hết usage / mất mạng)                                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Codex (`gpt-6.2-sol` high / `gpt-6.2-astra` medium–high)** | `node .agents/skills/agent-orchestrate/scripts/new_codex_thread.mjs <threadName> gpt-6.2-sol high <promptFile> <outFile> --branch <branchPath>` | `node .agents/skills/agent-orchestrate/scripts/resume_codex_thread.mjs <threadId> gpt-6.2-sol high <promptFile> <outFile> --branch <branchPath>` |
| **Gemini (`Gemini 4 Neon (High)` / `Hydrogen` / `Argon`)**   | `agy --model "Gemini 4 Neon (High)" --mode accept-edits --settings <settings.json> --output-format json --print-timeout 900s -p "<prompt>"`     | Gọi lại lệnh `agy` với `BRANCH_HANDOFF.md` + `dirtyFiles` từ `manage_virtual_branch.mjs recover`                                                 |

4. **Cơ chế Phục hồi khi hết Usage / Mất mạng (Kể cả 2 Codex cùng model chung 1 lane — `OL-2026-11-22-A18`, `A19`):**
   - Khi điều phối $\ge 2$ subagent dùng **cùng model/effort** trong cùng `lane<X>-<task-slug>/`, gắn hậu tố `-w1`, `-w2`... (vd `codex-gpt-6.2-sol-high-w1` và `codex-gpt-6.2-sol-high-w2`).
   - Truyền `--branch <branchPath>` để script tự ghi Write-Ahead State vào `BRANCH_MANIFEST.json` và `agents/branches/ORCHESTRATOR_STATE.json`. Exit code `3` = `PAUSED_QUOTA` (hết usage), `4` = `PAUSED_NETWORK` (mất mạng) — cả 2 đều giữ nguyên `threadId` trên đĩa.
   - Khi Orchestrator mới quay lại hoặc sau khi refill usage, chạy:
     ```powershell
     node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs recover --all
     ```
     để tự động bỏ qua mọi nhánh đã `INTEGRATED`/`COMPLETED` và lấy đúng lệnh `resume_codex_thread.mjs <threadId>` cho từng nhánh `-w1`/`-w2` đang `PAUSED_QUOTA`/`PAUSED_NETWORK`.
5. **Giám sát Tiến trình Chạy nền mỗi 2 phút (`120 giây`) & Tự động xử lý treo (`TW-14`, `OL-2026-11-22-A28`):**
   - Mọi tiến trình chạy nền dài (Unity batchmode, bộ test, subagent) phải chạy qua `.agents/skills/agent-orchestrate/scripts/watchdog_runner.mjs` (mặc định `--interval-ms 120000` = 2 phút):
     ```powershell
     node .agents/skills/agent-orchestrate/scripts/watchdog_runner.mjs run --label unity-sync --log-file "$env:TEMP\do-an-3-verify\UnityBatch.log" -- "C:\FileManager\UnityEditor\6000.0.74f1\Editor\Unity.exe" -batchmode -nographics -projectPath "D:\UnityProject\Do an 3\Do an 3" -quit -logFile "$env:TEMP\do-an-3-verify\UnityBatch.log"
     ```
   - **Nếu tiến trình treo do đã hoàn thành nhưng tiến trình con (như `VBCSCompiler.dll`) giữ handle:** Watchdog tự động tắt tiến trình con giữ handle, thu thập mã thoát thật và ghi nhận `COMPLETED_HUNG_CLEANED`.
   - **Nếu tiến trình treo thật giữa chừng (sau 2 phút không có log/output mới):** Watchdog tự động dừng cây tiến trình treo, ghi chẩn đoán từ log cuối và khởi động lại (`STALLED_MID_TASK` → restart) để chạy tiếp.

## 3. Xử lý `BLOCKED: plan` (`CE-10`)

1. Khi subagent dừng và ghi `BLOCKED: plan` trong `BRANCH_HANDOFF.md` (hoặc handoff task): Orchestrator tự đọc lại code thật theo `C80` để xác minh điểm chặn (`file:line`, lệnh).
2. Giải thích ngắn gọn, dễ hiểu cho owner và xin duyệt sửa plan (trừ khi lỗi kỹ thuật nằm trong phạm vi standing order đã được owner duyệt trước).
3. Ghi mục `## Plan fix N` kèm `### Plan fix consistency` (Gate 6) vào file plan trong `docs/plans/`, rồi resume đúng thread subagent đó.

## 4. Gom nhánh Disjoint vs Cụm Conflict Cluster và Chạy `COMMENTER` (`TW-10`, `TW-11`)

1. Kiểm tra trạng thái nhánh ảo của một `lane<X>-<task-slug>`:
   ```powershell
   node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs status agents/branches/<type>/lane<X>-<task-slug>
   ```
2. **Nếu là `MODE: DISJOINT` (chỉ có 1 thư mục model dưới `lane<X>-<task-slug>/`):**
   - Ngay khi subagent bàn giao `BRANCH_HANDOFF.md`, Orchestrator kiểm tra phạm vi rồi tích hợp vào cây chính:
     ```powershell
     node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs integrate agents/branches/<type>/lane<X>-<task-slug>/<agent>-<model>-<effort>
     ```
   - Nếu nhánh đó do **Codex** code (0 comment): Orchestrator chạy ngay bước **Gemini `COMMENTER`** (mục 5 bên dưới) trước khi chấm Scorecard.
3. **Nếu là `MODE: CONFLICT_CLUSTER` (có $\ge 2$ thư mục model dưới cùng `lane<X>-<task-slug>/`):**
   - Khi mới có 1 nhánh con xong (`STATE: WAITING_FOR_CONFLICT_CLUSTER`): **khoan review lẻ**, ghi nhận vào handoff Orchestrator và chờ các nhánh con còn lại trong cùng `lane<X>-<task-slug>/` bàn giao đủ.
   - Khi tất cả nhánh con đã bàn giao (`STATE: READY_TO_MERGE_CLUSTER`): Orchestrator đối chiếu code của các nhánh con, merge phương án tốt nhất (hoặc kết hợp cả hai theo hợp đồng) vào cây chính `Assets/**`, chạy bước **Gemini `COMMENTER`** cho phần code lấy từ Codex, rồi **review tổng thể cả cụm trong 1 lượt duy nhất**.

## 5. Điều phối Gemini `COMMENTER` qua `comment-guard.mjs` (`TW-10`)

Áp dụng bắt buộc sau mọi lượt code C# của Codex (tối đa 5 file `.cs` mỗi lượt):

1. Chụp bản sao code gốc trước khi thêm comment:
   ```powershell
   node Tools/AIControlPlane/comment-guard.mjs snapshot <nhãn> <file1.cs> [file2.cs...]
   ```
2. Giao **Gemini (`Gemini 4 Neon (High)` hoặc `Medium`)** giữ vai `COMMENTER` chỉ thêm/sửa comment `//`, `///`, `/* */` và `Tooltip("...")` theo `.agents/rules/vietnamese-comment-standard.md` (`VCS-01..10`).
3. **Sau mỗi file** và ở cuối lượt, chạy kiểm chứng không một dòng code nào bị đổi (`TW-10`):
   ```powershell
   node Tools/AIControlPlane/comment-guard.mjs verify <nhãn>
   ```
   Phải đạt `KẾT QUẢ: code giữ nguyên ở N/N file` (exit code 0). Nếu lệch lần thứ hai trên cùng một file thì dừng và báo `BLOCKED`.

## 6. Chấm Scorecard `G1–G10` và Đóng Task

1. Chạy đầy đủ bảng cổng `G1–G10` theo skill `.agents/skills/agent-review-scorecard/SKILL.md`.
2. Dọn sạch thư mục nhánh ảo đã hoàn tất:
   ```powershell
   node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs clean agents/branches/<type>/lane<X>-<task-slug>
   ```
3. Viết bản dễ đọc cho owner tại `docs/owner_review/YYYY-MM-DD-<slug>.md` và cập nhật `docs/owner_review/README.md` (`TW-09`).
4. **Tuyệt đối không chạy `cm checkin`** (`PL-03`) — bàn giao để owner nghiệm thu và tự check-in Plastic SCM.
