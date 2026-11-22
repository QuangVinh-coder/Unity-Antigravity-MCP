---
name: unity-antigravity-mcp
description: Comprehensive workflow for using the Unity 6 & C# Antigravity MCP server (unity_antigravity_mcp) to diagnose C# .csproj/.asmdef issues, inspect Unity Editor state/Scene/Hierarchy/SerializedObjects/Console/Tests, and execute owner-approved modular atomic batches across UI (uGUI + UI Toolkit), Scene/Prefabs, Animation, ParticleSystems, ScriptableObjects, and PackageManager with Undo rollback and Operation Journal recovery.
---

# Unity 6 & C# Antigravity MCP Skill

Use this skill whenever the user asks to inspect, debug, sync `.csproj`/`.sln`, run tests, or interactively design/modify components inside a Unity project (uGUI, UI Toolkit, Scene GameObjects, Prefabs, Animation/Animator, ParticleSystems, ScriptableObjects, Materials, or PackageManager).

## 1. Diagnosing C# Red Squiggles (`CS0229` / Missing `.csproj`)

1. Call `unity_inspect_csharp_project` (works even when Unity Editor is closed) to compare all `.asmdef` files against root `*.csproj` and `*.sln`.
2. If any `.asmdef` is missing its `.csproj` (or `.csproj` is stale):
   - Ask the owner for approval to sync project files (or if already approved in the current task, call `unity_batch_package_and_project` with `{ action: "sync_project_files" }`).
   - When `com.vinh.antigravity-unity-bridge` is installed in Unity, `AntigravityExternalCodeEditor` calls `GeneratorFactory.GetInstance(GeneratorStyle.Legacy).Sync()` to generate standard `.sln` and `.csproj` files compatible with `.NET Language Server`.

## 2. Inspecting Unity Editor Before Proposing Changes (Tier 1 — Read-Only)

Always gather ground-truth evidence first:
1. `unity_get_editor_status` — verify if Unity Editor is running, whether `writeEnabled` is `true` in `Tools > Antigravity MCP Bridge`, whether `isPlaying` is `false`, and what Scene is active.
2. `unity_get_console_logs` — check for existing compiler errors (`error CS...`) or runtime exceptions.
3. `unity_get_hierarchy` & `unity_inspect_object_deep` — read existing GameObjects, `RectTransform` anchors/pivots, and `SerializedProperty` paths before designing changes.
4. `unity_get_operation_journal` — when resuming after a quota pause or Wi-Fi drop, check which `operationId` batches were already `APPLIED`, `ROLLED_BACK`, or `UNDONE_BY_USER`.

## 3. Executing Interactive Modular Batches Safely (Tier 2 — Requires Owner Approval)

Choose the matching domain batch tool so the entire change runs as **one atomic transaction** in Unity (`Undo.IncrementCurrentGroup` → execute all steps → `Undo.RevertAllDownToGroup` on any failure → `Undo.CollapseUndoOperations` on success):

| Domain | MCP Tool | Typical Operations |
| :--- | :--- | :--- |
| **Scene, GameObject, 2D/3D, Physics, Tilemap, Audio, Prefab** | `unity_batch_scene_and_prefab` | `create_gameobject`, `duplicate_gameobject`, `delete_gameobject`, `reparent_gameobject`, `set_transform`, `set_active_tag_layer`, `add_component`, `remove_component`, `instantiate_prefab`, `save_as_prefab`, `unpack_prefab` |
| **UI (uGUI + TextMeshPro & UI Toolkit)** | `unity_batch_ui` | `create_canvas`, `create_ugui_node` (`Panel`, `Image`, `TMP_Text`, `Button`, `ScrollView`, etc.), `set_rect_transform` (16 anchor presets + offsets), `configure_layout` (`Horizontal/Vertical/GridLayoutGroup`, `ContentSizeFitter`), `set_ugui_style`, `create_ui_document`, `write_uxml_asset`, `write_uss_asset` |
| **Animation & AnimatorController** | `unity_batch_animation` | `create_animator_controller`, `add_parameter`, `add_layer`, `add_state`, `set_default_state`, `add_transition`, `create_blend_tree`, `create_or_update_animation_clip` |
| **ParticleSystem, VFX, Trail & Line** | `unity_batch_vfx_and_particle` | `create_particle_system`, `configure_particle_main`, `configure_particle_emission`, `configure_particle_shape`, `configure_particle_lifetime_modules`, `configure_particle_renderer`, `configure_trail_or_line_renderer` |
| **ScriptableObject, Material & Assets** | `unity_batch_assets_and_so` | `create_scriptable_object`, `edit_scriptable_object_fields`, `create_material`, `create_physics_material_2d`, `create_folder`, `move_or_rename_asset` (preserves `.meta` GUID) |
| **PackageManager, `.csproj` Sync & Menus** | `unity_batch_package_and_project` | `package_add`, `package_remove`, `package_resolve`, `sync_project_files`, `refresh_assets`, `execute_menu_item` |
| **Universal `SerializedObject` Engine (Any Unity / Third-Party Component)** | `unity_universal_serialized_batch` | Set any `propertyPath` (`int`, `float`, `bool`, `string`, `Color`, `Vector2/3/4`, `Rect`, `Enum`, `ObjectReference`, `AnimationCurve`, `Gradient`, arrays) on any Component or Asset |

### Handling `403 WRITE_LOCKED_IN_UNITY`
If Unity returns `403 WRITE_LOCKED_IN_UNITY`, remind the owner to open **`Tools > Antigravity MCP Bridge`** in Unity Editor and toggle **`Allow AI Write Actions = ON`** (it defaults to `OFF` and auto-relocks after 15 minutes of inactivity for safety).
