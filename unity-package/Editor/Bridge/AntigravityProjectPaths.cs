using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Quản lý đường dẫn tệp khám phá (Discovery) và sổ nhật ký thao tác (Operation Journal) đồng bộ với Node.js MCP Server.
/// </summary>
public static class AntigravityProjectPaths
{
    private const int ProjectHashLength = 16;

    // Lưu danh sách operationId -> danh sách instanceId đã tạo trong phiên để phát hiện khi owner bấm Ctrl+Z.
    private static readonly Dictionary<string, List<int>> AppliedBatchInstanceIds = new Dictionary<string, List<int>>();
    private static readonly HashSet<string> UndoneOperationIds = new HashSet<string>();

    // Dùng hàm static thuần để tính mã băm 16 ký tự khớp 100% với computeProjectHash() trong offline-tools.mjs.
    /// <summary>
    /// Tính mã SHA-256 rút gọn 16 ký tự viết hoa từ đường dẫn chuẩn hóa của thư mục gốc dự án Unity.
    /// </summary>
    public static string GetProjectHash()
    {
        string rawRoot = Directory.GetParent(Application.dataPath)?.FullName ?? Application.dataPath;
        string normalized = rawRoot.Replace('\\', '/').TrimEnd('/').ToLowerInvariant();
        using (SHA256 sha = SHA256.Create())
        {
            byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(normalized));
            StringBuilder builder = new StringBuilder(ProjectHashLength);
            for (int index = 0; index < ProjectHashLength / 2; index++)
            {
                builder.Append(bytes[index].ToString("X2"));
            }

            return builder.ToString();
        }
    }

    // Dùng hàm static để trả về thư mục gốc lưu dữ liệu trao đổi cục bộ của Antigravity Unity MCP.
    /// <summary>
    /// Lấy thư mục dữ liệu %LOCALAPPDATA%/antigravity-unity-mcp (hoặc biến môi trường ANTIGRAVITY_UNITY_MCP_DIR).
    /// </summary>
    public static string GetAppDataRoot()
    {
        string customEnv = Environment.GetEnvironmentVariable("ANTIGRAVITY_UNITY_MCP_DIR");
        if (!string.IsNullOrEmpty(customEnv))
        {
            return Path.GetFullPath(customEnv);
        }

        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(localAppData, "antigravity-unity-mcp");
    }

    // Dùng hàm static để lấy đường dẫn tệp JSON đăng ký cổng và token của phiên Unity hiện tại.
    /// <summary>
    /// Lấy đường dẫn tệp discovery instances/&lt;projectHash&gt;.json.
    /// </summary>
    public static string GetInstanceFilePath()
    {
        return Path.Combine(GetAppDataRoot(), "instances", $"{GetProjectHash()}.json");
    }

    // Dùng hàm static để lấy đường dẫn sổ nhật ký Operation Journal chống chạy trùng khi mất mạng.
    /// <summary>
    /// Lấy đường dẫn tệp journal/&lt;projectHash&gt;.jsonl.
    /// </summary>
    public static string GetJournalFilePath()
    {
        return Path.Combine(GetAppDataRoot(), "journal", $"{GetProjectHash()}.jsonl");
    }

    // Dùng hàm static để ghi tệp discovery mỗi khi Bridge khởi động hoặc đổi trạng thái công tắc ghi.
    /// <summary>
    /// Ghi thông tin cổng loopback, token, PID và trạng thái công tắc ghi xuống đĩa.
    /// </summary>
    public static void WriteDiscoveryFile(int port, string token, bool writeEnabled)
    {
        try
        {
            string filePath = GetInstanceFilePath();
            string directory = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            string projectRoot = (Directory.GetParent(Application.dataPath)?.FullName ?? string.Empty).Replace('\\', '/');
            int pid = Process.GetCurrentProcess().Id;
            string json =
                "{\n" +
                $"  \"projectPath\": \"{EscapeJson(projectRoot)}\",\n" +
                $"  \"projectHash\": \"{GetProjectHash()}\",\n" +
                $"  \"host\": \"127.0.0.1\",\n" +
                $"  \"port\": {port},\n" +
                $"  \"token\": \"{EscapeJson(token)}\",\n" +
                $"  \"pid\": {pid},\n" +
                $"  \"unityVersion\": \"{EscapeJson(Application.unityVersion)}\",\n" +
                $"  \"writeEnabled\": {(writeEnabled ? "true" : "false")},\n" +
                $"  \"updatedAt\": \"{DateTime.UtcNow:O}\"\n" +
                "}";
            File.WriteAllText(filePath, json, new UTF8Encoding(false));
        }
        catch (Exception exception)
        {
            UnityEngine.Debug.LogWarning($"[Antigravity MCP] Không ghi được tệp discovery: {exception.Message}");
        }
    }

    // Dùng hàm static để xóa tệp discovery khi Unity thoát hoặc trước khi reload domain.
    /// <summary>
    /// Xóa tệp discovery của phiên hiện tại khi đóng server.
    /// </summary>
    public static void DeleteDiscoveryFile()
    {
        try
        {
            string filePath = GetInstanceFilePath();
            if (File.Exists(filePath))
            {
                File.Delete(filePath);
            }
        }
        catch
        {
        }
    }

    // Dùng hàm static để ghi nối một dòng sự kiện vào sổ nhật ký Operation Journal trên đĩa.
    /// <summary>
    /// Ghi đồng bộ một bản ghi trạng thái (APPLIED, ROLLED_BACK, UNDONE_BY_USER) vào Operation Journal.
    /// </summary>
    public static void AppendJournalEntry(string operationId, string toolName, string status, string summary, List<int> createdInstanceIds)
    {
        if (string.IsNullOrEmpty(operationId))
        {
            return;
        }

        try
        {
            string journalPath = GetJournalFilePath();
            string directory = Path.GetDirectoryName(journalPath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            if (status == "APPLIED" && createdInstanceIds != null && createdInstanceIds.Count > 0)
            {
                AppliedBatchInstanceIds[operationId] = new List<int>(createdInstanceIds);
                UndoneOperationIds.Remove(operationId);
            }

            string idsJson = createdInstanceIds != null ? string.Join(",", createdInstanceIds) : string.Empty;
            string line =
                "{" +
                $"\"timestamp\":\"{DateTime.UtcNow:O}\"," +
                $"\"operationId\":\"{EscapeJson(operationId)}\"," +
                $"\"tool\":\"{EscapeJson(toolName)}\"," +
                $"\"status\":\"{EscapeJson(status)}\"," +
                $"\"summary\":\"{EscapeJson(summary)}\"," +
                $"\"instanceIds\":[{idsJson}]" +
                "}\n";
            File.AppendAllText(journalPath, line, new UTF8Encoding(false));
        }
        catch (Exception exception)
        {
            UnityEngine.Debug.LogWarning($"[Antigravity MCP] Lỗi ghi Operation Journal: {exception.Message}");
        }
    }

    // Dùng hàm static kiểm tra xem một operationId đã được áp dụng và các đối tượng của nó còn sống trên Scene không.
    /// <summary>
    /// Kiểm tra tính chống chạy trùng (Idempotency) cho một operationId khi mạng chập chờn gửi lại lệnh.
    /// </summary>
    public static bool IsOperationStillAppliedInScene(string operationId)
    {
        if (string.IsNullOrEmpty(operationId) || UndoneOperationIds.Contains(operationId))
        {
            return false;
        }

        if (!AppliedBatchInstanceIds.TryGetValue(operationId, out List<int> ids) || ids == null || ids.Count == 0)
        {
            return false;
        }

        for (int index = 0; index < ids.Count; index++)
        {
            if (EditorUtility.InstanceIDToObject(ids[index]) == null)
            {
                return false;
            }
        }

        return true;
    }

    // Dùng hàm static lắng nghe sự kiện Undo.undoRedoPerformed của Unity Editor.
    /// <summary>
    /// Quét các batch đã APPLIED sau khi owner bấm Ctrl+Z; nếu đối tượng đã bị hoàn tác thì ghi UNDONE_BY_USER vào Journal.
    /// </summary>
    public static void OnUnityUndoRedoPerformed()
    {
        foreach (KeyValuePair<string, List<int>> pair in AppliedBatchInstanceIds)
        {
            string opId = pair.Key;
            if (UndoneOperationIds.Contains(opId))
            {
                continue;
            }

            List<int> ids = pair.Value;
            bool anyMissing = false;
            for (int index = 0; index < ids.Count; index++)
            {
                if (EditorUtility.InstanceIDToObject(ids[index]) == null)
                {
                    anyMissing = true;
                    break;
                }
            }

            if (anyMissing)
            {
                UndoneOperationIds.Add(opId);
                AppendJournalEntry(opId, "Undo.undoRedoPerformed", "UNDONE_BY_USER", "Owner pressed Ctrl+Z in Unity Editor", ids);
            }
        }
    }

    // Dùng hàm static để thoát chuỗi JSON an toàn không cần thư viện ngoài.
    /// <summary>
    /// Thoát các ký tự đặc biệt trong chuỗi JSON.
    /// </summary>
    public static string EscapeJson(string raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return string.Empty;
        }

        return raw
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n")
            .Replace("\t", "\\t");
    }
}
