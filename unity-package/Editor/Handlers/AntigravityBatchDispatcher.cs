using System;
using System.Collections.Generic;
using AntigravityJson;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// Bộ điều phối giao dịch Batch nguyên tử (Tầng 2) sử dụng Newtonsoft.Json (JObject) để đọc đầy đủ 100%
/// cấu trúc properties/settings động cho mọi Component, NetworkBehaviour, Prefab và UI.
/// </summary>
public static class AntigravityBatchDispatcher
{
    // Dùng hàm static để xử lý mọi request /api/batch/* trên luồng chính của Unity.
    /// <summary>
    /// Kiểm tra khóa an toàn 2 lớp và thực thi gói Batch nguyên tử với Undo Rollback.
    /// </summary>
    public static string HandleBatchRequest(string path, string body, out int statusCode)
    {
        JObject envelope = ParseEnvelope(body);
        if (!ValidateSafetyLocks(envelope, out statusCode, out string lockErrorJson))
        {
            return lockErrorJson;
        }

        string operationId = envelope.Value<string>("operationId") ?? string.Empty;

        // Chốt chống tạo trùng khi rớt Wi-Fi: nếu operationId đã APPLIED và đối tượng còn trên Scene thì trả kết quả cũ.
        if (AntigravityProjectPaths.IsOperationStillAppliedInScene(operationId))
        {
            statusCode = 200;
            return new JObject
            {
                ["operationId"] = operationId,
                ["status"] = "APPLIED",
                ["idempotentReplay"] = true,
                ["message"] = "Operation already applied in active Scene; skipped duplicate execution."
            }.ToString(Formatting.None);
        }

        if (path.EndsWith("/save-scene", StringComparison.OrdinalIgnoreCase))
        {
            return ExecuteSaveScene(envelope, out statusCode);
        }

        if (path.EndsWith("/rollback", StringComparison.OrdinalIgnoreCase))
        {
            return ExecuteRollback(envelope, out statusCode);
        }

        return ExecuteAtomicModuleBatch(path, envelope, out statusCode);
    }

    private static JObject ParseEnvelope(string body)
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

    private static bool ValidateSafetyLocks(JObject env, out int statusCode, out string errorJson)
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            statusCode = 409;
            errorJson = "{\"errorCode\":\"BLOCKED_IN_PLAY_MODE\",\"message\":\"Tier-2 write actions are blocked during Play Mode.\"}";
            return false;
        }

        if (!AntigravityBridgeState.WriteEnabled)
        {
            statusCode = 403;
            errorJson = "{\"errorCode\":\"WRITE_LOCKED_IN_UNITY\",\"message\":\"Allow AI Write Actions is OFF in Tools > Antigravity MCP > Control Panel.\"}";
            return false;
        }

        bool ownerApproved = env.Value<bool?>("ownerApproved") ?? false;
        string approvalSummary = env.Value<string>("approvalSummary") ?? string.Empty;
        string operationId = env.Value<string>("operationId") ?? string.Empty;

        if (!ownerApproved || string.IsNullOrEmpty(approvalSummary) || string.IsNullOrEmpty(operationId))
        {
            statusCode = 400;
            errorJson = "{\"errorCode\":\"OWNER_APPROVAL_REQUIRED\",\"message\":\"Missing ownerApproved, approvalSummary, or operationId.\"}";
            return false;
        }

        if (AntigravityBridgeState.RequirePopupConfirmation)
        {
            bool confirmed = EditorUtility.DisplayDialog(
                "Antigravity MCP — Xác nhận Gói Thao tác",
                $"Operation ID: {operationId}\nNội dung đã duyệt: {approvalSummary}\n\nBạn có cho phép thực thi gói này không?",
                "Cho phép",
                "Từ chối");
            if (!confirmed)
            {
                statusCode = 403;
                errorJson = "{\"errorCode\":\"REJECTED_BY_OWNER_POPUP\",\"message\":\"Owner declined the Unity confirmation dialog.\"}";
                return false;
            }
        }

        statusCode = 200;
        errorJson = string.Empty;
        return true;
    }

    private static string ExecuteAtomicModuleBatch(string path, JObject env, out int statusCode)
    {
        string operationId = env.Value<string>("operationId") ?? string.Empty;
        string approvalSummary = env.Value<string>("approvalSummary") ?? string.Empty;
        JArray ops = env["operations"] as JArray ?? new JArray();
        List<int> createdInstanceIds = new List<int>();

        Undo.IncrementCurrentGroup();
        int undoGroup = Undo.GetCurrentGroup();
        Undo.SetCurrentGroupName($"Antigravity MCP: {operationId}");

        try
        {
            for (int index = 0; index < ops.Count; index++)
            {
                JObject opItem = ops[index] as JObject;
                if (opItem != null)
                {
                    AntigravityDomainModules.ExecuteSingleOperation(path, opItem, operationId, createdInstanceIds);
                }
            }

            Undo.CollapseUndoOperations(undoGroup);
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());

            AntigravityProjectPaths.AppendJournalEntry(operationId, path, "APPLIED", approvalSummary, createdInstanceIds);
            AntigravityBridgeState.RecordWriteActivity(operationId, path, "APPLIED", approvalSummary);

            statusCode = 200;
            return new JObject
            {
                ["operationId"] = operationId,
                ["status"] = "APPLIED",
                ["executedSteps"] = ops.Count,
                ["createdObjectCount"] = createdInstanceIds.Count
            }.ToString(Formatting.None);
        }
        catch (Exception exception)
        {
            Undo.RevertAllDownToGroup(undoGroup);
            AntigravityProjectPaths.AppendJournalEntry(operationId, path, "ROLLED_BACK", exception.Message, null);
            AntigravityBridgeState.RecordWriteActivity(operationId, path, "ROLLED_BACK", exception.Message);

            statusCode = 400;
            return new JObject
            {
                ["errorCode"] = "BATCH_ROLLED_BACK",
                ["operationId"] = operationId,
                ["message"] = exception.Message
            }.ToString(Formatting.None);
        }
    }

    private static string ExecuteRollback(JObject env, out int statusCode)
    {
        string operationId = env.Value<string>("operationId") ?? string.Empty;
        string targetOpId = env.Value<string>("targetOperationId") ?? string.Empty;
        string approvalSummary = env.Value<string>("approvalSummary") ?? string.Empty;

        Undo.PerformUndo();
        AntigravityProjectPaths.AppendJournalEntry(targetOpId, "rollback", "ROLLED_BACK", approvalSummary, null);
        AntigravityBridgeState.RecordWriteActivity(operationId, "rollback", "ROLLED_BACK", targetOpId);
        statusCode = 200;
        return new JObject
        {
            ["operationId"] = operationId,
            ["rolledBackTarget"] = targetOpId,
            ["status"] = "ROLLED_BACK"
        }.ToString(Formatting.None);
    }

    private static string ExecuteSaveScene(JObject env, out int statusCode)
    {
        string operationId = env.Value<string>("operationId") ?? string.Empty;
        Scene activeScene = SceneManager.GetActiveScene();
        bool saved = EditorSceneManager.SaveScene(activeScene);
        AntigravityProjectPaths.AppendJournalEntry(operationId, "save-scene", saved ? "APPLIED" : "FAILED", activeScene.path, null);
        AntigravityBridgeState.RecordWriteActivity(operationId, "save-scene", saved ? "APPLIED" : "FAILED", activeScene.path);
        statusCode = saved ? 200 : 500;
        return new JObject
        {
            ["operationId"] = operationId,
            ["saved"] = saved,
            ["scenePath"] = activeScene.path
        }.ToString(Formatting.None);
    }
}
