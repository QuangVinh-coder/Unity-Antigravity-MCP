#!/usr/bin/env node
// Chụp và kiểm "chỉ đổi comment" cho file C# (team-workflow.md TW-10).
//
//   node Tools/AIControlPlane/comment-guard.mjs snapshot <nhãn> <file|thư mục>...
//   node Tools/AIControlPlane/comment-guard.mjs verify <nhãn>
//
// snapshot: chép nguyên file vào kho tạm ngoài repo (mặc định %TEMP%/do-an-3-comment-guard/<nhãn>).
//           Nhãn đã có thì từ chối: bản chụp chụp sau khi sửa là vô giá trị.
// verify:   bỏ comment ở cả bản chụp lẫn file hiện tại rồi so từng dòng code.
//           Lệch dòng nào thì in nguyên dòng gốc để chép lại, không phải đoán.
// Chuỗi trong Tooltip("...") được coi là comment (VCS áp cho tooltip); mọi chuỗi khác là code.
// Exit: 0 = code giữ nguyên, 1 = code đổi/thiếu/thêm file, 2 = sai cách gọi hoặc lỗi đọc ghi.
// Chỉ đọc repo; chỉ ghi vào kho tạm. Không mạng.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const options = { root: process.cwd(), store: path.join(os.tmpdir(), "do-an-3-comment-guard") };
const positional = [];
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--root") options.root = path.resolve(args[++index]);
  else if (args[index] === "--store") options.store = path.resolve(args[++index]);
  else positional.push(args[index]);
}
const [command, label, ...targets] = positional;

function fail(message) {
  console.error(`LỖI: ${message}`);
  process.exit(2);
}

function toRelative(absolutePath) {
  return path.relative(options.root, absolutePath).split(path.sep).join("/");
}

function collectCsFiles(absolutePath, found) {
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    if (absolutePath.endsWith(".cs")) found.push(absolutePath);
    return;
  }
  for (const entry of fs.readdirSync(absolutePath)) {
    if (entry.startsWith(".")) continue;
    collectCsFiles(path.join(absolutePath, entry), found);
  }
}

// Bỏ comment C# nhưng giữ nguyên chuỗi, ký tự và số dòng.
function stripComments(source) {
  let output = "";
  let index = 0;
  const length = source.length;
  while (index < length) {
    const current = source[index];
    const next = source[index + 1];
    if (current === "/" && next === "/") {
      while (index < length && source[index] !== "\n") index++;
    } else if (current === "/" && next === "*") {
      index += 2;
      while (index < length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") output += "\n";
        index++;
      }
      index += 2;
    } else if (current === '"' || ((current === "@" || current === "$") && isStringStart(source, index))) {
      index = copyString(source, index, (text) => { output += text; });
    } else if (current === "'") {
      let end = index + 1;
      while (end < length && source[end] !== "'" && source[end] !== "\n") end += source[end] === "\\" ? 2 : 1;
      output += source.slice(index, end + 1);
      index = end + 1;
    } else {
      output += current;
      index++;
    }
  }
  return output;
}

function isStringStart(source, index) {
  const prefix = source.slice(index, index + 3);
  return /^(@"|\$"|@\$"|\$@")/.test(prefix);
}

function copyString(source, start, write) {
  let index = start;
  let verbatim = false;
  while (source[index] !== '"') {
    if (source[index] === "@") verbatim = true;
    index++;
  }
  index++;
  while (index < source.length) {
    if (verbatim && source[index] === '"' && source[index + 1] === '"') { index += 2; continue; }
    if (!verbatim && source[index] === "\\") { index += 2; continue; }
    if (source[index] === '"') { index++; break; }
    if (!verbatim && source[index] === "\n") break;
    index++;
  }
  write(source.slice(start, index));
  return index;
}

// Gộp mỗi cụm khoảng trắng ngoài chuỗi thành một dấu cách: xóa comment giữa dòng không bị tính là đổi code.
function collapseSpaces(line) {
  let output = "";
  let index = 0;
  while (index < line.length) {
    const current = line[index];
    if (current === '"' || ((current === "@" || current === "$") && isStringStart(line, index))) {
      index = copyString(line, index, (text) => { output += text; });
    } else if (current === "'") {
      let end = index + 1;
      while (end < line.length && line[end] !== "'") end += line[end] === "\\" ? 2 : 1;
      output += line.slice(index, end + 1);
      index = end + 1;
    } else if (/\s/.test(current)) {
      while (index < line.length && /\s/.test(line[index])) index++;
      output += " ";
    } else {
      output += current;
      index++;
    }
  }
  return output;
}

