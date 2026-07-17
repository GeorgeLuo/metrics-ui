import {
  CHASER_CONTROL_SOURCE_ACTION_ID,
  CHASER_CONTROL_SOURCES,
  EVADER_EXISTS_ACTION_ID,
  RENDERING_PROFILE_ACTION_ID,
  SCENARIO_SELECT_ACTION_ID,
  SIMULATION_FPS_ACTION_ID,
  SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
  SIMULATION_RESET_ACTION_ID,
} from "../../config/constants.mjs";
import { formatEditableNumber } from "../../decision-model/core/math.ts";

function formatRunMetric(value, digits = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? formatEditableNumber(numericValue, digits)
    : "0";
}

function normalizeOptions(options) {
  return Array.isArray(options)
    ? options
      .filter((option) => option?.value && option?.label)
      .map((option) => ({
        value: String(option.value),
        label: String(option.label),
      }))
    : [];
}

function buildScenarioRows(scenarioControls) {
  const options = normalizeOptions(scenarioControls.options);
  const activeScenarioId = String(scenarioControls.activeScenarioId ?? "");
  if (options.length === 0 || !activeScenarioId) {
    return [];
  }
  return [
    { kind: "header", label: "Scenario" },
    {
      kind: "select",
      id: SCENARIO_SELECT_ACTION_ID,
      label: "Loaded",
      value: activeScenarioId,
      options,
      hint: "Switch the scenario config used by the Chase simulation.",
    },
    {
      kind: "toggle",
      id: EVADER_EXISTS_ACTION_ID,
      label: "Evader",
      enabled: scenarioControls.evaderExists !== false,
      enabledLabel: "present",
      disabledLabel: "absent",
      hint: "Override whether the active scenario includes the evader.",
    },
  ];
}

function buildRenderingProfileRow(scenarioControls) {
  const options = normalizeOptions(scenarioControls.renderingProfileOptions);
  const renderingProfileId = String(scenarioControls.renderingProfileId ?? "");
  return options.length > 0 && renderingProfileId
    ? [{
      kind: "select",
      id: RENDERING_PROFILE_ACTION_ID,
      label: "Rendering",
      value: renderingProfileId,
      options,
      hint: "Select the resolved visual profile used by the main scene, actor views, and snapshots.",
    }]
    : [];
}

function buildChaserControlSourceRow(chaserControlSource) {
  return {
    kind: "select",
    id: CHASER_CONTROL_SOURCE_ACTION_ID,
    label: "Chaser control",
    value: Object.values(CHASER_CONTROL_SOURCES).includes(chaserControlSource)
      ? chaserControlSource
      : CHASER_CONTROL_SOURCES.PROGRAMMATIC,
    options: [
      { value: CHASER_CONTROL_SOURCES.PROGRAMMATIC, label: "decision model" },
      { value: CHASER_CONTROL_SOURCES.KEYBOARD, label: "keyboard" },
      { value: CHASER_CONTROL_SOURCES.WS, label: "WS" },
    ],
    hint: "Choose the single control source consumed by the chaser each simulation frame.",
  };
}

/** Builds the Game section without owning runtime action dispatch. */
export function buildGameRows({
  chaserControlSource,
  simulationSettings,
  runMetrics = {},
  scenarioControls = {},
}) {
  return [
    { kind: "header", label: "Score" },
    { kind: "value", label: "Touches", value: formatRunMetric(runMetrics.touchCount, 0) },
    { kind: "value", label: "Frames", value: formatRunMetric(runMetrics.elapsedFrames, 0) },
    {
      kind: "value",
      label: "Touches / 1k frames",
      value: formatRunMetric(runMetrics.touchRatePerThousandFrames, 2),
    },
    ...buildScenarioRows(scenarioControls),
    { kind: "header", label: "Simulation" },
    {
      kind: "editableValue",
      id: SIMULATION_FPS_ACTION_ID,
      label: "FPS",
      value: formatEditableNumber(simulationSettings.framesPerSecond, 0),
      suffix: "frames/s",
      hint: "How many simulation frames to advance per real-time second while watching the run.",
    },
    ...buildRenderingProfileRow(scenarioControls),
    {
      kind: "toggle",
      id: SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
      label: "Playback",
      enabled: !Boolean(simulationSettings.pauseBeforeActions),
      enabledLabel: "playing",
      disabledLabel: "paused",
      tone: "playback",
      hint: "Freeze after actor reasoning runs for the current frame, before actions update the world.",
    },
    buildChaserControlSourceRow(chaserControlSource),
    {
      kind: "action",
      id: SIMULATION_RESET_ACTION_ID,
      label: "Reset",
      hint: "Reset the Chase run to a fresh initial state.",
    },
  ];
}
