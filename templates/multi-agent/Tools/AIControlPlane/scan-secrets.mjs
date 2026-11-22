#!/usr/bin/env node
// Quét dấu hiệu bí mật (mật khẩu, token, khóa, chuỗi kết nối) trong file văn bản của repo.
// Dùng cho secure-coding.md SC-07. Chỉ đọc file, không ghi gì, không truy cập mạng, không đọc biến môi trường.
//
// Cách chạy (từ thư mục gốc Unity project):
//   node Tools/AIControlPlane/scan-secrets.mjs                 quét vùng mặc định
//   node Tools/AIControlPlane/scan-secrets.mjs <đường dẫn>...  quét file/thư mục chỉ định
//   thêm --summary để chỉ in số lượng theo nhóm
//
// Khác nhau giữa hai chế độ:
//   - Mặc định: bỏ qua thư mục SDK bên thứ ba (Photon, Plugins, TextMesh Pro) và không đọc .prefab/.unity (rất nhiều, rất lớn).
//   - Chỉ định đường dẫn: đọc cả các thư mục đó và cả .prefab/.unity bên trong đường dẫn được chỉ.
//
// Mã thoát: 0 = không có dấu hiệu CHẮC; 1 = có ít nhất một dấu hiệu CHẮC; 2 = gọi sai cách.
// Máy KHÔNG BAO GIỜ in giá trị nghi là bí mật: chỉ in file:dòng, tên nhóm và 4 ký tự đầu đã che.
// Sạch máy quét không chứng minh repo không có bí mật; nó chỉ bắt các mẫu đã biết
// (cross-audit 2026-11-13 đã chỉ ra nhiều ca lọt; bản này sửa các ca đó, không phải mọi ca).
// Dòng có chú thích "secret-scan: allow" (kèm lý do) được bỏ qua — dùng cho dữ liệu giả trong test.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const SKIP_ALWAYS = new Set(["Library", "Temp", "obj", "Logs", ".plastic", ".git", "node_modules", "UserSettings", ".vs", "Build", "Builds"]);
const SKIP_IN_DEFAULT_MODE = new Set(["Photon", "TextMesh Pro", "Plugins"]);
const TEXT_EXT = new Set([".cs", ".mjs", ".js", ".cjs", ".ts", ".json", ".md", ".txt", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".env", ".sh", ".ps1", ".bat", ".cmd", ".xml", ".asset", ".html", ".service", ".fusion"]);
const EXTRA_EXT_WHEN_EXPLICIT = new Set([".prefab", ".unity"]);
const DEFAULT_TARGETS = ["Assets/Scripts", "Assets/Editor", "Assets/Resources", "Assets/Settings", "Assets/Test", "Tools", "docs", ".claude", ".agents", "ProjectSettings", "AGENTS.md", "CLAUDE.md", "CODEBASE_MAP.md", "todo.md"];
const MAX_BYTES = 2 * 1024 * 1024;

const summaryOnly = process.argv.includes("--summary");
const args = process.argv.slice(2).filter((a) => a !== "--summary");
const explicit = args.length > 0;
const targets = explicit ? args : DEFAULT_TARGETS.filter((t) => existsSync(t));
for (const t of args) {
  if (!existsSync(t)) {
    console.log(`Không tìm thấy: ${t}`);
    process.exit(2);
  }
}

// Gom file văn bản; file tên .env* luôn được quét dù không có đuôi quen.
function collect(target, out) {
  const info = statSync(target);
  if (info.isDirectory()) {
    for (const name of readdirSync(target)) {
      if (SKIP_ALWAYS.has(name)) continue;
      if (!explicit && SKIP_IN_DEFAULT_MODE.has(name)) continue;
      collect(path.join(target, name), out);
    }
    return;
  }
  const base = path.basename(target);
  const ext = path.extname(base).toLowerCase();
  if (info.size > MAX_BYTES) return;
  if (TEXT_EXT.has(ext) || base.startsWith(".env") || (explicit && EXTRA_EXT_WHEN_EXPLICIT.has(ext))) out.push(target);
}
const files = [];
for (const t of targets) collect(t, files);

