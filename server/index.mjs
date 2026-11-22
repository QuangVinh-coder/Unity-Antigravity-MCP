#!/usr/bin/env node
// Máy chủ MCP (Model Context Protocol) JSON-RPC 2.0 qua Stdio cho Unity 6 & C# trên Antigravity IDE.
// Hỗ trợ tự động cả newline-delimited JSON-RPC (chuẩn Antigravity IDE) lẫn Content-Length header framing.

import { ALL_TOOLS, TIER2_TOOL_NAMES } from "./tool-schemas.mjs";
import {
  normalizeProjectPath,
  inspectCsharpProject,
  listPackagesOffline,
  findAssetsOffline,
  readOperationJournal,
} from "./offline-tools.mjs";
import { validateTier2Approval, discoverUnityInstance, callUnityBridge } from "./bridge-client.mjs";

const SERVER_INFO = {
  name: "unity_antigravity_mcp",
  version: "1.0.0",
};

const TIER2_ENDPOINT_MAP = {
  unity_batch_scene_and_prefab: "/api/batch/scene-prefab",
  unity_batch_ui: "/api/batch/ui",
  unity_batch_animation: "/api/batch/animation",
  unity_batch_vfx_and_particle: "/api/batch/vfx-particle",
  unity_batch_assets_and_so: "/api/batch/assets-so",
  unity_batch_package_and_project: "/api/batch/package-project",
  unity_universal_serialized_batch: "/api/batch/universal-serialized",
  unity_rollback_batch: "/api/batch/rollback",
  unity_save_open_scene: "/api/batch/save-scene",
};

