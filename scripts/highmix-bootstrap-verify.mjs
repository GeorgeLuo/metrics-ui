#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function parseBool(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function tryParseJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ]) {
    const first = trimmed.indexOf(open);
    const last = trimmed.lastIndexOf(close);
    if (first >= 0 && last > first) {
      const candidate = trimmed.slice(first, last + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // ignore candidate
      }
    }
  }
  return null;
}

function runSimeval(args, options = {}) {
  const { expectJson = false, allowFailure = false } = options;
  try {
    const stdout = execFileSync("simeval", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: repoRoot,
    });
    if (!expectJson) {
      return stdout.trim();
    }
    const parsed = tryParseJson(stdout);
    if (!parsed) {
      throw new Error(`Failed to parse JSON from simeval output: ${stdout}`);
    }
    return parsed;
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr) : "";
    const stdout = error?.stdout ? String(error.stdout) : "";
    const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
    if (!allowFailure) {
      throw new Error(`simeval ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
    }
    return null;
  }
}

function metricKey(captureId, pathValue) {
  const fullPath = Array.isArray(pathValue) ? pathValue.join(".") : String(pathValue ?? "");
  return `${captureId}::${fullPath}`;
}

function loadSpec(specPath) {
  const absolute = path.isAbsolute(specPath) ? specPath : path.resolve(repoRoot, specPath);
  const raw = fs.readFileSync(absolute, "utf8");
  const parsed = JSON.parse(raw);
  return {
    absolutePath: absolute,
    data: parsed,
  };
}

function applyOverrides(spec, args) {
  const next = JSON.parse(JSON.stringify(spec));
  if (!Array.isArray(next.captures)) next.captures = [];

  const legacyOverride = args.legacySource || args.legacy;
  const causalOverride = args.causalSource || args.causal;
  if (legacyOverride) {
    const legacy = next.captures.find((entry) => entry.id === "legacy");
    if (legacy) legacy.source = legacyOverride;
  }
  if (causalOverride) {
    const causal = next.captures.find((entry) => entry.id === "causal");
    if (causal) causal.source = causalOverride;
  }
  return next;
}

function verifyShape(spec) {
  if (!Array.isArray(spec.captures) || spec.captures.length === 0) {
    throw new Error("Spec is missing captures.");
  }
  if (!Array.isArray(spec.selectedMetrics) || spec.selectedMetrics.length === 0) {
    throw new Error("Spec is missing selectedMetrics.");
  }
  if (!spec.visualization || typeof spec.visualization !== "object") {
    throw new Error("Spec is missing visualization configuration.");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function evaluateSnapshot(spec, snapshot, debug) {
  const failures = [];
  const warnings = [];

  const captures = Array.isArray(snapshot?.captures) ? snapshot.captures : [];
  const selected = Array.isArray(snapshot?.selectedMetrics) ? snapshot.selectedMetrics : [];
  const selectedSet = new Set(
    selected.map((entry) => metricKey(entry.captureId, entry.fullPath ?? entry.path)),
  );

  for (const captureSpec of spec.captures) {
    const found = captures.find((entry) => entry.id === captureSpec.id);
    if (!found) {
      failures.push({
        type: "capture-missing",
        captureId: captureSpec.id,
      });
      continue;
    }
    const tickCount =
      typeof found.tickCount === "number" && Number.isFinite(found.tickCount) ? found.tickCount : -1;
    const minTickCount = parseNumber(captureSpec.minTickCount, 1);
    if (tickCount < minTickCount) {
      failures.push({
        type: "capture-underflow",
        captureId: captureSpec.id,
        tickCount,
        minTickCount,
      });
    }
  }

  for (const metric of spec.selectedMetrics) {
    const key = metricKey(metric.captureId, metric.path);
    if (!selectedSet.has(key)) {
      failures.push({
        type: "metric-missing",
        captureId: metric.captureId,
        fullPath: Array.isArray(metric.path) ? metric.path.join(".") : String(metric.path ?? ""),
      });
    }
  }

  const vizState = debug?.refs?.visualization ?? null;
  if (!vizState) {
    failures.push({ type: "visualization-missing" });
  } else {
    if (spec.visualization.pluginId && vizState.pluginId !== spec.visualization.pluginId) {
      failures.push({
        type: "visualization-plugin-mismatch",
        expected: spec.visualization.pluginId,
        actual: vizState.pluginId ?? null,
      });
    }
    if (spec.visualization.captureId && vizState.captureId !== spec.visualization.captureId) {
      failures.push({
        type: "visualization-capture-mismatch",
        expected: spec.visualization.captureId,
        actual: vizState.captureId ?? null,
      });
    }
    if (spec.visualization.requireVisualSignal && vizState.hasVisualSignal !== true) {
      failures.push({
        type: "visualization-not-visible",
        visualSignal: vizState.visualSignal ?? "none",
      });
    }
    if (vizState.pluginReportError) {
      warnings.push({
        type: "visualization-plugin-warning",
        message: vizState.pluginReportError,
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    summary: {
      captures: captures.length,
      selectedMetrics: selected.length,
      visualization: vizState
        ? {
            pluginId: vizState.pluginId ?? null,
            captureId: vizState.captureId ?? null,
            hasVisualSignal: Boolean(vizState.hasVisualSignal),
            visualSignal: vizState.visualSignal ?? "none",
          }
        : null,
    },
  };
}

function bootstrapState(spec, uiHttp, uiWs, skipBootstrap) {
  if (skipBootstrap) {
    return;
  }

  runSimeval(["ui", "live-stop", "--ui", uiWs], { allowFailure: true });
  runSimeval(["ui", "clear-captures", "--ui", uiWs], { allowFailure: true });
  runSimeval(["ui", "clear", "--ui", uiWs], { allowFailure: true });
  runSimeval(["ui", "analysis-clear", "--ui", uiWs], { allowFailure: true });
  runSimeval(["ui", "clear-annotations", "--ui", uiWs], { allowFailure: true });
  runSimeval(["ui", "clear-subtitles", "--ui", uiWs], { allowFailure: true });
  runSimeval(["ui", "visualization-reset", "--ui", uiWs], { allowFailure: true });

  const pluginFile = path.isAbsolute(spec.visualization.pluginFile)
    ? spec.visualization.pluginFile
    : path.resolve(repoRoot, spec.visualization.pluginFile);
  runSimeval(
    ["ui", "visualization-plugin-upload", "--file", pluginFile, "--ui", uiHttp],
    { expectJson: true },
  );

  for (const capture of spec.captures) {
    runSimeval(
      [
        "ui",
        "live-start",
        "--capture-id",
        capture.id,
        "--source",
        capture.source,
        "--ui",
        uiWs,
      ],
      { expectJson: true },
    );
  }

  for (const metric of spec.selectedMetrics) {
    runSimeval(
      [
        "ui",
        "select",
        "--capture-id",
        metric.captureId,
        "--path",
        JSON.stringify(metric.path),
        "--ui",
        uiWs,
      ],
      { allowFailure: false },
    );
  }

  runSimeval(
    [
      "ui",
      "visualization-use",
      "--plugin-id",
      spec.visualization.pluginId,
      "--capture-id",
      spec.visualization.captureId,
      "--ui",
      uiWs,
    ],
    { allowFailure: false },
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const specPath = args.spec || "examples/highmix/view-spec.json";
  const { absolutePath, data } = loadSpec(specPath);
  const spec = applyOverrides(data, args);
  verifyShape(spec);

  const uiHttp = args.uiHttp || args.uiHttpUrl || spec.ui?.http || "http://127.0.0.1:5050";
  const uiWs = args.uiWs || args.uiWsUrl || spec.ui?.ws || "ws://127.0.0.1:5050/ws/control";
  const timeoutMs = parseNumber(args.timeoutMs, 45000);
  const intervalMs = parseNumber(args.intervalMs, 1000);
  const skipBootstrap = parseBool(args.verifyOnly, false);

  bootstrapState(spec, uiHttp, uiWs, skipBootstrap);

  const startedAt = Date.now();
  let lastEval = null;
  let snapshot = null;
  let debug = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      snapshot = runSimeval(["ui", "display-snapshot", "--ui", uiWs], { expectJson: true });
      debug = runSimeval(["ui", "debug", "--ui", uiWs], { expectJson: true });
      lastEval = evaluateSnapshot(spec, snapshot, debug);
    } catch (error) {
      lastEval = {
        ok: false,
        failures: [
          {
            type: "probe-failed",
            error: error instanceof Error ? error.message : String(error),
          },
        ],
        warnings: [],
        summary: null,
      };
    }
    if (lastEval.ok) {
      break;
    }
    await sleep(intervalMs);
  }

  const result = {
    status: lastEval?.ok ? "ok" : "failed",
    checkedAt: new Date().toISOString(),
    specPath: absolutePath,
    ui: { http: uiHttp, ws: uiWs },
    bootstrapApplied: !skipBootstrap,
    summary: lastEval?.summary ?? null,
    failures: lastEval?.failures ?? [{ type: "unknown" }],
    warnings: lastEval?.warnings ?? [],
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!lastEval?.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  const result = {
    status: "failed",
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(1);
});
