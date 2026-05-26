import {
  CHASER_ACTION_PATH_HORIZON_ACTION_ID,
  CHASER_ACTION_PATH_RATE_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_MODES,
  CHASER_AUTOPILOT_ACTION_ID,
  CHASER_MAP_OVERLAY_ACTION_ID,
  CHASER_MAP_OVERLAY_VIEW_MODES,
  CHASER_VIEW_ACTION_ID,
  CHASER_SPEED_ACTION_ID,
  DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
  DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
  EVADER_EXISTS_ACTION_ID,
  SCENARIO_SELECT_ACTION_ID,
  EVADER_VIEW_ACTION_ID,
  IDAE_DEBUG_ACTION_ID,
  SIMULATION_FPS_ACTION_ID,
  EVADER_PROJECTION_HORIZON_ACTION_ID,
  EVADER_PROJECTION_RATE_ACTION_ID,
  EVADER_PROJECTION_VIEW_ACTION_ID,
  EVADER_PROJECTION_VIEW_MODES,
  EVADER_SPEED_ACTION_ID,
  VEHICLE_FOV_ACTION_ID,
  VEHICLE_TURN_RATE_ACTION_ID,
  SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
  SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
  SIMULATION_RESET_ACTION_ID,
} from "../config/constants.mjs";
import { CHASER_STRATEGY_MOTIVE_GROUPS } from "../config/strategy-ids.mjs";
import { formatEditableNumber, radiansToDegrees } from "../decision-model/core/math.ts";

function formatRunMetric(value, digits = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "0";
  }
  return formatEditableNumber(numericValue, digits);
}

