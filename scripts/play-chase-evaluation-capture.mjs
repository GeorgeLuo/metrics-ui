import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { validateEvidenceDirectory } from "./play-chase-evaluation-validate.mjs";

const DEFAULT_OUTPUT_DIRECTORY = "/tmp/chase-evaluation-capture";
const DEFAULT_UI_URL = "ws://127.0.0.1:5050/ws/control";

function parseArgs(argv) {
  const options = {
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    simeval: process.env.SIMEVAL_BIN || "simeval",
    ui: DEFAULT_UI_URL,
    moveMs: 2500,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--out-dir" && value) {
      options.outputDirectory = value;
      index += 1;
      continue;
    }
    if (argv[index] === "--simeval" && value) {
      options.simeval = value;
      index += 1;
      continue;
    }
    if (argv[index] === "--ui" && value) {
      options.ui = value;
      index += 1;
      continue;
    }
    if (argv[index] === "--move-ms" && value) {
      options.moveMs = Number(value);
      index += 1;
    }
  }
  if (!Number.isFinite(options.moveMs) || options.moveMs <= 0) {
    throw new Error("--move-ms must be a positive number.");
  }
  return options;
}

function resolveSimevalCommand(simeval) {
  const resolved = simeval.includes(path.sep) ? path.resolve(simeval) : simeval;
  return resolved.endsWith(".js")
    ? { command: process.execPath, prefix: [resolved] }
    : { command: resolved, prefix: [] };
}

function runSimeval(commandSpec, ui, args) {
  const result = spawnSync(
    commandSpec.command,
    [...commandSpec.prefix, "ui", ...args, "--ui", ui, "--timeout", "5000"],
    { encoding: "utf8" },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `SimEval exited ${result.status}.`);
  }
  return result.stdout.trim();
}

function printStep(message) {
  process.stdout.write(`${message}\n`);
}

function capture(commandSpec, options, name) {
  printStep(`Capture: ${name}`);
  runSimeval(commandSpec, options.ui, [
    "play-evaluation-capture",
    "--actor", "chaser",
    "--width", "640",
    "--height", "480",
    "--name", name,
    "--out-dir", options.outputDirectory,
  ]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const commandSpec = resolveSimevalCommand(options.simeval);
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  let wsControlPrepared = false;

  try {
    printStep("Prepare: Play / chaser-depth-obstacles / WS control");
    runSimeval(commandSpec, options.ui, ["subapp", "--app", "play"]);
    await delay(250);
    runSimeval(commandSpec, options.ui, [
      "play-game-action", "--action-id", "scenario-select", "--value", '"chaser-depth-obstacles"',
    ]);
    runSimeval(commandSpec, options.ui, ["play-chaser-source", "--source", "ws"]);
    wsControlPrepared = true;
    runSimeval(commandSpec, options.ui, [
      "play-chaser-control", "--motion", "none", "--steering", "0",
    ]);
    runSimeval(commandSpec, options.ui, [
      "play-game-action", "--action-id", "simulation-pause-before-actions", "--enabled", "false",
    ]);
    runSimeval(commandSpec, options.ui, [
      "play-game-action", "--action-id", "simulation-reset",
    ]);
    await delay(100);

    capture(commandSpec, options, "before");
    capture(commandSpec, options, "repeat");

    printStep(`Move: reverse for ${options.moveMs} ms under WS control`);
    runSimeval(commandSpec, options.ui, [
      "play-game-action", "--action-id", "simulation-pause-before-actions", "--enabled", "true",
    ]);
    runSimeval(commandSpec, options.ui, [
      "play-chaser-control", "--motion", "reverse", "--steering", "0",
    ]);
    await delay(options.moveMs);
    runSimeval(commandSpec, options.ui, [
      "play-chaser-control", "--motion", "none", "--steering", "0",
    ]);
    runSimeval(commandSpec, options.ui, [
      "play-game-action", "--action-id", "simulation-pause-before-actions", "--enabled", "false",
    ]);
    await delay(100);
    capture(commandSpec, options, "after-move");

    printStep("Reset: create a new simulation epoch");
    runSimeval(commandSpec, options.ui, [
      "play-game-action", "--action-id", "simulation-reset",
    ]);
    await delay(100);
    capture(commandSpec, options, "after-reset");

    const report = validateEvidenceDirectory(options.outputDirectory);
    const reportPath = path.join(path.resolve(options.outputDirectory), "validation.json");
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    printStep(`Validation: ${report.status} (${report.summary.passed}/${report.summary.checks})`);
    printStep(`Evidence: ${path.resolve(options.outputDirectory)}`);
    if (report.status !== "pass") {
      process.exitCode = 1;
    }
  } finally {
    if (wsControlPrepared) {
      try {
        runSimeval(commandSpec, options.ui, [
          "play-chaser-control", "--motion", "none", "--steering", "0",
        ]);
        runSimeval(commandSpec, options.ui, [
          "play-game-action", "--action-id", "simulation-pause-before-actions", "--enabled", "false",
        ]);
      } catch (error) {
        console.error(`[chase-evaluation-capture] cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }
  }
}

await main().catch((error) => {
  console.error(`[chase-evaluation-capture] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
