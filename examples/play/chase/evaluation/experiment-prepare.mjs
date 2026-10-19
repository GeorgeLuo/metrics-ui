import { readExperimentStartup } from "./experiment-startup.mjs";

/** Validate the whole request before touching the paused scene. */
export function prepareChaseExperiment(payload, { pause, neutralize, replace, configureTrace }) {
  const maxFrames = payload?.maxFrames ?? 20001;
  if (!Number.isInteger(maxFrames) || maxFrames < 2 || maxFrames > 20001) throw new Error("Invalid maxFrames");
  const options = readExperimentStartup(new URLSearchParams({
    playScenario: payload?.scenarioId ?? "", playControl: payload?.controlSource ?? "ws", playPaused: "1",
  }).toString());
  pause();
  neutralize();
  replace(options);
  configureTrace({ enabled: true, maxFrames });
}