// Giá trị giữ chỗ: khớp nguyên cả giá trị với một từ quen, hoặc bắt đầu bằng tiền tố ví dụ VÀ ngắn.
// Giới hạn độ dài để khóa thật kiểu "test_<32 ký tự>" của môi trường thử không bị coi là giữ chỗ.
const PLACEHOLDER_EXACT = /^(?:<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%[A-Z_]+%|x{3,}|\*{3,}|\.{3,}|changeme|placeholder|todo|tbd|null|none|undefined|process\.env\.\w+|secret|token|password)$/i;
const PLACEHOLDER_PREFIX = /^(?:your|example|dummy|test|fake|sample|thay|mat[-_]?khau)[-_ ]?\w*$/i;
const PLACEHOLDER_MAX_LENGTH = 20;
function isPlaceholder(value) {
  return PLACEHOLDER_EXACT.test(value) || (value.length <= PLACEHOLDER_MAX_LENGTH && PLACEHOLDER_PREFIX.test(value));
}

// Nhãn hoặc tên hằng (ERR_PASS_MIN_8_CHARS, X-Session-Token-Header-V1): từ 3 đoạn chữ ngắn trở lên nối bằng - _ .
// Giới hạn độ dài mỗi đoạn để khóa kiểu "sk_live_<chuỗi dài>" không bị coi là nhãn (cross-audit vòng 2, CH-201).
const LABEL_PART_MAX_LENGTH = 12;
function looksLikeLabel(value) {
  const parts = value.split(/[-_.]/);
  return parts.length >= 3 && parts.every((part) => part.length <= LABEL_PART_MAX_LENGTH && /^[A-Za-z]*\d{0,2}$/.test(part));
}

