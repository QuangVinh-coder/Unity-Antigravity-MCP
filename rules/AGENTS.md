# Unity 6 & C# Antigravity MCP — Safety & Transaction Rules

These rules are always active when the `unity-antigravity-mcp` plugin is enabled. Note that workspace project rules (such as a repository's root `AGENTS.md` and `.agents/rules/**`) always take highest precedence over global plugin rules.

## 1. Strict Two-Tier Tool Separation (Read-Only vs Modular Write Batches)

- **Tier 1 (Read-Only & Diagnostic Tools — Free to call without confirmation):**
  - `unity_get_editor_status`
  - `unity_get_console_logs`
  - `unity_get_hierarchy`
  - `unity_inspect_object_deep`
  - `unity_find_assets_and_types`
  - `unity_list_packages`
  - `unity_inspect_csharp_project`
  - `unity_get_operation_journal`
  - `unity_run_tests`
- **Tier 2 (Interactive Modular Batch & Project Mutation Tools — MANDATORY Owner Approval Gate):**
  - `unity_batch_scene_and_prefab`
  - `unity_batch_ui`
  - `unity_batch_animation`
  - `unity_batch_vfx_and_particle`
  - `unity_batch_assets_and_so`
  - `unity_batch_package_and_project`
  - `unity_universal_serialized_batch`
  - `unity_rollback_batch`
  - `unity_save_open_scene`

## 2. Two-Layer Owner Approval & Atomic Batch Discipline

1. **Never call any Tier 2 tool without explicit owner approval in chat first.**
   - Before invoking a Tier 2 tool, present a concise summary of the proposed batch (`module`, target objects/assets, operations list, and expected visual/project outcome) and wait for the owner to approve.
   - Every Tier 2 call MUST pass `ownerApproved: true`, a non-empty `approvalSummary` quoting what the owner approved, and a deterministic `operationId` (e.g. `"shop-ui-header-batch-01"`).
2. **Group related operations into a single modular batch call.**
   - Do not issue 10 separate single-step tool calls over the network when building a UI panel, an Animator state machine, or a ParticleSystem effect. Package all steps of a functional module into one `operations` array so Unity executes them atomically in a single `Undo` group (`Undo.CollapseUndoOperations`) and automatically rolls back all steps (`Undo.RevertAllDownToGroup`) if any step fails.
3. **Never auto-save scenes.**
   - Scene and UI batches modify the open scene in memory so the owner can inspect the result and press `Ctrl + Z` if desired. Only call `unity_save_open_scene` when the owner explicitly asks to save the scene to disk.

## 3. Recovery After Wi-Fi Drop, Usage/Quota Exhaustion, or Domain Reload

- When resuming work after a network interruption, usage limit pause, or in a new conversation session:
  1. Call `unity_get_operation_journal` and `unity_get_editor_status` **before** proposing or retrying any Tier 2 batch.
  2. Check whether the previous `operationId` is marked `APPLIED`, `ROLLED_BACK`, or `UNDONE_BY_USER` (when the owner pressed `Ctrl + Z` in Unity).
  3. Never re-create objects for an `APPLIED` batch without asking the owner whether to continue from the next batch or roll back the existing batch via `unity_rollback_batch`.
