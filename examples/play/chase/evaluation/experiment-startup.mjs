import { getChaseScenarioDefinition } from "../scenarios/index.mjs";

/** Left-pane actions that are not settings: the scenario comes from playScenario; the rest are buttons and windows. */
const NON_SETTING_ACTION_IDS = new Set(["scenario-select", "simulation-reset", "chaser-view", "evader-view", "idae-debug"]);

function readStartupSettings(params) {
  if (!params.has("playSettings")) return null;
  let settings;
  try { settings = JSON.parse(params.get("playSettings")); } catch { throw new Error("Experiment settings must be JSON"); }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Experiment settings must be an object of left-pane action ids");
  const entries = Object.entries(settings);
  const rejected = entries.find(([id]) => NON_SETTING_ACTION_IDS.has(id));
  if (rejected) throw new Error(`Experiment setting ${rejected[0]} is not a left-pane setting`);
  return entries;
}

/** Explicit experiment entry; reject mistakes before the game loop is created. */
export function readExperimentStartup(search = "") {
  const params = new URLSearchParams(search);
  if (!params.has("playScenario")) return null;
  const scenarioId = params.get("playScenario");
  if (getChaseScenarioDefinition(scenarioId).id !== scenarioId) throw new Error("Unknown experiment scenario");
  const controlSource = params.get("playControl") ?? "ws";
  if (!["ws", "keyboard", "programmatic"].includes(controlSource)) throw new Error("Invalid experiment control source");
  if (params.has("playPaused") && params.get("playPaused") !== "1") throw new Error("Experiment entry must start paused");
  if (params.has("playHeadless") && params.get("playHeadless") !== "1") throw new Error("Invalid experiment headless flag");
  const settings = readStartupSettings(params);
  return {
    scenarioId, controlSource, paused: true,
    ...(settings ? { settings } : {}),
    ...(params.has("playHeadless") ? { headless: true } : {}),
  };
}

/** Run each startup setting through its left-pane handler, in order, after checking every id exists. */
export function applyStartupSettings(descriptors, settings) {
  const handlers = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor.handler]));
  const unknown = settings.find(([id]) => !handlers.has(id));
  if (unknown) throw new Error(`Unknown startup setting ${unknown[0]}`);
  settings.forEach(([id, value]) => handlers.get(id)(value));
}