// Biểu thức chính quy (vd luật mật khẩu "^(?=.*[a-z])..."): không phải bí mật.
function looksLikeRegex(value) {
  return /^\^|\(\?[=!:<]|\\[dwsbDWSB]/.test(value);
}

function entropy(text) {
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / text.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// Giá trị trông ngẫu nhiên: có chữ và số với entropy vừa, hoặc chỉ chữ nhưng dài và entropy cao (khóa base64 không có số).
function looksRandom(value) {
  if (isPlaceholder(value) || looksLikeLabel(value) || looksLikeRegex(value)) return false;
  const e = entropy(value);
  if (/[A-Za-z]/.test(value) && /\d/.test(value)) return e >= 3.5;
  return value.length >= 24 && e >= 4;
}

// Mật khẩu trong chuỗi kết nối ví dụ: từ quen, hoặc máy chủ là localhost/example.
const EXAMPLE_PASSWORD = /^(?:pass|passwd|password|pwd|secret|user|admin|root|guest)$/i;
const EXAMPLE_HOST = /^(?:localhost|127\.0\.0\.1|\[?::1\]?|host|.*\.example\.(?:com|net|org)|example\.(?:com|net|org)|.*\.example\.mongodb\.net)$/i;

const SECRET_NAME = "(?:secret|token|passwd|password|pwd|api[_-]?key|private[_-]?key|access[_-]?key|checksum[_-]?key|payos[_-]?key|hmac[_-]?key|signing[_-]?key|webhook[_-]?key|jwt[_-]?key|master[_-]?key|client[_-]?secret|connection[_-]?string|auth[_-]?key)"; // secret-scan: allow — đây là danh sách tên cần tìm, không phải bí mật

// Mỗi luật chạy với cờ "g" để bắt mọi chỗ khớp trên cùng một dòng (JSON gọn thường có nhiều cặp trên một dòng).
const RULES = [
  { level: "CHẮC", kind: "khóa riêng (PEM)", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { level: "CHẮC", kind: "chuỗi kết nối có mật khẩu", connection: true, re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp)s?:\/\/[^\s:@/"'`]*:([^\s@/"'`]{3,})@([^\s/"'`:?]+)/gi },
  { level: "CHẮC", kind: "khóa AWS", re: /\b(AKIA[0-9A-Z]{16})\b/g },
  { level: "CHẮC", kind: "khóa Google API", re: /\b(AIza[0-9A-Za-z_-]{35})\b/g },
  { level: "CHẮC", kind: "token GitHub/Slack", re: /\b((?:gh[pousr]_[A-Za-z0-9]{30,})|(?:xox[baprs]-[A-Za-z0-9-]{10,}))\b/g },
  { level: "NGHI VẤN", kind: "JWT", re: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g },
  { level: "NGHI VẤN", kind: "Bearer token viết thẳng", re: /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g },
  { level: "NGHI VẤN", kind: "gán giá trị cho tên giống bí mật", random: true, re: new RegExp(`(?<![\\w.-])[\\w.-]*${SECRET_NAME}[\\w-]*["']?\\s*[:=]\\s*["'\`]([^"'\`\\s]{12,})["'\`]`, "gi") },
  // File .env / systemd EnvironmentFile / shell: KEY=giá trị không có dấu nháy. Chỉ nhận tên viết HOA kiểu biến môi trường
  // để không bắt nhầm phép gán biến trong code C#/JS (cross-audit vòng 2, CH-201).
  { level: "NGHI VẤN", kind: "biến môi trường giống bí mật gán giá trị không dấu nháy", random: true, re: new RegExp(`(?:^|[\\s"'=])(?:export\\s+)?(?=[A-Z0-9_]*${SECRET_NAME.toUpperCase()})[A-Z][A-Z0-9_]*=([^\\s"'\`#;]{12,})`, "g") },
  { level: "NGHI VẤN", kind: "truyền giá trị cho tên giống bí mật qua lời gọi hàm", random: true, re: new RegExp(`\\(\\s*["'][\\w.-]*${SECRET_NAME}[\\w-]*["']\\s*,\\s*["'\`]([^"'\`\\s]{12,})["'\`]`, "gi") },
];

const findings = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue; // file nhị phân
  const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000 || /secret-scan:\s*allow/i.test(line)) continue;
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        const value = m[1] || "";
        let level = rule.level;
        let kind = rule.kind;
        if (rule.connection) {
          if (isPlaceholder(value)) continue;
          // Chuỗi ví dụ trong tài liệu vẫn được báo, nhưng ở mức nghi vấn để không chặn oan.
          if (EXAMPLE_PASSWORD.test(value) || EXAMPLE_HOST.test(m[2] || "")) {
            level = "NGHI VẤN";
            kind = "chuỗi kết nối trông như ví dụ (kiểm lại)";
          }
        } else if (rule.random) {
          if (!looksRandom(value)) continue;
        } else if (value && isPlaceholder(value)) {
          continue;
        }
        const masked = value ? `${value.slice(0, 4)}…(${value.length} ký tự, đã che)` : "(đã che)";
        findings.push({ level, kind, file: rel, line: i + 1, masked });
      }
    }
  }
}

const order = ["CHẮC", "NGHI VẤN"];
findings.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.line - b.line);
console.log(`scan-secrets: quét ${files.length} file văn bản trong ${targets.join(", ")}.`);
const groups = new Map();
for (const f of findings) {
  const key = `[${f.level}] ${f.kind}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(f);
}
for (const [key, items] of groups) {
  console.log(`\n${key}: ${items.length}`);
  if (summaryOnly) continue;
  for (const f of items) console.log(`  ${f.file}:${f.line}  ${f.masked}`);
}
const sure = findings.filter((f) => f.level === "CHẮC").length;
console.log(`\nTỔNG: CHẮC = ${sure} · NGHI VẤN = ${findings.length - sure}`);
if (findings.length) console.log("Nếu là bí mật thật: KHÔNG chép giá trị đi đâu; báo file:dòng và đổi (rotate) bí mật đó (secure-coding.md SC-07).");
process.exit(sure > 0 ? 1 : 0);
