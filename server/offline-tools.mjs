// Các công cụ chạy ngoại tuyến (Offline) cho Unity & C# trên Antigravity IDE:
//   - Đối chiếu .asmdef vs .csproj/.sln phát hiện nguyên nhân lỗi đỏ CS0229
//   - Đọc Packages/manifest.json & packages-lock.json
//   - Tìm Asset và tra GUID từ file .meta
//   - Đọc/ghi sổ nhật ký Operation Journal (%LOCALAPPDATA%/antigravity-unity-mcp/journal/<projectHash>.jsonl)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const IGNORED_DIRS = new Set([
  "Library",
  "Temp",
  "obj",
  "Logs",
  "UserSettings",
  ".plastic",
  ".git",
  "node_modules",
  "agents",
]);

export function normalizeProjectPath(rawPath) {
  const resolved = path.resolve(rawPath || process.cwd());
  return resolved.replaceAll("\\", "/").replace(/\/+$/g, "");
}

export function computeProjectHash(projectPath) {
  const norm = normalizeProjectPath(projectPath).toLowerCase();
  return createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 16).toUpperCase();
}

export function getAppDataRoot() {
  if (process.env.ANTIGRAVITY_UNITY_MCP_DIR) {
    return path.resolve(process.env.ANTIGRAVITY_UNITY_MCP_DIR);
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "antigravity-unity-mcp");
}

export function getInstanceFilePath(projectPath) {
  const hash = computeProjectHash(projectPath);
  return path.join(getAppDataRoot(), "instances", `${hash}.json`);
}

export function getJournalFilePath(projectPath) {
  const hash = computeProjectHash(projectPath);
  return path.join(getAppDataRoot(), "journal", `${hash}.jsonl`);
}

export function inspectCsharpProject(rawProjectPath) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const rootEntries = fs.existsSync(projectPath) ? fs.readdirSync(projectPath) : [];
  const csprojFiles = rootEntries.filter((f) => f.toLowerCase().endsWith(".csproj")).sort();
  const slnFiles = rootEntries
    .filter((f) => f.toLowerCase().endsWith(".sln") || f.toLowerCase().endsWith(".slnx"))
    .sort();
  const csprojNames = new Set(csprojFiles.map((f) => f.replace(/\.csproj$/i, "")));

  const asmdefs = [];
  const scanDir = (dirAbs) => {
    if (!fs.existsSync(dirAbs)) return;
    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        scanDir(path.join(dirAbs, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".asmdef")) {
        const full = path.join(dirAbs, entry.name);
        const rel = path.relative(projectPath, full).replaceAll("\\", "/");
        let asmName = entry.name.replace(/\.asmdef$/i, "");
        try {
          const parsed = JSON.parse(fs.readFileSync(full, "utf8").replace(/^\uFEFF/, ""));
          if (parsed && typeof parsed.name === "string" && parsed.name.trim()) {
            asmName = parsed.name.trim();
          }
        } catch {
          // Giữ tên file nếu JSON lỗi
        }
        const expectedCsproj = `${asmName}.csproj`;
        const hasCsproj = csprojNames.has(asmName);
        asmdefs.push({
          assemblyName: asmName,
          asmdefPath: rel,
          expectedCsproj,
          hasCsproj,
        });
      }
    }
  };

  scanDir(path.join(projectPath, "Assets"));
  scanDir(path.join(projectPath, "Packages"));

  const missingCsprojAssemblies = asmdefs.filter((a) => !a.hasCsproj);
  const syncedAssemblies = asmdefs.filter((a) => a.hasCsproj);

  return {
    projectPath,
    projectHash: computeProjectHash(projectPath),
    solutionFiles: slnFiles,
    csprojCount: csprojFiles.length,
    csprojFiles,
    asmdefCount: asmdefs.length,
    syncedCount: syncedAssemblies.length,
    missingCsprojCount: missingCsprojAssemblies.length,
    missingCsprojAssemblies,
    hasCs0229Risk: missingCsprojAssemblies.length > 0,
    diagnosis:
      missingCsprojAssemblies.length > 0
        ? `Phát hiện ${missingCsprojAssemblies.length} assembly (.asmdef) chưa có file .csproj ở gốc dự án (${missingCsprojAssemblies.map((x) => x.expectedCsproj).join(", ")}). Đây là nguyên nhân khiến .NET Language Server trong Antigravity IDE báo lỗi đỏ CS0229. Có thể khắc phục bằng lệnh sync_project_files.`
        : "Toàn bộ .asmdef trong Assets/ và Packages/ đều đã có file .csproj tương ứng.",
  };
}

