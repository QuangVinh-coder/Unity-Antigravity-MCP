#!/usr/bin/env node
// Bộ giám sát tiến trình chạy nền mỗi 2 phút (120.000 ms) cho Orchestrator & Executor (TW-14, OL-2026-11-22-A28).
//
// Giải quyết triệt để 2 kịch bản treo thực tế trên Windows + Unity + Node + Subagent CLI:
//   1. COMPLETED_HUNG (Tiến trình chính đã xong / log đã ghi dấu hiệu hoàn tất, nhưng tiến trình con như
//      dotnet.exe VBCSCompiler.dll hoặc http.Server giữ pipe/Job Object làm tiến trình cha không thoát):
//      -> Tự động kill cây tiến trình con giữ handle, thu thập mã thoát thật từ log và ghi nhận COMPLETED_HUNG_CLEANED.
//   2. STALLED_MID_TASK (Sau mỗi chu kỳ 2 phút / 120s không có bất kỳ byte log/stdout/stderr mới):
//      -> Tự động dừng cây tiến trình treo, ghi nhận chẩn đoán từ log cuối, cập nhật checkpoint và tự động khởi động lại
//         (restart) theo số lần --max-retries để công việc chạy tiếp.
//
// Cách gọi:
//   node .agents/skills/agent-orchestrate/scripts/watchdog_runner.mjs run --label <name> [--interval-ms 120000] [--max-retries 1] [--log-file <path>] [--done-regex <regex>] [--branch <branchPath>] -- <cmd> [args...]
//   node .agents/skills/agent-orchestrate/scripts/watchdog_runner.mjs scan

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_INTERVAL_MS = 120_000; // 2 phút theo đúng OL-2026-11-22-A28
const DEFAULT_DONE_REGEX =
  "Exiting batchmode successfully now!|Application will terminate with return code (\\d+)|=== FINAL ===|</test-run>";

