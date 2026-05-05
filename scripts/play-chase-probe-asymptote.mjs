import path from "node:path";
import { pathToFileURL } from "node:url";
import { probeChaseStrategyComparisonConvergence } from "../examples/play/chase/chase-strategy-comparison.mjs";

function parseFrameSets(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = value
    .split(",")
    .map((entry) => Math.max(0, Math.floor(Number(entry.trim()) || 0)))
    .filter((entry) => entry > 0);
  return parsed.length > 0 ? parsed : null;
}

function parseArgs(argv) {
  const options = {
    configPath: "examples/play/chase/scenarios/default-comparison.mjs",
    frameSets: null,
    threshold: 0.1,
    warmupFrames: undefined,
    warmupRatio: undefined,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--config" && typeof argv[index + 1] === "string") {
      options.configPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--frames" && typeof argv[index + 1] === "string") {
      options.frameSets = parseFrameSets(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--threshold" && typeof argv[index + 1] === "string") {
      const threshold = Number(argv[index + 1]);
      if (Number.isFinite(threshold) && threshold >= 0) {
        options.threshold = threshold;
      }
      index += 1;
      continue;
    }
    if (arg === "--warmup-frames" && typeof argv[index + 1] === "string") {
      const warmupFrames = Math.max(0, Math.floor(Number(argv[index + 1]) || 0));
      options.warmupFrames = warmupFrames;
      index += 1;
      continue;
    }
    if (arg === "--warmup-ratio" && typeof argv[index + 1] === "string") {
      const warmupRatio = Number(argv[index + 1]);
      if (Number.isFinite(warmupRatio) && warmupRatio >= 0 && warmupRatio <= 1) {
        options.warmupRatio = warmupRatio;
      }
      index += 1;
    }
  }

  return options;
}

function formatNumber(value, digits = 6) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function printProbeSummary(probe) {
  console.log(`Convergence threshold: ${formatNumber(probe.convergenceThreshold, 3)} touches / 1k frames`);
  console.log(`Converged at: ${probe.convergedAtTotalFrames ?? "not reached"}`);
  console.table(
    probe.comparisons.map((comparison) => ({
      fromFrames: comparison.fromTotalFrames,
      toFrames: comparison.toTotalFrames,
      maxDelta: formatNumber(comparison.maxAbsoluteDelta, 6),
      converged: comparison.converged ? "yes" : "no",
    })),
  );
}

const options = parseArgs(process.argv.slice(2));
const configModulePath = path.resolve(process.cwd(), options.configPath);
const configModule = await import(pathToFileURL(configModulePath).href);
const config = configModule.default ?? {};
const resolvedWarmupFrames = options.warmupFrames !== undefined
  ? options.warmupFrames
  : options.warmupRatio !== undefined
    ? null
    : config.warmupFrames;
const probe = probeChaseStrategyComparisonConvergence({
  ...config,
  frameSets: options.frameSets ?? undefined,
  convergenceThreshold: options.threshold,
  warmupFrames: resolvedWarmupFrames,
  warmupRatio: options.warmupRatio ?? config.warmupRatio,
});

if (options.asJson) {
  console.log(JSON.stringify(probe, null, 2));
} else {
  printProbeSummary(probe);
}
