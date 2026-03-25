import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(projectRoot, "file-size-lint.json");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
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
    const next = argv[index + 1];
    if (typeof next === "undefined" || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/lint-file-sizes.mjs [--config <path>]

Checks tracked file sizes against line and byte limits declared in a JSON config.

Options:
  --config <path>   Path to the lint config JSON. Defaults to file-size-lint.json
  --help            Show this message
`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPosixRelative(absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeRule(rawRule, index) {
  if (!isPlainObject(rawRule)) {
    throw new Error(`Rule at index ${index} must be an object.`);
  }
  const name = typeof rawRule.name === "string" && rawRule.name.trim().length > 0
    ? rawRule.name.trim()
    : `rule-${index + 1}`;
  const include = normalizeStringArray(rawRule.include);
  const exclude = normalizeStringArray(rawRule.exclude);
  const extensions = normalizeStringArray(rawRule.extensions);
  const maxLines = typeof rawRule.maxLines === "number" && Number.isFinite(rawRule.maxLines)
    ? Math.floor(rawRule.maxLines)
    : null;
  const maxBytes = typeof rawRule.maxBytes === "number" && Number.isFinite(rawRule.maxBytes)
    ? Math.floor(rawRule.maxBytes)
    : null;

  if (include.length === 0) {
    throw new Error(`Rule "${name}" must include at least one file or directory.`);
  }
  if (maxLines === null && maxBytes === null) {
    throw new Error(`Rule "${name}" must define maxLines, maxBytes, or both.`);
  }
  if (maxLines !== null && maxLines < 1) {
    throw new Error(`Rule "${name}" has an invalid maxLines value.`);
  }
  if (maxBytes !== null && maxBytes < 1) {
    throw new Error(`Rule "${name}" has an invalid maxBytes value.`);
  }

  return {
    name,
    include,
    exclude,
    extensions,
    maxLines,
    maxBytes,
  };
}

function loadConfig(configPath) {
  let rawText;
  try {
    rawText = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read config ${configPath}: ${message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${configPath}: ${message}`);
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.rules)) {
    throw new Error(`Config ${configPath} must be an object with a rules array.`);
  }

  return parsed.rules.map((rawRule, index) => normalizeRule(rawRule, index));
}

function pathMatchesPrefix(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function walkDirectory(directoryPath, files) {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(absolutePath, files);
      return;
    }
    if (entry.isFile()) {
      files.add(absolutePath);
    }
  });
}

function collectRuleFiles(rule) {
  const collected = new Set();
  rule.include.forEach((entry) => {
    const absolutePath = path.resolve(projectRoot, entry);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Rule "${rule.name}" includes a missing path: ${entry}`);
    }
    const stats = fs.statSync(absolutePath);
    if (stats.isDirectory()) {
      walkDirectory(absolutePath, collected);
      return;
    }
    if (stats.isFile()) {
      collected.add(absolutePath);
      return;
    }
    throw new Error(`Rule "${rule.name}" includes a non-file, non-directory path: ${entry}`);
  });

  const excludedPrefixes = rule.exclude.map((entry) =>
    path.resolve(projectRoot, entry).split(path.sep).join("/"));

  const files = [...collected]
    .filter((absolutePath) => {
      const normalizedAbsolute = absolutePath.split(path.sep).join("/");
      return !excludedPrefixes.some((prefix) => pathMatchesPrefix(normalizedAbsolute, prefix));
    })
    .filter((absolutePath) => {
      if (rule.extensions.length === 0) {
        return true;
      }
      return rule.extensions.includes(path.extname(absolutePath));
    })
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error(`Rule "${rule.name}" did not match any files.`);
  }

  return files;
}

function countLines(text) {
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\r\n|\r|\n/u).length;
}

function lintRule(rule) {
  const files = collectRuleFiles(rule);
  const failures = [];

  files.forEach((absolutePath) => {
    const text = fs.readFileSync(absolutePath, "utf8");
    const lineCount = countLines(text);
    const byteCount = Buffer.byteLength(text, "utf8");
    const relativePath = toPosixRelative(absolutePath);

    if (rule.maxLines !== null && lineCount > rule.maxLines) {
      failures.push(
        `${relativePath}: ${lineCount} lines exceeds maxLines ${rule.maxLines}`,
      );
    }
    if (rule.maxBytes !== null && byteCount > rule.maxBytes) {
      failures.push(
        `${relativePath}: ${byteCount} bytes exceeds maxBytes ${rule.maxBytes}`,
      );
    }
  });

  return {
    rule,
    fileCount: files.length,
    failures,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const configPath = path.resolve(
    process.cwd(),
    typeof options.config === "string" ? options.config : DEFAULT_CONFIG_PATH,
  );
  const rules = loadConfig(configPath);
  const results = rules.map((rule) => lintRule(rule));
  const failures = results.flatMap((result) =>
    result.failures.map((failure) => ({ ruleName: result.rule.name, failure })),
  );

  results.forEach((result) => {
    console.log(
      `[file-size-lint] ${result.rule.name}: checked ${result.fileCount} file${result.fileCount === 1 ? "" : "s"}.`,
    );
  });

  if (failures.length > 0) {
    console.error("\n[file-size-lint] Failures:");
    failures.forEach(({ ruleName, failure }) => {
      console.error(`  - ${ruleName}: ${failure}`);
    });
    process.exitCode = 1;
    return;
  }

  console.log("\n[file-size-lint] OK");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[file-size-lint] ${message}`);
  process.exitCode = 1;
}
