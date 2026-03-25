import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEquationsPaneStatePatchInput } from "../shared/equations-validation";

type ParsedArgs = {
  options: Record<string, string | boolean>;
  positional: string[];
};

const EQUATIONS_PANE_PRESET_NAMES = [
  "epistemic-kuramoto",
  "kuramoto-epistemic",
  "kuramoto-2x3",
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function parseArgs(argvInput: string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let index = 0; index < argvInput.length; index += 1) {
    const arg = argvInput[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (!key) {
      continue;
    }
    if (key === "help" || key === "h") {
      options.help = true;
      continue;
    }
    const next = argvInput[index + 1];
    if (typeof next === "undefined" || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return { options, positional };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonFileAbsolute(filename: string, label: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filename, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${label} ${filename}: ${message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} JSON (${filename}): ${message}`);
  }
}

function parseOptionalJson(value: string | boolean | undefined, label: string): unknown | null {
  if (value === undefined || value === false) {
    return null;
  }
  if (value === true) {
    throw new Error(`Missing value for --${label}.`);
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --${label} JSON: ${message}`);
  }
}

function parseOptionalJsonFile(
  filePath: string | boolean | undefined,
  label: string,
): unknown | null {
  if (filePath === undefined || filePath === false) {
    return null;
  }
  if (filePath === true) {
    throw new Error(`Missing value for --${label}-file.`);
  }
  const resolvedPath = path.resolve(process.cwd(), String(filePath));
  return readJsonFileAbsolute(resolvedPath, `${label} file`);
}

function parseOptionalJsonInput(
  value: string | boolean | undefined,
  filePath: string | boolean | undefined,
  label: string,
): unknown | null {
  const inlineValue = parseOptionalJson(value, label);
  const fileValue = parseOptionalJsonFile(filePath, label);
  if (inlineValue !== null && fileValue !== null) {
    throw new Error(`Provide either --${label} or --${label}-file, not both.`);
  }
  return fileValue !== null ? fileValue : inlineValue;
}

function normalizeEquationsBootstrapPayloadObject(
  parsed: unknown,
  sourceLabel: string,
): Record<string, unknown> {
  if (!isPlainObject(parsed)) {
    throw new Error(`Invalid equations bootstrap at ${sourceLabel}: expected a JSON object.`);
  }
  if (isPlainObject(parsed.spec) || Array.isArray(parsed.items)) {
    return {
      replace: true,
      document: parsed,
    };
  }
  return {
    replace: true,
    ...parsed,
  };
}

function loadEquationsBootstrapFromDirectory(directoryPath: string): Record<string, unknown> {
  const paneFile = path.join(directoryPath, "equations-pane.json");
  if (fs.existsSync(paneFile) && fs.statSync(paneFile).isFile()) {
    return normalizeEquationsBootstrapPayloadObject(
      readJsonFileAbsolute(paneFile, "equations bootstrap file"),
      paneFile,
    );
  }

  const payload: Record<string, unknown> = { replace: true };
  const candidates: Array<[string, string]> = [
    ["document", path.join(directoryPath, "equations-framegrid.json")],
    ["document", path.join(directoryPath, "equations-document.json")],
    ["content", path.join(directoryPath, "equations-content.json")],
    ["dimensions", path.join(directoryPath, "equations-layout.json")],
    ["dimensions", path.join(directoryPath, "equations-dimensions.json")],
    ["context", path.join(directoryPath, "equations-context.json")],
    ["cells", path.join(directoryPath, "equations-cells.json")],
  ];

  let found = false;
  for (const [key, candidatePath] of candidates) {
    if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
      continue;
    }
    payload[key] = readJsonFileAbsolute(candidatePath, `equations ${key} file`);
    found = true;
  }

  if (!found) {
    throw new Error(
      `No equations bootstrap files found in ${directoryPath}. Expected equations-pane.json or one of equations-framegrid.json, equations-document.json, equations-content.json, equations-layout.json, equations-dimensions.json, equations-context.json, equations-cells.json.`,
    );
  }

  return payload;
}

function loadEquationsBootstrapFromPath(bootstrapPath: string): Record<string, unknown> {
  const resolvedPath = path.resolve(process.cwd(), bootstrapPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Equations bootstrap path not found: ${resolvedPath}`);
  }
  const stats = fs.statSync(resolvedPath);
  if (stats.isDirectory()) {
    return loadEquationsBootstrapFromDirectory(resolvedPath);
  }
  if (stats.isFile()) {
    return normalizeEquationsBootstrapPayloadObject(
      readJsonFileAbsolute(resolvedPath, "equations bootstrap file"),
      resolvedPath,
    );
  }
  throw new Error(`Equations bootstrap path is neither a file nor a directory: ${resolvedPath}`);
}

function parseEquationsPaneBootstrap(
  value: string | boolean | undefined,
  filePath: string | boolean | undefined,
  dirPath: string | boolean | undefined,
): Record<string, unknown> | null {
  const sources = [
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null,
    typeof filePath === "string" && filePath.trim().length > 0 ? filePath.trim() : null,
    typeof dirPath === "string" && dirPath.trim().length > 0 ? dirPath.trim() : null,
  ].filter((entry): entry is string => entry !== null);

  if (sources.length > 1) {
    throw new Error("Provide only one of --bootstrap, --bootstrap-file, or --bootstrap-dir.");
  }
  if (sources.length === 0) {
    return null;
  }
  return loadEquationsBootstrapFromPath(sources[0]);
}

function parseBooleanOption(
  value: string | boolean | undefined,
  fallback: boolean | undefined,
): boolean | undefined {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function parseEquationsPanePreset(
  value: string | boolean | undefined,
): Record<string, unknown> | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (EQUATIONS_PANE_PRESET_NAMES.includes(normalized)) {
    return {
      replace: true,
      content: readJsonFileAbsolute(
        path.join(projectRoot, "examples", "kuramoto", "equations-content.model.json"),
        "equations content file",
      ),
    };
  }
  throw new Error(
    `Unknown --preset value "${value}". Available presets: ${EQUATIONS_PANE_PRESET_NAMES.join(", ")}.`,
  );
}

function formatDiagnosticLine(
  diagnostic: {
    severity: "warning" | "error";
    path: string;
    message: string;
    latex?: string;
    ruleId?: string;
  },
): string {
  const lines = [
    `${diagnostic.severity.toUpperCase()}${diagnostic.ruleId ? ` [${diagnostic.ruleId}]` : ""} ${diagnostic.path}`,
    `  ${diagnostic.message}`,
  ];
  if (diagnostic.latex) {
    lines.push(`  latex: ${diagnostic.latex}`);
  }
  return lines.join("\n");
}

function printUsage() {
  console.log("Usage: node --import tsx scripts/equations-validate.ts [options]");
  console.log("");
  console.log("Options:");
  console.log("  --bootstrap       Equations bootstrap path (JSON file or directory)");
  console.log("  --bootstrap-file  JSON file containing a full equations pane patch or FrameGrid document");
  console.log("  --bootstrap-dir   Directory containing equations-pane.json or equations-* bootstrap files");
  console.log("  --preset          Named equations pane preset from Metrics UI examples");
  console.log("  --patch           Full equations pane patch JSON object");
  console.log("  --patch-file      File path containing full equations pane patch JSON");
  console.log("  --content         Equations pane content patch JSON object");
  console.log("  --content-file    File path containing equations pane content patch JSON");
  console.log("  --dimensions      Equations pane dimensions patch JSON object");
  console.log("  --dimensions-file File path containing equations pane dimensions patch JSON");
  console.log("  --document        Equations FrameGrid document JSON object");
  console.log("  --document-file   File path containing an Equations FrameGrid document JSON");
  console.log("  --context         Equations interaction context patch JSON object");
  console.log("  --context-file    File path containing equations interaction context patch JSON");
  console.log("  --replace         Replace/reset equations pane state before applying patch (true|false)");
  console.log("  --json            Print JSON instead of human-readable diagnostics");
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const contentFileInput = options["content-file"];
  const documentFileInput = options["document-file"];
  const fileBackedEquationsSwap = (
    (typeof contentFileInput === "string" && contentFileInput.trim().length > 0)
    || (typeof documentFileInput === "string" && documentFileInput.trim().length > 0)
  );

  const bootstrap = parseEquationsPaneBootstrap(
    options.bootstrap,
    options["bootstrap-file"],
    options["bootstrap-dir"],
  );
  const preset = parseEquationsPanePreset(options.preset);
  const patch = parseOptionalJsonInput(options.patch, options["patch-file"], "patch");
  const content = parseOptionalJsonInput(options.content, options["content-file"], "content");
  const dimensions = parseOptionalJsonInput(options.dimensions, options["dimensions-file"], "dimensions");
  const document = parseOptionalJsonInput(options.document, options["document-file"], "document");
  const context = parseOptionalJsonInput(options.context, options["context-file"], "context");
  const replaceOption = options.replace;
  const replace = replaceOption === undefined
    ? (fileBackedEquationsSwap ? true : undefined)
    : parseBooleanOption(replaceOption, undefined);

  if (
    bootstrap === null
    && preset === null
    && patch === null
    && content === null
    && dimensions === null
    && document === null
    && context === null
    && replace === undefined
  ) {
    throw new Error(
      "Provide --bootstrap/--bootstrap-file/--bootstrap-dir and/or --preset and/or --patch/--patch-file and/or --content/--content-file and/or --dimensions/--dimensions-file and/or --document/--document-file and/or --context/--context-file and/or --replace true|false.",
    );
  }

  const payload: Record<string, unknown> = {};
  if (bootstrap) {
    Object.assign(payload, bootstrap);
  }
  if (preset) {
    Object.assign(payload, preset);
  }
  if (patch) {
    Object.assign(payload, patch);
  }
  if (content !== null) {
    if (!isPlainObject(content)) {
      throw new Error("Invalid --content JSON. Expected an object.");
    }
    payload.content = content;
  }
  if (dimensions !== null) {
    if (!isPlainObject(dimensions)) {
      throw new Error("Invalid --dimensions JSON. Expected an object.");
    }
    payload.dimensions = dimensions;
  }
  if (document !== null) {
    if (!isPlainObject(document)) {
      throw new Error("Invalid --document JSON. Expected an object.");
    }
    payload.document = document;
  }
  if (context !== null) {
    if (!isPlainObject(context)) {
      throw new Error("Invalid --context JSON. Expected an object.");
    }
    payload.context = context;
  }
  if (replace !== undefined) {
    payload.replace = replace;
  }
  if (payload.content !== undefined && !isPlainObject(payload.content)) {
    throw new Error("Equations pane payload content must be an object.");
  }
  if (payload.dimensions !== undefined && !isPlainObject(payload.dimensions)) {
    throw new Error("Equations pane payload dimensions must be an object.");
  }
  if (payload.document !== undefined && !isPlainObject(payload.document)) {
    throw new Error("Equations pane payload document must be an object.");
  }
  if (payload.context !== undefined && !isPlainObject(payload.context)) {
    throw new Error("Equations pane payload context must be an object.");
  }

  const report = validateEquationsPaneStatePatchInput(payload, {
    replace: payload.replace === true,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Equations validation: ${report.status} (${report.errorCount} error${report.errorCount === 1 ? "" : "s"}, ${report.warningCount} warning${report.warningCount === 1 ? "" : "s"})`,
    );
    if (report.diagnostics.length > 0) {
      console.log("");
      report.diagnostics.forEach((diagnostic, index) => {
        if (index > 0) {
          console.log("");
        }
        console.log(formatDiagnosticLine(diagnostic));
      });
    }
  }

  if (report.errorCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[equations-validate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