function codeLines(source) {
  const lines = stripComments(source.replace(/\r\n?/g, "\n")).split("\n");
  const result = [];
  lines.forEach((text, position) => {
    const normalized = collapseSpaces(text)
      .replace(/\bTooltip\s*\(\s*@?"(?:[^"\\]|\\.|"")*"\s*\)/g, 'Tooltip("<tooltip>")')
      .trim();
    if (normalized !== "") result.push({ text: normalized, line: position + 1 });
  });
  return result;
}

// Diff theo dãy con chung dài nhất; file C# của repo đủ nhỏ để làm trực tiếp.
function diffLines(before, after) {
  const rows = before.length;
  const columns = after.length;
  const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      table[row][column] = before[row].text === after[column].text
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }
  const changes = [];
  let row = 0;
  let column = 0;
  while (row < rows || column < columns) {
    if (row < rows && column < columns && before[row].text === after[column].text) { row++; column++; }
    else if (column < columns && (row === rows || table[row][column + 1] >= table[row + 1][column])) {
      changes.push(`  + hiện tại dòng ${after[column].line}: ${after[column].text}`);
      column++;
    } else {
      changes.push(`  - bản gốc  dòng ${before[row].line}: ${before[row].text}`);
      row++;
    }
  }
  return changes;
}

function snapshot() {
  if (!label || targets.length === 0) fail("cách gọi: snapshot <nhãn> <file|thư mục>...");
  const folder = path.join(options.store, label);
  if (fs.existsSync(folder)) fail(`nhãn "${label}" đã có ở ${folder}. Chọn nhãn mới; không chụp đè.`);
  const files = [];
  const directories = [];
  for (const target of targets) {
    const absolute = path.resolve(options.root, target);
    if (!fs.existsSync(absolute)) fail(`không thấy ${target}`);
    if (fs.statSync(absolute).isDirectory()) directories.push(toRelative(absolute));
    collectCsFiles(absolute, files);
  }
  if (files.length === 0) fail("không có file .cs nào để chụp");
  for (const file of files) {
    const copy = path.join(folder, "files", toRelative(file));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(file, copy);
  }
  const manifest = { label, createdAt: new Date().toISOString(), root: options.root, directories, files: files.map(toRelative) };
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Đã chụp ${files.length} file vào ${folder}`);
}

function verify() {
  if (!label) fail("cách gọi: verify <nhãn>");
  const folder = path.join(options.store, label);
  const manifestPath = path.join(folder, "manifest.json");
  if (!fs.existsSync(manifestPath)) fail(`chưa có bản chụp "${label}" ở ${folder}. Phải snapshot TRƯỚC khi sửa.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  let problems = 0;
  for (const relative of manifest.files) {
    const current = path.join(options.root, relative);
    if (!fs.existsSync(current)) { console.log(`MẤT FILE  ${relative}`); problems++; continue; }
    const before = codeLines(fs.readFileSync(path.join(folder, "files", relative), "utf8"));
    const after = codeLines(fs.readFileSync(current, "utf8"));
    const changes = diffLines(before, after);
    if (changes.length === 0) { console.log(`GIỮ CODE  ${relative}`); continue; }
    problems++;
    console.log(`ĐỔI CODE  ${relative}`);
    for (const change of changes) console.log(change);
  }
  for (const directory of manifest.directories) {
    const found = [];
    const absolute = path.join(options.root, directory);
    if (fs.existsSync(absolute)) collectCsFiles(absolute, found);
    for (const file of found.map(toRelative)) {
      if (!manifest.files.includes(file)) { console.log(`FILE MỚI  ${file}`); problems++; }
    }
  }
  console.log(problems === 0
    ? `KẾT QUẢ: code giữ nguyên ở ${manifest.files.length}/${manifest.files.length} file (bản chụp ${manifest.createdAt}).`
    : `KẾT QUẢ: ${problems} file lệch code. Chép lại dòng "bản gốc" từ bản chụp ${path.join(folder, "files")}; không đoán.`);
  process.exit(problems === 0 ? 0 : 1);
}

if (command === "snapshot") snapshot();
else if (command === "verify") verify();
else fail("lệnh: snapshot <nhãn> <file|thư mục>... | verify <nhãn>  [--root <thư mục>] [--store <thư mục>]");
