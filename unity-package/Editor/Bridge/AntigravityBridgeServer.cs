using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Máy chủ HTTP Loopback (127.0.0.1) chạy trong Unity Editor, xác thực bằng mã X-Antigravity-Token 256-bit
/// và điều phối toàn bộ lời gọi Unity API về luồng chính qua EditorApplication.update.
/// </summary>
[InitializeOnLoad]
public static class AntigravityBridgeServer
{
    private const string TokenHeaderName = "X-Antigravity-Token";
    private const int TokenByteLength = 32;
    private const int MaxRequestsPerFrame = 4;

    private static readonly ConcurrentQueue<PendingHttpRequest> MainThreadQueue = new ConcurrentQueue<PendingHttpRequest>();
    private static HttpListener _listener;
    private static Thread _listenerThread;
    private static volatile bool _isRunning;
    private static int _boundPort;
    private static string _sessionToken;

    private sealed class PendingHttpRequest
    {
        public string Method;
        public string Path;
        public string Body;
        public HttpListenerContext Context;
    }

    // Tự động khởi chạy máy chủ loopback khi Unity Editor nạp domain và dọn sạch trước khi reload hoặc thoát.
    static AntigravityBridgeServer()
    {
        if (Application.isBatchMode)
        {
            return;
        }

        Application.logMessageReceivedThreaded += AntigravityBridgeState.OnUnityLogMessageReceived;
        Undo.undoRedoPerformed += AntigravityProjectPaths.OnUnityUndoRedoPerformed;
        AssemblyReloadEvents.beforeAssemblyReload += StopServer;
        EditorApplication.quitting += StopServer;
        EditorApplication.update += ProcessMainThreadQueue;
        StartServer();
    }

    /// <summary>
    /// Trạng thái máy chủ Bridge có đang lắng nghe hay không.
    /// </summary>
    public static bool IsRunning
    {
        get { return _isRunning; }
    }

    /// <summary>
    /// Cổng loopback 127.0.0.1 đang mở của phiên Unity hiện tại.
    /// </summary>
    public static int BoundPort
    {
        get { return _boundPort; }
    }

    // Dùng hàm static để khởi động hoặc khởi động lại máy chủ HTTP trên cổng trống của 127.0.0.1.
    /// <summary>
    /// Khởi tạo cổng rảnh trên 127.0.0.1, sinh token 256-bit và ghi tệp discovery cho MCP Server.
    /// </summary>
    public static void StartServer()
    {
        if (_isRunning)
        {
            return;
        }

        try
        {
            _boundPort = AllocateFreeLoopbackPort();
            _sessionToken = GenerateRandomTokenHex();
            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://127.0.0.1:{_boundPort}/");
            _listener.Start();
            _isRunning = true;

            AntigravityProjectPaths.WriteDiscoveryFile(_boundPort, _sessionToken, AntigravityBridgeState.WriteEnabled);

            _listenerThread = new Thread(ListenLoop)
            {
                IsBackground = true,
                Name = "AntigravityUnityMcpListener"
            };
            _listenerThread.Start();
        }
        catch (Exception exception)
        {
            _isRunning = false;
            UnityEngine.Debug.LogWarning($"[Antigravity MCP] Không mở được cổng loopback: {exception.Message}");
        }
    }

    // Dùng hàm static để đóng kết nối sạch sẽ khi Unity reload C# hoặc tắt Editor.
    /// <summary>
    /// Dừng máy chủ HTTP và xóa tệp discovery.
    /// </summary>
    public static void StopServer()
    {
        _isRunning = false;
        AntigravityProjectPaths.DeleteDiscoveryFile();
        try
        {
            _listener?.Stop();
            _listener?.Close();
        }
        catch
        {
        }

        _listener = null;
    }

    // Dùng hàm static để đồng bộ lại trạng thái công tắc ghi vào tệp discovery trên đĩa.
    /// <summary>
    /// Cập nhật lại tệp discovery khi công tắc Allow AI Write Actions thay đổi.
    /// </summary>
    public static void RefreshDiscoveryState()
    {
        if (_isRunning && _boundPort > 0 && !string.IsNullOrEmpty(_sessionToken))
        {
            AntigravityProjectPaths.WriteDiscoveryFile(_boundPort, _sessionToken, AntigravityBridgeState.WriteEnabled);
        }
    }

