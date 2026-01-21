import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCapabilitiesPayload } from "../shared/protocol-utils";

const COMMANDS_START = "<!-- WS:COMMANDS:START -->";
const COMMANDS_END = "<!-- WS:COMMANDS:END -->";
const RESPONSES_START = "<!-- WS:RESPONSES:START -->";
const RESPONSES_END = "<!-- WS:RESPONSES:END -->";

function replaceSection(content: string, start: string, end: string, body: string) {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(`Missing or invalid markers: ${start} / ${end}`);
  }
  const before = content.slice(0, startIndex + start.length);
  const after = content.slice(endIndex);
  return `${before}\n${body}\n${after}`;
}

function renderList(items: string[]) {
  return items.map((item) => `- \`${item}\``).join("\n");
}

function main() {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has("--check");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const usagePath = path.resolve(__dirname, "..", "USAGE.md");
  const usage = fs.readFileSync(usagePath, "utf8");

  const capabilities = buildCapabilitiesPayload();
  const commandsList = renderList(capabilities.commands);
  const responsesList = renderList(capabilities.responses);

  let next = usage;
  next = replaceSection(next, COMMANDS_START, COMMANDS_END, commandsList);
  next = replaceSection(next, RESPONSES_START, RESPONSES_END, responsesList);

  if (checkOnly) {
    if (next !== usage) {
      console.error("[ws-docs] USAGE.md is out of date. Run: npm run docs:ws");
      process.exit(1);
    }
    console.log("[ws-docs] USAGE.md is in sync.");
    return;
  }

  if (next !== usage) {
    fs.writeFileSync(usagePath, next, "utf8");
    console.log("[ws-docs] Updated USAGE.md.");
  } else {
    console.log("[ws-docs] USAGE.md already up to date.");
  }
}

main();
