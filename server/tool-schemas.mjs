// Định nghĩa JSON Schema cho 18 MCP tools của Unity 6 & C# Antigravity MCP (9 Tầng 1 Chỉ đọc + 9 Tầng 2 Modular Batch).

const APPROVAL_PROPERTIES = {
  projectPath: {
    type: "string",
    description: "Optional absolute path to the Unity project root. Defaults to the current working directory.",
  },
  ownerApproved: {
    type: "boolean",
    description: "MANDATORY Tier-2 safety gate: must be true ONLY after the owner explicitly approved this batch in chat.",
  },
  approvalSummary: {
    type: "string",
    description: "MANDATORY summary (>= 5 chars) quoting or describing what the owner approved in chat.",
  },
  operationId: {
    type: "string",
    description: "MANDATORY deterministic idempotency ID (3-128 chars, [A-Za-z0-9._:-]) to prevent duplicate execution on Wi-Fi drop or retry.",
  },
};

const APPROVAL_REQUIRED = ["ownerApproved", "approvalSummary", "operationId"];

export const TIER1_TOOLS = [
  {
    name: "unity_get_editor_status",
    description:
      "Tier 1 (Read-Only): Get Unity Editor connection status, active Scene, compile/PlayMode state, Write Switch state (writeEnabled), and Auto-Relock remaining seconds.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "Optional Unity project root path." },
      },
    },
  },
  {
    name: "unity_get_console_logs",
    description:
      "Tier 1 (Read-Only): Read recent Unity Editor Console logs (Error, Warning, Log, Exception) with optional severity and text filtering.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        severity: {
          type: "string",
          enum: ["all", "error", "warning", "log"],
          description: "Filter by log severity (default: all).",
        },
        limit: { type: "integer", description: "Max log entries to return (default: 50, max: 500)." },
        contains: { type: "string", description: "Optional substring filter." },
      },
    },
  },
  {
    name: "unity_get_hierarchy",
    description:
      "Tier 1 (Read-Only): Inspect the GameObject hierarchy of the currently open Unity Scene (names, hierarchy paths, active state, tag, layer, instanceId, component names).",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        rootPath: { type: "string", description: "Optional hierarchy path to start from (e.g. 'Canvas/MainPanel')." },
        maxDepth: { type: "integer", description: "Max hierarchy traversal depth (default: 4)." },
        includeInactive: { type: "boolean", description: "Include inactive GameObjects (default: true)." },
      },
    },
  },
  {
    name: "unity_inspect_object_deep",
    description:
      "Tier 1 (Read-Only): Deeply inspect any GameObject, Component (Transform, RectTransform, ParticleSystem, Animator, etc.), or Asset/ScriptableObject via UnityEditor.SerializedObject.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        hierarchyPath: { type: "string", description: "Scene hierarchy path of the target GameObject (e.g. 'Canvas/ShopPanel')." },
        instanceId: { type: "integer", description: "Optional Unity instanceId of the target object." },
        assetPath: { type: "string", description: "Optional project-relative asset path (e.g. 'Assets/Data/Item.asset')." },
        componentType: { type: "string", description: "Optional specific component type name to inspect all SerializedProperties." },
        maxProperties: { type: "integer", description: "Max serialized properties to return per component (default: 120)." },
      },
    },
  },
  {
    name: "unity_find_assets_and_types",
    description:
      "Tier 1 (Read-Only): Search project assets (Prefabs, Scenes, ScriptableObjects, Materials, Sprites, .asmdef) with GUID lookup, or query available Component/ScriptableObject types via TypeCache.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        query: { type: "string", description: "Search query or filename substring." },
        assetType: {
          type: "string",
          description: "Optional asset filter or extension (e.g. 't:Prefab', '.prefab', '.cs', '.asmdef', '.asset').",
        },
        listComponentTypes: {
          type: "boolean",
          description: "If true and Unity Editor is connected, query matching Component/ScriptableObject types from TypeCache.",
        },
        limit: { type: "integer", description: "Max items to return (default: 50)." },
      },
    },
  },
  {
    name: "unity_list_packages",
    description:
      "Tier 1 (Read-Only): List installed Unity Package Manager (UPM) packages from PackageManager.Client (when Editor is open) and Packages/manifest.json (offline).",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
      },
    },
  },
  {
    name: "unity_inspect_csharp_project",
    description:
      "Tier 1 (Read-Only / Offline): Compare all Unity .asmdef assemblies against generated .csproj and .sln files at project root to diagnose CS0229 red squiggles or missing project files in Antigravity IDE.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
      },
    },
  },
  {
    name: "unity_get_operation_journal",
    description:
      "Tier 1 (Read-Only): Read the persistent Operation Journal (%LOCALAPPDATA%/antigravity-unity-mcp/journal/) to see APPLIED, ROLLED_BACK, or UNDONE_BY_USER (Ctrl+Z) batches after a Wi-Fi drop or quota pause.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        operationId: { type: "string", description: "Optional specific operationId to look up." },
        limit: { type: "integer", description: "Max recent journal entries to return (default: 30)." },
      },
    },
  },
  {
    name: "unity_run_tests",
    description:
      "Tier 1 (Read-Only / Verification): Run Unity EditMode or PlayMode tests via the live Editor TestRunnerApi (if open) or return status/guidance.",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string" },
        testMode: { type: "string", enum: ["EditMode", "PlayMode"], description: "Test platform (default: EditMode)." },
        testFilter: { type: "string", description: "Optional class, namespace, or test method filter." },
        assemblyNames: {
          type: "array",
          items: { type: "string" },
          description: "Optional assembly names filter (e.g. ['TestNew.EditModeTests']).",
        },
      },
    },
  },
];

