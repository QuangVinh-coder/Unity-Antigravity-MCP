#!/usr/bin/env node
// Mở một thread/session Codex mới cho một milestone thực thi hoặc cross-audit (CPG-02, TW-11).
// Hỗ trợ Write-Ahead Checkpoint vào BRANCH_MANIFEST.json khi truyền --branch <branchPath> (OL-2026-11-22-A18, A19).
//
// Cách gọi:
//   node .agents/skills/agent-orchestrate/scripts/new_codex_thread.mjs <threadName> <model> <effort> <promptFile> [outputFile] [--branch <branchPath>]
//
// Exit codes:
//   0 = Hoàn tất (hoặc BLOCKED: plan sạch)
//   1 = Lỗi thực thi khác
//   2 = Sai tham số / vi phạm bảng model CPG-02
//   3 = PAUSED_QUOTA (hết usage / rate limit 429 — đã lưu threadId vào BRANCH_MANIFEST.json để resume sau)
//   4 = PAUSED_NETWORK (mất mạng / Wi-Fi — đã lưu threadId vào BRANCH_MANIFEST.json để resume sau)

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ALLOWED_MODELS = {
  "gpt-6.2-sol": new Set(["high"]),
  "gpt-6.2-astra": new Set(["medium", "high"]),
};

const rawArgs = process.argv.slice(2);
const positional = [];
let branchPath = process.env.BRANCH_PATH || null;
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--branch" && i + 1 < rawArgs.length) {
    branchPath = rawArgs[++i];
  } else {
    positional.push(rawArgs[i]);
  }
}

const [threadName, model, effort, promptFile, outputFile] = positional;

function fail(msg) {
  console.error(`[new_codex_thread] LỖI: ${msg}`);
  process.exit(2);
}

if (!threadName || !model || !effort || !promptFile) {
  fail("Cách gọi: node new_codex_thread.mjs <threadName> <model> <effort> <promptFile> [outputFile] [--branch <branchPath>]");
}
if (!ALLOWED_MODELS[model]) {
  fail(`Model Codex "${model}" không nằm trong bảng CPG-02 (chỉ cho phép: ${Object.keys(ALLOWED_MODELS).join(", ")}).`);
}
if (!ALLOWED_MODELS[model].has(effort)) {
  fail(`Mức effort "${effort}" không hợp lệ cho ${model} theo CPG-02 (cho phép: ${[...ALLOWED_MODELS[model]].join(", ")}).`);
}
if (!fs.existsSync(promptFile)) {
  fail(`Không tìm thấy file prompt: ${promptFile}`);
}

function updateBranchManifest(patch) {
  if (!branchPath) return;
  const manifestPath = path.join(process.cwd(), branchPath, "BRANCH_MANIFEST.json");
  if (!fs.existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    Object.assign(manifest, patch, { updatedAt: new Date().toISOString() });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  } catch (err) {
    console.error(`[new_codex_thread] Cảnh báo: không cập nhật được BRANCH_MANIFEST.json (${err.message})`);
  }
}

function extractThreadId(text) {
  if (!text) return null;
  const m =
    text.match(/session\s+id\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) ||
    text.match(/thread(?:_?id)?\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}

function classifyFailure(combinedErrorText) {
  if (/(429|usage\s+limit|rate\s+limit|quota|too\s+many\s+requests|insufficient_quota)/i.test(combinedErrorText)) {
    return { status: "PAUSED_QUOTA", exitCode: 3 };
  }
  if (/(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket\s+hang\s+up|network\s+error|fetch\s+failed|connection\s+refused)/i.test(combinedErrorText)) {
    return { status: "PAUSED_NETWORK", exitCode: 4 };
  }
  return { status: "PAUSED_NETWORK", exitCode: 1 };
}

// Write-Ahead State trước khi gọi subagent
updateBranchManifest({ status: "RUNNING", promptFile: promptFile.replaceAll("\\", "/"), lastError: null });

const prompt = fs.readFileSync(promptFile, "utf8");
const userProfile = process.env.USERPROFILE || process.env.HOME || "";
const defaultCompanionPath = path.join(
  userProfile,
  ".claude/plugins/cache/openai-codex/codex/1.0.6/scripts/lib/codex.mjs"
);
const companionPath = process.env.CODEX_COMPANION_LIB || defaultCompanionPath;

if (fs.existsSync(companionPath) && process.env.USE_CODEX_CLI !== "1") {
  const libUrl = companionPath.startsWith("file://")
    ? companionPath
    : "file:///" + companionPath.replaceAll("\\", "/");
  const { runAppServerTurn } = await import(libUrl);
  const result = await runAppServerTurn(process.cwd(), {
    prompt,
    defaultPrompt: "",
    model,
    effort,
    sandbox: "workspace-write",
    persistThread: true,
    threadName,
    onProgress: (update) => {
      const text = typeof update === "string" ? update : update?.message ?? JSON.stringify(update);
      console.log(`[codex] ${text}`);
    },
  });
  console.log(`[codex] thread=${result.threadId} turn=${result.turnId} status=${result.status}`);
  const errMsg = result.error ? String(result.error.message ?? result.error) : "";
  if (errMsg) console.error(`[codex] error: ${errMsg}`);
  const finalMsg = result.finalMessage ?? "";
  if (outputFile) {
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
    fs.writeFileSync(outputFile, finalMsg, "utf8");
  }
  console.log("=== FINAL ===");
  console.log(finalMsg);

  const ok = result.status === "completed" || !result.error;
  if (ok) {
    const isBlocked = /^\s*BLOCKED:\s*plan\b/im.test(finalMsg);
    updateBranchManifest({
      threadId: result.threadId || null,
      status: isBlocked ? "BLOCKED" : "COMPLETED",
      lastError: null,
    });
    process.exit(0);
  }
  const classified = classifyFailure(errMsg);
  updateBranchManifest({
    threadId: result.threadId || null,
    status: classified.status,
    lastError: errMsg.slice(0, 400),
  });
  process.exit(classified.exitCode);
} else {
  const outPath = outputFile || path.join(process.env.TEMP || ".", `${threadName}-last.md`);
  const args = [
    "exec",
    "--skip-git-repo-check",
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${effort}"`,
    "-s",
    "workspace-write",
    "-o",
    outPath,
    "-",
  ];
  const res = spawnSync("codex", args, {
    cwd: process.cwd(),
    input: prompt,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (res.stdout) console.log(res.stdout);
  if (res.stderr) console.error(res.stderr);
  const combinedLogs = `${res.stdout || ""}\n${res.stderr || ""}`;
  const detectedThreadId = extractThreadId(combinedLogs);
  const finalMsg = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  console.log("=== FINAL ===");
  console.log(finalMsg);

  if (res.status === 0) {
    const isBlocked = /^\s*BLOCKED:\s*plan\b/im.test(finalMsg);
    updateBranchManifest({
      ...(detectedThreadId ? { threadId: detectedThreadId } : {}),
      status: isBlocked ? "BLOCKED" : "COMPLETED",
      lastError: null,
    });
    process.exit(0);
  }
  const classified = classifyFailure(combinedLogs);
  updateBranchManifest({
    ...(detectedThreadId ? { threadId: detectedThreadId } : {}),
    status: classified.status,
    lastError: (res.stderr || res.stdout || `exit code ${res.status}`).trim().slice(0, 400),
  });
  process.exit(classified.exitCode);
}
