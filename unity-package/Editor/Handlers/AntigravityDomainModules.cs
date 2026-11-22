using System;
using System.Collections.Generic;
using System.IO;
using AntigravityJson;
using TMPro;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.PackageManager;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.UIElements;
using Button = UnityEngine.UI.Button;
using Image = UnityEngine.UI.Image;
using Slider = UnityEngine.UI.Slider;
using Toggle = UnityEngine.UI.Toggle;

/// <summary>
/// Thực thi các bước thao tác cho 7 phân hệ Unity và Động cơ vạn năng SerializedObject (JObject),
/// hỗ trợ gán trực tiếp ObjectReference (hierarchy:Path#Component, asset:Assets/..., guid:...), Enum, Vector, Color, Array
/// để phục vụ wiring Photon Fusion (NetworkRunner, NetworkObject, NetworkBehaviour) và thiết kế UI/Prefab.
/// </summary>
public static class AntigravityDomainModules
{
    private static readonly HashSet<string> ForbiddenMenuPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "File/Quit",
        "File/New Project...",
        "File/Open Project...",
        "File/New Scene"
    };

    // Dùng hàm static để định tuyến từng bước JObject trong gói Batch về đúng phân hệ xử lý.
    /// <summary>
    /// Thực thi một bước trong gói Batch và ghi nhận instanceId của đối tượng mới tạo vào danh sách theo dõi Undo.
    /// </summary>
    public static void ExecuteSingleOperation(string endpointPath, JObject op, string undoLabel, List<int> createdIds)
    {
        if (endpointPath.EndsWith("/universal-serialized", StringComparison.OrdinalIgnoreCase))
        {
            ExecuteUniversalSerializedStep(op, undoLabel);
            return;
        }

        string action = op.Value<string>("action");
        if (string.IsNullOrEmpty(action))
        {
            throw new ArgumentException("Operation action cannot be empty.");
        }

        if (endpointPath.EndsWith("/scene-prefab", StringComparison.OrdinalIgnoreCase))
        {
            ExecuteScenePrefabStep(action, op, undoLabel, createdIds);
            return;
        }

        if (endpointPath.EndsWith("/ui", StringComparison.OrdinalIgnoreCase))
        {
            ExecuteUiStep(action, op, undoLabel, createdIds);
            return;
        }

        if (endpointPath.EndsWith("/animation", StringComparison.OrdinalIgnoreCase))
        {
            ExecuteAnimationStep(action, op, undoLabel, createdIds);
            return;
        }

        if (endpointPath.EndsWith("/vfx-particle", StringComparison.OrdinalIgnoreCase))
        {
            ExecuteVfxParticleStep(action, op, undoLabel, createdIds);
            return;
        }

        if (endpointPath.EndsWith("/assets-so", StringComparison.OrdinalIgnoreCase))
        {
            ExecuteAssetSoStep(action, op, undoLabel, createdIds);
            return;
        }

        if (endpointPath.EndsWith("/package-project", StringComparison.OrdinalIgnoreCase))
        {
            ExecutePackageProjectStep(action, op);
            return;
        }

        throw new InvalidOperationException($"Unsupported batch module endpoint: {endpointPath}");
    }

    private static void ExecuteScenePrefabStep(string action, JObject op, string undoLabel, List<int> createdIds)
    {
        switch (action)
        {
            case "create_gameobject":
            {
                string name = op.Value<string>("name");
                GameObject go = new GameObject(string.IsNullOrEmpty(name) ? "GameObject" : name);
                Undo.RegisterCreatedObjectUndo(go, undoLabel);
                AttachToParentIfSpecified(go.transform, op.Value<string>("parentPath"), undoLabel);
                ApplyTransformValues(go.transform, op, undoLabel);
                ApplyActiveTagLayer(go, op, undoLabel);
                createdIds.Add(go.GetInstanceID());
                return;
            }
            case "duplicate_gameobject":
            {
                GameObject src = RequireGameObject(op.Value<string>("targetPath"));
                GameObject clone = UnityEngine.Object.Instantiate(src, src.transform.parent);
                clone.name = string.IsNullOrEmpty(op.Value<string>("name")) ? $"{src.name}_Copy" : op.Value<string>("name");
                Undo.RegisterCreatedObjectUndo(clone, undoLabel);
                ApplyTransformValues(clone.transform, op, undoLabel);
                createdIds.Add(clone.GetInstanceID());
                return;
            }
            case "reparent_gameobject":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                AttachToParentIfSpecified(target.transform, op.Value<string>("parentPath"), undoLabel);
                return;
            }
            case "set_active_tag_layer":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                ApplyActiveTagLayer(target, op, undoLabel);
                return;
            }
            case "delete_gameobject":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                Undo.DestroyObjectImmediate(target);
                return;
            }
            case "set_transform":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                ApplyTransformValues(target.transform, op, undoLabel);
                return;
            }
            case "add_component":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                string compName = op.Value<string>("componentType");
                Type compType = ResolveUnityType(compName);
                if (compType == null)
                {
                    throw new InvalidOperationException($"Component type not found: {compName}");
                }

                Component comp = Undo.AddComponent(target, compType);
                if (op["properties"] is JObject propsObj && comp != null)
                {
                    ApplySerializedPropertiesMap(comp, propsObj, undoLabel);
                }

                return;
            }
            case "remove_component":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                Component comp = target.GetComponent(op.Value<string>("componentType"));
                if (comp == null)
                {
                    throw new InvalidOperationException($"Component not found on {target.name}: {op.Value<string>("componentType")}");
                }

                Undo.DestroyObjectImmediate(comp);
                return;
            }
            case "instantiate_prefab":
            {
                string prefabPath = op.Value<string>("prefabAssetPath");
                GameObject prefabAsset = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                if (prefabAsset == null)
                {
                    throw new InvalidOperationException($"Prefab asset not found at: {prefabPath}");
                }

                GameObject instance = (GameObject)PrefabUtility.InstantiatePrefab(prefabAsset);
                if (!string.IsNullOrEmpty(op.Value<string>("name")))
                {
                    instance.name = op.Value<string>("name");
                }

                Undo.RegisterCreatedObjectUndo(instance, undoLabel);
                AttachToParentIfSpecified(instance.transform, op.Value<string>("parentPath"), undoLabel);
                ApplyTransformValues(instance.transform, op, undoLabel);
                createdIds.Add(instance.GetInstanceID());
                return;
            }
            case "save_as_prefab":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                string prefabPath = op.Value<string>("prefabAssetPath");
                bool allowOverwrite = op.Value<bool?>("allowOverwrite") ?? false;
                if (!allowOverwrite && File.Exists(prefabPath))
                {
                    throw new InvalidOperationException($"Prefab already exists at {prefabPath} (set allowOverwrite=true to overwrite).");
                }

                PrefabUtility.SaveAsPrefabAssetAndConnect(target, prefabPath, InteractionMode.UserAction);
                return;
            }
            case "unpack_prefab":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                PrefabUtility.UnpackPrefabInstance(target, PrefabUnpackMode.OutermostRoot, InteractionMode.UserAction);
                return;
            }
            default:
                throw new InvalidOperationException($"Unknown scene-prefab action: {action}");
        }
    }

    private static void ExecuteUiStep(string action, JObject op, string undoLabel, List<int> createdIds)
    {
        switch (action)
        {
            case "create_canvas":
            {
                string name = op.Value<string>("name");
                GameObject canvasGo = new GameObject(
                    string.IsNullOrEmpty(name) ? "Canvas" : name,
                    typeof(RectTransform),
                    typeof(Canvas),
                    typeof(CanvasScaler),
                    typeof(GraphicRaycaster));
                Undo.RegisterCreatedObjectUndo(canvasGo, undoLabel);
                Canvas canvas = canvasGo.GetComponent<Canvas>();
                canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                createdIds.Add(canvasGo.GetInstanceID());
                return;
            }
            case "create_ugui_node":
            {
                string uiType = op.Value<string>("uiType") ?? "Panel";
                string name = op.Value<string>("name");
                GameObject node = CreateUguiElement(uiType, string.IsNullOrEmpty(name) ? uiType : name);
                Undo.RegisterCreatedObjectUndo(node, undoLabel);
                AttachToParentIfSpecified(node.transform, op.Value<string>("parentPath"), undoLabel);
                ApplyRectTransformValues(node.GetComponent<RectTransform>(), op, undoLabel);
                ApplyUguiVisuals(node, op, undoLabel);
                createdIds.Add(node.GetInstanceID());
                return;
            }
            case "set_rect_transform":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                ApplyRectTransformValues(target.GetComponent<RectTransform>(), op, undoLabel);
                return;
            }
            case "configure_layout":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                string layoutType = op.Value<string>("layoutType");
                Type compType = ResolveUnityType(layoutType);
                if (compType == null)
                {
                    throw new InvalidOperationException($"Layout component type not found: {layoutType}");
                }

                Component comp = target.GetComponent(compType) ?? Undo.AddComponent(target, compType);
                if (op["layoutSettings"] is JObject settingsObj)
                {
                    ApplySerializedPropertiesMap(comp, settingsObj, undoLabel);
                }

                return;
            }
            case "set_ugui_style":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                ApplyUguiVisuals(target, op, undoLabel);
                return;
            }
            case "create_ui_document":
            {
                string name = op.Value<string>("name");
                GameObject docGo = new GameObject(string.IsNullOrEmpty(name) ? "UIDocument" : name, typeof(UIDocument));
                Undo.RegisterCreatedObjectUndo(docGo, undoLabel);
                AttachToParentIfSpecified(docGo.transform, op.Value<string>("parentPath"), undoLabel);
                createdIds.Add(docGo.GetInstanceID());
                return;
            }
            case "write_uxml_asset":
            case "write_uss_asset":
            {
                string assetPath = op.Value<string>("assetPath");
                if (string.IsNullOrEmpty(assetPath) || !assetPath.StartsWith("Assets/", StringComparison.Ordinal))
                {
                    throw new InvalidOperationException("UI Toolkit assetPath must start with 'Assets/'.");
                }

                string dir = Path.GetDirectoryName(assetPath);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                File.WriteAllText(assetPath, op.Value<string>("content") ?? string.Empty);
                AssetDatabase.ImportAsset(assetPath);
                return;
            }
            case "bind_uxml_to_uidocument":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                UIDocument doc = target.GetComponent<UIDocument>();
                VisualTreeAsset vta = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(op.Value<string>("assetPath"));
                if (doc == null || vta == null)
                {
                    throw new InvalidOperationException("UIDocument or VisualTreeAsset (.uxml) not found.");
                }

                Undo.RecordObject(doc, undoLabel);
                doc.visualTreeAsset = vta;
                return;
            }
            default:
                throw new InvalidOperationException($"Unknown UI action: {action}");
        }
    }

    private static void ExecuteAnimationStep(string action, JObject op, string undoLabel, List<int> createdIds)
    {
        string controllerPath = op.Value<string>("controllerPath");
        switch (action)
        {
            case "create_animator_controller":
            {
                AnimatorController controller = AnimatorController.CreateAnimatorControllerAtPath(controllerPath);
                if (controller == null)
                {
                    throw new InvalidOperationException($"Failed to create AnimatorController at {controllerPath}");
                }

                createdIds.Add(controller.GetInstanceID());
                return;
            }
            case "add_parameter":
            {
                AnimatorController controller = RequireAnimatorController(controllerPath);
                Undo.RecordObject(controller, undoLabel);
                string paramTypeStr = op.Value<string>("parameterType") ?? "Float";
                AnimatorControllerParameterType paramType = (AnimatorControllerParameterType)Enum.Parse(
                    typeof(AnimatorControllerParameterType),
                    paramTypeStr,
                    true);
                controller.AddParameter(op.Value<string>("parameterName"), paramType);
                return;
            }
            case "add_state":
            {
                AnimatorController controller = RequireAnimatorController(controllerPath);
                AnimatorStateMachine sm = controller.layers[0].stateMachine;
                Undo.RecordObject(sm, undoLabel);
                sm.AddState(op.Value<string>("stateName"));
                return;
            }
            case "add_transition":
            {
                AnimatorController controller = RequireAnimatorController(controllerPath);
                AnimatorStateMachine sm = controller.layers[0].stateMachine;
                AnimatorState src = FindAnimatorState(sm, op.Value<string>("sourceStateName"));
                AnimatorState dst = FindAnimatorState(sm, op.Value<string>("destinationStateName"));
                if (src == null || dst == null)
                {
                    throw new InvalidOperationException("Animator source or destination state not found.");
                }

                AnimatorStateTransition tr = src.AddTransition(dst);
                tr.hasExitTime = op.Value<bool?>("hasExitTime") ?? true;
                tr.duration = op.Value<float?>("duration") ?? 0.25f;
                return;
            }
            case "assign_controller_to_animator":
            {
                GameObject target = RequireGameObject(op.Value<string>("targetPath"));
                Animator animator = target.GetComponent<Animator>() ?? Undo.AddComponent<Animator>(target);
                AnimatorController controller = RequireAnimatorController(controllerPath);
                Undo.RecordObject(animator, undoLabel);
                animator.runtimeAnimatorController = controller;
                return;
            }
            default:
                throw new InvalidOperationException($"Unknown animation action: {action}");
        }
    }

    private static void ExecuteVfxParticleStep(string action, JObject op, string undoLabel, List<int> createdIds)
    {
        if (action == "create_particle_system")
        {
            string name = op.Value<string>("name");
            GameObject psGo = new GameObject(string.IsNullOrEmpty(name) ? "ParticleSystem" : name, typeof(ParticleSystem));
            Undo.RegisterCreatedObjectUndo(psGo, undoLabel);
            AttachToParentIfSpecified(psGo.transform, op.Value<string>("parentPath"), undoLabel);
            ApplyTransformValues(psGo.transform, op, undoLabel);
            createdIds.Add(psGo.GetInstanceID());
            return;
        }

        GameObject target = RequireGameObject(op.Value<string>("targetPath"));
        ParticleSystem ps = target.GetComponent<ParticleSystem>();
        if (ps == null)
        {
            throw new InvalidOperationException($"No ParticleSystem on {op.Value<string>("targetPath")}");
        }

        if (op["settings"] is JObject settingsObj)
        {
            ApplySerializedPropertiesMap(ps, settingsObj, undoLabel);
        }
    }

    private static void ExecuteAssetSoStep(string action, JObject op, string undoLabel, List<int> createdIds)
    {
        string assetPath = op.Value<string>("assetPath");
        switch (action)
        {
            case "create_scriptable_object":
            {
                string typeName = op.Value<string>("typeName");
                Type soType = ResolveUnityType(typeName);
                if (soType == null || !typeof(ScriptableObject).IsAssignableFrom(soType))
                {
                    throw new InvalidOperationException($"ScriptableObject type not found: {typeName}");
                }

                ScriptableObject instance = ScriptableObject.CreateInstance(soType);
                AssetDatabase.CreateAsset(instance, assetPath);
                if (op["fields"] is JObject fieldsObj)
                {
                    ApplySerializedPropertiesMap(instance, fieldsObj, undoLabel);
                }

                EditorUtility.SetDirty(instance);
                createdIds.Add(instance.GetInstanceID());
                return;
            }
            case "edit_scriptable_object_fields":
            {
                UnityEngine.Object asset = AssetDatabase.LoadMainAssetAtPath(assetPath);
                if (asset == null)
                {
                    throw new InvalidOperationException($"Asset not found at: {assetPath}");
                }

                if (op["fields"] is JObject fieldsObj)
                {
                    ApplySerializedPropertiesMap(asset, fieldsObj, undoLabel);
                    EditorUtility.SetDirty(asset);
                }

                return;
            }
            case "create_material":
            {
                string shaderName = op.Value<string>("shaderName");
                Shader shader = Shader.Find(string.IsNullOrEmpty(shaderName) ? "Sprites/Default" : shaderName);
                if (shader == null)
                {
                    throw new InvalidOperationException($"Shader not found: {shaderName}");
                }

                Material mat = new Material(shader);
                AssetDatabase.CreateAsset(mat, assetPath);
                createdIds.Add(mat.GetInstanceID());
                return;
            }
            case "create_folder":
            {
                if (!Directory.Exists(assetPath))
                {
                    Directory.CreateDirectory(assetPath);
                    AssetDatabase.Refresh();
                }

                return;
            }
            case "move_or_rename_asset":
            {
                string error = AssetDatabase.MoveAsset(assetPath, op.Value<string>("destinationPath"));
                if (!string.IsNullOrEmpty(error))
                {
                    throw new InvalidOperationException($"AssetDatabase.MoveAsset failed: {error}");
                }

                return;
            }
            default:
                throw new InvalidOperationException($"Unknown asset/SO action: {action}");
        }
    }

    private static void ExecutePackageProjectStep(string action, JObject op)
    {
        switch (action)
        {
            case "sync_project_files":
                AntigravityExternalCodeEditor.SyncSolutionAndProjects();
                return;
            case "refresh_assets":
                AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                return;
            case "package_add":
                Client.Add(op.Value<string>("packageIdentifier"));
                return;
            case "package_remove":
                Client.Remove(op.Value<string>("packageIdentifier"));
                return;
            case "package_resolve":
                Client.Resolve();
                return;
            case "execute_menu_item":
            {
                string menuPath = op.Value<string>("menuItemPath");
                if (ForbiddenMenuPaths.Contains(menuPath))
                {
                    throw new InvalidOperationException($"Menu item is blocked for safety: {menuPath}");
                }

                if (!EditorApplication.ExecuteMenuItem(menuPath))
                {
                    throw new InvalidOperationException($"Failed to execute menu item: {menuPath}");
                }

                return;
            }
            default:
                throw new InvalidOperationException($"Unknown package/project action: {action}");
        }
    }

    // Động cơ Vạn năng SerializedObject hỗ trợ gán mọi kiểu dữ liệu và ObjectReference cho Photon Fusion / Scene / Prefab.
    private static void ExecuteUniversalSerializedStep(JObject op, string undoLabel)
    {
        UnityEngine.Object targetObject = null;
        string assetPath = op.Value<string>("assetPath");
        string targetPath = op.Value<string>("targetPath") ?? op.Value<string>("hierarchyPath");
        string componentType = op.Value<string>("componentType");

        if (!string.IsNullOrEmpty(assetPath))
        {
            targetObject = AssetDatabase.LoadMainAssetAtPath(assetPath);
        }
        else if (!string.IsNullOrEmpty(targetPath))
        {
            GameObject go = RequireGameObject(targetPath);
            targetObject = string.IsNullOrEmpty(componentType) ? (UnityEngine.Object)go : go.GetComponent(componentType);
        }

        if (targetObject == null)
        {
            throw new InvalidOperationException($"Universal serialized target not found (targetPath={targetPath}, componentType={componentType}, assetPath={assetPath}).");
        }

        JObject propsMap = op["properties"] as JObject;
        if (propsMap == null || propsMap.Count == 0)
        {
            throw new InvalidOperationException("Universal serialized operation requires a non-empty 'properties' object.");
        }

        ApplySerializedPropertiesMap(targetObject, propsMap, undoLabel);
    }

    private static void ApplySerializedPropertiesMap(UnityEngine.Object targetObject, JObject propsMap, string undoLabel)
    {
        Undo.RecordObject(targetObject, undoLabel);
        SerializedObject so = new SerializedObject(targetObject);

        foreach (KeyValuePair<string, JToken> pair in propsMap)
        {
            SerializedProperty prop = so.FindProperty(pair.Key);
            if (prop == null)
            {
                throw new InvalidOperationException($"SerializedProperty '{pair.Key}' not found on {targetObject.name} ({targetObject.GetType().Name}).");
            }

            AssignTokenToSerializedProperty(prop, pair.Value);
        }

        so.ApplyModifiedProperties();
        EditorUtility.SetDirty(targetObject);
    }

    private static void AssignTokenToSerializedProperty(SerializedProperty prop, JToken token)
    {
        if (token == null || token.Type == JTokenType.Null)
        {
            if (prop.propertyType == SerializedPropertyType.ObjectReference)
            {
                prop.objectReferenceValue = null;
            }

            return;
        }

        switch (prop.propertyType)
        {
            case SerializedPropertyType.Integer:
                prop.intValue = token.Value<int>();
                return;
            case SerializedPropertyType.Boolean:
                prop.boolValue = token.Value<bool>();
                return;
            case SerializedPropertyType.Float:
                prop.floatValue = token.Value<float>();
                return;
            case SerializedPropertyType.String:
                prop.stringValue = token.Value<string>();
                return;
            case SerializedPropertyType.Enum:
                if (token.Type == JTokenType.Integer)
                {
                    prop.intValue = token.Value<int>();
                }
                else
                {
                    string enumName = token.Value<string>();
                    int idx = Array.FindIndex(prop.enumNames, n => string.Equals(n, enumName, StringComparison.OrdinalIgnoreCase));
                    if (idx < 0 && prop.enumDisplayNames != null)
                    {
                        idx = Array.FindIndex(prop.enumDisplayNames, n => string.Equals(n, enumName, StringComparison.OrdinalIgnoreCase));
                    }

                    if (idx < 0)
                    {
                        throw new InvalidOperationException($"Enum value '{enumName}' not found on property '{prop.propertyPath}'.");
                    }

                    prop.enumValueIndex = idx;
                }

                return;
            case SerializedPropertyType.Vector2:
                if (token is JArray arr2 && arr2.Count >= 2)
                {
                    prop.vector2Value = new Vector2(arr2[0].Value<float>(), arr2[1].Value<float>());
                }

                return;
            case SerializedPropertyType.Vector3:
                if (token is JArray arr3 && arr3.Count >= 3)
                {
                    prop.vector3Value = new Vector3(arr3[0].Value<float>(), arr3[1].Value<float>(), arr3[2].Value<float>());
                }

                return;
            case SerializedPropertyType.Color:
                if (ColorUtility.TryParseHtmlString(token.Value<string>(), out Color c))
                {
                    prop.colorValue = c;
                }

                return;
            case SerializedPropertyType.ObjectReference:
                prop.objectReferenceValue = ResolveObjectReferenceToken(token);
                return;
            default:
                if (prop.isArray && token is JArray arrayTokens)
                {
                    prop.arraySize = arrayTokens.Count;
                    for (int index = 0; index < arrayTokens.Count; index++)
                    {
                        AssignTokenToSerializedProperty(prop.GetArrayElementAtIndex(index), arrayTokens[index]);
                    }

                    return;
                }

                throw new InvalidOperationException($"Unsupported SerializedPropertyType '{prop.propertyType}' on '{prop.propertyPath}'.");
        }
    }

    // Hỗ trợ tham chiếu "hierarchy:Canvas/Panel#Image", "asset:Assets/Prefabs/P.prefab", "guid:..." hoặc instanceId số nguyên.
    private static UnityEngine.Object ResolveObjectReferenceToken(JToken token)
    {
        if (token.Type == JTokenType.Integer)
        {
            return EditorUtility.InstanceIDToObject(token.Value<int>());
        }

        string spec = token.Value<string>() ?? string.Empty;
        if (string.IsNullOrEmpty(spec))
        {
            return null;
        }

        if (spec.StartsWith("guid:", StringComparison.OrdinalIgnoreCase))
        {
            string assetPath = AssetDatabase.GUIDToAssetPath(spec.Substring(5).Trim());
            return AssetDatabase.LoadMainAssetAtPath(assetPath);
        }

        if (spec.StartsWith("sprite:", StringComparison.OrdinalIgnoreCase))
        {
            string spriteSpec = spec.Substring(7).Trim();
            int subIdx = spriteSpec.IndexOf('#');
            string pathOnly = subIdx > 0 ? spriteSpec.Substring(0, subIdx) : spriteSpec;
            string subName = subIdx > 0 ? spriteSpec.Substring(subIdx + 1) : null;
            UnityEngine.Object[] allAssets = AssetDatabase.LoadAllAssetsAtPath(pathOnly);
            for (int index = 0; index < allAssets.Length; index++)
            {
                if (allAssets[index] is Sprite spr && (string.IsNullOrEmpty(subName) || spr.name == subName))
                {
                    return spr;
                }
            }

            return AssetDatabase.LoadAssetAtPath<Sprite>(pathOnly);
        }

        if (spec.StartsWith("asset:", StringComparison.OrdinalIgnoreCase))
        {
            return AssetDatabase.LoadMainAssetAtPath(spec.Substring(6).Trim());
        }

        if (spec.StartsWith("Assets/", StringComparison.Ordinal) || spec.StartsWith("Packages/", StringComparison.Ordinal))
        {
            return AssetDatabase.LoadMainAssetAtPath(spec);
        }

        string hierarchySpec = spec.StartsWith("hierarchy:", StringComparison.OrdinalIgnoreCase)
            ? spec.Substring(10).Trim()
            : spec;
        int hashIdx = hierarchySpec.IndexOf('#');
        if (hashIdx > 0)
        {
            string goPath = hierarchySpec.Substring(0, hashIdx);
            string compName = hierarchySpec.Substring(hashIdx + 1);
            GameObject go = RequireGameObject(goPath);
            Component comp = go.GetComponent(compName);
            if (comp == null)
            {
                throw new InvalidOperationException($"Component '{compName}' not found on GameObject '{goPath}'.");
            }

            return comp;
        }

        return RequireGameObject(hierarchySpec);
    }

    private static GameObject CreateUguiElement(string uiType, string name)
    {
        GameObject go = new GameObject(name, typeof(RectTransform));
        switch ((uiType ?? "Panel").ToLowerInvariant())
        {
            case "panel":
            case "image":
                go.AddComponent<Image>();
                break;
            case "rawimage":
                go.AddComponent<RawImage>();
                break;
            case "tmp_text":
                go.AddComponent<TextMeshProUGUI>();
                break;
            case "button":
                go.AddComponent<Image>();
                go.AddComponent<Button>();
                break;
            case "toggle":
                go.AddComponent<Toggle>();
                break;
            case "slider":
                go.AddComponent<Slider>();
                break;
            case "scrollview":
                go.AddComponent<Image>();
                go.AddComponent<ScrollRect>();
                break;
        }

        return go;
    }

    private static void ApplyRectTransformValues(RectTransform rect, JObject op, string undoLabel)
    {
        if (rect == null)
        {
            return;
        }

        Undo.RecordObject(rect, undoLabel);
        ApplyAnchorPreset(rect, op.Value<string>("anchorPreset"));

        if (op["anchorMin"] is JArray aMin && aMin.Count >= 2)
        {
            rect.anchorMin = new Vector2(aMin[0].Value<float>(), aMin[1].Value<float>());
        }

        if (op["anchorMax"] is JArray aMax && aMax.Count >= 2)
        {
            rect.anchorMax = new Vector2(aMax[0].Value<float>(), aMax[1].Value<float>());
        }

        if (op["pivot"] is JArray piv && piv.Count >= 2)
        {
            rect.pivot = new Vector2(piv[0].Value<float>(), piv[1].Value<float>());
        }

        if (op["anchoredPosition"] is JArray aPos && aPos.Count >= 2)
        {
            rect.anchoredPosition = new Vector2(aPos[0].Value<float>(), aPos[1].Value<float>());
        }

        if (op["sizeDelta"] is JArray sDelta && sDelta.Count >= 2)
        {
            rect.sizeDelta = new Vector2(sDelta[0].Value<float>(), sDelta[1].Value<float>());
        }
    }

    private static void ApplyAnchorPreset(RectTransform rect, string preset)
    {
        if (string.IsNullOrEmpty(preset))
        {
            return;
        }

        switch (preset.ToLowerInvariant())
        {
            case "stretch-all":
                rect.anchorMin = Vector2.zero;
                rect.anchorMax = Vector2.one;
                rect.offsetMin = Vector2.zero;
                rect.offsetMax = Vector2.zero;
                return;
            case "top-stretch":
                rect.anchorMin = new Vector2(0.0f, 1.0f);
                rect.anchorMax = new Vector2(1.0f, 1.0f);
                rect.pivot = new Vector2(0.5f, 1.0f);
                return;
            case "bottom-stretch":
                rect.anchorMin = new Vector2(0.0f, 0.0f);
                rect.anchorMax = new Vector2(1.0f, 0.0f);
                rect.pivot = new Vector2(0.5f, 0.0f);
                return;
            case "middle-center":
                rect.anchorMin = new Vector2(0.5f, 0.5f);
                rect.anchorMax = new Vector2(0.5f, 0.5f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                return;
            case "top-left":
                rect.anchorMin = new Vector2(0.0f, 1.0f);
                rect.anchorMax = new Vector2(0.0f, 1.0f);
                rect.pivot = new Vector2(0.0f, 1.0f);
                return;
            case "top-right":
                rect.anchorMin = new Vector2(1.0f, 1.0f);
                rect.anchorMax = new Vector2(1.0f, 1.0f);
                rect.pivot = new Vector2(1.0f, 1.0f);
                return;
        }
    }

    private static void ApplyUguiVisuals(GameObject node, JObject op, string undoLabel)
    {
        string text = op.Value<string>("text");
        if (text != null)
        {
            TextMeshProUGUI tmp = node.GetComponent<TextMeshProUGUI>();
            if (tmp != null)
            {
                Undo.RecordObject(tmp, undoLabel);
                tmp.text = text;
                float fontSize = op.Value<float?>("fontSize") ?? 0.0f;
                if (fontSize > 0.0f)
                {
                    tmp.fontSize = fontSize;
                }
            }
        }

        string colorHex = op.Value<string>("color");
        if (!string.IsNullOrEmpty(colorHex) && ColorUtility.TryParseHtmlString(colorHex, out Color parsedColor))
        {
            Graphic graphic = node.GetComponent<Graphic>();
            if (graphic != null)
            {
                Undo.RecordObject(graphic, undoLabel);
                graphic.color = parsedColor;
            }
        }
    }

    private static void AttachToParentIfSpecified(Transform child, string parentPath, string undoLabel)
    {
        if (string.IsNullOrEmpty(parentPath))
        {
            return;
        }

        GameObject parentGo = RequireGameObject(parentPath);
        Undo.SetTransformParent(child, parentGo.transform, false, undoLabel);
    }

    private static void ApplyTransformValues(Transform tr, JObject op, string undoLabel)
    {
        Undo.RecordObject(tr, undoLabel);
        if (op["position"] is JArray wPos && wPos.Count >= 3)
        {
            tr.position = new Vector3(wPos[0].Value<float>(), wPos[1].Value<float>(), wPos[2].Value<float>());
        }

        if (op["localPosition"] is JArray lPos && lPos.Count >= 3)
        {
            tr.localPosition = new Vector3(lPos[0].Value<float>(), lPos[1].Value<float>(), lPos[2].Value<float>());
        }

        if (op["localEulerAngles"] is JArray lRot && lRot.Count >= 3)
        {
            tr.localEulerAngles = new Vector3(lRot[0].Value<float>(), lRot[1].Value<float>(), lRot[2].Value<float>());
        }

        if (op["localScale"] is JArray lScale && lScale.Count >= 3)
        {
            tr.localScale = new Vector3(lScale[0].Value<float>(), lScale[1].Value<float>(), lScale[2].Value<float>());
        }
    }

    private static void ApplyActiveTagLayer(GameObject go, JObject op, string undoLabel)
    {
        Undo.RecordObject(go, undoLabel);
        if (op["active"] != null)
        {
            go.SetActive(op.Value<bool>("active"));
        }

        string tag = op.Value<string>("tag");
        if (!string.IsNullOrEmpty(tag))
        {
            go.tag = tag;
        }

        string layerName = op.Value<string>("layer");
        if (!string.IsNullOrEmpty(layerName))
        {
            int layerId = LayerMask.NameToLayer(layerName);
            if (layerId >= 0)
            {
                go.layer = layerId;
            }
        }
    }

    private static GameObject RequireGameObject(string hierarchyPath)
    {
        GameObject found = GameObject.Find(hierarchyPath);
        if (found == null)
        {
            throw new InvalidOperationException($"GameObject not found in active Scene: {hierarchyPath}");
        }

        return found;
    }

    private static AnimatorController RequireAnimatorController(string path)
    {
        AnimatorController controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(path);
        if (controller == null)
        {
            throw new InvalidOperationException($"AnimatorController not found at: {path}");
        }

        return controller;
    }

    private static AnimatorState FindAnimatorState(AnimatorStateMachine sm, string stateName)
    {
        ChildAnimatorState[] states = sm.states;
        for (int index = 0; index < states.Length; index++)
        {
            if (states[index].state != null && states[index].state.name == stateName)
            {
                return states[index].state;
            }
        }

        return null;
    }

    private static Type ResolveUnityType(string typeName)
    {
        if (string.IsNullOrEmpty(typeName))
        {
            return null;
        }

        Type direct = Type.GetType(typeName);
        if (direct != null)
        {
            return direct;
        }

        System.Reflection.Assembly[] assemblies = AppDomain.CurrentDomain.GetAssemblies();
        for (int aIndex = 0; aIndex < assemblies.Length; aIndex++)
        {
            Type[] types;
            try
            {
                types = assemblies[aIndex].GetTypes();
            }
            catch
            {
                continue;
            }

            for (int tIndex = 0; tIndex < types.Length; tIndex++)
            {
                if (types[tIndex].Name == typeName || types[tIndex].FullName == typeName)
                {
                    return types[tIndex];
                }
            }
        }

        return null;
    }
}
