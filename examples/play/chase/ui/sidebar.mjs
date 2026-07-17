import {
  CHASER_ACTION_PATH_HORIZON_ACTION_ID,
  CHASER_ACTION_PATH_RATE_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_ACTION_ID,
  CHASER_ACTION_PATH_VIEW_MODES,
  CHASER_MAP_OVERLAY_ACTION_ID,
  CHASER_MAP_OVERLAY_VIEW_MODES,
  CHASER_VIEW_ACTION_ID,
  CHASER_SPEED_ACTION_ID,
  DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
  DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
  EVADER_VIEW_ACTION_ID,
  IDAE_DEBUG_ACTION_ID,
  EVADER_PROJECTION_HORIZON_ACTION_ID,
  EVADER_PROJECTION_RATE_ACTION_ID,
  EVADER_PROJECTION_VIEW_ACTION_ID,
  EVADER_PROJECTION_VIEW_MODES,
  EVADER_SPEED_ACTION_ID,
  FLOOR_GRID_ACTION_ID,
  VEHICLE_FOV_ACTION_ID,
  VEHICLE_FOV_DISTANCE_ACTION_ID,
  VEHICLE_MAX_STEERING_ANGLE_ACTION_ID,
  SIMULATION_GREENTEXT_DEBUG_ACTION_ID,
} from "../config/constants.mjs";
import { CHASER_ACTION_PROPOSAL_MOTIVE_GROUPS } from "../config/decision-ids.mjs";
import { formatEditableNumber, radiansToDegrees } from "../decision-model/core/math.ts";
import { buildGameRows } from "./sidebar/game-section.mjs";

function formatActorLabel(actorId) {
  const value = String(actorId ?? "").trim();
  if (!value) {
    return "Actor";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatActionProposalLabel(actionProposalId) {
  const value = String(actionProposalId ?? "").trim();
  if (!value) {
    return "Action Proposal";
  }
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

export function createActorActionProposalToggleActionId(actorId, actionProposalId) {
  return `actor-action-proposal:${String(actorId ?? "").trim()}:${String(actionProposalId ?? "").trim()}`;
}

function buildActorActionProposalToggleRow(actorId, actionProposalId, enabled) {
  return {
    kind: "toggle",
    id: createActorActionProposalToggleActionId(actorId, actionProposalId),
    label: formatActionProposalLabel(actionProposalId),
    enabled: Boolean(enabled),
    enabledLabel: "on",
    disabledLabel: "off",
    hint: `Enable or disable ${formatActorLabel(actorId).toLowerCase()} action proposal ${formatActionProposalLabel(actionProposalId).toLowerCase()}.`,
  };
}

function buildChaserActionProposalRows(actionProposals = {}) {
  const actionProposalEntries = actionProposals && typeof actionProposals === "object" ? actionProposals : {};
  const knownActionProposalIds = new Set();
  const groupedRows = CHASER_ACTION_PROPOSAL_MOTIVE_GROUPS.flatMap((group) => {
    const motiveRows = group.actionProposalIds
      .filter((actionProposalId) => Object.prototype.hasOwnProperty.call(actionProposalEntries, actionProposalId))
      .map((actionProposalId) => {
        knownActionProposalIds.add(actionProposalId);
        return buildActorActionProposalToggleRow("chaser", actionProposalId, actionProposalEntries[actionProposalId]);
      });
    return motiveRows.length > 0
      ? [
        { kind: "header", label: `Chaser motive: ${group.label}` },
        ...motiveRows,
      ]
      : [];
  });
  const ungroupedRows = Object.entries(actionProposalEntries)
    .filter(([actionProposalId]) => !knownActionProposalIds.has(actionProposalId))
    .map(([actionProposalId, enabled]) => buildActorActionProposalToggleRow("chaser", actionProposalId, enabled));
  return ungroupedRows.length > 0
    ? [
      ...groupedRows,
      { kind: "header", label: "Chaser motive: Other" },
      ...ungroupedRows,
    ]
    : groupedRows;
}

function buildUngroupedActorActionProposalRows(actorId, actionProposals = {}) {
  const actionProposalEntries = actionProposals && typeof actionProposals === "object" ? actionProposals : {};
  const rows = Object.entries(actionProposalEntries)
    .map(([actionProposalId, enabled]) => buildActorActionProposalToggleRow(actorId, actionProposalId, enabled));
  return rows.length > 0
    ? [
      { kind: "header", label: `${formatActorLabel(actorId)} action proposals` },
      ...rows,
    ]
    : [];
}

function buildActorActionProposalRows(actorActionProposalCollections = {}) {
  const chaserRows = buildChaserActionProposalRows(actorActionProposalCollections.chaser);
  const otherActorRows = Object.entries(actorActionProposalCollections)
    .filter(([actorId]) => actorId !== "chaser")
    .flatMap(([actorId, actionProposals]) => buildUngroupedActorActionProposalRows(actorId, actionProposals));
  return [
    ...chaserRows,
    ...otherActorRows,
  ];
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

export function publishSidebarSections(
  setSidebarSections,
  chaserControlSource,
  frameVisibility,
  simulationSettings,
  vehicleSettings,
  projectionSettings,
  actorActionProposalCollections = {},
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
  const gameRows = buildGameRows({
    chaserControlSource,
    simulationSettings,
    runMetrics,
    scenarioControls,
  });
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
        {
          kind: "toggle",
          id: FLOOR_GRID_ACTION_ID,
          label: "Floor grid",
          enabled: Boolean(simulationSettings.floorGridVisible),
          enabledLabel: "shown",
          disabledLabel: "hidden",
          hint: "Show or hide reference grid lines over the textured Chase floor.",
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
          id: VEHICLE_MAX_STEERING_ANGLE_ACTION_ID,
          label: "Max steering angle",
          value: formatEditableNumber(radiansToDegrees(vehicleSettings.maxSteeringAngleRadians), 1),
          suffix: "deg",
          hint: "Edit the maximum front-wheel steering angle used by vehicle movement.",
        },
        {
          kind: "editableValue",
          id: VEHICLE_FOV_ACTION_ID,
          label: "FOV",
          value: formatEditableNumber(radiansToDegrees(vehicleSettings.fieldOfViewAngleRadians), 0),
          suffix: "deg",
          hint: "Edit the blue chaser field of view.",
        },
        {
          kind: "editableValue",
          id: VEHICLE_FOV_DISTANCE_ACTION_ID,
          label: "FOV distance",
          value: formatEditableNumber(vehicleSettings.fieldOfViewDistance, 1),
          suffix: "u",
          hint: "Edit how far the vehicle can see in its field-of-view cone.",
        },
        { kind: "header", label: "Controls" },
        { kind: "value", label: "Forward", value: "I" },
        { kind: "value", label: "Reverse", value: "K" },
        { kind: "value", label: "Steer", value: "A / D" },
      ],
    },
  ];

  const actionProposalRows = [
    ...buildActorActionProposalRows(actorActionProposalCollections),
  ];
  if (actionProposalRows.length > 0) {
    const vehicleSectionIndex = sections.findIndex((section) => section.id === "vehicle");
    sections.splice(vehicleSectionIndex === -1 ? sections.length : vehicleSectionIndex, 0, {
      id: "actionProposals",
      title: "Action Proposals",
      hint: "Live actor action-proposal toggles generated from the current actor engine collections.",
      rows: actionProposalRows,
    });
  }

  setSidebarSections(sections);
}
