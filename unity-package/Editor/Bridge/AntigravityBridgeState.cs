using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Lưu trữ trạng thái an toàn của Unity Bridge: công tắc khóa ghi (Allow AI Write Actions), bộ đếm tự khóa sau 15 phút
/// không tương tác (Auto-Relock Timeout), bộ đệm vòng 500 dòng Console log và nhật ký Audit Log.
/// </summary>
public static class AntigravityBridgeState
{
    private const string WriteEnabledSessionKey = "AntigravityMCP.WriteEnabled";
    private const string PopupConfirmSessionKey = "AntigravityMCP.PopupConfirm";
    private const double AutoRelockTimeoutSeconds = 900.0;
    private const int MaxConsoleLogs = 500;
    private const int MaxAuditEntries = 100;

    private static readonly object LogLock = new object();
    private static readonly List<ConsoleLogItem> ConsoleLogs = new List<ConsoleLogItem>();
    private static readonly List<string> AuditEntries = new List<string>();
    private static DateTime _lastWriteActivityUtc = DateTime.UtcNow;

    /// <summary>
    /// Cấu trúc lưu một dòng thông báo trong Unity Console.
    /// </summary>
    public struct ConsoleLogItem
    {
        public string Timestamp;
        public string Severity;
        public string Message;
        public string StackTrace;
    }

    /// <summary>
    /// Trạng thái công tắc cho phép AI thực hiện các gói Batch Tầng 2 (mặc định TẮT khi mở Unity).
    /// </summary>
    public static bool WriteEnabled
    {
        get
        {
            CheckAutoRelock();
            return SessionState.GetBool(WriteEnabledSessionKey, false);
        }
        set
        {
            SessionState.SetBool(WriteEnabledSessionKey, value);
            if (value)
            {
                _lastWriteActivityUtc = DateTime.UtcNow;
            }

            AntigravityBridgeServer.RefreshDiscoveryState();
        }
    }

    /// <summary>
    /// Tùy chọn bật hộp thoại xác nhận ngay trong Unity Editor trước mỗi gói Batch.
    /// </summary>
    public static bool RequirePopupConfirmation
    {
        get { return SessionState.GetBool(PopupConfirmSessionKey, false); }
        set { SessionState.SetBool(PopupConfirmSessionKey, value); }
    }

    // Dùng hàm static để tính số giây còn lại trước khi tự động khóa về READ_ONLY.
    /// <summary>
    /// Số giây còn lại trước khi công tắc ghi tự động tắt về READ_ONLY do không có hoạt động.
    /// </summary>
    public static int GetAutoRelockRemainingSeconds()
    {
        if (!SessionState.GetBool(WriteEnabledSessionKey, false))
        {
            return 0;
        }

        double elapsed = (DateTime.UtcNow - _lastWriteActivityUtc).TotalSeconds;
        double remaining = AutoRelockTimeoutSeconds - elapsed;
        return remaining > 0.0 ? (int)remaining : 0;
    }

    // Dùng hàm static để gia hạn thời gian hoạt động mỗi khi có một gói Batch hợp lệ được thực thi.
    /// <summary>
    /// Cập nhật mốc thời gian hoạt động ghi gần nhất và thêm dòng vào bảng Audit Log.
    /// </summary>
    public static void RecordWriteActivity(string operationId, string toolName, string status, string summary)
    {
        _lastWriteActivityUtc = DateTime.UtcNow;
        string entry = $"[{DateTime.Now:HH:mm:ss}] [{status}] {toolName} ({operationId}) — {summary}";
        lock (LogLock)
        {
            AuditEntries.Add(entry);
            if (AuditEntries.Count > MaxAuditEntries)
            {
                AuditEntries.RemoveAt(0);
            }
        }
    }

    // Dùng hàm static để tự động khóa công tắc ghi nếu quá 15 phút không có thao tác (ví dụ khi hết usage hoặc mất Wi-Fi).
    /// <summary>
    /// Kiểm tra và tự động tắt WriteEnabled về false nếu vượt quá 15 phút không tương tác.
    /// </summary>
    public static void CheckAutoRelock()
    {
        if (!SessionState.GetBool(WriteEnabledSessionKey, false))
        {
            return;
        }

        double elapsed = (DateTime.UtcNow - _lastWriteActivityUtc).TotalSeconds;
        if (elapsed >= AutoRelockTimeoutSeconds)
        {
            SessionState.SetBool(WriteEnabledSessionKey, false);
            RecordWriteActivity("AUTO_RELOCK", "System", "LOCKED", "Tự động khóa về READ_ONLY sau 15 phút không hoạt động.");
            AntigravityBridgeServer.RefreshDiscoveryState();
        }
    }

    // Dùng hàm static nhận callback từ Application.logMessageReceivedThreaded trên mọi luồng.
    /// <summary>
    /// Ghi nhận thông báo từ Unity Console vào bộ đệm vòng 500 dòng.
    /// </summary>
    public static void OnUnityLogMessageReceived(string condition, string stackTrace, LogType type)
    {
        string severity = "log";
        if (type == LogType.Error || type == LogType.Exception || type == LogType.Assert)
        {
            severity = "error";
        }
        else if (type == LogType.Warning)
        {
            severity = "warning";
        }

        ConsoleLogItem item = new ConsoleLogItem
        {
            Timestamp = DateTime.Now.ToString("HH:mm:ss"),
            Severity = severity,
            Message = condition ?? string.Empty,
            StackTrace = stackTrace ?? string.Empty
        };

        lock (LogLock)
        {
            ConsoleLogs.Add(item);
            if (ConsoleLogs.Count > MaxConsoleLogs)
            {
                ConsoleLogs.RemoveAt(0);
            }
        }
    }

    // Dùng hàm static để sao chép danh sách log theo bộ lọc một cách an toàn đa luồng.
    /// <summary>
    /// Lấy danh sách các dòng Console log gần nhất theo mức độ và từ khóa.
    /// </summary>
    public static List<ConsoleLogItem> GetFilteredConsoleLogs(string severityFilter, string substringFilter, int limit)
    {
        List<ConsoleLogItem> result = new List<ConsoleLogItem>();
        int maxCount = Mathf.Clamp(limit <= 0 ? 50 : limit, 1, MaxConsoleLogs);
        string sev = string.IsNullOrEmpty(severityFilter) ? "all" : severityFilter.ToLowerInvariant();
        string sub = string.IsNullOrEmpty(substringFilter) ? string.Empty : substringFilter.ToLowerInvariant();

        lock (LogLock)
        {
            for (int index = ConsoleLogs.Count - 1; index >= 0 && result.Count < maxCount; index--)
            {
                ConsoleLogItem item = ConsoleLogs[index];
                if (sev != "all" && item.Severity != sev)
                {
                    continue;
                }

                if (!string.IsNullOrEmpty(sub) && item.Message.ToLowerInvariant().IndexOf(sub, StringComparison.Ordinal) < 0)
                {
                    continue;
                }

                result.Add(item);
            }
        }

        return result;
    }

    // Dùng hàm static để hiển thị danh sách Audit Log trên cửa sổ điều khiển trong Unity.
    /// <summary>
    /// Lấy bản sao danh sách các thao tác ghi đã thực hiện trong phiên.
    /// </summary>
    public static List<string> GetAuditEntriesSnapshot()
    {
        lock (LogLock)
        {
            return new List<string>(AuditEntries);
        }
    }
}
