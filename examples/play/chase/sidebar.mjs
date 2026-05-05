import {
  CHASER_AUTOPILOT_ACTION_ID,
  CHASER_VIEW_ACTION_ID,
  CHASER_SPEED_ACTION_ID,
  EVADER_VIEW_ACTION_ID,
  IDAE_DEBUG_ACTION_ID,
  SIMULATION_FPS_ACTION_ID,
  EVADER_PROJECTION_DEBUG_ACTION_ID,
  EVADER_PROJECTION_HORIZON_ACTION_ID,
  EVADER_PROJECTION_RATE_ACTION_ID,
  EVADER_SPEED_ACTION_ID,
  VEHICLE_FOV_ACTION_ID,
  VEHICLE_TURN_RATE_ACTION_ID,
} from "./constants.mjs";
import { formatEditableNumber, radiansToDegrees } from "./math.mjs";

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

function buildActorStrategyRows(actorStrategyCollections = {}) {
  return Object.entries(actorStrategyCollections).flatMap(([actorId, strategies]) =>
    Object.entries(strategies ?? {}).map(([strategyId, enabled]) => ({
      kind: "toggle",
      id: createActorStrategyToggleActionId(actorId, strategyId),
      label: `${formatActorLabel(actorId)}: ${formatStrategyLabel(strategyId)}`,
      enabled: Boolean(enabled),
      enabledLabel: "on",
      disabledLabel: "off",
      hint: `Enable or disable ${formatActorLabel(actorId).toLowerCase()} peer strategy ${formatStrategyLabel(strategyId).toLowerCase()}.`,
    })));
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
) {
  if (typeof setSidebarSections !== "function") {
    return;
  }

  const sections = [
    {
      id: "score",
      title: "Score",
      hint: "Live run metrics for comparing chase setups.",
      rows: [
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
      ],
    },
    {
      id: "simulation",
      title: "Simulation",
      hint: "Playback pacing for the discrete frame simulation.",
      rows: [
        {
          kind: "editableValue",
          id: SIMULATION_FPS_ACTION_ID,
          label: "FPS",
          value: formatEditableNumber(simulationSettings.framesPerSecond, 0),
          suffix: "frames/s",
          hint: "How many simulation frames to advance per real-time second while watching the run.",
        },
      ],
    },
    {
      id: "controls",
      title: "Controls",
      hint: "Game-provided controls for the active Play example.",
      rows: [
        {
          kind: "toggle",
          id: CHASER_AUTOPILOT_ACTION_ID,
          label: "Programmatic chaser",
          enabled: programmaticChaserEnabled,
          enabledLabel: "on",
          disabledLabel: "off",
          hint: "Let the game algorithm press the same forward, reverse, and steering inputs available to a human player.",
        },
        { kind: "value", label: "Forward", value: "I" },
        { kind: "value", label: "Reverse", value: "K" },
        { kind: "value", label: "Steer", value: "A / D" },
      ],
    },
    {
      id: "windows",
      title: "Windows",
      hint: "Launch or close floating views for the active Play example.",
      rows: [
        {
          kind: "toggle",
          id: CHASER_VIEW_ACTION_ID,
          label: "Chaser View",
          enabled: frameVisibility.chaserViewVisible,
          enabledLabel: "open",
          disabledLabel: "closed",
          hint: "Open or close the chaser's forward-looking viewport.",
        },
        {
          kind: "toggle",
          id: EVADER_VIEW_ACTION_ID,
          label: "Evader View",
          enabled: frameVisibility.evaderViewVisible,
          enabledLabel: "open",
          disabledLabel: "closed",
          hint: "Open or close the evader's forward-looking viewport.",
        },
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
        {
          kind: "editableValue",
          id: EVADER_SPEED_ACTION_ID,
          label: "Evader speed",
          value: formatEditableNumber(vehicleSettings.evaderSpeedUnitsPerFrame, 3),
          suffix: "u/frame",
          hint: "Edit the red evader's true movement speed; the chaser must estimate this from field of view.",
        },
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
      ],
    },
    {
      id: "projection",
      title: "Projection",
      hint: "Game-provided debug controls for the chaser evader-path estimate.",
      rows: [
        {
          kind: "toggle",
          id: EVADER_PROJECTION_DEBUG_ACTION_ID,
          label: "Evader projection",
          enabled: projectionSettings.visible,
          enabledLabel: "on",
          disabledLabel: "off",
          hint: "Show the chaser estimate of the evader path.",
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
      ],
    },
  ];

  const actorStrategyRows = buildActorStrategyRows(actorStrategyCollections);
  if (actorStrategyRows.length > 0) {
    sections.splice(4, 0, {
      id: "strategies",
      title: "Strategies",
      hint: "Live actor peer-strategy toggles generated from the current actor engine collections.",
      rows: actorStrategyRows,
    });
  }

  setSidebarSections(sections);
}
