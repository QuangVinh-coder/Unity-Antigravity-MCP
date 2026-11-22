#!/usr/bin/env node
// Quét các vi phạm luật C# mà máy bắt được (coding-convention.md UCC-06/08/22/30/32/33/35/36)
// trong file .cs. Dùng cho cổng G7 của .agents/rules/review-scorecard.md.
//
// Chỉ đọc file, không ghi gì, không truy cập mạng. Bỏ qua nội dung comment và chuỗi trước khi so mẫu,
// để chữ tiếng Việt trong comment không bị bắt nhầm.
//
// Cách chạy (từ thư mục gốc Unity project):
//   node Tools/AIControlPlane/scan-csharp-rules.mjs <file-hoặc-thư-mục> [...]
//   ví dụ: node Tools/AIControlPlane/scan-csharp-rules.mjs Assets/Test
//
// Mã thoát: 0 = không có vi phạm CHẮC; 1 = có ít nhất một vi phạm CHẮC; 2 = gọi sai cách.
// NGHI VẤN là chỗ máy không tự kết luận được (số "magic", lambda, static, thiếu summary) — reviewer phải đọc.
// Thiếu /// summary chỉ là NGHI VẤN vì VCS-04 không bắt summary ở code tự giải thích (owner chọn 2026-11-13, OL-2026-11-13-C04).
// Nhóm SC-* (secure-coding.md, thêm 2026-11-13, OL-2026-11-13-C07) luôn là NGHI VẤN: đánh dấu cửa vào dữ liệu từ client để người đọc.
// Máy chỉ đọc theo mẫu; nó không thay việc reviewer đọc code (review-scorecard.md RS-04).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["Library", "Temp", "obj", "Logs", ".plastic", ".git", "node_modules", "UserSettings"]);
// "--summary": chỉ in số lượng theo từng nhóm, không liệt kê từng dòng.
const summaryOnly = process.argv.includes("--summary");
const args = process.argv.slice(2).filter((a) => a !== "--summary");
if (!args.length) {
  console.log("Cách dùng: node Tools/AIControlPlane/scan-csharp-rules.mjs [--summary] <file-hoặc-thư-mục> [...]");
  process.exit(2);
}

// Gom mọi file .cs từ danh sách đường dẫn người dùng đưa vào.
function collect(target, out) {
  if (!existsSync(target)) {
    console.log(`Không tìm thấy: ${target}`);
    process.exit(2);
  }
  const info = statSync(target);
  if (info.isDirectory()) {
    for (const name of readdirSync(target)) {
      if (SKIP_DIRS.has(name)) continue;
      collect(path.join(target, name), out);
    }
  } else if (target.endsWith(".cs")) {
    out.push(target);
  }
}
const files = [];
for (const a of args) collect(a, files);

