#!/usr/bin/env node
// Bộ kiểm thử tự động toàn diện cho Unity 6 & C# Antigravity MCP Server (18 tools + 8 kịch bản an toàn/phục hồi lỗi):
//   1. Handshake MCP initialize & tools/list (đủ 9 Tier-1 + 9 Tier-2 = 18 tools)
//   2. Chốt Fail-Closed Tier 2: chặn 100% lệnh thiếu ownerApproved=true, thiếu approvalSummary hoặc sai operationId
//   3. Chống tạo trùng khi mất Wi-Fi (Idempotency Key + Operation Journal trên đĩa)
//   4. Rollback nguyên tử (Atomic Batch Rollback): lỗi bước #3 trong batch 4 bước -> rollback sạch bước 1..2
//   5. Phát hiện Owner bấm Ctrl+Z trong lúc mất mạng (UNDONE_BY_USER trong Operation Journal)
//   6. Auto-Relock Timeout (15 phút không tương tác tự khóa về 403 WRITE_LOCKED_IN_UNITY)
//   7. Phục hồi tự động khi Unity Domain Reload làm ngắt socket giữa lệnh sync_project_files / package_resolve
//   8. Dọn tệp discovery có PID chết & Chẩn đoán ngoại tuyến .asmdef vs .csproj trên repo thật Do an 3

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { handleJsonRpcMessage, handleToolCall } from "./index.mjs";
import { getInstanceFilePath, getJournalFilePath } from "./offline-tools.mjs";