function formatActorLabel(actorId) {
  const value = String(actorId ?? "").trim();
  if (!value) {
    return "Actor";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatStrategyLabel(strategyId) {
  const value = String(strategyId ?? "").trim();
  if (!value) {
    return "Strategy";
  }
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

export function createActorStrategyToggleActionId(actorId, strategyId) {
  return `actor-strategy:${String(actorId ?? "").trim()}:${String(strategyId ?? "").trim()}`;
}

function buildActorStrategyToggleRow(actorId, strategyId, enabled) {
  return {
    kind: "toggle",
    id: createActorStrategyToggleActionId(actorId, strategyId),
    label: formatStrategyLabel(strategyId),
    enabled: Boolean(enabled),
    enabledLabel: "on",
    disabledLabel: "off",
    hint: `Enable or disable ${formatActorLabel(actorId).toLowerCase()} peer strategy ${formatStrategyLabel(strategyId).toLowerCase()}.`,
  };
}

function buildChaserStrategyRows(strategies = {}) {
  const strategyEntries = strategies && typeof strategies === "object" ? strategies : {};
  const knownStrategyIds = new Set();
  const groupedRows = CHASER_STRATEGY_MOTIVE_GROUPS.flatMap((group) => {
    const motiveRows = group.strategyIds
      .filter((strategyId) => Object.prototype.hasOwnProperty.call(strategyEntries, strategyId))
      .map((strategyId) => {
        knownStrategyIds.add(strategyId);
        return buildActorStrategyToggleRow("chaser", strategyId, strategyEntries[strategyId]);
      });
    return motiveRows.length > 0
      ? [
        { kind: "header", label: `Chaser motive: ${group.label}` },
        ...motiveRows,
      ]
      : [];
  });
  const ungroupedRows = Object.entries(strategyEntries)
    .filter(([strategyId]) => !knownStrategyIds.has(strategyId))
    .map(([strategyId, enabled]) => buildActorStrategyToggleRow("chaser", strategyId, enabled));
  return ungroupedRows.length > 0
    ? [
      ...groupedRows,
      { kind: "header", label: "Chaser motive: Other" },
      ...ungroupedRows,
    ]
    : groupedRows;
}

function buildUngroupedActorStrategyRows(actorId, strategies = {}) {
  const strategyEntries = strategies && typeof strategies === "object" ? strategies : {};
  const rows = Object.entries(strategyEntries)
    .map(([strategyId, enabled]) => buildActorStrategyToggleRow(actorId, strategyId, enabled));
  return rows.length > 0
    ? [
      { kind: "header", label: `${formatActorLabel(actorId)} strategies` },
      ...rows,
    ]
    : [];
}

function buildActorStrategyRows(actorStrategyCollections = {}) {
  const chaserRows = buildChaserStrategyRows(actorStrategyCollections.chaser);
  const otherActorRows = Object.entries(actorStrategyCollections)
    .filter(([actorId]) => actorId !== "chaser")
    .flatMap(([actorId, strategies]) => buildUngroupedActorStrategyRows(actorId, strategies));
  return [
    ...chaserRows,
    ...otherActorRows,
  ];
}

function buildProgrammaticChaserRow(programmaticChaserEnabled) {
  return {
    kind: "toggle",
    id: CHASER_AUTOPILOT_ACTION_ID,
    label: "Programmatic chaser",
    enabled: programmaticChaserEnabled,
    enabledLabel: "on",
    disabledLabel: "off",
    hint: "Let the game algorithm press the same forward, reverse, and steering inputs available to a human player.",
  };
}

function getEvaderProjectionViewMode(projectionSettings = {}, predictionDebugState = {}) {
  if (predictionDebugState.visible) {
    return EVADER_PROJECTION_VIEW_MODES.PREDICTION_PATHS;
  }
  return projectionSettings.visible
    ? EVADER_PROJECTION_VIEW_MODES.ESTIMATE
    : EVADER_PROJECTION_VIEW_MODES.HIDDEN;
}

function getChaserActionPathViewMode(actionPathDebugState = {}) {
  return Object.values(CHASER_ACTION_PATH_VIEW_MODES).includes(actionPathDebugState.viewMode)
    ? actionPathDebugState.viewMode
    : CHASER_ACTION_PATH_VIEW_MODES.HIDDEN;
}

function getChaserMapOverlayViewMode(mapKnowledgeDebugState = {}) {
  if (Object.values(CHASER_MAP_OVERLAY_VIEW_MODES).includes(mapKnowledgeDebugState.viewMode)) {
    return mapKnowledgeDebugState.viewMode;
  }
  if (mapKnowledgeDebugState.visible && mapKnowledgeDebugState.recencyVisible) {
    return CHASER_MAP_OVERLAY_VIEW_MODES.ALL;
  }
  if (mapKnowledgeDebugState.recencyVisible) {
    return CHASER_MAP_OVERLAY_VIEW_MODES.RECENCY;
  }
  return mapKnowledgeDebugState.visible
    ? CHASER_MAP_OVERLAY_VIEW_MODES.KNOWLEDGE
    : CHASER_MAP_OVERLAY_VIEW_MODES.HIDDEN;
}

function getPositiveFrameCount(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.round(numericValue))
    : fallback;
}

function buildScenarioRows(scenarioControls = {}) {
  const options = Array.isArray(scenarioControls.options)
    ? scenarioControls.options
      .filter((option) => option?.value && option?.label)
      .map((option) => ({
        value: String(option.value),
        label: String(option.label),
      }))
    : [];
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

export function publishSidebarSections(
  setSidebarSections,
  programmaticChaserEnabled,
  frameVisibility,
  simulationSettings,
  vehicleSettings,
  projectionSettings,
  actorStrategyCollections = {},
  runMetrics = {},
  scenarioControls = {},
  predictionDebugState = {},
  actionPathDebugState = {},
  mapKnowledgeDebugState = {},
) {
  if (typeof setSidebarSections !== "function") {
    return;
  }

  const evaderExists = scenarioControls.evaderExists !== false;
  const gameRows = [
    { kind: "header", label: "Score" },
    {
      kind: "value",
      label: "Touches",
      value: formatRunMetric(runMetrics.touchCount, 0),
    },
    {
      kind: "value",
      label: "Frames",
      value: formatRunMetric(runMetrics.elapsedFrames, 0),
    },
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
    {
      kind: "toggle",
      id: SIMULATION_PAUSE_BEFORE_ACTIONS_ID,
      label: "Playback",
      enabled: !Boolean(simulationSettings.pauseBeforeActions),
      enabledLabel: "playing",
      disabledLabel: "paused",
      tone: "playback",
      hint: "Freeze after all actor reasoning has run for the current frame, before actions update the world.",
    },
    {
      kind: "action",
      id: SIMULATION_RESET_ACTION_ID,
      label: "Reset",
      hint: "Reset the Chase run to a fresh initial state.",
    },
  ];
  const sections = [
    {
      id: "game",
      title: "Game",
      hint: "Score, scenario, and simulation settings for the active Chase run.",
      rows: gameRows,
    },
    {
      id: "view",
      title: "View",
      hint: "Launch windows and toggle visual debug layers for the active Chase run.",
      rows: [
        { kind: "header", label: "Path visualizations" },
        ...(evaderExists ? [
          {
            kind: "select",
            id: EVADER_PROJECTION_VIEW_ACTION_ID,
            label: "Evader projection",
            value: getEvaderProjectionViewMode(projectionSettings, predictionDebugState),
            options: [
              {
                value: EVADER_PROJECTION_VIEW_MODES.HIDDEN,
                label: "off",
              },
              {
                value: EVADER_PROJECTION_VIEW_MODES.ESTIMATE,
                label: "consensus",
              },
              {
                value: EVADER_PROJECTION_VIEW_MODES.PREDICTION_PATHS,
                label: "split",
              },
            ],
            hint: "Choose the main-view evader projection display.",
          },
          {
            kind: "editableValue",
            id: EVADER_PROJECTION_HORIZON_ACTION_ID,
            label: "Horizon",
            value: formatEditableNumber(projectionSettings.horizonFrames, 0),
            suffix: "frames",
            hint: "How many game frames into the future to project.",
          },
          {
            kind: "editableValue",
            id: EVADER_PROJECTION_RATE_ACTION_ID,
            label: "Spacing",
            value: formatEditableNumber(projectionSettings.sampleSpacingFrames, 0),
            suffix: "frames",
            hint: "How many future frames to skip between projected rectangles.",
          },
        ] : []),
        {
          kind: "select",
          id: CHASER_ACTION_PATH_VIEW_ACTION_ID,
          label: "Chaser paths",
          value: getChaserActionPathViewMode(actionPathDebugState),
          options: [
            {
              value: CHASER_ACTION_PATH_VIEW_MODES.HIDDEN,
              label: "off",
            },
            {
              value: CHASER_ACTION_PATH_VIEW_MODES.ALL,
              label: "all",
            },
            {
              value: CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS,
              label: "consensus",
            },
            {
              value: CHASER_ACTION_PATH_VIEW_MODES.EVADER_PREDICTION_PURSUIT,
              label: "prediction",
            },
            {
              value: CHASER_ACTION_PATH_VIEW_MODES.LINE_OF_SIGHT_PURSUIT,
              label: "line of sight",
            },
            {
              value: CHASER_ACTION_PATH_VIEW_MODES.MAP_DISCOVERY,
              label: "map discovery",
            },
            {
              value: CHASER_ACTION_PATH_VIEW_MODES.MAP_RECENCY_REFRESH,
              label: "map recency",
            },
            {
              value: CHASER_ACTION_PATH_VIEW_MODES.SPIN,
              label: "spin",
            },
          ],
          hint: "Choose which feasible chaser proposal paths to draw in the main Chase view.",
        },
        {
          kind: "editableValue",
          id: CHASER_ACTION_PATH_HORIZON_ACTION_ID,
          label: "Chaser horizon",
          value: formatEditableNumber(
            getPositiveFrameCount(
              actionPathDebugState.horizonFrames,
              DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
            ),
            0,
          ),
          suffix: "frames",
          hint: "How many game frames of feasible chaser proposal paths to draw.",
        },
        {
          kind: "editableValue",
          id: CHASER_ACTION_PATH_RATE_ACTION_ID,
          label: "Chaser spacing",
          value: formatEditableNumber(
            getPositiveFrameCount(
              actionPathDebugState.sampleSpacingFrames,
              DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
            ),
            0,
          ),
          suffix: "frames",
          hint: "How many future frames to skip between chaser path rectangles.",
        },
        {
          kind: "select",
          id: CHASER_MAP_OVERLAY_ACTION_ID,
          label: "Map overlay",
          value: getChaserMapOverlayViewMode(mapKnowledgeDebugState),
          options: [
            {
              value: CHASER_MAP_OVERLAY_VIEW_MODES.HIDDEN,
              label: "off",
            },
            {
              value: CHASER_MAP_OVERLAY_VIEW_MODES.KNOWLEDGE,
              label: "knowledge",
            },
            {
              value: CHASER_MAP_OVERLAY_VIEW_MODES.RECENCY,
              label: "recency",
            },
            {
              value: CHASER_MAP_OVERLAY_VIEW_MODES.ALL,
              label: "all",
            },
          ],
          hint: "Choose which chaser map-memory overlay to draw in the main Chase view.",
        },
        { kind: "header", label: "Debug" },
        {
          kind: "toggle",
          id: SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
          label: "Debug overlay",
          enabled: Boolean(simulationSettings.greentextDebugVisible),
          enabledLabel: "shown",
          disabledLabel: "hidden",
          hint: "Show or hide a green text debug overlay in the bottom-right of the Chase view.",
        },
        { kind: "header", label: "Windows" },
        {
          kind: "toggle",
          id: CHASER_VIEW_ACTION_ID,
          label: "Chaser View",
          enabled: frameVisibility.chaserViewVisible,
          enabledLabel: "open",
          disabledLabel: "closed",
          hint: "Open or close the chaser's forward-looking viewport.",
        },
        ...(evaderExists ? [{
          kind: "toggle",
          id: EVADER_VIEW_ACTION_ID,
          label: "Evader View",
          enabled: frameVisibility.evaderViewVisible,
          enabledLabel: "open",
          disabledLabel: "closed",
          hint: "Open or close the evader's forward-looking viewport.",
        }] : []),
        {
          kind: "toggle",
          id: IDAE_DEBUG_ACTION_ID,
          label: "IDAE Debug",
          enabled: frameVisibility.idaeDebugVisible,
          enabledLabel: "open",
          disabledLabel: "closed",
          hint: "Open or close the live actor reasoning debug window.",
        },
      ],
    },
    {
      id: "vehicle",
      title: "Vehicle",
      hint: "Game-provided vehicle parameters for the active Play example.",
      rows: [
        {
          kind: "editableValue",
          id: CHASER_SPEED_ACTION_ID,
          label: "Chaser speed",
          value: formatEditableNumber(vehicleSettings.chaserSpeedUnitsPerFrame, 3),
          suffix: "u/frame",
          hint: "Edit the blue chaser speed used for movement and intercept planning.",
        },
        ...(evaderExists ? [{
          kind: "editableValue",
          id: EVADER_SPEED_ACTION_ID,
          label: "Evader speed",
          value: formatEditableNumber(vehicleSettings.evaderSpeedUnitsPerFrame, 3),
          suffix: "u/frame",
          hint: "Edit the red evader's true movement speed; the chaser must estimate this from field of view.",
        }] : []),
        {
          kind: "editableValue",
          id: VEHICLE_TURN_RATE_ACTION_ID,
          label: "Turn rate",
          value: formatEditableNumber(radiansToDegrees(vehicleSettings.turnRateRadiansPerFrame), 2),
          suffix: "deg/frame",
          hint: "Edit the steering rate used by the same forward and reverse input model.",
        },
        {
          kind: "editableValue",
          id: VEHICLE_FOV_ACTION_ID,
          label: "FOV",
          value: formatEditableNumber(radiansToDegrees(vehicleSettings.fieldOfViewAngleRadians), 0),
          suffix: "deg",
          hint: "Edit the blue chaser field of view.",
        },
        { kind: "header", label: "Controls" },
        { kind: "value", label: "Forward", value: "I" },
        { kind: "value", label: "Reverse", value: "K" },
        { kind: "value", label: "Steer", value: "A / D" },
      ],
    },
  ];

  const strategyRows = [
    buildProgrammaticChaserRow(programmaticChaserEnabled),
    ...buildActorStrategyRows(actorStrategyCollections),
  ];
  if (strategyRows.length > 0) {
    const vehicleSectionIndex = sections.findIndex((section) => section.id === "vehicle");
    sections.splice(vehicleSectionIndex === -1 ? sections.length : vehicleSectionIndex, 0, {
      id: "strategies",
      title: "Strategies",
      hint: "Programmatic control and live actor peer-strategy toggles generated from the current actor engine collections.",
      rows: strategyRows,
    });
  }

  setSidebarSections(sections);
}