    // Dùng hàm static chạy trên luồng nền chỉ để nhận socket và kiểm tra bảo mật token/Origin trước khi đẩy vào hàng đợi luồng chính.
    private static void ListenLoop()
    {
        while (_isRunning && _listener != null && _listener.IsListening)
        {
            HttpListenerContext context = null;
            try
            {
                context = _listener.GetContext();
                if (!ValidateRequestSecurity(context))
                {
                    WriteJsonResponse(context, 401, "{\"errorCode\":\"UNAUTHORIZED\",\"message\":\"Invalid or missing X-Antigravity-Token or forbidden Origin.\"}");
                    continue;
                }

                string body = string.Empty;
                if (context.Request.HasEntityBody)
                {
                    using (StreamReader reader = new StreamReader(context.Request.InputStream, Encoding.UTF8))
                    {
                        body = reader.ReadToEnd();
                    }
                }

                MainThreadQueue.Enqueue(new PendingHttpRequest
                {
                    Method = context.Request.HttpMethod,
                    Path = context.Request.Url.AbsolutePath,
                    Body = body,
                    Context = context
                });
            }
            catch
            {
                if (!_isRunning)
                {
                    break;
                }
            }
        }
    }

    // Dùng hàm static chạy mỗi nhịp EditorApplication.update để thực thi mọi API Unity an toàn trên luồng chính.
    private static void ProcessMainThreadQueue()
    {
        AntigravityBridgeState.CheckAutoRelock();
        int processed = 0;
        while (processed < MaxRequestsPerFrame && MainThreadQueue.TryDequeue(out PendingHttpRequest req))
        {
            processed++;
            try
            {
                int statusCode;
                string responseJson = RouteMainThreadRequest(req.Path, req.Body, out statusCode);
                WriteJsonResponse(req.Context, statusCode, responseJson);
            }
            catch (Exception exception)
            {
                string safeMsg = AntigravityProjectPaths.EscapeJson(exception.Message);
                WriteJsonResponse(req.Context, 500, $"{{\"errorCode\":\"INTERNAL_ERROR\",\"message\":\"{safeMsg}\"}}");
            }
        }
    }

    // Dùng hàm static định tuyến giữa nhóm API chỉ đọc (/api/read/*) và nhóm API Batch Tầng 2 (/api/batch/*).
    private static string RouteMainThreadRequest(string path, string body, out int statusCode)
    {
        if (path.StartsWith("/api/read/", StringComparison.OrdinalIgnoreCase))
        {
            return AntigravityReadHandlers.HandleReadRequest(path, body, out statusCode);
        }

        if (path.StartsWith("/api/batch/", StringComparison.OrdinalIgnoreCase))
        {
            return AntigravityBatchDispatcher.HandleBatchRequest(path, body, out statusCode);
        }

        statusCode = 404;
        return "{\"errorCode\":\"NOT_FOUND\",\"message\":\"Endpoint not found.\"}";
    }

    // Dùng hàm static kiểm tra chống tấn công CSRF từ trình duyệt (cấm header Origin) và so khớp token hằng thời gian.
    private static bool ValidateRequestSecurity(HttpListenerContext context)
    {
        if (!string.IsNullOrEmpty(context.Request.Headers["Origin"]))
        {
            return false;
        }

        string providedToken = context.Request.Headers[TokenHeaderName];
        if (string.IsNullOrEmpty(providedToken) || string.IsNullOrEmpty(_sessionToken))
        {
            return false;
        }

        byte[] a = Encoding.UTF8.GetBytes(providedToken);
        byte[] b = Encoding.UTF8.GetBytes(_sessionToken);
        if (a.Length != b.Length)
        {
            return false;
        }

        int diff = 0;
        for (int index = 0; index < a.Length; index++)
        {
            diff |= a[index] ^ b[index];
        }

        return diff == 0;
    }

    // Dùng hàm static để ghi JSON trả về và đóng luồng HTTP.
    private static void WriteJsonResponse(HttpListenerContext context, int statusCode, string json)
    {
        try
        {
            byte[] payload = Encoding.UTF8.GetBytes(json ?? "{}");
            context.Response.StatusCode = statusCode;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.ContentLength64 = payload.Length;
            context.Response.OutputStream.Write(payload, 0, payload.Length);
            context.Response.OutputStream.Close();
        }
        catch
        {
        }
    }

    // Dùng hàm static mượn TcpListener(IPAddress.Loopback, 0) để hệ điều hành cấp một cổng rảnh không đụng bất kỳ ứng dụng nào.
    private static int AllocateFreeLoopbackPort()
    {
        TcpListener tempListener = new TcpListener(IPAddress.Loopback, 0);
        tempListener.Start();
        int port = ((IPEndPoint)tempListener.LocalEndpoint).Port;
        tempListener.Stop();
        return port;
    }

    // Dùng hàm static sinh chuỗi hex ngẫu nhiên 256-bit bằng bộ sinh mật mã của hệ điều hành.
    private static string GenerateRandomTokenHex()
    {
        byte[] bytes = new byte[TokenByteLength];
        using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
        {
            rng.GetBytes(bytes);
        }

        StringBuilder builder = new StringBuilder(TokenByteLength * 2);
        for (int index = 0; index < bytes.Length; index++)
        {
            builder.Append(bytes[index].ToString("x2"));
        }

        return builder.ToString();
    }
}
