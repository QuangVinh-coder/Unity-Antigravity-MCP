#!/usr/bin/env node
// Quản lý thư mục nhánh ảo tại agents/branches/<type>/lane<X>-<task-slug>/<agent>-<model>-<effort>[-w<N>]/ (TW-11).
// Hỗ trợ lưu checkpoint chống mất tiến độ khi hết usage / mất mạng (OL-2026-11-22-A18, A19).
//
// Các lệnh:
//   node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs init <branchPath> [filesToClone...]
//   node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs checkpoint <branchPath> [--status <S>] [--thread <id>] [--task <t>] [--step <s>] [--error <e>] [--prompt-file <p>] [--allowed-files <csv>]
//   node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs status <taskDirOrBranchPath|--all>
//   node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs recover <taskDirOrBranchPath|--all>
//   node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs integrate <branchPath> [specificFiles...]
//   node .agents/skills/agent-orchestrate/scripts/manage_virtual_branch.mjs clean <taskDirOrBranchPath>

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const ORCHESTRATOR_STATE_REL = "agents/branches/ORCHESTRATOR_STATE.json";
const ALLOWED_TYPES = new Set(["feature", "fix", "refactor", "test", "docs"]);
const ALLOWED_AGENT_MODELS = new Set([
  "gemini-4-hydrogen-high",
  "gemini-4-hydrogen-xhigh",
  "gemini-4-neon-medium",
  "gemini-4-neon-high",
  "gemini-4-neon-xhigh",
  "gemini-4-argon-medium",
  "gemini-4-argon-high",
  "codex-gpt-6.2-sol-high",
  "codex-gpt-6.2-astra-medium",
  "codex-gpt-6.2-astra-high",
  "claude-opus-5.5-medium",
  "claude-opus-5.5-high",
  "claude-opus-5.5-xhigh",
]);
const ALLOWED_STATUSES = new Set([
  "INITIALIZED",
  "RUNNING",
  "PAUSED_QUOTA",
  "PAUSED_NETWORK",
  "BLOCKED",
  "COMPLETED",
  "INTEGRATED",
]);

const FORBIDDEN_PREFIXES = [
  "Library/",
  "Logs/",
  "obj/",
  "Temp/",
  ".vs/",
  ".plastic/",
  "UserSettings/",
  ".agents/skills/unity-2d-project-guardian/",
  ".claude/agents/",
];

function fail(msg) {
  console.error(`[manage_virtual_branch] LỖI: ${msg}`);
  process.exit(2);
}