// Thay nội dung comment, chuỗi và ký tự bằng dấu cách (giữ nguyên xuống dòng) để số dòng không đổi.
function stripCode(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      if (i < n) { out += "  "; i += 2; }
      continue;
    }
    const startsString = c === '"' || ((c === "@" || c === "$") && (d === '"' || ((d === "@" || d === "$") && src[i + 2] === '"')));
    if (startsString) {
      let verbatim = false;
      while (src[i] === "@" || src[i] === "$") { if (src[i] === "@") verbatim = true; out += src[i]; i++; }
      out += '"'; i++;
      while (i < n) {
        const ch = src[i];
        if (verbatim) {
          if (ch === '"' && src[i + 1] === '"') { out += "  "; i += 2; continue; }
          if (ch === '"') break;
        } else {
          if (ch === "\\") { out += "  "; i += 2; continue; }
          if (ch === '"' || ch === "\n") break;
        }
        out += ch === "\n" ? "\n" : " "; i++;
      }
      if (i < n && src[i] === '"') { out += '"'; i++; }
      continue;
    }
    if (c === "'") {
      out += "'"; i++;
      while (i < n && src[i] !== "'" && src[i] !== "\n") {
        if (src[i] === "\\") { out += " "; i++; }
        out += " "; i++;
      }
      if (src[i] === "'") { out += "'"; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const findings = []; // { level: "CHẮC" | "NGHI VẤN", rule, kind, detail, file, line, text }
// kind = tên nhóm cố định để gom kết quả; detail = phần riêng của từng chỗ (tên hàm, số tham số...).
function report(level, rule, kind, file, lineIndex, original, detail = "") {
  findings.push({ level, rule, kind, detail, file, line: lineIndex + 1, text: original.trim().slice(0, 110) });
}

const MODIFIERS = "(?:public|private|protected|internal|static|override|virtual|abstract|new|async|extern|unsafe|readonly|partial|sealed)";
const ATTRS = "^\\s*(?:\\[[^\\]]*\\]\\s*)*";
const TYPE_DECL = new RegExp(`${ATTRS}(?:${MODIFIERS}\\s+)*(class|struct|interface|enum)\\s+(\\w+)`);
const METHOD_DECL = new RegExp(`${ATTRS}(?:${MODIFIERS}\\s+)*(?:[\\w<>\\[\\],.?]+\\s+)?(\\w+)\\s*\\(`);
const PUBLIC_FIELD = new RegExp(`${ATTRS}public\\s+(?!(?:const|event|delegate|class|struct|enum|interface|abstract|override|virtual)\\b)(?:static\\s+|readonly\\s+)*[\\w<>\\[\\],.?]+\\s+\\w+\\s*(?:=(?!>)|;)`);
const KEYWORDS_NOT_METHOD = new Set(["if", "for", "foreach", "while", "switch", "using", "return", "new", "catch", "lock", "base", "this", "nameof", "typeof", "sizeof", "default"]);
const LINQ_METHODS = /(?<!Mathf?)\.(Where|Select|SelectMany|Any|All|First|FirstOrDefault|Last|LastOrDefault|OrderBy|OrderByDescending|ThenBy|GroupBy|ToList|ToDictionary|Aggregate|Distinct|Skip|Take|Zip)\s*\(/;
const FIND_CALLS = /\b(FindObjectOfType|FindFirstObjectByType|FindAnyObjectByType|FindObjectsOfType|FindObjectsByType)\b|\bGameObject\.Find(?:WithTag|GameObjectsWithTag)?\s*\(/;
const MAX_PARAMETERS = 4;
const MAX_METHOD_CODE_LINES = 30;
const MAX_NESTING = 3;

// Dòng có được tắt cảnh báo nhóm SC không: cần đúng mã luật và có lý do đi kèm.
function scAllowed(originalLines, lineIndex, rule) {
  const marker = new RegExp(`sc-scan:\\s*allow\\b[^\\n]*\\b${rule}\\b\\s+\\S`);
  if (marker.test(originalLines[lineIndex])) return true;
  return lineIndex > 0 && /^\s*\/\//.test(originalLines[lineIndex - 1]) && marker.test(originalLines[lineIndex - 1]);
}

// [Networked] nằm trên cùng dòng hoặc trong tối đa 4 dòng attribute liền phía trên property.
function hasNetworkedAttribute(originalLines, lineIndex) {
  if (/\[Networked\b/.test(originalLines[lineIndex])) return true;
  for (let k = lineIndex - 1; k >= 0 && lineIndex - k <= 4; k--) {
    if (!/^\s*\[/.test(originalLines[k])) return false;
    if (/\[Networked\b/.test(originalLines[k])) return true;
  }
  return false;
}

// Đếm tham số trong danh sách "(a, b, c)", bỏ qua dấu phẩy nằm trong <...> của kiểu generic.
function countParameters(list) {
  const trimmed = list.trim();
  if (!trimmed) return 0;
  let angle = 0;
  let count = 1;
  for (const ch of trimmed) {
    if (ch === "<") angle++;
    else if (ch === ">") angle--;
    else if (ch === "," && angle === 0) count++;
  }
  return count;
}

// Lấy khối comment "///" ngay trên dòng khai báo (bỏ qua dòng attribute và dòng trống).
function docCommentAbove(originalLines, lineIndex) {
  const block = [];
  for (let k = lineIndex - 1; k >= 0; k--) {
    const t = originalLines[k].trim();
    if (t.startsWith("///")) { block.push(t); continue; }
    if (t === "" || t.startsWith("[")) {
      if (block.length) break;
      continue;
    }
    break;
  }
  return block.join(" ");
}

for (const file of files) {
  const raw = readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const original = raw.split("\n");
  const code = stripCode(raw).split("\n");
  const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
  const isEditorOnly = /(^|\/)Editor\//.test(rel);
  // File dùng Fusion (không phụ thuộc tên thư mục): có "using Fusion" hoặc kế thừa NetworkBehaviour/SimulationBehaviour.
  const usesFusion = code.some((l) => /\busing\s+Fusion\b|:\s*(?:NetworkBehaviour|SimulationBehaviour)\b/.test(l));

  const stack = []; // "type" | "method" | "block" | "namespace"
  let pending = null; // loại khối sẽ mở ở dấu "{" kế tiếp
  let currentMethod = null; // { name, line, index, codeLines, maxNest }

  for (let i = 0; i < code.length; i++) {
    const line = code[i];
    const t = line.trim();
    const memberLevel = stack.length === 0 || stack[stack.length - 1] === "type" || stack[stack.length - 1] === "namespace";
    const insideMethod = stack.includes("method");

    if (t) {
      // ---- Kiểm ở mọi chỗ (UCC-30, UCC-32)
      if (/^\s*using\s+System\.Linq\b/.test(line)) report("CHẮC", "UCC-30", "LINQ (using System.Linq)", rel, i, original[i]);
      if (LINQ_METHODS.test(line.replace(/\bNetAddress\.Any\s*\(/g, " "))) report("NGHI VẤN", "UCC-30", "gọi hàm kiểu LINQ", rel, i, original[i]);
      if (/\bvar\b\s+[\w(]/.test(line)) report("CHẮC", "UCC-30", "var", rel, i, original[i]);
      if (/(?:^|[^\w.])_\s*=(?![=>])/.test(line) || /\bout\s+_\b/.test(line)) report("CHẮC", "UCC-30", "discard _", rel, i, original[i]);
      if (/\b(?:un)?checked\s*[({]/.test(line)) report("CHẮC", "UCC-30", "checked/unchecked", rel, i, original[i]);
      if (/\bswitch\s*\{/.test(line)) report("CHẮC", "UCC-30", "switch expression", rel, i, original[i]);
      if (/\bis\s+not\b|\bis\s*\{/.test(line)) report("CHẮC", "UCC-30", "pattern matching (is not / is {})", rel, i, original[i]);
      if (/\bgoto\b/.test(line)) report("CHẮC", "UCC-30", "goto", rel, i, original[i]);
      if ((line.match(/ \? /g) || []).length >= 2) report("NGHI VẤN", "UCC-30", "toán tử ? : lồng nhau", rel, i, original[i]);
      let arrowAt = line.indexOf("=>");
      while (arrowAt !== -1) {
        const before = line.slice(0, arrowAt);
        const openParens = (before.match(/\(/g) || []).length - (before.match(/\)/g) || []).length;
        if (openParens > 0 && !line.includes("+=")) {
          report("NGHI VẤN", "UCC-30", "lambda làm tham số (chỉ được dùng để gắn sự kiện UI)", rel, i, original[i]);
          break;
        }
        arrowAt = line.indexOf("=>", arrowAt + 2);
      }
      if (!isEditorOnly && FIND_CALLS.test(line)) report("CHẮC", "UCC-32", "Find* trong code gameplay", rel, i, original[i]);
      if (/\bDebug\.Log/.test(line)) report("NGHI VẤN", "UCC-20", "Debug.Log còn trong code bàn giao", rel, i, original[i]);
      // ---- Nhóm SC (secure-coding.md): chỉ đánh dấu chỗ reviewer phải đọc, không tự kết luận.
      // Tắt một dòng đã được người đọc xác nhận: "// sc-scan: allow SC-xx <lý do>" trên chính dòng đó hoặc dòng ngay trên.
      const sc = (rule, kind) => { if (!scAllowed(original, i, rule)) report("NGHI VẤN", rule, kind, rel, i, original[i]); };
      if (/\[\s*Rpc\b/.test(line)) {
        // [Rpc] không khai RpcSources thì Fusion mặc định nhận từ mọi peer (Fusion.Runtime.xml: "Default is RpcSources.All").
        if (!/\bRpcSources\./.test(line) || /\bRpcSources\.All\b/.test(line)) sc("SC-03", "RPC nhận từ mọi peer (RpcSources.All hoặc không khai nguồn) — cần lý do");
        else sc("SC-03", "RPC — kiểm nguồn gọi, quyền trên đối tượng, tham số, tần suất");
      }
      if (/\bGetInput\s*[<(]/.test(line)) sc("SC-02", "đọc input của client — đã kẹp và kiểm khoảng chưa");
      if (/\b(?:GetCommandLineArgs|GetEnvironmentVariable)\b/.test(line)) sc("SC-01", "đọc dòng lệnh/biến môi trường — kiểm bằng allowlist, không log bí mật");
      // Chuỗi đã bị thay bằng dấu cách ở bản "code", nên với log phải nhìn dòng gốc (bỏ phần // cuối dòng) để thấy {token} trong $"...".
      if (/\bDebug\.Log/.test(line) && /(?:token|password|passwd|secret|authorization|connectionstring|apikey|api_key)/i.test(original[i].replace(/\/\/.*$/, ""))) sc("SC-09", "log có tên hoặc chữ giống bí mật");
      // catch rỗng: gom tối đa 4 dòng vì dấu { } thường nằm ở dòng dưới.
      if (/\bcatch\b/.test(line) && /\bcatch\b[^{;]*\{\s*\}/.test(code.slice(i, i + 4).join(" "))) sc("SC-10", "catch rỗng hoặc chỉ có comment — nuốt lỗi");
      if (/\bRuntimeInitializeOnLoadMethod\b/.test(line)) sc("SC-12", "tự chạy ở mọi tiến trình, kể cả Dedicated Server");
      if (usesFusion && /\bRandom\.(?:Range|value|insideUnit\w*)\b/.test(line)) sc("SC-13", "ngẫu nhiên trong code mạng — authority tung hay client tung");
      if (/\/\/\s*TODO\b/.test(original[i])) report("NGHI VẤN", "UCC-20", "TODO", rel, i, original[i]);
      if (/^\s*namespace\b/.test(line)) report("CHẮC", "UCC-35", "namespace trong code mới", rel, i, original[i]);
      if (/\bsealed\b/.test(line)) report("CHẮC", "UCC-35", "sealed", rel, i, original[i]);

      // ---- Kiểm ở cấp thành viên của class (UCC-08/22/33/35)
      const typeMatch = line.match(TYPE_DECL);
      if (typeMatch && memberLevel) {
        // UCC-22 cho phép kiểu lồng nhỏ chỉ class chủ dùng; máy không phân biệt được nên để reviewer quyết.
        if (typeMatch[1] === "enum" && stack.includes("type")) report("NGHI VẤN", "UCC-22", "enum lồng trong class (được phép nếu nhỏ, chỉ class chủ dùng)", rel, i, original[i]);
        // VCS-04: summary không bắt buộc ở mọi kiểu; máy chỉ nhắc reviewer xem kiểu này có hợp đồng khó đoán không.
        if (!docCommentAbove(original, i)) report("NGHI VẤN", "UCC-08", "class/struct/enum không có /// summary (VCS-04: chỉ cần khi hợp đồng không hiển nhiên)", rel, i, original[i], `${typeMatch[1]} ${typeMatch[2]}`);
        pending = "type";
      } else if (/^\s*namespace\b/.test(line)) {
        pending = "namespace";
      } else if (memberLevel && stack.includes("type")) {
        const methodMatch = line.match(METHOD_DECL);
        const beforeParen = line.slice(0, line.indexOf("("));
        const isMethod = methodMatch && !KEYWORDS_NOT_METHOD.has(methodMatch[1]) && !beforeParen.includes("=") && !/^\s*(?:return|new)\b/.test(line);
        if (isMethod) {
          const doc = docCommentAbove(original, i);
          // VCS-04 mức 0: hàm tự giải thích không cần summary, nên đây chỉ là nghi vấn để reviewer đọc.
          if (!doc) report("NGHI VẤN", "UCC-08", "hàm/constructor không có /// summary (VCS-04: chỉ cần ở mức 1–2)", rel, i, original[i], methodMatch[1]);
          if (/\bstatic\b/.test(beforeParen) && !/static|tĩnh/i.test(doc)) report("NGHI VẤN", "UCC-35", "hàm static chưa có comment giải thích vì sao static", rel, i, original[i], methodMatch[1]);
          // Chữ ký có thể xuống nhiều dòng: gom tới khi gặp ")".
          let signature = line.slice(line.indexOf("(") + 1);
          let k = i;
          while (!signature.includes(")") && k + 1 < code.length && k - i < 8) { k++; signature += " " + code[k]; }
          const parameterText = signature.slice(0, signature.indexOf(")"));
          const parameterCount = countParameters(parameterText) - (/\bRpcInfo\s+\w+/.test(parameterText) ? 1 : 0);
          if (parameterCount > MAX_PARAMETERS) report("CHẮC", "UCC-35", `hàm quá ${MAX_PARAMETERS} tham số`, rel, i, original[i], `${methodMatch[1]}: ${parameterCount} tham số`);
          const afterSignature = code.slice(i, k + 2).join(" ");
          if (!/=>/.test(afterSignature.split("{")[0]) && !/\)\s*;/.test(afterSignature.split("{")[0])) {
            pending = "method";
            currentMethod = { name: methodMatch[1], index: i, codeLines: 0, maxNest: 0, depth: -1 };
          }
        } else if (PUBLIC_FIELD.test(line) && !line.includes("=>") && !/\{\s*get/.test(line)) {
          // "= new List<int>()" vẫn là field: chỉ cần dấu "=" hoặc ";" đứng trước dấu "(" đầu tiên.
          const firstParen = line.indexOf("(");
          const firstAssignOrEnd = line.search(/=|;/);
          if (firstParen === -1 || firstAssignOrEnd < firstParen) report("CHẮC", "UCC-33", "public field", rel, i, original[i]);
        }
        if (/\bpublic\b[^(]*\{\s*get\s*;\s*set\s*;/.test(line)) {
          // Property [Networked] của Fusion dùng accessor do SDK sinh; reviewer kiểm xem setter có thu hẹp được không.
          const isNetworked = hasNetworkedAttribute(original, i);
          if (isNetworked) report("NGHI VẤN", "UCC-33", "property [Networked] có set public", rel, i, original[i]);
          else report("CHẮC", "UCC-33", "property public có set public", rel, i, original[i]);
        }
      }

      // ---- Số "magic" trong thân hàm (UCC-06): mọi số khác 0 và 1, trừ dòng const và attribute.
      if (insideMethod && !/\bconst\b/.test(line) && !/^\s*\[/.test(line)) {
        const numbers = line.match(/(?<![\w.])\d+(?:\.\d+)?[fFdDmM]?(?![\w.])/g) || [];
        const magic = numbers.filter((value) => !/^[01](?:\.0+)?[fFdDmM]?$/.test(value));
        if (magic.length) report("NGHI VẤN", "UCC-06", "số viết thẳng trong thân hàm (magic number?)", rel, i, original[i], magic.join(", "));
      }

      // Đếm dòng code của hàm đang mở (bỏ dòng chỉ có dấu ngoặc).
      if (currentMethod && currentMethod.depth >= 0 && !/^[{}]+;?$/.test(t)) currentMethod.codeLines++;
    }

    // ---- Cập nhật ngăn xếp khối theo dấu ngoặc nhọn.
    for (const ch of line) {
      if (ch === "{") {
        const kind = pending || "block";
        stack.push(kind);
        if (kind === "method" && currentMethod) currentMethod.depth = stack.length;
        if (currentMethod && currentMethod.depth >= 0) {
          const nest = stack.length - currentMethod.depth;
          if (nest > currentMethod.maxNest) currentMethod.maxNest = nest;
        }
        pending = null;
      } else if (ch === "}") {
        const closed = stack.pop();
        if (closed === "method" && currentMethod) {
          if (currentMethod.codeLines > MAX_METHOD_CODE_LINES) {
            report("CHẮC", "UCC-36", `hàm dài quá ${MAX_METHOD_CODE_LINES} dòng code`, rel, currentMethod.index, original[currentMethod.index], `${currentMethod.name}: ${currentMethod.codeLines} dòng`);
          }
          if (currentMethod.maxNest > MAX_NESTING) {
            report("CHẮC", "UCC-36", `hàm lồng quá ${MAX_NESTING} tầng`, rel, currentMethod.index, original[currentMethod.index], `${currentMethod.name}: ${currentMethod.maxNest} tầng`);
          }
          currentMethod = null;
        }
      } else if (ch === ";" && pending && pending !== "type" && pending !== "namespace") {
        pending = null;
        if (currentMethod && currentMethod.depth < 0) currentMethod = null;
      }
    }
  }
}

// ---- In kết quả, gom theo mức → luật → nhóm.
const order = ["CHẮC", "NGHI VẤN"];
findings.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || a.rule.localeCompare(b.rule) || a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.line - b.line);
console.log(`scan-csharp-rules: quét ${files.length} file .cs (đã bỏ qua comment và chuỗi).`);
const groups = new Map();
for (const f of findings) {
  const key = `[${f.level}] ${f.rule} — ${f.kind}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(f);
}
for (const [key, items] of groups) {
  console.log(`\n${key}: ${items.length}`);
  if (summaryOnly) continue;
  for (const f of items) {
    const detail = f.detail ? `${f.detail}  |  ` : "";
    console.log(`  ${f.file}:${f.line}  ${detail}${f.text}`);
  }
}
const sure = findings.filter((f) => f.level === "CHẮC").length;
const maybe = findings.length - sure;
console.log(`\nTỔNG: CHẮC = ${sure} · NGHI VẤN = ${maybe}`);
process.exit(sure > 0 ? 1 : 0);
