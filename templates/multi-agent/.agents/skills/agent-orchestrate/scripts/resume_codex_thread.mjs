#!/usr/bin/env node
// Nối tiếp đúng một thread/session Codex theo ID sau Plan fix, hết usage (PAUSED_QUOTA), mất mạng (PAUSED_NETWORK) hoặc qua milestone kế (CPG-02, TW-11).
//
// Cách gọi:
//   node .agents/skills/agent-orchestrate/scripts/resume_codex_thread.mjs <threadId> <model> <effort> <promptFile> [outputFile] [--branch <branchPath>]
//
// Exit codes: 0 = COMPLETED/BLOCKED, 1 = lỗi khác, 2 = sai tham số, 3 = PAUSED_QUOTA, 4 = PAUSED_NETWORK

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

const [threadId, model, effort, promptFile, outputFile] = positional;

function fail(msg) {
  console.error(`[resume_codex_thread] LỖI: ${msg}`);
  process.exit(2);
}

if (!threadId || !model || !effort || !promptFile) {
  fail("Cách gọi: node resume_codex_thread.mjs <threadId> <model> <effort> <promptFile> [outputFile] [--branch <branchPath>]");
}
if (!ALLOWED_MODELS[model]) {
  fail(`Model Codex "${model}" không nằm trong bảng CPG-02.`);
}
if (!ALLOWED_MODELS[model].has(effort)) {
  fail(`Mức effort "${effort}" không hợp lệ cho ${model} theo CPG-02.`);
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
    console.error(`[resume_codex_thread] Cảnh báo: không cập nhật được BRANCH_MANIFEST.json (${err.message})`);
  }
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

updateBranchManifest({ status: "RUNNING", threadId, promptFile: promptFile.replaceAll("\\", "/"), lastError: null });

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
    resumeThreadId: threadId,
    prompt,
    defaultPrompt: "",
    model,
    effort,
    sandbox: "workspace-write",
    persistThread: true,
    threadName: null,
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
      threadId: result.threadId || threadId,
      status: isBlocked ? "BLOCKED" : "COMPLETED",
      lastError: null,
    });
    process.exit(0);
  }
  const classified = classifyFailure(errMsg);
  updateBranchManifest({
    threadId: result.threadId || threadId,
    status: classified.status,
    lastError: errMsg.slice(0, 400),
  });
  process.exit(classified.exitCode);
} else {
  const outPath = outputFile || path.join(process.env.TEMP || ".", `${threadId}-resume-last.md`);
  const args = ["exec", "resume", "--skip-git-repo-check", threadId, "-o", outPath, "-"];
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
  const finalMsg = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  console.log("=== FINAL ===");
  console.log(finalMsg);

  if (res.status === 0) {
    const isBlocked = /^\s*BLOCKED:\s*plan\b/im.test(finalMsg);
    updateBranchManifest({
      threadId,
      status: isBlocked ? "BLOCKED" : "COMPLETED",
      lastError: null,
    });
    process.exit(0);
  }
  const classified = classifyFailure(combinedLogs);
  updateBranchManifest({
    threadId,
    status: classified.status,
    lastError: (res.stderr || res.stdout || `exit code ${res.status}`).trim().slice(0, 400),
  });
  process.exit(classified.exitCode);
}
