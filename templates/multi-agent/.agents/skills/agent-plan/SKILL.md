---
name: agent-plan
description: Dùng khi ORCHESTRATOR hoặc PLANNER (Claude, Codex, hoặc Gemini Neon/Argon) viết mới hoặc sửa Plan / Plan fix trong docs/plans/ cho dự án Do an 3. Bắt buộc đi qua đủ Gates 0–7, Read depth C80, Evidence basis C51, phản biện 5 giai đoạn Unity, bảng tiêu chí nghiệm thu đo được CE-09 và bảng khuyến nghị Model/Effort CPG-02.
---

# Agent Plan (Lập kế hoạch & Plan Fix theo Gates 0–7)

- **Author:** Antigravity (`Gemini 4 Argon`) — viết ngày 2026-11-22 theo quyết định owner `OL-2026-11-22-A01`..`OL-2026-11-22-A12`.
- **SOURCE:** `project-local` · **QUALIFICATION_STATUS:** `PILOT` (kiểm định 4 bước `SG-04` tại `docs/reviews/2026-11-22-agent-skills-sg04-audit.md`).
- **Luật canonical ràng buộc:** `AGENTS.md` §5, `.agents/rules/team-workflow.md` (`TW-11`, `TW-12`, `TW-13`), `.agents/rules/codex-execution-contract.md` (`CE-03`, `CE-09`, `CE-10`), `.agents/rules/control-plane-governance.md` (`CPG-02`).

Một Plan hoặc `Plan fix` trong `docs/plans/` là **CHƯA ĐỦ ĐIỀU KIỆN BÀN GIAO (UNDELIVERABLE)** nếu thiếu bất kỳ mục nào của **Gates 0–7** dưới đây. Máy kiểm `node Tools/AIControlPlane/validate-control-plane.mjs` sẽ báo `FAIL` tự động nếu Plan `ACTIVE` thiếu một trong các chốt này.

## Các cổng bắt buộc (Gates 0–7)

### Gate 0 — Evidence basis (`C51`), Read depth (`C80`) & Ambiguity
1. **Read depth (`C80`):** Đọc **trọn vẹn 100% file nguồn** ngay trong lượt hiện tại cho mọi file sẽ sửa và các file liên quan trực tiếp (caller, callee, shared state/contract); chỉ lớp UI presentation thuần mới đọc quanh vùng sửa. Liệt kê vào mục `### Files read in full (C80)`.
2. **Evidence basis (`C51`):** Đối chiếu code, `CODEBASE_MAP.md`, `docs/STATUS.md`, `docs/RISK_REGISTER.md`, `.agents/rules/error-ledger.md`, `docs/owner-log/` và các báo cáo đo đạc/research liên quan. Lập bảng `### Evidence basis`:
   `| Kind (code/arch/system/docs/data) | File read | What it says | Step | Supports/contradicts |`
3. **Owner questions:** Trước khi hỏi owner phải grep `docs/owner-log/`. Khi còn điểm mơ hồ thì hỏi owner và ghi nguyên văn câu trả lời vào `docs/owner-log/YYYY-MM.md` trước khi chốt plan. Ghi mục `### Owner questions` (trích mã `OL-` hoặc giải thích vì sao không còn mơ hồ).

### Gate 1 — Context & Milestone boundary (`OL-2026-11-22-A04`)
Ghi mục `### Gate 1 — Context & Milestone boundary`: nêu rõ trạng thái context hiện tại và quy tắc sau mỗi **1–2 milestone lớn** phải cập nhật `docs/STATUS.md` + `docs/handoff/<file>` rồi nhắc owner `/compact`.

### Gate 2 — Current-code evidence
Đọc trực tiếp trong lượt này mọi class, hàm, `[Networked]`/`[Rpc]`/`[SerializeField]` sẽ chạm. Lập bảng `### Current-code evidence`:
`| file:line | Symbol / caller | Current behaviour (quoted) | UCC/VCS baseline (lines / params / nesting) |`