function formatToolResult(payload, isError = false) {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

export async function handleToolCall(toolName, rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  const projectPath = normalizeProjectPath(args.projectPath || process.cwd());

  // 1. Kiểm tra khóa cứng Tier 2 trước khi làm bất cứ việc gì
  if (TIER2_TOOL_NAMES.has(toolName)) {
    const gate = validateTier2Approval(toolName, args);
    if (!gate.ok) {
      return formatToolResult(
        {
          ok: false,
          tool: toolName,
          errorCode: gate.errorCode,
          message: gate.message,
        },
        true
      );
    }

    const endpoint = TIER2_ENDPOINT_MAP[toolName];
    const allowDomainReloadRetry =
      toolName === "unity_batch_package_and_project" || toolName === "unity_batch_assets_and_so";
    const res = await callUnityBridge(projectPath, endpoint, "POST", { ...args, projectPath }, { allowDomainReloadRetry });
    if (!res.ok) {
      return formatToolResult(
        {
          ok: false,
          tool: toolName,
          operationId: args.operationId,
          status: res.status,
          errorCode: res.errorCode,
          message: res.message,
          details: res.data || null,
        },
        true
      );
    }
    return formatToolResult({
      ok: true,
      tool: toolName,
      operationId: args.operationId,
      ...(res.recoveredFromJournalAfterReload ? { recoveredFromJournalAfterReload: true } : {}),
      result: res.data,
    });
  }

  // 2. Xử lý 9 công cụ Tier 1 (Chỉ đọc / Chẩn đoán)
  switch (toolName) {
    case "unity_inspect_csharp_project":
      return formatToolResult(inspectCsharpProject(projectPath));

    case "unity_get_operation_journal":
      return formatToolResult(readOperationJournal(projectPath, args.limit, args.operationId));

    case "unity_get_editor_status": {
      const disc = discoverUnityInstance(projectPath);
      if (!disc.running) {
        return formatToolResult({
          connected: false,
          ...disc,
          csharpDiagnosis: inspectCsharpProject(projectPath),
        });
      }
      const res = await callUnityBridge(projectPath, "/api/read/status", "GET");
      if (!res.ok) {
        return formatToolResult({
          connected: false,
          projectPath,
          errorCode: res.errorCode,
          message: res.message,
        });
      }
      return formatToolResult({
        connected: true,
        projectPath,
        ...res.data,
      });
    }

    case "unity_list_packages": {
      const disc = discoverUnityInstance(projectPath);
      if (disc.running) {
        const res = await callUnityBridge(projectPath, "/api/read/packages", "GET");
        if (res.ok) return formatToolResult({ mode: "live-editor", ...res.data });
      }
      return formatToolResult({ mode: "offline-manifest", ...listPackagesOffline(projectPath) });
    }

    case "unity_find_assets_and_types": {
      const disc = discoverUnityInstance(projectPath);
      if (disc.running) {
        const res = await callUnityBridge(projectPath, "/api/read/find-assets", "POST", args);
        if (res.ok) return formatToolResult(res.data);
      }
      return formatToolResult(findAssetsOffline(projectPath, args.query, args.assetType, args.limit));
    }

    case "unity_get_console_logs": {
      const res = await callUnityBridge(projectPath, "/api/read/console-logs", "POST", args);
      return formatToolResult(res.ok ? res.data : res, !res.ok);
    }

    case "unity_get_hierarchy": {
      const res = await callUnityBridge(projectPath, "/api/read/hierarchy", "POST", args);
      return formatToolResult(res.ok ? res.data : res, !res.ok);
    }

    case "unity_inspect_object_deep": {
      const res = await callUnityBridge(projectPath, "/api/read/inspect-object", "POST", args);
      return formatToolResult(res.ok ? res.data : res, !res.ok);
    }

    case "unity_run_tests": {
      const res = await callUnityBridge(projectPath, "/api/read/run-tests", "POST", args, { timeoutMs: 30000 });
      return formatToolResult(res.ok ? res.data : res, !res.ok);
    }

    default:
      return formatToolResult({ ok: false, errorCode: "UNKNOWN_TOOL", message: `Unknown tool: ${toolName}` }, true);
  }
}

export async function handleJsonRpcMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const id = msg.id !== undefined ? msg.id : null;
  const method = typeof msg.method === "string" ? msg.method : "";
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};

  if (method === "notifications/initialized" || method.startsWith("notifications/")) {
    return null;
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: SERVER_INFO,
      },
    };
  }
  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: ALL_TOOLS,
      },
    };
  }
  if (method === "tools/call") {
    const toolName = typeof params.name === "string" ? params.name : "";
    const toolArgs = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
    try {
      const result = await handleToolCall(toolName, toolArgs);
      return {
        jsonrpc: "2.0",
        id,
        result,
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  if (id !== null) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }
  return null;
}

// Khởi chạy Stdio loop khi file được gọi trực tiếp
const isDirectRun =
  process.argv[1] &&
  import.meta.url.toLowerCase().endsWith(process.argv[1].replaceAll("\\", "/").toLowerCase());

if (isDirectRun) {
  let buffer = Buffer.alloc(0);
  let useContentLengthFraming = false;

  function sendResponse(respObj) {
    if (!respObj) return;
    const json = JSON.stringify(respObj);
    if (useContentLengthFraming) {
      const byteLen = Buffer.byteLength(json, "utf8");
      process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
    } else {
      process.stdout.write(`${json}\n`);
    }
  }

  async function processIncomingBuffer() {
    while (buffer.length > 0) {
      const headerMatch = buffer.toString("utf8", 0, Math.min(buffer.length, 64)).match(/^Content-Length:\s*(\d+)\r?\n/i);
      if (headerMatch) {
        useContentLengthFraming = true;
        const sepIdx = buffer.indexOf("\r\n\r\n");
        const altSepIdx = buffer.indexOf("\n\n");
        const headerEnd = sepIdx >= 0 ? sepIdx + 4 : altSepIdx >= 0 ? altSepIdx + 2 : -1;
        if (headerEnd < 0) return;
        const contentLen = Number(headerMatch[1]);
        if (buffer.length < headerEnd + contentLen) return;
        const bodyStr = buffer.toString("utf8", headerEnd, headerEnd + contentLen);
        buffer = buffer.subarray(headerEnd + contentLen);
        try {
          const parsed = JSON.parse(bodyStr);
          const resp = await handleJsonRpcMessage(parsed);
          sendResponse(resp);
        } catch {}
      } else {
        const nlIdx = buffer.indexOf(0x0a); // '\n'
        if (nlIdx < 0) return;
        const line = buffer.toString("utf8", 0, nlIdx).trim();
        buffer = buffer.subarray(nlIdx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          const resp = await handleJsonRpcMessage(parsed);
          sendResponse(resp);
        } catch {}
      }
    }
  }

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    processIncomingBuffer();
  });
}