function killProcessTree(pid) {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {}
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

function getFileSizeSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function readTailSafe(filePath, maxBytes = 8192) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

function updateBranchWatchdogState(branchPath, patch) {
  if (!branchPath) return;
  const mp = path.join(process.cwd(), branchPath, "BRANCH_MANIFEST.json");
  if (!fs.existsSync(mp)) return;
  try {
    const m = JSON.parse(fs.readFileSync(mp, "utf8"));
    Object.assign(m, patch, { updatedAt: new Date().toISOString() });
    fs.writeFileSync(mp, JSON.stringify(m, null, 2), "utf8");
  } catch {}
}

function parseOptions(argv) {
  const sepIdx = argv.indexOf("--");
  const flagPart = sepIdx >= 0 ? argv.slice(0, sepIdx) : argv;
  const cmdPart = sepIdx >= 0 ? argv.slice(sepIdx + 1) : [];

  const opts = {
    mode: flagPart[0] || "run",
    label: "task",
    intervalMs: DEFAULT_INTERVAL_MS,
    maxRetries: 1,
    logFile: null,
    doneRegex: DEFAULT_DONE_REGEX,
    branch: null,
    cmd: cmdPart[0] || null,
    cmdArgs: cmdPart.slice(1),
  };

  for (let i = 1; i < flagPart.length; i++) {
    const k = flagPart[i];
    const next = flagPart[i + 1];
    if (k === "--label" && next) opts.label = flagPart[++i];
    else if (k === "--interval-ms" && next) opts.intervalMs = Math.max(100, Number(flagPart[++i]) || DEFAULT_INTERVAL_MS);
    else if (k === "--max-retries" && next) opts.maxRetries = Math.max(0, Number(flagPart[++i]) || 0);
    else if (k === "--log-file" && next) opts.logFile = flagPart[++i];
    else if (k === "--done-regex" && next) opts.doneRegex = flagPart[++i];
    else if (k === "--branch" && next) opts.branch = flagPart[++i];
  }
  return opts;
}

async function runSingleAttempt(opts, attemptIndex) {
  return new Promise((resolve) => {
    const doneRe = new RegExp(opts.doneRegex, "i");
    let stdoutBytes = 0;
    let lastCheckedBytes = 0;
    let lastCheckedLogFileSize = getFileSizeSafe(opts.logFile);
    let settled = false;
    let pollTimer = null;
    let watchdogTimer = null;

    const child = spawn(opts.cmd, opts.cmdArgs, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (watchdogTimer) clearInterval(watchdogTimer);
      resolve(outcome);
    };

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      process.stderr.write(chunk);
    });

    child.on("close", (code) => {
      finish({
        status: "EXITED_NORMALLY",
        exitCode: code ?? 0,
        attempt: attemptIndex,
      });
    });

    child.on("error", (err) => {
      finish({
        status: "SPAWN_ERROR",
        exitCode: 1,
        error: err.message,
        attempt: attemptIndex,
      });
    });

    const fastCheckMs = Math.min(250, Math.max(40, Math.floor(opts.intervalMs / 4)));
    let completedMarkerSeenAt = 0;

    pollTimer = setInterval(() => {
      if (!opts.logFile) return;
      const tail = readTailSafe(opts.logFile);
      const match = tail.match(doneRe);
      if (match) {
        if (!completedMarkerSeenAt) {
          completedMarkerSeenAt = Date.now();
          return;
        }
        if (Date.now() - completedMarkerSeenAt >= fastCheckMs) {
          const parsedCode = match[1] !== undefined ? Number(match[1]) : 0;
          killProcessTree(child.pid);
          finish({
            status: "COMPLETED_HUNG_CLEANED",
            exitCode: parsedCode,
            pid: child.pid,
            attempt: attemptIndex,
            note: `Phát hiện log hoàn tất (${match[0]}) nhưng tiến trình con giữ handle; đã tắt PID ${child.pid} và ghi nhận hoàn tất.`,
          });
        }
      }
    }, fastCheckMs);

    watchdogTimer = setInterval(() => {
      const curLogSize = getFileSizeSafe(opts.logFile);
      const tail = readTailSafe(opts.logFile);
      const match = tail.match(doneRe);
      if (match) {
        const parsedCode = match[1] !== undefined ? Number(match[1]) : 0;
        killProcessTree(child.pid);
        finish({
          status: "COMPLETED_HUNG_CLEANED",
          exitCode: parsedCode,
          pid: child.pid,
          attempt: attemptIndex,
          note: `Watchdog 2 phút phát hiện tiến trình đã hoàn tất trong log nhưng bị treo handle; đã dọn PID ${child.pid}.`,
        });
        return;
      }

      const byteDelta = stdoutBytes - lastCheckedBytes;
      const logDelta = curLogSize - lastCheckedLogFileSize;
      lastCheckedBytes = stdoutBytes;
      lastCheckedLogFileSize = curLogSize;

      if (byteDelta === 0 && logDelta === 0) {
        killProcessTree(child.pid);
        finish({
          status: "STALLED_MID_TASK",
          exitCode: 124,
          pid: child.pid,
          attempt: attemptIndex,
          tailLog: tail.slice(-500),
          note: `Watchdog phát hiện PID ${child.pid} treo không có tiến triển sau ${opts.intervalMs}ms; đã dừng cây tiến trình để sửa/khởi động lại.`,
        });
      }
    }, opts.intervalMs);
  });
}

const opts = parseOptions(process.argv.slice(2));

if (opts.mode === "scan" || opts.mode === "sweep") {
  const report = {
    scannedAt: new Date().toISOString(),
    watchdogIntervalSeconds: 120,
    orchestratorStateExists: fs.existsSync(path.join(process.cwd(), "agents/branches/ORCHESTRATOR_STATE.json")),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (!opts.cmd) {
  console.error("Cách gọi: watchdog_runner.mjs run --label <name> [options] -- <command> [args...]");
  process.exit(2);
}

let finalOutcome = null;
const restartedFromStall = [];

for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
  updateBranchWatchdogState(opts.branch, {
    watchdogLabel: opts.label,
    watchdogAttempt: attempt,
    watchdogLastCheckAt: new Date().toISOString(),
  });
  const outcome = await runSingleAttempt(opts, attempt);
  finalOutcome = outcome;

  if (outcome.status === "STALLED_MID_TASK" && attempt <= opts.maxRetries) {
    restartedFromStall.push({
      attempt,
      pid: outcome.pid,
      note: outcome.note,
    });
    console.error(`[WATCHDOG] ${outcome.note} -> Đang tự động khởi động lại (lần ${attempt + 1}/${opts.maxRetries + 1})...`);
    continue;
  }
  break;
}

const summary = {
  label: opts.label,
  finalStatus: finalOutcome.status,
  exitCode: finalOutcome.exitCode,
  attemptsUsed: finalOutcome.attempt,
  restartedFromStall,
  note: finalOutcome.note || null,
};

updateBranchWatchdogState(opts.branch, {
  watchdogSummary: summary,
});

console.log(`[WATCHDOG_SUMMARY] ${JSON.stringify(summary)}`);
process.exit(finalOutcome.exitCode ?? 1);
