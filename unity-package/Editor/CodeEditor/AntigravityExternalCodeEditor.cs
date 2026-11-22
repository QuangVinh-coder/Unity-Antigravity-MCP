using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using Unity.CodeEditor;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Đăng ký Antigravity IDE làm External Script Editor chính thức của Unity 6, hiển thị nút Regenerate project files
/// và gọi bộ sinh LegacyStyleProjectGeneration để tạo đầy đủ file .sln và .csproj.
/// </summary>
[InitializeOnLoad]
public class AntigravityExternalCodeEditor : IExternalCodeEditor
{
    private const string EditorDisplayName = "Antigravity IDE";
    private const string GeneratorFactoryTypeName = "Microsoft.Unity.VisualStudio.Editor.GeneratorFactory, Unity.VisualStudio.Editor";
    private const string GeneratorStyleTypeName = "Microsoft.Unity.VisualStudio.Editor.GeneratorStyle, Unity.VisualStudio.Editor";
    private const int LegacyGeneratorStyleValue = 2;
    private const float RegenerateButtonWidth = 240.0f;

    // Đăng ký trình soạn thảo ngay khi Unity nạp domain Editor để xuất hiện trong Preferences > External Tools.
    static AntigravityExternalCodeEditor()
    {
        CodeEditor.Register(new AntigravityExternalCodeEditor());
    }

    /// <summary>
    /// Danh sách các bản cài đặt Antigravity IDE tự động phát hiện được trên máy.
    /// </summary>
    public CodeEditor.Installation[] Installations
    {
        get { return DiscoverInstallations(); }
    }

    /// <summary>
    /// Khởi tạo trình soạn thảo khi được chọn trong External Tools.
    /// </summary>
    public void Initialize(string editorInstallationPath)
    {
    }

    /// <summary>
    /// Nhận diện đường dẫn thực thi có phải là Antigravity IDE hay không.
    /// </summary>
    public bool TryGetInstallationForPath(string editorPath, out CodeEditor.Installation installation)
    {
        if (!string.IsNullOrEmpty(editorPath) && IsAntigravityExecutable(editorPath))
        {
            installation = new CodeEditor.Installation
            {
                Name = EditorDisplayName,
                Path = editorPath
            };
            return true;
        }

        installation = default;
        return false;
    }

    /// <summary>
    /// Vẽ nút Regenerate project files trong cửa sổ Edit > Preferences > External Tools khi chọn Antigravity IDE.
    /// </summary>
    public void OnGUI()
    {
        EditorGUILayout.Space();
        EditorGUILayout.HelpBox(
            "Antigravity IDE External Editor Bridge đã kích hoạt. Bấm nút bên dưới để tái sinh toàn bộ .csproj và .sln.",
            MessageType.Info);
        Rect buttonRect = EditorGUI.IndentedRect(EditorGUILayout.GetControlRect());
        buttonRect.width = RegenerateButtonWidth;
        if (GUI.Button(buttonRect, "Regenerate project files"))
        {
            SyncAll();
        }
    }

    /// <summary>
    /// Đồng bộ lại các file .csproj khi có script hoặc .asmdef thêm, xóa, di chuyển.
    /// </summary>
    public void SyncIfNeeded(string[] addedFiles, string[] deletedFiles, string[] movedFiles, string[] movedFromFiles, string[] importedFiles)
    {
        SyncSolutionAndProjects();
    }

    /// <summary>
    /// Tái sinh toàn bộ file .sln và .csproj cho dự án hiện tại.
    /// </summary>
    public void SyncAll()
    {
        SyncSolutionAndProjects();
    }

    /// <summary>
    /// Mở file script tại đúng dòng và cột trong Antigravity IDE khi double-click từ Unity Editor.
    /// </summary>
    public bool OpenProject(string filePath, int line, int column)
    {
        string editorExe = CodeEditor.CurrentEditorInstallation;
        if (string.IsNullOrEmpty(editorExe) || !File.Exists(editorExe))
        {
            return false;
        }

        string projectRoot = Directory.GetParent(Application.dataPath)?.FullName ?? string.Empty;
        int safeLine = line < 1 ? 1 : line;
        int safeColumn = column < 1 ? 1 : column;
        string arguments = string.IsNullOrEmpty(filePath)
            ? $"\"{projectRoot}\""
            : $"\"{projectRoot}\" --goto \"{filePath}:{safeLine}:{safeColumn}\"";

        ProcessStartInfo startInfo = new ProcessStartInfo
        {
            FileName = editorExe,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        Process.Start(startInfo);
        return true;
    }

    // Dùng hàm static để gọi trực tiếp từ MenuItem, MCP Bridge và dòng lệnh Unity batchmode -executeMethod.
    /// <summary>
    /// Gọi GeneratorFactory.GetInstance(GeneratorStyle.Legacy).Sync() để sinh chuẩn .sln và .csproj.
    /// </summary>
    [MenuItem("Tools/Antigravity MCP/Sync .csproj and .sln Files Now")]
    public static bool SyncSolutionAndProjects()
    {
        try
        {
            Type factoryType = Type.GetType(GeneratorFactoryTypeName);
            Type styleEnumType = Type.GetType(GeneratorStyleTypeName);
            if (factoryType == null || styleEnumType == null)
            {
                UnityEngine.Debug.LogWarning("[Antigravity MCP] Không tìm thấy package com.unity.ide.visualstudio để sinh .csproj.");
                return false;
            }

            MethodInfo getInstanceMethod = factoryType.GetMethod(
                "GetInstance",
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
            if (getInstanceMethod == null)
            {
                return false;
            }

            object legacyStyle = Enum.ToObject(styleEnumType, LegacyGeneratorStyleValue);
            object generator = getInstanceMethod.Invoke(null, new[] { legacyStyle });
            MethodInfo syncMethod = generator?.GetType().GetMethod("Sync", BindingFlags.Public | BindingFlags.Instance);
            if (syncMethod == null)
            {
                return false;
            }

            syncMethod.Invoke(generator, Array.Empty<object>());
            UnityEngine.Debug.Log("[Antigravity MCP] Đã tái sinh toàn bộ file .sln và .csproj thành công.");
            return true;
        }
        catch (Exception exception)
        {
            UnityEngine.Debug.LogError($"[Antigravity MCP] Lỗi khi sinh .csproj/.sln: {exception.Message}");
            return false;
        }
    }

    // Dùng hàm static nội bộ để kiểm tra tên file thực thi Antigravity không phụ thuộc trạng thái instance.
    private static bool IsAntigravityExecutable(string path)
    {
        string fileName = Path.GetFileName(path);
        return !string.IsNullOrEmpty(fileName) &&
               fileName.IndexOf("antigravity", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    // Dùng hàm static nội bộ để quét các đường dẫn cài đặt phổ biến của Antigravity IDE trên Windows.
    private static CodeEditor.Installation[] DiscoverInstallations()
    {
        List<CodeEditor.Installation> list = new List<CodeEditor.Installation>();
        string current = CodeEditor.CurrentEditorInstallation;
        if (!string.IsNullOrEmpty(current) && File.Exists(current) && IsAntigravityExecutable(current))
        {
            list.Add(new CodeEditor.Installation { Name = EditorDisplayName, Path = current });
        }

        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string candidate = Path.Combine(localAppData, "Programs", "Antigravity", "Antigravity.exe");
        if (File.Exists(candidate) && !string.Equals(candidate, current, StringComparison.OrdinalIgnoreCase))
        {
            list.Add(new CodeEditor.Installation { Name = EditorDisplayName, Path = candidate });
        }

        return list.ToArray();
    }
}
