using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Cửa sổ bảng điều khiển Tools > Antigravity MCP > Control Panel trong Unity Editor để owner bật/tắt công tắc ghi,
/// theo dõi thời gian Auto-Relock 15 phút, bấm đồng bộ .csproj/.sln và xem nhật ký Audit Log.
/// </summary>
public class AntigravityBridgeWindow : EditorWindow
{
    private Vector2 _scrollPosition;

    // Dùng hàm static để đăng ký mục mở cửa sổ trên thanh menu Tools của Unity Editor.
    /// <summary>
    /// Mở cửa sổ điều khiển Antigravity MCP Bridge.
    /// </summary>
    [MenuItem("Tools/Antigravity MCP/Control Panel")]
    public static void ShowWindow()
    {
        AntigravityBridgeWindow window = GetWindow<AntigravityBridgeWindow>("Antigravity MCP");
        window.minSize = new Vector2(420.0f, 340.0f);
        window.Show();
    }

    private void OnGUI()
    {
        EditorGUILayout.Space(6.0f);
        EditorGUILayout.LabelField("Antigravity IDE — Unity 6 MCP Bridge", EditorStyles.boldLabel);

        string statusText = AntigravityBridgeServer.IsRunning
            ? $"Đang chạy trên 127.0.0.1:{AntigravityBridgeServer.BoundPort} (Project Hash: {AntigravityProjectPaths.GetProjectHash()})"
            : "Đang dừng";
        EditorGUILayout.HelpBox(statusText, AntigravityBridgeServer.IsRunning ? MessageType.Info : MessageType.Warning);

        DrawSafetySection();
        EditorGUILayout.Space(8.0f);
        DrawQuickActionsSection();
        EditorGUILayout.Space(8.0f);
        DrawAuditLogSection();
    }

    private static void DrawSafetySection()
    {
        EditorGUILayout.LabelField("Chốt An toàn 2 Lớp (Tier-2 Write Lock)", EditorStyles.boldLabel);
        bool currentWrite = AntigravityBridgeState.WriteEnabled;
        bool nextWrite = EditorGUILayout.ToggleLeft(
            "Allow AI Write Actions (Cho phép AI thực thi các gói Batch đã được bạn duyệt)",
            currentWrite);
        if (nextWrite != currentWrite)
        {
            AntigravityBridgeState.WriteEnabled = nextWrite;
        }

        if (nextWrite)
        {
            int remainingSeconds = AntigravityBridgeState.GetAutoRelockRemainingSeconds();
            EditorGUILayout.HelpBox(
                $"Đang MỞ QUYỀN GHI. Tự động khóa lại về READ_ONLY sau {remainingSeconds / 60} phút {remainingSeconds % 60} giây không hoạt động.",
                MessageType.Warning);
        }
        else
        {
            EditorGUILayout.HelpBox("Đang ở chế độ READ_ONLY (Mọi lệnh ghi từ AI đều bị chặn với mã 403).", MessageType.None);
        }

        AntigravityBridgeState.RequirePopupConfirmation = EditorGUILayout.ToggleLeft(
            "Require Unity Popup Confirmation Per Batch (Hỏi thêm hộp thoại xác nhận trong Unity)",
            AntigravityBridgeState.RequirePopupConfirmation);
    }

    private static void DrawQuickActionsSection()
    {
        EditorGUILayout.LabelField("Công cụ Nhanh", EditorStyles.boldLabel);
        EditorGUILayout.BeginHorizontal();
        if (GUILayout.Button("Sync .csproj & .sln Now", GUILayout.Height(26.0f)))
        {
            AntigravityExternalCodeEditor.SyncSolutionAndProjects();
        }

        if (GUILayout.Button("Restart Bridge Server", GUILayout.Height(26.0f)))
        {
            AntigravityBridgeServer.StopServer();
            AntigravityBridgeServer.StartServer();
        }

        EditorGUILayout.EndHorizontal();
    }

    private void DrawAuditLogSection()
    {
        EditorGUILayout.LabelField("Nhật ký Thao tác (Audit Log)", EditorStyles.boldLabel);
        List<string> logs = AntigravityBridgeState.GetAuditEntriesSnapshot();
        _scrollPosition = EditorGUILayout.BeginScrollView(_scrollPosition, EditorStyles.helpBox);
        if (logs.Count == 0)
        {
            EditorGUILayout.LabelField("Chưa có thao tác ghi nào trong phiên này.");
        }
        else
        {
            for (int index = logs.Count - 1; index >= 0; index--)
            {
                EditorGUILayout.LabelField(logs[index], EditorStyles.wordWrappedMiniLabel);
            }
        }

        EditorGUILayout.EndScrollView();
    }
}
