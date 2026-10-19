import { getChaseScenarioDefinition } from "../scenarios/index.mjs";

/** Explicit experiment entry; reject mistakes before the game loop is created. */
export function readExperimentStartup(search = "") {
  const params = new URLSearchParams(search);
  if (!params.has("playScenario")) return null;
  const scenarioId = params.get("playScenario");
  if (getChaseScenarioDefinition(scenarioId).id !== scenarioId) throw new Error("Unknown experiment scenario");
  const controlSource = params.get("playControl") ?? "ws";
  if (!["ws", "keyboard", "programmatic"].includes(controlSource)) throw new Error("Invalid experiment control source");
  if (params.has("playPaused") && params.get("playPaused") !== "1") throw new Error("Experiment entry must start paused");
  return { scenarioId, controlSource, paused: true };
}