export function listPackagesOffline(rawProjectPath) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const manifestPath = path.join(projectPath, "Packages", "manifest.json");
  const lockPath = path.join(projectPath, "Packages", "packages-lock.json");

  let dependencies = {};
  let lockDependencies = {};
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      dependencies = m.dependencies || {};
    } catch {}
  }
  if (fs.existsSync(lockPath)) {
    try {
      const l = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      lockDependencies = l.dependencies || {};
    } catch {}
  }

  const packages = Object.entries(dependencies).map(([name, versionOrTarget]) => ({
    name,
    target: versionOrTarget,
    source: lockDependencies[name]?.source || (String(versionOrTarget).startsWith("file:") ? "local" : "registry"),
    resolvedVersion: lockDependencies[name]?.version || versionOrTarget,
  }));

  return {
    projectPath,
    manifestExists: fs.existsSync(manifestPath),
    packageCount: packages.length,
    packages,
  };
}

function readGuidFromMeta(metaPath) {
  if (!fs.existsSync(metaPath)) return null;
  try {
    const content = fs.readFileSync(metaPath, "utf8");
    const m = content.match(/^guid:\s*([0-9a-fA-F]{32})\b/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function findAssetsOffline(rawProjectPath, query = "", assetType = "", limit = 50) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const assetsRoot = path.join(projectPath, "Assets");
  const q = String(query || "").trim().toLowerCase();
  const typeRaw = String(assetType || "").trim().toLowerCase();

  const extFilter = typeRaw.startsWith(".")
    ? typeRaw
    : typeRaw === "t:prefab"
      ? ".prefab"
      : typeRaw === "t:scene"
        ? ".unity"
        : typeRaw === "t:script"
          ? ".cs"
          : typeRaw === "t:material"
            ? ".mat"
            : typeRaw === "t:scriptableobject" || typeRaw === "t:asset"
              ? ".asset"
              : typeRaw === "t:asmdef"
                ? ".asmdef"
                : "";

  const matches = [];
  const maxItems = Math.min(Math.max(Number(limit) || 50, 1), 250);

  const walk = (dirAbs) => {
    if (matches.length >= maxItems || !fs.existsSync(dirAbs)) return;
    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      if (matches.length >= maxItems) return;
      const full = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && !entry.name.toLowerCase().endsWith(".meta")) {
        const lowerName = entry.name.toLowerCase();
        if (extFilter && !lowerName.endsWith(extFilter)) continue;
        const rel = path.relative(projectPath, full).replaceAll("\\", "/");
        if (q && !rel.toLowerCase().includes(q)) continue;
        matches.push({
          assetPath: rel,
          fileName: entry.name,
          guid: readGuidFromMeta(`${full}.meta`),
        });
      }
    }
  };

  walk(assetsRoot);
  return {
    projectPath,
    mode: "offline-filesystem",
    matchCount: matches.length,
    matches,
  };
}

export function readOperationJournal(rawProjectPath, limit = 30, filterOperationId = null) {
  const projectPath = normalizeProjectPath(rawProjectPath);
  const journalPath = getJournalFilePath(projectPath);
  if (!fs.existsSync(journalPath)) {
    return {
      projectPath,
      journalPath,
      entryCount: 0,
      entries: [],
    };
  }
  const lines = fs
    .readFileSync(journalPath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\uFEFF/, "").trim())
    .filter(Boolean);

  // Gom trạng thái mới nhất cho từng operationId (ví dụ APPLIED sau đó chuyển sang UNDONE_BY_USER hoặc ROLLED_BACK)
  const byOpId = new Map();
  const rawEntries = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      rawEntries.push(obj);
      if (obj && obj.operationId) {
        const prev = byOpId.get(obj.operationId) || {};
        byOpId.set(obj.operationId, { ...prev, ...obj });
      }
    } catch {}
  }

  let consolidated = [...byOpId.values()];
  if (filterOperationId) {
    consolidated = consolidated.filter((e) => e.operationId === filterOperationId);
  }
  const maxItems = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const slice = consolidated.slice(-maxItems).reverse();

  return {
    projectPath,
    journalPath,
    totalEventsLogged: rawEntries.length,
    entryCount: slice.length,
    entries: slice,
  };
}
