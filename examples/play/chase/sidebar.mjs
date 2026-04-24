import {
  CHASER_AUTOPILOT_ACTION_ID,
  CHASER_SPEED_ACTION_ID,
  TARGET_PROJECTION_DEBUG_ACTION_ID,
  TARGET_PROJECTION_HORIZON_ACTION_ID,
  TARGET_PROJECTION_RATE_ACTION_ID,
  TARGET_SPEED_ACTION_ID,
  VEHICLE_FOV_ACTION_ID,
  VEHICLE_TURN_RATE_ACTION_ID,
} from "./constants.mjs";
import { formatEditableNumber, radiansToDegrees } from "./math.mjs";

export function publishSidebarSections(
  setSidebarSections,
  programmaticChaserEnabled,
  vehicleSettings,
  projectionSettings,
) {
  if (typeof setSidebarSections !== "function") {
    return;
  }

  setSidebarSections([
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
          hint: "Let the game algorithm press the same forward and steering inputs available to a human player.",
        },
        { kind: "value", label: "Forward", value: "I" },
        { kind: "value", label: "Steer", value: "A / D" },
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
          value: formatEditableNumber(vehicleSettings.chaserSpeedUnitsPerSecond, 1),
          suffix: "units/s",
          hint: "Edit the blue chaser speed used for movement and intercept planning.",
        },
        {
          kind: "editableValue",
          id: TARGET_SPEED_ACTION_ID,
          label: "Target speed",
          value: formatEditableNumber(vehicleSettings.targetSpeedUnitsPerSecond, 1),
          suffix: "units/s",
          hint: "Edit the red target's true movement speed; the chaser must estimate this from field of view.",
        },
        {
          kind: "editableValue",
          id: VEHICLE_TURN_RATE_ACTION_ID,
          label: "Turn rate",
          value: formatEditableNumber(radiansToDegrees(vehicleSettings.turnRateRadiansPerSecond), 0),
          suffix: "deg/s",
          hint: "Edit the steering rate used by the same input model.",
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
      hint: "Game-provided debug controls for the chaser target-path estimate.",
      rows: [
        {
          kind: "toggle",
          id: TARGET_PROJECTION_DEBUG_ACTION_ID,
          label: "Target projection",
          enabled: projectionSettings.visible,
          enabledLabel: "on",
          disabledLabel: "off",
          hint: "Show the chaser estimate of the target path.",
        },
        {
          kind: "editableValue",
          id: TARGET_PROJECTION_HORIZON_ACTION_ID,
          label: "Horizon",
          value: formatEditableNumber(projectionSettings.horizonFrames, 0),
          suffix: "frames",
          hint: "How many game frames into the future to project.",
        },
        {
          kind: "editableValue",
          id: TARGET_PROJECTION_RATE_ACTION_ID,
          label: "Rate",
          value: formatEditableNumber(projectionSettings.samplesPerSecond, 1),
          suffix: "rect/s",
          hint: "How many projected rectangles to draw per second.",
        },
      ],
    },
  ]);
}