function withTempMcpEnv(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-unity-mcp-test-"));
  const prevEnv = process.env.ANTIGRAVITY_UNITY_MCP_DIR;
  process.env.ANTIGRAVITY_UNITY_MCP_DIR = tmpDir;
  return Promise.resolve()
    .then(() => fn(tmpDir))
    .finally(() => {
      if (prevEnv === undefined) delete process.env.ANTIGRAVITY_UNITY_MCP_DIR;
      else process.env.ANTIGRAVITY_UNITY_MCP_DIR = prevEnv;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
}

function appendJournalLine(projectPath, entry) {
  const jPath = getJournalFilePath(projectPath);
  fs.mkdirSync(path.dirname(jPath), { recursive: true });
  fs.appendFileSync(jPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, "utf8");
}

function writeInstanceDiscovery(projectPath, info) {
  const iPath = getInstanceFilePath(projectPath);
  fs.mkdirSync(path.dirname(iPath), { recursive: true });
  fs.writeFileSync(iPath, JSON.stringify(info, null, 2), "utf8");
}

test("1. Handshake MCP initialize & tools/list trả đúng 18 tools (9 Tier-1 + 9 Tier-2)", async () => {
  const initRes = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal(initRes.result.protocolVersion, "2024-11-05");
  assert.equal(initRes.result.serverInfo.name, "unity_antigravity_mcp");

  const listRes = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  assert.equal(listRes.result.tools.length, 18);
  const names = listRes.result.tools.map((t) => t.name);
  assert.ok(names.includes("unity_batch_ui"));
  assert.ok(names.includes("unity_batch_animation"));
  assert.ok(names.includes("unity_batch_vfx_and_particle"));
  assert.ok(names.includes("unity_batch_package_and_project"));
  assert.ok(names.includes("unity_universal_serialized_batch"));
});

test("2. Fail-Closed Tier 2 Gate: chặn tuyệt đối mọi lệnh ghi thiếu ownerApproved=true, approvalSummary hoặc operationId", async () => {
  await withTempMcpEnv(async (tmp) => {
    const rNoApprove = await handleToolCall("unity_batch_ui", {
      projectPath: tmp,
      ownerApproved: false,
      approvalSummary: "Owner duyệt tạo Shop Panel",
      operationId: "shop-ui-01",
      operations: [{ action: "create_canvas", name: "MainCanvas" }],
    });
    assert.equal(rNoApprove.isError, true);
    assert.match(rNoApprove.content[0].text, /OWNER_APPROVAL_REQUIRED/);

    const rNoSummary = await handleToolCall("unity_batch_animation", {
      projectPath: tmp,
      ownerApproved: true,
      approvalSummary: "ok",
      operationId: "anim-01",
      operations: [],
    });
    assert.equal(rNoSummary.isError, true);
    assert.match(rNoSummary.content[0].text, /APPROVAL_SUMMARY_MISSING/);

    const rBadOpId = await handleToolCall("unity_batch_vfx_and_particle", {
      projectPath: tmp,
      ownerApproved: true,
      approvalSummary: "Owner duyệt tạo hiệu ứng nổ",
      operationId: "bad id with spaces!",
      operations: [],
    });
    assert.equal(rBadOpId.isError, true);
    assert.match(rBadOpId.content[0].text, /INVALID_OPERATION_ID/);
  });
});

test("3. Chống tạo trùng khi mất Wi-Fi (Idempotency) + Atomic Batch Rollback + Ctrl+Z (UNDONE_BY_USER) + Auto-Relock 403", async () => {
  await withTempMcpEnv(async (tmp) => {
    const mockLoopbackHeader = "mock-loopback-header-value";
    let writeEnabled = true;
    let lastWriteAt = Date.now();
    const autoRelockMs = 15 * 60 * 1000;
    const sceneObjects = new Map();
    const appliedOps = new Map();

    const server = http.createServer((req, res) => {
      if (req.headers["x-antigravity-token"] !== mockLoopbackHeader) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ errorCode: "UNAUTHORIZED", message: "Invalid token" }));
        return;
      }
      let bodyStr = "";
      req.on("data", (c) => (bodyStr += c));
      req.on("end", () => {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        if (Date.now() - lastWriteAt > autoRelockMs) {
          writeEnabled = false;
        }
        if (!writeEnabled) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              errorCode: "WRITE_LOCKED_IN_UNITY",
              message: "Allow AI Write Actions is OFF or auto-relocked after 15m inactivity.",
            })
          );
          return;
        }
        lastWriteAt = Date.now();

        // Kiểm tra Idempotency khi mạng rớt rồi gửi lại cùng operationId
        if (appliedOps.has(body.operationId)) {
          const prev = appliedOps.get(body.operationId);
          const stillExists = prev.createdIds.every((id) => sceneObjects.has(id));
          if (stillExists) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ...prev, idempotentReplay: true }));
            return;
          }
        }

        // Thực thi Atomic Batch với snapshot để rollback nếu bất kỳ bước nào lỗi
        const snapshot = new Map(sceneObjects);
        const createdIds = [];
        try {
          for (const op of body.operations || []) {
            if (op.action === "create_ugui_node" && op.name === "BROKEN_NODE") {
              throw new Error("Simulated failure at step 3: missing font asset");
            }
            const id = `go-${sceneObjects.size + 1}`;
            sceneObjects.set(id, { name: op.name || op.action });
            createdIds.push(id);
          }
          const resultPayload = {
            operationId: body.operationId,
            status: "APPLIED",
            createdIds,
            sceneObjectCount: sceneObjects.size,
          };
          appliedOps.set(body.operationId, resultPayload);
          appendJournalLine(tmp, resultPayload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(resultPayload));
        } catch (err) {
          // Undo.RevertAllDownToGroup: khôi phục hoàn toàn Scene về trạng thái trước batch!
          sceneObjects.clear();
          for (const [k, v] of snapshot.entries()) sceneObjects.set(k, v);
          appendJournalLine(tmp, {
            operationId: body.operationId,
            status: "ROLLED_BACK",
            error: err.message,
          });
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              errorCode: "BATCH_ROLLED_BACK",
              message: `Batch rolled back cleanly via Undo.RevertAllDownToGroup: ${err.message}`,
            })
          );
        }
      });
    });

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      writeInstanceDiscovery(tmp, { port, token: mockLoopbackHeader, pid: process.pid, writeEnabled: true });

      // 3a. Gọi lần 1 thành công (tạo 2 phần tử UI)
      const call1 = await handleToolCall("unity_batch_ui", {
        projectPath: tmp,
        ownerApproved: true,
        approvalSummary: "Owner duyệt tạo ShopPanel và Title",
        operationId: "shop-batch-01",
        operations: [
          { action: "create_ugui_node", uiType: "Panel", name: "ShopPanel" },
          { action: "create_ugui_node", uiType: "TMP_Text", name: "TitleText" },
        ],
      });
      const res1 = JSON.parse(call1.content[0].text);
      assert.equal(res1.ok, true);
      assert.equal(res1.result.sceneObjectCount, 2);
      assert.equal(res1.result.idempotentReplay, undefined);

      // 3b. Giả lập mất Wi-Fi lúc nhận response nên AI gửi lại y hệt operationId="shop-batch-01" -> KHÔNG tạo đúp!
      const call2 = await handleToolCall("unity_batch_ui", {
        projectPath: tmp,
        ownerApproved: true,
        approvalSummary: "Owner duyệt tạo ShopPanel và Title",
        operationId: "shop-batch-01",
        operations: [
          { action: "create_ugui_node", uiType: "Panel", name: "ShopPanel" },
          { action: "create_ugui_node", uiType: "TMP_Text", name: "TitleText" },
        ],
      });
      const res2 = JSON.parse(call2.content[0].text);
      assert.equal(res2.ok, true);
      assert.equal(res2.result.idempotentReplay, true);
      assert.equal(sceneObjects.size, 2, "Không được tạo trùng GameObject thứ 3, 4!");

      // 3c. Atomic Batch Rollback: batch 3 bước nhưng bước 3 bị lỗi -> bước 1, 2 phải được rollback, tổng số object vẫn là 2!
      const callFail = await handleToolCall("unity_batch_ui", {
        projectPath: tmp,
        ownerApproved: true,
        approvalSummary: "Owner duyệt thử batch lỗi giữa chừng",
        operationId: "shop-batch-02-broken",
        operations: [
          { action: "create_ugui_node", uiType: "Button", name: "BuyBtn1" },
          { action: "create_ugui_node", uiType: "Button", name: "BuyBtn2" },
          { action: "create_ugui_node", uiType: "TMP_Text", name: "BROKEN_NODE" },
        ],
      });
      assert.equal(callFail.isError, true);
      assert.equal(sceneObjects.size, 2, "Sau khi lỗi bước 3, bước 1 và 2 phải được rollback sạch về 2 object ban đầu!");

      // 3d. Giả lập Owner bấm Ctrl+Z trên Unity (Undo.undoRedoPerformed ghi UNDONE_BY_USER vào Journal)
      appendJournalLine(tmp, {
        operationId: "shop-batch-01",
        status: "UNDONE_BY_USER",
        note: "Owner pressed Ctrl+Z in Unity Editor",
      });
      const journalCall = await handleToolCall("unity_get_operation_journal", { projectPath: tmp });
      const journalData = JSON.parse(journalCall.content[0].text);
      const b1Entry = journalData.entries.find((e) => e.operationId === "shop-batch-01");
      const b2Entry = journalData.entries.find((e) => e.operationId === "shop-batch-02-broken");
      assert.equal(b1Entry.status, "UNDONE_BY_USER");
      assert.equal(b2Entry.status, "ROLLED_BACK");

      // 3e. Giả lập hết usage 5 tiếng quay lại (quá 15 phút Auto-Relock Timeout) -> tự động khóa 403 WRITE_LOCKED_IN_UNITY!
      lastWriteAt = Date.now() - 20 * 60 * 1000;
      const callLocked = await handleToolCall("unity_batch_ui", {
        projectPath: tmp,
        ownerApproved: true,
        approvalSummary: "Owner duyệt sau 20 phút",
        operationId: "shop-batch-03-late",
        operations: [{ action: "create_ugui_node", uiType: "Panel", name: "LatePanel" }],
      });
      assert.equal(callLocked.isError, true);
      assert.match(callLocked.content[0].text, /WRITE_LOCKED_IN_UNITY/);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("4. Phục hồi tự động khi Unity Domain Reload làm đứt kết nối HTTP giữa lệnh sync_project_files", async () => {
  await withTempMcpEnv(async (tmp) => {
    const token = "reload-token";
    const server = http.createServer((req, res) => {
      // Giả lập Unity vừa ghi APPLIED vào Journal xong thì AppDomain reload làm đứt socket trước khi trả HTTP response!
      appendJournalLine(tmp, {
        operationId: "sync-csproj-reload-01",
        status: "APPLIED",
        syncedProjects: ["Assembly-CSharp.csproj", "TestNew.csproj", "TestNew.EditModeTests.csproj"],
      });
      req.socket.destroy();
    });

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      writeInstanceDiscovery(tmp, { port, token, pid: process.pid, writeEnabled: true });

      const res = await handleToolCall("unity_batch_package_and_project", {
        projectPath: tmp,
        ownerApproved: true,
        approvalSummary: "Owner duyệt tái sinh .csproj",
        operationId: "sync-csproj-reload-01",
        operations: [{ action: "sync_project_files" }],
      });
      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.recoveredFromJournalAfterReload, true);
      assert.equal(parsed.result.status, "APPLIED");
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("5. Tự động phát hiện và dọn tệp discovery có PID chết + Chẩn đoán thực tế .asmdef vs .csproj", async () => {
  await withTempMcpEnv(async (tmp) => {
    // Ghi PID không tồn tại (99999999)
    writeInstanceDiscovery(tmp, { port: 54321, token: "dead", pid: 99999999, writeEnabled: false });
    const statusCall = await handleToolCall("unity_get_editor_status", { projectPath: tmp });
    const statusData = JSON.parse(statusCall.content[0].text);
    assert.equal(statusData.connected, false);
    assert.equal(statusData.staleCleaned, true);
    assert.equal(fs.existsSync(getInstanceFilePath(tmp)), false, "File discovery của PID chết phải được xóa sạch!");

    // Tạo một dự án Unity giả lập trong %TEMP% có 2 .asmdef nhưng mới sinh 1 .csproj -> phát hiện đúng rủi ro CS0229
    fs.mkdirSync(path.join(tmp, "Assets/Scripts/Core"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "Assets/Scripts/UI"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "Assets/Scripts/Core/GameCore.asmdef"), JSON.stringify({ name: "GameCore" }), "utf8");
    fs.writeFileSync(path.join(tmp, "Assets/Scripts/UI/GameUI.asmdef"), JSON.stringify({ name: "GameUI" }), "utf8");
    fs.writeFileSync(path.join(tmp, "GameCore.csproj"), "<Project />", "utf8");

    const diagCall = await handleToolCall("unity_inspect_csharp_project", {
      projectPath: tmp,
    });
    const diag = JSON.parse(diagCall.content[0].text);
    assert.equal(diag.asmdefCount, 2);
    assert.equal(diag.missingCsprojCount, 1);
    assert.equal(diag.hasCs0229Risk, true);
    assert.equal(diag.missingCsprojAssemblies[0].assemblyName, "GameUI");
  });
});

test("6. Hướng 2 Networking (OL-2026-11-22-A27): unity_universal_serialized_batch gán ObjectReference ('hierarchy:...', 'asset:...'), kiểm tra EditorBuildSettings.scenes, cảnh báo PRE-3 duplicate root & unity_run_tests", async () => {
  await withTempMcpEnv(async (tmp) => {
    const token = "net-token-06";
    let receivedBatchPayload = null;
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (req.url === "/api/read/hierarchy") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              sceneName: "Online_Level1_Main",
              duplicateRootWarnings: ["Duplicate root names detected (PRE-3 risk): WaveManager (1)"],
              nodes: [
                {
                  name: "WaveManager",
                  path: "WaveManager",
                  networkWarnings: ["Has NetworkBehaviour (WaveManager) without NetworkObject on GameObject or parents."],
                },
              ],
            })
          );
          return;
        }
        if (req.url === "/api/batch/universal-serialized") {
          receivedBatchPayload = JSON.parse(raw);
          appendJournalLine(tmp, {
            operationId: receivedBatchPayload.operationId,
            status: "APPLIED",
            wiredReferences: ["hierarchy:Canvas/StartWaveBtn#Button", "asset:Assets/Prefabs/NetworkRunnerPrefab.prefab"],
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "APPLIED", stepsApplied: 1 }));
          return;
        }
        if (req.url === "/api/read/run-tests") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ triggered: true, runGuid: "test-guid-123", testMode: "EditMode" }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      writeInstanceDiscovery(tmp, { port, token, pid: process.pid, writeEnabled: true });

      const hierCall = await handleToolCall("unity_get_hierarchy", { projectPath: tmp });
      const hierData = JSON.parse(hierCall.content[0].text);
      assert.equal(hierData.duplicateRootWarnings.length, 1);
      assert.match(hierData.duplicateRootWarnings[0], /PRE-3/);

      const wireCall = await handleToolCall("unity_universal_serialized_batch", {
        projectPath: tmp,
        ownerApproved: true,
        approvalSummary: "Owner duyệt gán ObjectReference cho PhotonSessionBootstrap & WaveManager",
        operationId: "net-wire-level1-01",
        operations: [
          {
            hierarchyPath: "PhotonBootstrap",
            componentType: "PhotonSessionBootstrap",
            properties: {
              _runnerPrefab: "asset:Assets/Prefabs/NetworkRunnerPrefab.prefab",
              _startWaveButton: "hierarchy:Canvas/StartWaveBtn#Button",
              _defaultMode: "Server",
            },
          },
        ],
      });
      const wireRes = JSON.parse(wireCall.content[0].text);
      assert.equal(wireRes.ok, true);
      assert.equal(
        receivedBatchPayload.operations[0].properties._startWaveButton,
        "hierarchy:Canvas/StartWaveBtn#Button"
      );

      const testCall = await handleToolCall("unity_run_tests", {
        projectPath: tmp,
        testMode: "EditMode",
        testFilter: "MatchTestNewEditModeTests",
      });
      const testData = JSON.parse(testCall.content[0].text);
      assert.equal(testData.triggered, true);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
