using System;
using System.Collections.Generic;
using System.Text;
using AntigravityJson;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// Xử lý toàn bộ các truy vấn Tầng 1 (Chỉ đọc) từ MCP Server, bao gồm kiểm tra Build Settings Scene Index,
/// phát hiện GameObject trùng tên (PRE-3) hoặc thiếu NetworkObject trên scene networking, và chạy EditMode test.
/// </summary>
public static class AntigravityReadHandlers
{
    // Dùng hàm static để phân phối các endpoint /api/read/* trên luồng chính của Unity.
    /// <summary>
    /// Thực thi truy vấn chỉ đọc và trả về chuỗi JSON kết quả.
    /// </summary>
    public static string HandleReadRequest(string path, string body, out int statusCode)
    {
        statusCode = 200;
        JObject query = ParseQueryObject(body);

        if (path.EndsWith("/status", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/editor-status", StringComparison.OrdinalIgnoreCase))
        {
            return BuildEditorStatusJson();
        }

        if (path.EndsWith("/console-logs", StringComparison.OrdinalIgnoreCase))
        {
            return BuildConsoleLogsJson(query);
        }

        if (path.EndsWith("/hierarchy", StringComparison.OrdinalIgnoreCase))
        {
            return BuildHierarchyJson(query);
        }

        if (path.EndsWith("/inspect-object", StringComparison.OrdinalIgnoreCase))
        {
            return BuildInspectObjectJson(query);
        }

        if (path.EndsWith("/find-assets", StringComparison.OrdinalIgnoreCase))
        {
            return BuildFindAssetsJson(query);
        }

        if (path.EndsWith("/packages", StringComparison.OrdinalIgnoreCase))
        {
            return BuildPackagesJson();
        }

        if (path.EndsWith("/run-tests", StringComparison.OrdinalIgnoreCase))
        {
            return TriggerEditModeTestsJson(query);
        }

        statusCode = 404;
        return "{\"errorCode\":\"READ_ENDPOINT_NOT_FOUND\",\"message\":\"Unknown read endpoint.\"}";
    }

    private static JObject ParseQueryObject(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return new JObject();
        }

        try
        {
            return JObject.Parse(body);
        }
        catch
        {
            return new JObject();
        }
    }

    private static string BuildEditorStatusJson()
    {
        Scene activeScene = SceneManager.GetActiveScene();
        JArray buildScenes = new JArray();
        EditorBuildSettingsScene[] configuredScenes = EditorBuildSettings.scenes;
        int activeBuildIndex = -1;
        int enabledIndex = 0;

        for (int index = 0; index < configuredScenes.Length; index++)
        {
            EditorBuildSettingsScene sceneEntry = configuredScenes[index];
            int buildIdx = sceneEntry.enabled ? enabledIndex++ : -1;
            if (sceneEntry.path == activeScene.path)
            {
                activeBuildIndex = buildIdx;
            }

            buildScenes.Add(new JObject
            {
                ["path"] = sceneEntry.path,
                ["enabled"] = sceneEntry.enabled,
                ["buildIndex"] = buildIdx
            });
        }

        JObject status = new JObject
        {
            ["unityVersion"] = Application.unityVersion,
            ["activeSceneName"] = activeScene.name,
            ["activeScenePath"] = activeScene.path,
            ["activeSceneBuildIndex"] = activeBuildIndex,
            ["activeSceneInBuildSettings"] = activeBuildIndex >= 0,
            ["activeSceneDirty"] = activeScene.isDirty,
            ["isCompiling"] = EditorApplication.isCompiling,
            ["isPlaying"] = EditorApplication.isPlaying,
            ["writeEnabled"] = AntigravityBridgeState.WriteEnabled,
            ["requirePopupConfirmation"] = AntigravityBridgeState.RequirePopupConfirmation,
            ["autoRelockRemainingSeconds"] = AntigravityBridgeState.GetAutoRelockRemainingSeconds(),
            ["buildSettingsScenes"] = buildScenes
        };
        return status.ToString(Formatting.None);
    }

    private static string BuildConsoleLogsJson(JObject query)
    {
        string severity = query.Value<string>("severity") ?? "all";
        string contains = query.Value<string>("contains") ?? string.Empty;
        int limit = query.Value<int?>("limit") ?? 50;

        List<AntigravityBridgeState.ConsoleLogItem> items =
            AntigravityBridgeState.GetFilteredConsoleLogs(severity, contains, limit);
        JArray logsArray = new JArray();
        for (int index = 0; index < items.Count; index++)
        {
            AntigravityBridgeState.ConsoleLogItem item = items[index];
            logsArray.Add(new JObject
            {
                ["timestamp"] = item.Timestamp,
                ["severity"] = item.Severity,
                ["message"] = item.Message,
                ["stackTrace"] = item.StackTrace
            });
        }

        return new JObject
        {
            ["count"] = logsArray.Count,
            ["logs"] = logsArray
        }.ToString(Formatting.None);
    }

    private static string BuildHierarchyJson(JObject query)
    {
        Scene activeScene = SceneManager.GetActiveScene();
        GameObject[] roots = activeScene.GetRootGameObjects();
        int maxDepth = Mathf.Clamp(query.Value<int?>("maxDepth") ?? 4, 1, 10);
        bool includeInactive = query.Value<bool?>("includeInactive") ?? true;

        JArray nodes = new JArray();
        JArray networkingWarnings = new JArray();
        HashSet<string> rootNames = new HashSet<string>(StringComparer.Ordinal);

        for (int index = 0; index < roots.Length; index++)
        {
            GameObject rootGo = roots[index];
            if (!rootNames.Add(rootGo.name) || rootGo.name.EndsWith("(1)", StringComparison.Ordinal))
            {
                networkingWarnings.Add($"[PRE-3 Duplicate Warning] Phát hiện root GameObject nghi trùng lặp trên Scene: '{rootGo.name}'.");
            }

            AppendHierarchyNode(rootGo.transform, string.Empty, 1, maxDepth, includeInactive, nodes, networkingWarnings);
        }

        return new JObject
        {
            ["sceneName"] = activeScene.name,
            ["scenePath"] = activeScene.path,
            ["nodeCount"] = nodes.Count,
            ["networkingWarnings"] = networkingWarnings,
            ["nodes"] = nodes
        }.ToString(Formatting.None);
    }

    private static void AppendHierarchyNode(
        Transform current,
        string parentPath,
        int depth,
        int maxDepth,
        bool includeInactive,
        JArray nodes,
        JArray networkingWarnings)
    {
        if (current == null || (!includeInactive && !current.gameObject.activeInHierarchy))
        {
            return;
        }

        string path = string.IsNullOrEmpty(parentPath) ? current.name : $"{parentPath}/{current.name}";
        Component[] comps = current.GetComponents<Component>();
        JArray compNames = new JArray();
        bool hasNetworkBehaviour = false;
        bool hasNetworkObject = false;

        for (int cIndex = 0; cIndex < comps.Length; cIndex++)
        {
            Component comp = comps[cIndex];
            if (comp == null)
            {
                networkingWarnings.Add($"[Missing Script] GameObject '{path}' có 1 Component bị Missing Script.");
                continue;
            }

            Type cType = comp.GetType();
            compNames.Add(cType.Name);
            if (cType.Name == "NetworkObject")
            {
                hasNetworkObject = true;
            }

            if (cType.BaseType != null && (cType.BaseType.Name == "NetworkBehaviour" || cType.BaseType.Name == "SimulationBehaviour"))
            {
                hasNetworkBehaviour = true;
            }
        }

        if (hasNetworkBehaviour && !hasNetworkObject && current.GetComponentInParent<Component>() != null)
        {
            bool parentHasNetObj = false;
            Transform p = current.parent;
            while (p != null)
            {
                if (p.GetComponent("NetworkObject") != null)
                {
                    parentHasNetObj = true;
                    break;
                }

                p = p.parent;
            }

            if (!parentHasNetObj)
            {
                networkingWarnings.Add($"[Fusion Wiring Warning] '{path}' chứa NetworkBehaviour nhưng chưa gắn NetworkObject trên nó hoặc cha của nó.");
            }
        }

        nodes.Add(new JObject
        {
            ["name"] = current.name,
            ["path"] = path,
            ["instanceId"] = current.gameObject.GetInstanceID(),
            ["active"] = current.gameObject.activeSelf,
            ["tag"] = current.gameObject.tag,
            ["layer"] = LayerMask.LayerToName(current.gameObject.layer),
            ["components"] = compNames
        });

        if (depth >= maxDepth)
        {
            return;
        }

        for (int childIndex = 0; childIndex < current.childCount; childIndex++)
        {
            AppendHierarchyNode(current.GetChild(childIndex), path, depth + 1, maxDepth, includeInactive, nodes, networkingWarnings);
        }
    }

    private static string BuildInspectObjectJson(JObject query)
    {
        UnityEngine.Object target = ResolveTargetObject(query);
        if (target == null)
        {
            return "{\"found\":false,\"message\":\"Target GameObject or Asset not found.\"}";
        }

        string compFilter = query.Value<string>("componentType") ?? string.Empty;
        int maxProps = Mathf.Clamp(query.Value<int?>("maxProperties") ?? 150, 10, 500);

        JArray inspectedComponents = new JArray();
        if (target is GameObject go)
        {
            Component[] comps = go.GetComponents<Component>();
            for (int index = 0; index < comps.Length; index++)
            {
                Component c = comps[index];
                if (c == null)
                {
                    continue;
                }

                if (!string.IsNullOrEmpty(compFilter) &&
                    !string.Equals(c.GetType().Name, compFilter, StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(c.GetType().FullName, compFilter, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                inspectedComponents.Add(InspectSingleUnityObject(c, maxProps));
            }
        }
        else
        {
            inspectedComponents.Add(InspectSingleUnityObject(target, maxProps));
        }

        return new JObject
        {
            ["found"] = true,
            ["name"] = target.name,
            ["type"] = target.GetType().FullName,
            ["instanceId"] = target.GetInstanceID(),
            ["targets"] = inspectedComponents
        }.ToString(Formatting.None);
    }

    private static JObject InspectSingleUnityObject(UnityEngine.Object obj, int maxProps)
    {
        JArray props = new JArray();
        SerializedObject so = new SerializedObject(obj);
        SerializedProperty iterator = so.GetIterator();
        bool enterChildren = true;
        int count = 0;
        while (iterator.NextVisible(enterChildren) && count < maxProps)
        {
            enterChildren = false;
            count++;
            props.Add(new JObject
            {
                ["path"] = iterator.propertyPath,
                ["type"] = iterator.propertyType.ToString(),
                ["value"] = FormatSerializedValue(iterator)
            });
        }

        return new JObject
        {
            ["componentType"] = obj.GetType().FullName,
            ["instanceId"] = obj.GetInstanceID(),
            ["properties"] = props
        };
    }

    private static UnityEngine.Object ResolveTargetObject(JObject query)
    {
        int instanceId = query.Value<int?>("instanceId") ?? 0;
        if (instanceId != 0)
        {
            return EditorUtility.InstanceIDToObject(instanceId);
        }

        string assetPath = query.Value<string>("assetPath");
        if (!string.IsNullOrEmpty(assetPath))
        {
            return AssetDatabase.LoadMainAssetAtPath(assetPath);
        }

        string hierarchyPath = query.Value<string>("hierarchyPath");
        if (!string.IsNullOrEmpty(hierarchyPath))
        {
            return GameObject.Find(hierarchyPath);
        }

        return null;
    }

    private static string FormatSerializedValue(SerializedProperty prop)
    {
        switch (prop.propertyType)
        {
            case SerializedPropertyType.Integer:
                return prop.intValue.ToString();
            case SerializedPropertyType.Boolean:
                return prop.boolValue ? "true" : "false";
            case SerializedPropertyType.Float:
                return prop.floatValue.ToString("G");
            case SerializedPropertyType.String:
                return prop.stringValue ?? string.Empty;
            case SerializedPropertyType.Enum:
                return prop.enumDisplayNames != null && prop.enumValueIndex >= 0 && prop.enumValueIndex < prop.enumDisplayNames.Length
                    ? prop.enumDisplayNames[prop.enumValueIndex]
                    : prop.intValue.ToString();
            case SerializedPropertyType.Vector2:
                return prop.vector2Value.ToString();
            case SerializedPropertyType.Vector3:
                return prop.vector3Value.ToString();
            case SerializedPropertyType.Color:
                return prop.colorValue.ToString();
            case SerializedPropertyType.ObjectReference:
                if (prop.objectReferenceValue == null)
                {
                    return "null";
                }

                string assetPath = AssetDatabase.GetAssetPath(prop.objectReferenceValue);
                return string.IsNullOrEmpty(assetPath)
                    ? $"{prop.objectReferenceValue.name} ({prop.objectReferenceValue.GetType().Name}#{prop.objectReferenceValue.GetInstanceID()})"
                    : $"{prop.objectReferenceValue.name} ({assetPath})";
            default:
                return prop.propertyType.ToString();
        }
    }

    private static string BuildFindAssetsJson(JObject query)
    {
        string q = query.Value<string>("query") ?? string.Empty;
        string assetType = query.Value<string>("assetType") ?? string.Empty;
        int limit = Mathf.Clamp(query.Value<int?>("limit") ?? 50, 1, 200);
        bool listTypes = query.Value<bool?>("listComponentTypes") ?? false;

        string filter = string.IsNullOrEmpty(assetType) ? q : $"{q} {assetType}".Trim();
        string[] guids = AssetDatabase.FindAssets(filter);
        JArray matches = new JArray();
        for (int index = 0; index < guids.Length && matches.Count < limit; index++)
        {
            string assetPath = AssetDatabase.GUIDToAssetPath(guids[index]);
            matches.Add(new JObject
            {
                ["guid"] = guids[index],
                ["assetPath"] = assetPath
            });
        }

        JObject result = new JObject
        {
            ["mode"] = "live-assetdatabase",
            ["matchCount"] = matches.Count,
            ["matches"] = matches
        };

        if (listTypes)
        {
            JArray compTypes = new JArray();
            TypeCache.TypeCollection types = TypeCache.GetTypesDerivedFrom<Component>();
            for (int index = 0; index < types.Count && compTypes.Count < limit; index++)
            {
                Type t = types[index];
                if (string.IsNullOrEmpty(q) || t.FullName.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    compTypes.Add(t.FullName);
                }
            }

            result["componentTypes"] = compTypes;
        }

        return result.ToString(Formatting.None);
    }

    private static string BuildPackagesJson()
    {
        UnityEditor.PackageManager.PackageInfo[] pkgs = UnityEditor.PackageManager.PackageInfo.GetAllRegisteredPackages();
        JArray list = new JArray();
        for (int index = 0; index < pkgs.Length; index++)
        {
            UnityEditor.PackageManager.PackageInfo p = pkgs[index];
            list.Add(new JObject
            {
                ["name"] = p.name,
                ["version"] = p.version,
                ["source"] = p.source.ToString(),
                ["resolvedPath"] = p.resolvedPath
            });
        }

        return new JObject
        {
            ["packageCount"] = list.Count,
            ["packages"] = list
        }.ToString(Formatting.None);
    }

    private static string TriggerEditModeTestsJson(JObject query)
    {
        string testModeStr = query.Value<string>("testMode") ?? "EditMode";
        string testFilter = query.Value<string>("testFilter") ?? string.Empty;
        TestMode mode = string.Equals(testModeStr, "PlayMode", StringComparison.OrdinalIgnoreCase)
            ? TestMode.PlayMode
            : TestMode.EditMode;

        TestRunnerApi api = ScriptableObject.CreateInstance<TestRunnerApi>();
        Filter filter = new Filter
        {
            testMode = mode
        };
        if (!string.IsNullOrEmpty(testFilter))
        {
            filter.testNames = new[] { testFilter };
            filter.groupNames = new[] { testFilter };
        }

        JArray assemblyTokens = query["assemblyNames"] as JArray;
        if (assemblyTokens != null && assemblyTokens.Count > 0)
        {
            string[] asmNames = new string[assemblyTokens.Count];
            for (int index = 0; index < assemblyTokens.Count; index++)
            {
                asmNames[index] = assemblyTokens[index].ToString();
            }

            filter.assemblyNames = asmNames;
        }

        string runGuid = api.Execute(new ExecutionSettings(filter));
        return new JObject
        {
            ["triggered"] = true,
            ["runGuid"] = runGuid,
            ["testMode"] = mode.ToString(),
            ["testFilter"] = testFilter,
            ["message"] = "EditMode/PlayMode test run started in Unity Editor TestRunnerApi. Check Console logs or Test Runner window for results."
        }.ToString(Formatting.None);
    }

    /// <summary>
    /// Hàm tự kiểm thử thực tế (Batchmode Self-Test) cho toàn bộ tính năng Hướng 2 Networking (OL-2026-11-22-A27, A29):
    /// kiểm tra EditorBuildSettings.scenes, phát hiện duplicate root object PRE-3 (WaveManager (1)),
    /// gán ObjectReference ("hierarchy:...") + Vector3 qua AntigravityJson JObject trên SerializedObject,
    /// rồi hoàn tác sạch bằng Undo.RevertAllDownToGroup để không làm bẩn scene đang mở.
    /// </summary>
    public static void RunNetworkingSelfTestInBatchmode()
    {
        AntigravityExternalCodeEditor.SyncSolutionAndProjects();

        string statusJson = HandleReadRequest("/api/read/editor-status", "{}", out int statusSc);
        JObject statusObj = JObject.Parse(statusJson);
        if (statusSc != 200 || !(statusObj["buildSettingsScenes"] is JArray))
        {
            throw new InvalidOperationException("SelfTest FAIL: /api/read/editor-status thiếu buildSettingsScenes.");
        }

        Undo.IncrementCurrentGroup();
        int testUndoGroup = Undo.GetCurrentGroup();
        Undo.SetCurrentGroupName("Antigravity Networking SelfTest Temp");

        try
        {
            GameObject wm1 = new GameObject("WaveManager");
            Undo.RegisterCreatedObjectUndo(wm1, "SelfTest");
            GameObject wm2 = new GameObject("WaveManager (1)");
            Undo.RegisterCreatedObjectUndo(wm2, "SelfTest");

            GameObject netRoot = new GameObject("TestNetRoot");
            Undo.RegisterCreatedObjectUndo(netRoot, "SelfTest");
            UnityEngine.UI.Image img = netRoot.AddComponent<UnityEngine.UI.Image>();
            UnityEngine.UI.Button btn = netRoot.AddComponent<UnityEngine.UI.Button>();
            btn.targetGraphic = null;

            string hierarchyJson = HandleReadRequest("/api/read/hierarchy", "{}", out int hierSc);
            JObject hierObj = JObject.Parse(hierarchyJson);
            JArray netWarnings = hierObj["networkingWarnings"] as JArray;
            if (hierSc != 200 || netWarnings == null || netWarnings.Count == 0)
            {
                throw new InvalidOperationException("SelfTest FAIL: /api/read/hierarchy không phát hiện duplicate root WaveManager (1) (PRE-3).");
            }

            JObject wireStep = JObject.Parse(
                "{\"hierarchyPath\":\"TestNetRoot\",\"componentType\":\"Button\",\"properties\":{\"m_TargetGraphic\":\"hierarchy:TestNetRoot#Image\",\"m_Interactable\":false}}");
            List<int> createdIds = new List<int>();
            AntigravityDomainModules.ExecuteSingleOperation("/api/batch/universal-serialized", wireStep, "SelfTestWire", createdIds);

            if (btn.targetGraphic != img || btn.interactable != false)
            {
                throw new InvalidOperationException("SelfTest FAIL: unity_universal_serialized_batch không gán đúng ObjectReference hierarchy:TestNetRoot#Image hoặc bool m_Interactable.");
            }

            UnityEngine.Debug.Log(
                $"[Antigravity MCP Networking Self-Test] PASS: buildSettingsScenes={((JArray)statusObj["buildSettingsScenes"]).Count}, " +
                $"networkingWarnings={netWarnings.Count}, ObjectReference wired={btn.targetGraphic.name}#Image, Undo revert clean.");
        }
        finally
        {
            Undo.RevertAllDownToGroup(testUndoGroup);
        }
    }
}
