import path from "node:path";
import { pathToFileURL } from "node:url";
import { compareChaseStrategyCombinations } from "../examples/play/chase/simulation/chase-strategy-comparison.mjs";

function parseArgs(argv) {
  const options = {
    configPath: "examples/play/chase/scenarios/default-comparison.mjs",
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
    }
  }

  return options;
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function printTable(results) {
  const rows = results.map((result) => ({
    id: result.id,
    touchesPer1k: formatNumber(result.touchesPerThousandFrames),
    measurementTouches: String(result.measurementTouchCount),
    measurementFrames: String(result.measurementFrames),
    chaserStrategies: Object.entries(result.chaserStrategies)
      .filter(([, enabled]) => enabled)
      .map(([strategyId]) => strategyId)
      .join(", "),
    evaderStrategies: Object.entries(result.evaderStrategies)
      .filter(([, enabled]) => enabled)
      .map(([strategyId]) => strategyId)
      .join(", "),
  }));
  console.table(rows);
}

const options = parseArgs(process.argv.slice(2));
const configModulePath = path.resolve(process.cwd(), options.configPath);
const configModule = await import(pathToFileURL(configModulePath).href);
const config = configModule.default ?? {};
const results = compareChaseStrategyCombinations(config);

if (options.asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  printTable(results);
}
