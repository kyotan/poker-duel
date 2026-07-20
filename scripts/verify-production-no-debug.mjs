import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve(process.argv[2] ?? "dist");

if (!fs.existsSync(distDir)) {
  throw new Error(`Production directory does not exist: ${distDir}`);
}

const forbidden = [
  "developer-settings-button",
  "__POKER_DUEL_TEST__",
  "render_game_to_text",
  "debug-dialog",
  "debug-field",
  "developer-button",
  "DEVELOPMENT ONLY",
  "TEST SETTINGS",
  "開発環境のみ",
  "テスト設定",
  "開発用テスト設定を開く",
];

const textExtensions = new Set([".html", ".js", ".css", ".json"]);
const files = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolutePath);
    else if (textExtensions.has(path.extname(entry.name))) files.push(absolutePath);
  }
}

collect(distDir);

const findings = [];
for (const file of files) {
  const contents = fs.readFileSync(file, "utf8");
  for (const marker of forbidden) {
    if (contents.includes(marker)) {
      findings.push(`${path.relative(distDir, file)} contains ${JSON.stringify(marker)}`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Production build contains development-only UI or test hooks:\n${findings.join("\n")}`);
}

console.log(`Production Debug audit passed (${files.length} text assets checked).`);
