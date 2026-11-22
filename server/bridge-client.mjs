// Cầu nối HTTP Loopback (127.0.0.1 + X-Antigravity-Token) từ Node.js MCP Server sang Unity Editor Bridge:
//   - Kiểm tra khóa Tier 2 (ownerApproved === true, approvalSummary, operationId) TRƯỚC khi gửi request
//   - Phát hiện PID Unity đã tắt để tự dọn file discovery cũ
//   - Tự động chờ & đối chiếu Operation Journal khi Unity thực hiện Domain Reload giữa lệnh sync/refresh

import fs from "node:fs";
import {
  normalizeProjectPath,
  computeProjectHash,
  getInstanceFilePath,
  readOperationJournal,
} from "./offline-tools.mjs";

export function validateTier2Approval(toolName, args) {
  if (!args || typeof args !== "object") {
    return {
      ok: false,
      errorCode: "OWNER_APPROVAL_REQUIRED",
      message: `[Fail-Closed Gate] Tool "${toolName}" thuộc Tầng 2 (Ghi/Tương tác Unity) nên bắt buộc phải có tham số.`,
    };
  }
  if (args.ownerApproved !== true) {
    return {
      ok: false,
      errorCode: "OWNER_APPROVAL_REQUIRED",
      message: `[Fail-Closed Gate] Từ chối thực thi "${toolName}": tham số "ownerApproved" phải là true. Hãy trình bày kế hoạch gói Batch và hỏi owner duyệt trong khung chat trước khi gọi tool Tầng 2.`,
    };
  }
  const summary = typeof args.approvalSummary === "string" ? args.approvalSummary.trim() : "";
  if (summary.length < 5) {
    return {
      ok: false,
      errorCode: "APPROVAL_SUMMARY_MISSING",
      message: `[Fail-Closed Gate] Từ chối thực thi "${toolName}": "approvalSummary" phải ghi rõ nội dung owner đã duyệt (>= 5 ký tự).`,
    };
  }
  const opId = typeof args.operationId === "string" ? args.operationId.trim() : "";
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(opId)) {
    return {
      ok: false,
      errorCode: "INVALID_OPERATION_ID",
      message: `[Fail-Closed Gate] Từ chối thực thi "${toolName}": "operationId" bắt buộc có độ dài 3–128 ký tự thuộc [A-Za-z0-9._:-] để chống tạo trùng khi rớt Wi-Fi hoặc hết usage.`,
    };
  }
  return { ok: true, operationId: opId, approvalSummary: summary };
}

function isProcessAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

export function discoverUnityInstance(rawProjectPath) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const instanceFile = getInstanceFilePath(projectPath);
  if (!fs.existsSync(instanceFile)) {
    return {
      running: false,
      projectPath,
      projectHash: computeProjectHash(projectPath),
      instanceFile,
      reason: "Không tìm thấy tệp phiên làm việc của Unity Editor Bridge (Unity đang đóng hoặc chưa cài gói com.vinh.antigravity-unity-bridge).",
    };
  }

  let info = null;
  try {
    info = JSON.parse(fs.readFileSync(instanceFile, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    return {
      running: false,
      projectPath,
      instanceFile,
      reason: `Tệp discovery bị lỗi định dạng JSON: ${err.message}`,
    };
  }

  if (!info || typeof info.port !== "number" || typeof info.token !== "string") {
    return {
      running: false,
      projectPath,
      instanceFile,
      reason: "Tệp discovery thiếu port hoặc token.",
    };
  }

  if (info.pid && !isProcessAlive(info.pid)) {
    try {
      fs.unlinkSync(instanceFile);
    } catch {}
    return {
      running: false,
      staleCleaned: true,
      projectPath,
      instanceFile,
      reason: `Tiến trình Unity cũ (PID ${info.pid}) không còn chạy. Đã tự động dọn sạch tệp discovery cũ.`,
    };
  }

  return {
    running: true,
    projectPath,
    instanceFile,
    host: "127.0.0.1",
    port: info.port,
    token: info.token,
    pid: info.pid || null,
    unityVersion: info.unityVersion || null,
    writeEnabled: Boolean(info.writeEnabled),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callUnityBridge(rawProjectPath, endpoint, method = "POST", body = null, options = {}) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const timeoutMs = options.timeoutMs || 8000;
  const allowDomainReloadRetry = Boolean(options.allowDomainReloadRetry);
  const maxAttempts = allowDomainReloadRetry ? 6 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const disc = discoverUnityInstance(projectPath);
    if (!disc.running) {
      if (attempt > 1 && body?.operationId) {
        const journal = readOperationJournal(projectPath, 5, body.operationId);
        if (journal.entries.length > 0) {
          return {
            ok: true,
            status: 200,
            recoveredFromJournalAfterReload: true,
            data: journal.entries[0],
          };
        }
      }
      if (attempt < maxAttempts) {
        await sleep(350);
        continue;
      }
      return {
        ok: false,
        status: 503,
        errorCode: "UNITY_EDITOR_NOT_CONNECTED",
        staleCleaned: Boolean(disc.staleCleaned),
        message: disc.reason,
      };
    }

    const url = `http://127.0.0.1:${disc.port}${endpoint}`;
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Antigravity-Token": disc.token,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { rawText: text };
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          errorCode: parsed?.errorCode || `HTTP_${res.status}`,
          message: parsed?.message || `Unity Bridge trả mã lỗi HTTP ${res.status}`,
          data: parsed,
        };
      }
      return {
        ok: true,
        status: res.status,
        data: parsed,
      };
    } catch (err) {
      const isConnInterrupted =
        /ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET|fetch failed|socket hang up/i.test(String(err?.cause?.code || err?.message || err));
      if (allowDomainReloadRetry && isConnInterrupted) {
        if (body?.operationId) {
          const journal = readOperationJournal(projectPath, 5, body.operationId);
          if (journal.entries.length > 0 && journal.entries[0].status === "APPLIED") {
            return {
              ok: true,
              status: 200,
              recoveredFromJournalAfterReload: true,
              data: journal.entries[0],
            };
          }
        }
        if (attempt < maxAttempts) {
          await sleep(350);
          continue;
        }
      }
      return {
        ok: false,
        status: 503,
        errorCode: "BRIDGE_CONNECTION_FAILED",
        message: `Không kết nối được tới Unity Bridge tại ${url}: ${err.message}`,
      };
    }
  }
}