### Gate 3 — Reachability & UCC fit (`UCC-01..37`, `UR-01..08`, `SC-01..16`)
Ghi mục `### Reachability & UCC fit`: truy vết từ điểm vào hàm (early return, guard, authority check `HasStateAuthority`/`HasInputAuthority`, vòng đời Unity `Awake`/`OnEnable`/`Start`/`FixedUpdateNetwork`), đảm bảo mọi hàm viết mới/sửa đạt giới hạn của `Tools/AIControlPlane/scan-csharp-rules.mjs` (hàm ≤ 30 dòng lệnh, ≤ 4 tham số `UCC-35`, độ lồng ≤ 3 tầng `UCC-36`, không viết tắt ngoài `UI`/`ID` `UCC-02`, không magic number `UCC-08`).

### Gate 4 — Numbers, Clocks, Authority, Serialization & Text
Lập bảng `### Edge cases`:
`| Case | Input / State | Expression / Rule | Expected |`
Kiểm tra: giá trị biên, công thức damage/stat, cooldown phía server, bảo toàn GUID `.meta` và `[FormerlySerializedAs]` khi đổi field serialize, khai báo cả `Assets/<ThưMụcMới>.meta` khi tạo thư mục mới dưới `Assets/` (`TW-02`).

### Gate 5 — Old tests & New tests (cặp Đỏ → Xanh)
Grep toàn bộ test hiện có (`Assets/Tests/**`, `Assets/Test*/**`, `Tools/**/test/**`) cho mọi symbol/hằng/thông báo bị chạm. Ghi mục `### Tests that must change` (nêu rõ test cũ nào bị ảnh hưởng hoặc `0 broken`, và chia test mới thành `RED` trước khi sửa và `GUARD` xanh trước/sau).

### Gate 6 — Plan fix consistency (Bắt buộc khi viết `## Plan fix N`)
Khi thêm mục `## Plan fix N` vào một plan (ví dụ sau khi Executor báo `BLOCKED: plan`), bắt buộc có mục con `### Plan fix consistency` rà soát lại toàn bộ các mục Decisions, Scope, Allowed Files, và bảng Acceptance Criteria trước đó để cập nhật tại chỗ, không để câu cũ mâu thuẫn câu mới.

### Gate 7 — Independent Plan Scan (`agent-research`)
Ghi mục `### Gate 7 — Independent Plan Scan`: chạy skill `.agents/skills/agent-research/SKILL.md` bằng model mạnh hơn / effort cao hơn để rà soát plan, lưu vào `docs/research/<plan-slug>/` và trích dẫn đường dẫn file đó (hoặc ghi rõ dòng ngoại lệ hợp lệ `Bỏ bước rà soát độc lập: <lý do + bằng chứng đã chứng minh>`).

## Template chuẩn cho file `docs/plans/<YYYY-MM-DD-slug>.md`

*(Nếu Planner cần lưu nháp giữa chừng để chống mất tiến độ khi sắp hết usage theo `OL-2026-11-22-A18`, dùng tạm banner `TRẠNG THÁI: DRAFT` sau mỗi cụm Gate rồi đổi sang `ACTIVE` khi đủ Gates 0–7.)*

```markdown
# <Tiêu đề Plan>

> **TRẠNG THÁI: ACTIVE** — <kết luận 1 câu> — cập nhật YYYY-MM-DD

## Context
### Files read in full (C80)
## Decisions
## Scope
## Gate 0 — Evidence basis and ambiguity
### Evidence basis
### Owner questions
### Gate 1 — Context & Milestone boundary
### Current-code evidence
### Reachability & UCC fit
### Edge cases
### Tests that must change
### Gate 7 — Independent Plan Scan
## Steps
## Acceptance criteria
| AC | Behaviour | Metric | Threshold | Command | Evidence |
## 5-stage critique
## Document impact
## Verification
## Recommended model/effort per milestone (Delegation Briefs)
```

Sau khi tạo hoặc cập nhật file plan, luôn thêm/cập nhật dòng tương ứng trong `docs/plans/README.md` và chạy `node Tools/AIControlPlane/validate-control-plane.mjs`.