function norm(p) {
  return p.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function sha256File(absPath) {
  return createHash("sha256").update(fs.readFileSync(absPath)).digest("hex").toUpperCase();
}

function isForbiddenTarget(relPath) {
  const n = norm(relPath);
  if (FORBIDDEN_PREFIXES.some((prefix) => n === prefix.slice(0, -1) || n.startsWith(prefix))) return true;
  if (/\.(csproj|sln|csproj\.lscache)$/i.test(n)) return true;
  return false;
}

function parseAgentModelDir(dirName) {
  let baseModelEffort = dirName;
  let workerSlot = null;
  const suffixMatch = dirName.match(/^(.*)-w([0-9a-zA-Z]+)$/);
  if (suffixMatch) {
    if (!/^[1-9]\d*$/.test(suffixMatch[2])) {
      fail(`Hậu tố worker "${dirName}" không hợp lệ (phải là -w1, -w2, ... với số nguyên dương >= 1).`);
    }
    baseModelEffort = suffixMatch[1];
    workerSlot = Number(suffixMatch[2]);
  }
  if (!ALLOWED_AGENT_MODELS.has(baseModelEffort)) {
    fail(
      `Định danh model "${dirName}" vi phạm bảng CPG-02 (chỉ cho phép: ${[...ALLOWED_AGENT_MODELS].join(", ")}, tùy chọn kèm hậu tố -w<N>).`
    );
  }
  return { agentModelEffort: dirName, baseModelEffort, workerSlot };
}

function parseBranchPath(rawPath) {
  const rel = norm(rawPath);
  const parts = rel.split("/");
  if (parts.length !== 5 || parts[0] !== "agents" || parts[1] !== "branches") {
    fail(
      `Đường dẫn nhánh "${rawPath}" sai cấu trúc. Phải có dạng: agents/branches/<type>/lane<X>-<task-slug>/<agent>-<model>-<effort>[-w<N>]`
    );
  }
  const [, , type, laneTask, agentModelDir] = parts;
  if (!ALLOWED_TYPES.has(type)) {
    fail(`Loại nhánh "${type}" không hợp lệ (cho phép: ${[...ALLOWED_TYPES].join(", ")}).`);
  }
  if (!/^lane[1-9]\d*-[a-z0-9][a-z0-9-]*$/.test(laneTask)) {
    fail(`Tên thư mục task "${laneTask}" phải có dạng "lane<X>-<task-slug>" bằng chữ thường kebab-case (VD: lane1-fix-inventory-shop).`);
  }
  const modelInfo = parseAgentModelDir(agentModelDir);
  return {
    rel,
    type,
    laneTask,
    ...modelInfo,
    taskRel: `agents/branches/${type}/${laneTask}`,
  };
}

function parseTaskOrBranchPath(rawPath) {
  const rel = norm(rawPath);
  const parts = rel.split("/");
  if (parts.length === 5) {
    const parsed = parseBranchPath(rel);
    return { kind: "branch", ...parsed };
  }
  if (parts.length === 4 && parts[0] === "agents" && parts[1] === "branches") {
    const [, , type, laneTask] = parts;
    if (!ALLOWED_TYPES.has(type)) fail(`Loại nhánh "${type}" không hợp lệ.`);
    if (!/^lane[1-9]\d*-[a-z0-9][a-z0-9-]*$/.test(laneTask)) {
      fail(`Tên thư mục task "${laneTask}" phải có dạng "lane<X>-<task-slug>".`);
    }
    return { kind: "task", rel, type, laneTask, taskRel: rel };
  }
  fail(`Đường dẫn "${rawPath}" phải là thư mục task (4 cấp) hoặc thư mục nhánh model (5 cấp) dưới agents/branches/.`);
}

function walkBranchFiles(branchAbs) {
  const out = [];
  if (!fs.existsSync(branchAbs)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const rel = norm(path.relative(branchAbs, full));
      if (rel === "BRANCH_MANIFEST.json" || rel === "BRANCH_HANDOFF.md" || rel === "PROMPT.md") continue;
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  walk(branchAbs);
  return out.sort();
}

function readManifest(branchAbs) {
  const mp = path.join(branchAbs, "BRANCH_MANIFEST.json");
  if (!fs.existsSync(mp)) return null;
  try {
    return JSON.parse(fs.readFileSync(mp, "utf8"));
  } catch {
    return null;
  }
}

function writeManifest(branchAbs, manifest) {
  fs.writeFileSync(path.join(branchAbs, "BRANCH_MANIFEST.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function computeDirtyFiles(branchAbs, manifest) {
  const files = walkBranchFiles(branchAbs);
  const baseHashes = manifest?.baselineHashes || {};
  const dirty = [];
  for (const f of files) {
    const abs = path.join(branchAbs, f);
    if (!baseHashes[f]) {
      dirty.push(f);
    } else if (sha256File(abs) !== baseHashes[f]) {
      dirty.push(f);
    }
  }
  return dirty;
}

function discoverAllTaskDirs() {
  const branchesRoot = path.join(ROOT, "agents/branches");
  if (!fs.existsSync(branchesRoot)) return [];
  const taskDirs = [];
  for (const typeDir of fs.readdirSync(branchesRoot)) {
    if (!ALLOWED_TYPES.has(typeDir)) continue;
    const typeAbs = path.join(branchesRoot, typeDir);
    if (!fs.statSync(typeAbs).isDirectory()) continue;
    for (const laneDir of fs.readdirSync(typeAbs)) {
      const laneAbs = path.join(typeAbs, laneDir);
      if (!fs.statSync(laneAbs).isDirectory()) continue;
      taskDirs.push(`agents/branches/${typeDir}/${laneDir}`);
    }
  }
  return taskDirs.sort();
}

function buildTaskStatusReport(taskRel) {
  const taskAbs = path.join(ROOT, taskRel);
  if (!fs.existsSync(taskAbs)) {
    fail(`Thư mục task không tồn tại: ${taskRel}`);
  }
  const subdirs = fs
    .readdirSync(taskAbs)
    .filter((d) => fs.statSync(path.join(taskAbs, d)).isDirectory())
    .sort();
  if (subdirs.length === 0) {
    return { taskDir: taskRel, mode: "EMPTY", state: "EMPTY", memberCount: 0, members: [], overlappingFiles: [] };
  }
  const mode = subdirs.length === 1 ? "DISJOINT" : "CONFLICT_CLUSTER";
  const branchSummaries = [];
  const fileToBranches = new Map();
  let allCompleted = true;

  for (const sub of subdirs) {
    const bRel = `${taskRel}/${sub}`;
    const bAbs = path.join(taskAbs, sub);
    const manifest = readManifest(bAbs) || {};
    const handoffExists = fs.existsSync(path.join(bAbs, "BRANCH_HANDOFF.md"));
    const status = manifest.status || (handoffExists ? "COMPLETED" : "INITIALIZED");
    const isDone = (status === "COMPLETED" || status === "INTEGRATED") && handoffExists;
    if (!isDone) allCompleted = false;
    const files = walkBranchFiles(bAbs);
    const dirtyFiles = computeDirtyFiles(bAbs, manifest);
    for (const f of files) {
      if (!fileToBranches.has(f)) fileToBranches.set(f, []);
      fileToBranches.get(f).push(sub);
    }
    branchSummaries.push({
      branch: bRel,
      modelDir: sub,
      baseModelEffort: manifest.baseModelEffort || sub.replace(/-w[1-9]\d*$/, ""),
      workerSlot: manifest.workerSlot ?? null,
      status,
      threadId: manifest.threadId || null,
      assignedTask: manifest.assignedTask || null,
      lastCompletedStep: manifest.lastCompletedStep || null,
      lastError: manifest.lastError || null,
      promptFile: manifest.promptFile || null,
      handoffReady: handoffExists,
      files,
      dirtyFiles,
      updatedAt: manifest.updatedAt || manifest.createdAt || null,
    });
  }

  const overlappingFiles = [...fileToBranches.entries()]
    .filter(([, holders]) => holders.length > 1)
    .map(([file, holders]) => ({ file, holders }));

  let clusterState = "IN_PROGRESS";
  const allIntegrated = branchSummaries.every((m) => m.status === "INTEGRATED");
  const hasPaused = branchSummaries.some((m) => m.status === "PAUSED_QUOTA" || m.status === "PAUSED_NETWORK");
  if (allIntegrated) {
    clusterState = "INTEGRATED";
  } else if (mode === "DISJOINT") {
    clusterState = allCompleted ? "READY_FOR_IMMEDIATE_REVIEW" : hasPaused ? "PAUSED" : "IN_PROGRESS";
  } else {
    clusterState = allCompleted ? "READY_TO_MERGE_CLUSTER" : "WAITING_FOR_CONFLICT_CLUSTER";
  }

  return {
    taskDir: taskRel,
    mode,
    state: clusterState,
    memberCount: subdirs.length,
    members: branchSummaries,
    overlappingFiles,
  };
}

function syncOrchestratorState() {
  const stateAbs = path.join(ROOT, ORCHESTRATOR_STATE_REL);
  const branchesRoot = path.join(ROOT, "agents/branches");
  if (!fs.existsSync(branchesRoot)) return;
  const tasks = discoverAllTaskDirs().map((t) => buildTaskStatusReport(t));
  const payload = {
    updatedAt: new Date().toISOString(),
    laneCount: tasks.length,
    lanes: tasks,
  };
  fs.writeFileSync(stateAbs, JSON.stringify(payload, null, 2), "utf8");
}

function buildRecoveryPlan(taskDirs) {
  const skipped = [];
  const actions = [];
  for (const taskRel of taskDirs) {
    const report = buildTaskStatusReport(taskRel);
    for (const m of report.members) {
      if (m.status === "INTEGRATED" || (m.status === "COMPLETED" && m.handoffReady)) {
        skipped.push({
          branch: m.branch,
          taskDir: taskRel,
          status: m.status,
          reason: m.status === "INTEGRATED" ? "Đã tích hợp vào cây chính" : "Đã hoàn tất và có BRANCH_HANDOFF.md",
        });
        continue;
      }
      const isCodex = m.baseModelEffort.startsWith("codex-");
      const codexParts = isCodex ? m.baseModelEffort.replace(/^codex-/, "").match(/^(.*)-(medium|high)$/) : null;
      const modelName = codexParts ? codexParts[1] : m.baseModelEffort;
      const effortName = codexParts ? codexParts[2] : null;
      const action = m.threadId ? "RESUME_THREAD" : "RESTART_FROM_BRANCH_DISK";
      const resumeCommand =
        isCodex && m.threadId && effortName
          ? `node .agents/skills/agent-orchestrate/scripts/resume_codex_thread.mjs ${m.threadId} ${modelName} ${effortName} ${m.promptFile || "<promptFile>"} --branch ${m.branch}`
          : null;
      actions.push({
        branch: m.branch,
        taskDir: taskRel,
        mode: report.mode,
        status: m.status,
        action,
        threadId: m.threadId,
        assignedTask: m.assignedTask,
        lastCompletedStep: m.lastCompletedStep,
        lastError: m.lastError,
        dirtyFiles: m.dirtyFiles,
        resumeCommand,
      });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    skippedCount: skipped.length,
    actionCount: actions.length,
    skipped,
    actions,
  };
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k.startsWith("--")) {
      const val = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : "true";
      flags[k.slice(2)] = val;
    }
  }
  return flags;
}

const [cmd, targetArg, ...restArgs] = process.argv.slice(2);
if (!cmd || !targetArg) {
  fail("Cách gọi: manage_virtual_branch.mjs <init|checkpoint|status|recover|integrate|clean> <branchOrTaskPath|--all> [args...]");
}

if (cmd === "init") {
  const info = parseBranchPath(targetArg);
  const branchAbs = path.join(ROOT, info.rel);
  fs.mkdirSync(branchAbs, { recursive: true });
  const cloned = {};
  for (const rawFile of restArgs) {
    const fileRel = norm(rawFile);
    if (isForbiddenTarget(fileRel)) {
      fail(`Không được phép clone vùng cấm "${fileRel}" vào nhánh ảo.`);
    }
    const srcAbs = path.join(ROOT, fileRel);
    if (fs.existsSync(srcAbs) && fs.statSync(srcAbs).isFile()) {
      const dstAbs = path.join(branchAbs, fileRel);
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      fs.copyFileSync(srcAbs, dstAbs);
      cloned[fileRel] = sha256File(srcAbs);
    }
  }
  const now = new Date().toISOString();
  const manifest = {
    branch: info.rel,
    taskDir: info.taskRel,
    type: info.type,
    laneTask: info.laneTask,
    agentModelEffort: info.agentModelEffort,
    baseModelEffort: info.baseModelEffort,
    workerSlot: info.workerSlot,
    status: "INITIALIZED",
    threadId: null,
    assignedTask: null,
    allowedFiles: Object.keys(cloned),
    promptFile: null,
    lastCompletedStep: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    baselineHashes: cloned,
  };
  writeManifest(branchAbs, manifest);
  syncOrchestratorState();
  console.log(`Đã khởi tạo nhánh ảo: ${info.rel} (đã clone ${Object.keys(cloned).length} file gốc).`);
} else if (cmd === "checkpoint") {
  const info = parseBranchPath(targetArg);
  const branchAbs = path.join(ROOT, info.rel);
  if (!fs.existsSync(branchAbs)) {
    fail(`Nhánh ảo không tồn tại: ${info.rel}`);
  }
  const manifest = readManifest(branchAbs);
  if (!manifest) {
    fail(`Thiếu BRANCH_MANIFEST.json trong ${info.rel}`);
  }
  const flags = parseFlags(restArgs);
  if (flags.status) {
    if (!ALLOWED_STATUSES.has(flags.status)) {
      fail(`Trạng thái "${flags.status}" không hợp lệ (cho phép: ${[...ALLOWED_STATUSES].join(", ")}).`);
    }
    manifest.status = flags.status;
  }
  if (flags.thread) manifest.threadId = flags.thread;
  if (flags.task) manifest.assignedTask = flags.task;
  if (flags.step) manifest.lastCompletedStep = flags.step;
  if (flags.error !== undefined) manifest.lastError = flags.error === "none" ? null : flags.error;
  if (flags["prompt-file"]) manifest.promptFile = norm(flags["prompt-file"]);
  if (flags["allowed-files"]) {
    manifest.allowedFiles = flags["allowed-files"]
      .split(",")
      .map((x) => norm(x.trim()))
      .filter(Boolean);
  }
  manifest.updatedAt = new Date().toISOString();
  writeManifest(branchAbs, manifest);
  syncOrchestratorState();
  console.log(JSON.stringify({ branch: info.rel, status: manifest.status, threadId: manifest.threadId, updatedAt: manifest.updatedAt }));
} else if (cmd === "status") {
  if (targetArg === "--all") {
    const taskDirs = discoverAllTaskDirs();
    const lanes = taskDirs.map((t) => buildTaskStatusReport(t));
    syncOrchestratorState();
    console.log(JSON.stringify({ updatedAt: new Date().toISOString(), laneCount: lanes.length, lanes }, null, 2));
  } else {
    const info = parseTaskOrBranchPath(targetArg);
    const report = buildTaskStatusReport(info.taskRel);
    console.log(JSON.stringify(report, null, 2));
  }
} else if (cmd === "recover") {
  const taskDirs =
    targetArg === "--all"
      ? discoverAllTaskDirs()
      : [parseTaskOrBranchPath(targetArg).taskRel];
  const plan = buildRecoveryPlan(taskDirs);
  console.log(JSON.stringify(plan, null, 2));
} else if (cmd === "integrate") {
  const info = parseBranchPath(targetArg);
  const branchAbs = path.join(ROOT, info.rel);
  if (!fs.existsSync(branchAbs)) {
    fail(`Nhánh ảo không tồn tại: ${info.rel}`);
  }
  const taskAbs = path.join(ROOT, info.taskRel);
  const siblingDirs = fs
    .readdirSync(taskAbs)
    .filter((d) => fs.statSync(path.join(taskAbs, d)).isDirectory());
  if (siblingDirs.length > 1) {
    for (const sib of siblingDirs) {
      const sibAbs = path.join(taskAbs, sib);
      const sibManifest = readManifest(sibAbs);
      const sibStatus = sibManifest?.status || null;
      if (
        !fs.existsSync(path.join(sibAbs, "BRANCH_HANDOFF.md")) ||
        (sibStatus && sibStatus !== "COMPLETED" && sibStatus !== "INTEGRATED")
      ) {
        fail(
          `Nhánh "${info.rel}" thuộc cụm CONFLICT_CLUSTER (${info.taskRel}) và nhánh "${sib}" chưa hoàn tất (status=${sibStatus || "MISSING_HANDOFF"}). Theo TW-11 (OL-2026-11-22-A04, A18), phải đợi toàn bộ cụm bàn giao đủ mới merge!`
        );
      }
    }
  }
  const branchFiles = walkBranchFiles(branchAbs);
  const filterSet = restArgs.length > 0 ? new Set(restArgs.map(norm)) : null;
  const integrated = [];
  for (const f of branchFiles) {
    if (filterSet && !filterSet.has(f)) continue;
    if (isForbiddenTarget(f)) {
      fail(`Từ chối tích hợp file thuộc vùng bảo vệ/cấm: ${f}`);
    }
    const srcAbs = path.join(branchAbs, f);
    const dstAbs = path.join(ROOT, f);
    fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
    fs.copyFileSync(srcAbs, dstAbs);
    integrated.push({ file: f, sha256: sha256File(dstAbs) });
  }
  const manifest = readManifest(branchAbs);
  if (manifest) {
    const now = new Date().toISOString();
    manifest.status = "INTEGRATED";
    manifest.integratedAt = now;
    manifest.updatedAt = now;
    writeManifest(branchAbs, manifest);
  }
  syncOrchestratorState();
  console.log(`Đã tích hợp ${integrated.length} file từ ${info.rel} vào working tree:`);
  for (const item of integrated) {
    console.log(`  [INTEGRATED] ${item.file} (SHA256=${item.sha256})`);
  }
} else if (cmd === "clean") {
  const info = parseTaskOrBranchPath(targetArg);
  const abs = path.join(ROOT, info.rel);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { recursive: true, force: true });
    console.log(`Đã dọn sạch thư mục nhánh ảo: ${info.rel}`);
  } else {
    console.log(`Thư mục nhánh ảo không còn tồn tại: ${info.rel}`);
  }
  syncOrchestratorState();
} else {
  fail(`Lệnh không hợp lệ "${cmd}" (chỉ hỗ trợ: init, checkpoint, status, recover, integrate, clean).`);
}
