# AGENTS.md — Portable Unity Multi-Agent & MCP Project Contract

Template hợp đồng đa-agent chuẩn hóa từ bộ **Unity-Antigravity-MCP** (`templates/multi-agent/`). Bạn có thể chép vào gốc bất kỳ dự án Unity nào (dùng Git hoặc Plastic SCM).

## 1. Phân vai Đa-Agent (`ORCHESTRATOR` · `EXECUTOR` · `COMMENTER` · `RESEARCHER`)

```text
OWNER         quyết định sản phẩm, kiến trúc, phạm vi, duyệt Plan/Delegation brief, và commit/check-in cuối cùng
ORCHESTRATOR  lập Plan (Gates 0–7) · trình Delegation brief · chia nhánh ảo · gom nhánh · chấm Scorecard G1–G10
CODEX         EXECUTOR (chỉ code C# & Unit Test, CẤM viết comment code mới) · REVIEWER
GEMINI        EXECUTOR (code + tự comment chuẩn VCS) · COMMENTER (qua comment-guard.mjs) · RESEARCHER · ORCHESTRATOR
```

## 2. Kỷ luật bằng chứng & Nhánh ảo cô lập (`agents/branches/`)
- **Không đoán:** `FILE EXISTS != PRODUCTION BEHAVIOR EXISTS`, `IT COMPILES != IT IS WIRED`, `I READ IT != I TESTED IT`.
- **Nhánh ảo cô lập:** Khi `ORCHESTRATOR` điều phối nhiều subagent song song, mỗi worker làm việc trong:
  `agents/branches/<type>/lane<X>-<task-slug>/<agent>-<model>-<effort>[-w<N>]/`
  *(nằm ngoài `Assets/` để Unity không biên dịch trùng class `CS0101` và ngoài `.agents/` để tách khỏi rules/skills)*.
  - Nhánh **DISJOINT** (khác `lane`, 1 model): xong trước được Orchestrator review & tích hợp trước.
  - Cụm **CONFLICT_CLUSTER** (nhiều model/worker chung `lane`): đợi bàn giao đủ cả cụm rồi merge & review 1 lượt.
- **Phục hồi hết Usage / Mất mạng:** Mọi lệnh gọi worker truyền `--branch <branchPath>` để lưu Write-Ahead State (`RUNNING`, `PAUSED_QUOTA` exit 3, `PAUSED_NETWORK` exit 4, `threadId`) vào `BRANCH_MANIFEST.json`; khôi phục toàn bộ bằng `node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs recover --all`.
- **Giám sát tiến trình nền mỗi 2 phút (`120s`):** Mọi tiến trình chạy dài (Unity batchmode, test runner, subagent) chạy qua `node .agents/skills/agent-orchestrate/scripts/watchdog_runner.mjs` để tự dọn cây tiến trình treo sau khi hoàn tất (`COMPLETED_HUNG_CLEANED`, như `VBCSCompiler.dll`) và tự khởi động lại nếu treo đứng giữa chừng (`STALLED_MID_TASK`).

## 3. Phân vai Comment (`comment-guard.mjs`)
- Khi **Codex** làm `EXECUTOR`: chỉ viết code & test (0 comment code mới).
- Sau khi tích hợp vào cây chính, `ORCHESTRATOR` chạy:
  1. `node Tools/AIControlPlane/comment-guard.mjs snapshot <label> <file1.cs> ...`
  2. Giao **Gemini `COMMENTER`** thêm comment tiếng Việt tự nhiên giải thích hợp đồng & ràng buộc thật.
  3. `node Tools/AIControlPlane/comment-guard.mjs verify <label>` → bắt buộc đạt `code giữ nguyên ở N/N file`.

## 4. An toàn tương tác Unity Editor qua MCP (`unity_antigravity_mcp`)
- Tầng 1 (Chỉ đọc — `unity_get_editor_status`, `unity_get_hierarchy`, `unity_inspect_object_deep`, `unity_get_console_logs`, `unity_run_tests`...) tự do gọi để chẩn đoán.
- Tầng 2 (Ghi/Batch — `unity_batch_scene_and_prefab`, `unity_batch_ui`, `unity_batch_animation`, `unity_batch_vfx_and_particle`, `unity_batch_assets_and_so`, `unity_batch_package_and_project`, `unity_universal_serialized_batch`) **BẮT BUỘC** có duyệt của owner trong chat (`ownerApproved: true`, `approvalSummary`, `operationId`) và công tắc `Allow AI Write Actions` bật trong Unity (`Tools > Antigravity MCP > Control Panel`).
- Không bao giờ tự lưu đè Scene (`unity_save_open_scene`) khi chưa được owner yêu cầu.
