import { readdirSync, statSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const CHASE_ROOT = path.join(ROOT, "examples", "play", "chase");
const TSC_BIN = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");

function collectTypeScriptFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

if (!statSync(TSC_BIN, { throwIfNoEntry: false })?.isFile()) {
  console.error("[play-chase-typecheck] TypeScript compiler not found at node_modules/typescript/bin/tsc.");
  process.exit(1);
}

const files = collectTypeScriptFiles(CHASE_ROOT);
if (files.length === 0) {
  console.error("[play-chase-typecheck] No TypeScript files found under examples/play/chase.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    TSC_BIN,
    "--noEmit",
    "--pretty",
    "false",
    "--incremental",
    "false",
    "--allowJs",
    "--checkJs",
    "false",
    "--target",
    "ES2020",
    "--module",
    "ESNext",
    "--moduleResolution",
    "bundler",
    "--allowImportingTsExtensions",
    "--strict",
    "--skipLibCheck",
    ...files,
  ],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
