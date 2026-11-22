# Tham chiếu đầy đủ 18 công cụ MCP (`unity_antigravity_mcp`)

Tài liệu này liệt kê đủ 18 công cụ MCP định nghĩa trong [`server/tool-schemas.mjs`](../server/tool-schemas.mjs), điều tuyến tại [`server/index.mjs`](../server/index.mjs) và xử lý phía Unity C# trong [`unity-package/Editor/Handlers/`](../unity-package/Editor/Handlers/). Quay lại trang tổng quan tại [README.md](../README.md).

## Quy ước an toàn giữa 2 tầng

9 công cụ Tầng 1 chỉ đọc dữ liệu nên được gọi tự do mà không làm thay đổi Scene, Prefab hay Asset. Trong số này có 4 công cụ hoạt động được khi Unity Editor đang đóng: `unity_inspect_csharp_project`, `unity_get_operation_journal`, `unity_list_packages` và `unity_find_assets_and_types`.

9 công cụ Tầng 2 bị chặn Fail-Closed tại [`server/bridge-client.mjs`](../server/bridge-client.mjs) nếu thiếu bất kỳ tham số bắt buộc nào trong bảng dưới đây. Phía Unity Editor cũng từ chối thực thi nếu công tắc `Allow AI Write Actions` đang tắt (`403 WRITE_LOCKED_IN_UNITY`) hoặc Editor đang chạy Play Mode (`409 BLOCKED_IN_PLAY_MODE`).

| Tham số bắt buộc (Tầng 2) | Kiểu | Quy tắc xác thực |
|---|---|---|
| `ownerApproved` | `boolean` | Bắt buộc là `true`, chỉ đặt sau khi chủ dự án duyệt kế hoạch batch trong khung chat. |
| `approvalSummary` | `string` | Tối thiểu 5 ký tự, ghi rõ nội dung chủ dự án đã duyệt. |
| `operationId` | `string` | Dài từ 3 đến 128 ký tự khớp `[A-Za-z0-9._:-]`, làm khóa idempotency chống tạo trùng khi rớt mạng hoặc retry. |
| `projectPath` *(tùy chọn)* | `string` | Đường dẫn gốc dự án Unity (mặc định lấy `process.cwd()`). |

## Tầng 1: 9 công cụ chỉ đọc và chẩn đoán