export const TIER2_TOOLS = [
  {
    name: "unity_batch_scene_and_prefab",
    description:
      "Tier 2 (Requires Owner Approval + Atomic Undo Batch): Create/duplicate/delete/reparent GameObjects, set Transform/Tag/Layer, add/remove any 2D/3D/Physics/Tilemap/Audio/Custom Component, and instantiate/save/unpack Prefabs in a single Undo group with auto-rollback on error.",
    inputSchema: {
      type: "object",
      properties: {
        ...APPROVAL_PROPERTIES,
        operations: {
          type: "array",
          description:
            "Ordered list of scene/prefab operations (actions: create_gameobject, duplicate_gameobject, delete_gameobject, reparent_gameobject, set_transform, set_active_tag_layer, add_component, remove_component, instantiate_prefab, save_as_prefab, unpack_prefab).",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  "create_gameobject",
                  "duplicate_gameobject",
                  "delete_gameobject",
                  "reparent_gameobject",
                  "set_transform",
                  "set_active_tag_layer",
                  "add_component",
                  "remove_component",
                  "instantiate_prefab",
                  "save_as_prefab",
                  "unpack_prefab",
                ],
              },
              name: { type: "string" },
              targetPath: { type: "string" },
              parentPath: { type: "string" },
              prefabAssetPath: { type: "string" },
              componentType: { type: "string" },
              position: { type: "array", items: { type: "number" } },
              localPosition: { type: "array", items: { type: "number" } },
              localEulerAngles: { type: "array", items: { type: "number" } },
              localScale: { type: "array", items: { type: "number" } },
              active: { type: "boolean" },
              tag: { type: "string" },
              layer: { type: "string" },
              allowOverwrite: { type: "boolean" },
              properties: { type: "object", description: "Optional map of SerializedProperty path -> value to initialize." },
            },
            required: ["action"],
          },
        },
      },
      required: [...APPROVAL_REQUIRED, "operations"],
    },
  },
  {
    name: "unity_batch_ui",
    description:
      "Tier 2 (Requires Owner Approval + Atomic Undo Batch): Build and style both uGUI + TextMeshPro hierarchies (Canvas, Panel, Image, TMP_Text, Button, ScrollView, LayoutGroups, 16 RectTransform anchor presets) AND UI Toolkit assets (UIDocument, PanelSettings, .uxml, .uss) in a single atomic Undo transaction.",
    inputSchema: {
      type: "object",
      properties: {
        ...APPROVAL_PROPERTIES,
        operations: {
          type: "array",
          description:
            "Ordered UI operations (actions: create_canvas, create_ugui_node, set_rect_transform, configure_layout, set_ugui_style, create_ui_document, write_uxml_asset, write_uss_asset, bind_uxml_to_uidocument).",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  "create_canvas",
                  "create_ugui_node",
                  "set_rect_transform",
                  "configure_layout",
                  "set_ugui_style",
                  "create_ui_document",
                  "write_uxml_asset",
                  "write_uss_asset",
                  "bind_uxml_to_uidocument",
                ],
              },
              uiType: {
                type: "string",
                description:
                  "For create_ugui_node: Panel, Image, RawImage, TMP_Text, Button, Toggle, Slider, ScrollView, TMP_InputField, EmptyRect.",
              },
              name: { type: "string" },
              targetPath: { type: "string" },
              parentPath: { type: "string" },
              anchorPreset: {
                type: "string",
                description:
                  "Preset: stretch-all, top-stretch, middle-stretch, bottom-stretch, left-stretch, center-stretch, right-stretch, top-left, top-center, top-right, middle-left, middle-center, middle-right, bottom-left, bottom-center, bottom-right.",
              },
              anchorMin: { type: "array", items: { type: "number" } },
              anchorMax: { type: "array", items: { type: "number" } },
              pivot: { type: "array", items: { type: "number" } },
              anchoredPosition: { type: "array", items: { type: "number" } },
              sizeDelta: { type: "array", items: { type: "number" } },
              offsetMin: { type: "array", items: { type: "number" } },
              offsetMax: { type: "array", items: { type: "number" } },
              text: { type: "string" },
              fontSize: { type: "number" },
              color: { type: "string", description: "Hex color (#RRGGBB or #RRGGBBAA)." },
              spriteAssetPath: { type: "string" },
              layoutType: {
                type: "string",
                description: "For configure_layout: HorizontalLayoutGroup, VerticalLayoutGroup, GridLayoutGroup, ContentSizeFitter, LayoutElement.",
              },
              layoutSettings: { type: "object" },
              assetPath: { type: "string", description: "For .uxml / .uss asset creation or binding." },
              content: { type: "string", description: "Full XML/CSS content for write_uxml_asset or write_uss_asset." },
            },
            required: ["action"],
          },
        },
      },
      required: [...APPROVAL_REQUIRED, "operations"],
    },
  },
  {
    name: "unity_batch_animation",
    description:
      "Tier 2 (Requires Owner Approval + Atomic Undo Batch): Create/modify AnimatorControllers, Parameters, Layers, AnimatorStates, Transitions, BlendTrees, and AnimationClip curves/keyframes in one atomic transaction.",
    inputSchema: {
      type: "object",
      properties: {
        ...APPROVAL_PROPERTIES,
        operations: {
          type: "array",
          description:
            "Ordered animation operations (actions: create_animator_controller, add_parameter, add_layer, add_state, set_default_state, add_transition, create_blend_tree, create_or_update_animation_clip, assign_controller_to_animator).",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  "create_animator_controller",
                  "add_parameter",
                  "add_layer",
                  "add_state",
                  "set_default_state",
                  "add_transition",
                  "create_blend_tree",
                  "create_or_update_animation_clip",
                  "assign_controller_to_animator",
                ],
              },
              controllerPath: { type: "string" },
              clipPath: { type: "string" },
              targetPath: { type: "string" },
              layerIndex: { type: "integer" },
              layerName: { type: "string" },
              parameterName: { type: "string" },
              parameterType: { type: "string", enum: ["Float", "Int", "Bool", "Trigger"] },
              defaultValue: {},
              stateName: { type: "string" },
              sourceStateName: { type: "string" },
              destinationStateName: { type: "string" },
              hasExitTime: { type: "boolean" },
              exitTime: { type: "number" },
              duration: { type: "number" },
              conditions: { type: "array", items: { type: "object" } },
              frameRate: { type: "number" },
              loopTime: { type: "boolean" },
              curves: { type: "array", items: { type: "object" } },
            },
            required: ["action"],
          },
        },
      },
      required: [...APPROVAL_REQUIRED, "operations"],
    },
  },
  {
    name: "unity_batch_vfx_and_particle",
    description:
      "Tier 2 (Requires Owner Approval + Atomic Undo Batch): Create and configure ParticleSystems (Main, Emission + Bursts, Shape, ColorOverLifetime, SizeOverLifetime, Velocity, Noise, Trails, Renderer), TrailRenderers, and LineRenderers atomically.",
    inputSchema: {
      type: "object",
      properties: {
        ...APPROVAL_PROPERTIES,
        operations: {
          type: "array",
          description:
            "Ordered VFX/Particle operations (actions: create_particle_system, configure_particle_main, configure_particle_emission, configure_particle_shape, configure_particle_lifetime_modules, configure_particle_renderer, configure_trail_or_line_renderer).",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  "create_particle_system",
                  "configure_particle_main",
                  "configure_particle_emission",
                  "configure_particle_shape",
                  "configure_particle_lifetime_modules",
                  "configure_particle_renderer",
                  "configure_trail_or_line_renderer",
                ],
              },
              name: { type: "string" },
              targetPath: { type: "string" },
              parentPath: { type: "string" },
              settings: {
                type: "object",
                description:
                  "Key-value map of module properties (e.g. duration, loop, startLifetime, startSpeed, startSize, startColor, maxParticles, rateOverTime, bursts, shapeType, radius, angle, sortingLayerName, sortingOrder, materialPath).",
              },
            },
            required: ["action"],
          },
        },
      },
      required: [...APPROVAL_REQUIRED, "operations"],
    },
  },
  {
    name: "unity_batch_assets_and_so",
    description:
      "Tier 2 (Requires Owner Approval + Atomic Undo Batch): Create/edit ScriptableObject (.asset) files, Materials (.mat), PhysicsMaterial2D, create folders, and move/rename assets via AssetDatabase (preserving 100% of .meta GUIDs).",
    inputSchema: {
      type: "object",
      properties: {
        ...APPROVAL_PROPERTIES,
        operations: {
          type: "array",
          description:
            "Ordered asset operations (actions: create_scriptable_object, edit_scriptable_object_fields, create_material, create_physics_material_2d, create_folder, move_or_rename_asset).",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  "create_scriptable_object",
                  "edit_scriptable_object_fields",
                  "create_material",
                  "create_physics_material_2d",
                  "create_folder",
                  "move_or_rename_asset",
                ],
              },
              typeName: { type: "string", description: "ScriptableObject C# class name." },
              assetPath: { type: "string" },
              destinationPath: { type: "string" },
              shaderName: { type: "string" },
              fields: { type: "object", description: "Map of SerializedProperty path or material property -> value." },
              allowOverwrite: { type: "boolean" },
            },
            required: ["action"],
          },
        },
      },
      required: [...APPROVAL_REQUIRED, "operations"],
    },
  },
  {
    name: "unity_batch_package_and_project",
    description:
      "Tier 2 (Requires Owner Approval): Interact with Unity PackageManager (add, remove, resolve packages), trigger AntigravityExternalCodeEditor to regenerate .csproj/.sln files, refresh AssetDatabase, or execute safe Unity Editor menu items.",
    inputSchema: {
      type: "object",
      properties: {
        ...APPROVAL_PROPERTIES,
        operations: {
          type: "array",
          description:
            "Ordered package/project operations (actions: sync_project_files, refresh_assets, package_add, package_remove, package_resolve, execute_menu_item).",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  "sync_project_files",
                  "refresh_assets",
                  "package_add",
                  "package_remove",
                  "package_resolve",
                  "execute_menu_item",
                ],
              },
              packageIdentifier: {
                type: "string",
                description: "For package_add / package_remove (e.g. 'com.unity.cinemachine@3.1.6' or 'file:C:/path/to/pkg').",
              },
              menuItemPath: {
                type: "string",
                description: "For execute_menu_item (e.g. 'Assets/Reimport'). Destructive menus like File/Quit are blocked.",
              },
            },
            required: ["action"],
          },
        },
      },
      required: [...APPROVAL_REQUIRED, "operations"],
    },
  },
  {
    name: "unity_universal_serialized_batch",
    description:
      "Tier 2 (Requires Owner Approval + Atomic Undo Batch): Universal SerializedObject engine capable of modifying ANY SerializedProperty path (including arrays, nested structs, ObjectReferences, AnimationCurves, Gradients, LayerMasks) on ANY Unity or third-party Component (Cinemachine, URP 2D, Photon Fusion, Tilemap) or Asset.",
    inputSchema: {
      type: "object",
      properties: {
        ...APPROVAL_PROPERTIES,
        operations: {
          type: "array",
          description: "List of universal SerializedProperty mutations.",
          items: {
            type: "object",
            properties: {
              targetPath: { type: "string", description: "Scene hierarchy path of GameObject (if modifying a Component)." },
              componentType: { type: "string", description: "Component type name on the target GameObject." },
              assetPath: { type: "string", description: "Project-relative asset path (if modifying an Asset/ScriptableObject)." },
              properties: {
                type: "object",
                description: "Map of exact Unity SerializedProperty path (e.g. 'm_LocalScale.x' or 'InitialModule.startLifetime.scalar') to value.",
              },
            },
            required: ["properties"],
          },
        },
      },
      required: [...APPROVAL_REQUIRED, "operations"],
    },
  },
  {
    name: "unity_rollback_batch",
    description:
      "Tier 2 (Requires Owner Approval): Roll back a previously applied batch by targetOperationId (destroying created objects / reverting Undo group and marking ROLLED_BACK in the Operation Journal).",
    inputSchema: {
      type: "object",
      properties: {
        ...APPROVAL_PROPERTIES,
        targetOperationId: {
          type: "string",
          description: "The operationId of the previously applied batch to roll back.",
        },
      },
      required: [...APPROVAL_REQUIRED, "targetOperationId"],
    },
  },
  {
    name: "unity_save_open_scene",
    description:
      "Tier 2 (Requires Owner Approval): Explicitly save the currently open Unity Scene(s) to disk. Never called implicitly by other batches.",
    inputSchema: {
      type: "object",
      properties: {
        ...APPROVAL_PROPERTIES,
        scenePath: { type: "string", description: "Optional specific scene path to save (defaults to active scene)." },
      },
      required: [...APPROVAL_REQUIRED],
    },
  },
];

export const ALL_TOOLS = [...TIER1_TOOLS, ...TIER2_TOOLS];
export const TIER2_TOOL_NAMES = new Set(TIER2_TOOLS.map((t) => t.name));