| # | Tên công cụ | Hỗ trợ khi Unity đóng | Tham số chính | Chức năng thực tế |
|---|---|---|---|---|
| 1 | `unity_get_editor_status` | Có (trả trạng thái offline và chẩn đoán C#) | `projectPath` | Trả trạng thái kết nối, Unity version, Scene đang mở, `EditorBuildSettings.scenes` (`buildIndex`), trạng thái `writeEnabled` và số giây còn lại trước khi Auto-Relock. Tự dọn tệp discovery có PID chết. |
| 2 | `unity_get_console_logs` | Không | `severity` (`all`/`error`/`warning`/`log`), `limit` (mặc định `50`, tối đa `500`), `contains` | Đọc bộ đệm vòng 500 dòng log của Unity Console, lọc theo mức độ và chuỗi con. |
| 3 | `unity_get_hierarchy` | Không | `rootPath`, `maxDepth` (mặc định `4`), `includeInactive` (mặc định `true`) | Duyệt cây GameObject của Scene đang mở (tên, đường dẫn, active, tag, layer, `instanceId`, danh sách Component). Tự cảnh báo trùng tên root (`PRE-3`), `Missing Script` và `NetworkBehaviour` thiếu `NetworkObject`. |
| 4 | `unity_inspect_object_deep` | Không | `hierarchyPath`, `instanceId` hoặc `assetPath`, `componentType`, `maxProperties` (mặc định `120`) | Soi sâu từng `SerializedProperty` của GameObject, Component, Prefab hoặc ScriptableObject qua `UnityEditor.SerializedObject`. |
| 5 | `unity_find_assets_and_types` | Có (fallback quét `Assets/` và `.meta` GUID) | `query`, `assetType` (`t:Prefab`, `.asset`, `.asmdef`...), `listComponentTypes`, `limit` (mặc định `50`) | Tìm Asset kèm GUID từ `.meta`, hoặc truy vấn các kiểu Component/ScriptableObject qua `TypeCache` khi Unity đang mở. |
| 6 | `unity_list_packages` | Có (đọc `Packages/manifest.json` và `packages-lock.json`) | `projectPath` | Liệt kê các gói UPM đã cài từ `PackageManager.Client` khi Unity mở hoặc từ `manifest.json` khi Unity đóng. |
| 7 | `unity_inspect_csharp_project` | Có (chạy thuần offline) | `projectPath` | Đối chiếu toàn bộ `.asmdef` trong `Assets/` và `Packages/` với các tệp `.csproj`/`.sln` ở gốc dự án để phát hiện nguy cơ lỗi đỏ `CS0229` (`hasCs0229Risk`). |
| 8 | `unity_get_operation_journal` | Có (chạy thuần offline) | `operationId`, `limit` (mặc định `30`) | Đọc sổ `journal/<projectHash>.jsonl` để lấy trạng thái hợp nhất mới nhất của từng `operationId` (`APPLIED`, `ROLLED_BACK`, `UNDONE_BY_USER`). |
| 9 | `unity_run_tests` | Không | `testMode` (`EditMode`/`PlayMode`, mặc định `EditMode`), `testFilter`, `assemblyNames` | Kích hoạt chạy kiểm thử qua `TestRunnerApi` trong Unity Editor đang mở (timeout mặc định `30s`). |

## Tầng 2: 9 công cụ ghi theo batch nguyên tử

Mỗi công cụ batch chạy toàn bộ mảng `operations` trong cùng một nhóm Undo bằng cách gọi `Undo.IncrementCurrentGroup`, thực thi lần lượt từng bước rồi gom bằng `Undo.CollapseUndoOperations`. Nếu bất kỳ bước nào ném ngoại lệ, bridge gọi `Undo.RevertAllDownToGroup` để khôi phục sạch Scene. Thành công sẽ đánh dấu Scene dirty (`MarkSceneDirty`) và không tự lưu Scene.

| # | Tên công cụ | Endpoint Unity Bridge | Các `action` hoặc tham số chính | Chức năng thực tế |
|---|---|---|---|---|
| 10 | `unity_batch_scene_and_prefab` | `/api/batch/scene-prefab` | `create_gameobject`, `duplicate_gameobject`, `delete_gameobject`, `reparent_gameobject`, `set_transform`, `set_active_tag_layer`, `add_component`, `remove_component`, `instantiate_prefab`, `save_as_prefab`, `unpack_prefab` | Dựng và chỉnh sửa cây GameObject, Transform, Tag/Layer, thêm hoặc gỡ Component, thao tác Prefab trong 1 nhóm Undo. |
| 11 | `unity_batch_ui` | `/api/batch/ui` | `create_canvas`, `create_ugui_node` (`Panel`, `Image`, `RawImage`, `TMP_Text`, `Button`, `Toggle`, `Slider`, `ScrollView`, `TMP_InputField`, `EmptyRect`), `set_rect_transform` (16 anchor preset), `configure_layout`, `set_ugui_style`, `create_ui_document`, `write_uxml_asset`, `write_uss_asset`, `bind_uxml_to_uidocument` | Dựng cả uGUI + TextMeshPro lẫn UI Toolkit (`.uxml`, `.uss`, `UIDocument`) trong một giao dịch nguyên tử. |
| 12 | `unity_batch_animation` | `/api/batch/animation` | `create_animator_controller`, `add_parameter` (`Float`/`Int`/`Bool`/`Trigger`), `add_layer`, `add_state`, `set_default_state`, `add_transition`, `create_blend_tree`, `create_or_update_animation_clip`, `assign_controller_to_animator` | Tạo và nối máy trạng thái `AnimatorController`, `BlendTree`, `AnimationClip` rồi gán vào `Animator`. |
| 13 | `unity_batch_vfx_and_particle` | `/api/batch/vfx-particle` | `create_particle_system`, `configure_particle_main`, `configure_particle_emission`, `configure_particle_shape`, `configure_particle_lifetime_modules`, `configure_particle_renderer`, `configure_trail_or_line_renderer` | Tạo và cấu hình `ParticleSystem`, `TrailRenderer`, `LineRenderer` kèm thông số màu, tốc độ, burst và sorting layer. |
| 14 | `unity_batch_assets_and_so` | `/api/batch/assets-so` | `create_scriptable_object`, `edit_scriptable_object_fields`, `create_material`, `create_physics_material_2d`, `create_folder`, `move_or_rename_asset` | Tạo hoặc sửa `ScriptableObject`, `Material`, `PhysicsMaterial2D`, đổi tên hoặc di chuyển Asset qua `AssetDatabase` (giữ nguyên `.meta` GUID). Tự đối chiếu Journal nếu gặp Domain Reload. |
| 15 | `unity_batch_package_and_project` | `/api/batch/package-project` | `sync_project_files`, `refresh_assets`, `package_add`, `package_remove`, `package_resolve`, `execute_menu_item` | Thêm hoặc gỡ gói UPM, tái sinh `.csproj`/`.sln`, refresh `AssetDatabase`, chạy menu Editor an toàn (chặn cứng `File/Quit`, `File/New Project...`, `File/Open Project...`, `File/New Scene`). Tự đối chiếu Journal nếu gặp Domain Reload. |
| 16 | `unity_universal_serialized_batch` | `/api/batch/universal-serialized` | `targetPath` + `componentType` (hoặc `assetPath`) và bản đồ `properties` | Ghi mọi `SerializedProperty` trên Component hoặc Asset của Unity lẫn gói thứ ba (như Cinemachine, URP, Photon Fusion), hỗ trợ `Enum` theo tên, `Vector2/3`, `Color`, mảng và các tiền tố `ObjectReference` ở bảng dưới. |
| 17 | `unity_rollback_batch` | `/api/batch/rollback` | `targetOperationId` | Gọi `Undo.PerformUndo()` để hoàn tác batch mục tiêu và ghi trạng thái `ROLLED_BACK` vào Operation Journal. |
| 18 | `unity_save_open_scene` | `/api/batch/save-scene` | `scenePath` *(tùy chọn)* | Lưu tường minh Scene đang mở xuống đĩa (`EditorSceneManager.SaveScene`). Các tool khác không bao giờ gọi ngầm thao tác này. |

## Cú pháp gán `ObjectReference` trong `unity_universal_serialized_batch`

Các tiền tố dưới đây được cài đặt tại [`unity-package/Editor/Handlers/AntigravityDomainModules.cs`](../unity-package/Editor/Handlers/AntigravityDomainModules.cs):

| Tiền tố | Ví dụ | Ý nghĩa |
|---|---|---|
| `hierarchy:` | `"hierarchy:Canvas/StartBtn#Button"` | Tìm GameObject theo đường dẫn Hierarchy trong Scene đang mở; thêm `#ComponentType` để trỏ thẳng tới Component. |
| `asset:` | `"asset:Assets/Prefabs/Player.prefab"` | Tải Asset từ `AssetDatabase` theo đường dẫn tương đối trong dự án. |
| `sprite:` | `"sprite:Assets/Art/Icons.png#Sword_01"` | Tải sub-asset `Sprite` cụ thể bên trong một Sprite Sheet (chế độ Multiple). |
| `guid:` | `"guid:a1b2c3d4e5f6..."` | Tải Asset qua GUID 32 ký tự hex trong tệp `.meta`. |
| *(số nguyên)* | `12345` | Tham chiếu trực tiếp theo Unity `instanceId`. |

## Ví dụ payload batch hợp lệ (Tầng 2)

```json
{
  "ownerApproved": true,
  "approvalSummary": "Chủ dự án duyệt gán Prefab và nút Start vào PhotonSessionBootstrap",
  "operationId": "wire-bootstrap-level1-01",
  "operations": [
    {
      "targetPath": "PhotonBootstrap",
      "componentType": "PhotonSessionBootstrap",
      "properties": {
        "_runnerPrefab": "asset:Assets/Prefabs/NetworkRunnerPrefab.prefab",
        "_startWaveButton": "hierarchy:Canvas/StartWaveBtn#Button",
        "_defaultMode": "Server"
      }
    }
  ]
}
```
