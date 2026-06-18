import { CAR_BOUND_RADIUS } from "../config/constants.mjs";
import {
  recordVehicleFrontViewCapture,
} from "../decision-model/memory/vehicle/front-view-captures.ts";
import {
  createVehicleFrontViewCaptureRecord,
} from "../perception/vehicle/front-view-capture.ts";

type RuntimeRecord = Record<string, any>;

function shouldCaptureFrontView(action: RuntimeRecord | null | undefined): boolean {
  return Boolean(action?.frontViewCapture?.requested);
}

function getFrontViewCaptureMemory(state: RuntimeRecord, actorId: string) {
  return actorId === "evader"
    ? state.evaderIdae?.state?.memory?.directObservation?.frontViewCaptures
    : state.chaserIdae?.state?.memory?.directObservation?.frontViewCaptures;
}

function createFrontViewCaptureSubjects(state: RuntimeRecord, actorId: string) {
  if (actorId === "chaser") {
    return state.evaderExists === false
      ? []
      : [
        {
          actorId: "evader",
          position: state.evaderPosition,
          direction: state.evaderDirection,
          radius: CAR_BOUND_RADIUS,
        },
      ];
  }

  return [
    {
      actorId: "chaser",
      position: state.chaserPosition,
      direction: state.chaserLookDirection,
      radius: CAR_BOUND_RADIUS,
    },
  ];
}

function recordFrontViewCaptureAction(
  state: RuntimeRecord,
  {
    actorId,
    action,
    frameIndex,
    actorPosition,
    actorDirection,
  }: RuntimeRecord = {},
) {
  if (!shouldCaptureFrontView(action)) {
    return null;
  }

  const capture = createVehicleFrontViewCaptureRecord({
    actorId,
    frameIndex,
    actorPosition,
    actorDirection,
    fieldOfViewAngleRadians: state.vehicleSettings.fieldOfViewAngleRadians,
    obstacles: state.obstacles,
    columns: state.columns,
    rows: state.rows,
    visibleActors: createFrontViewCaptureSubjects(state, actorId),
    rendererId: action.frontViewCapture.rendererId,
  });

  return recordVehicleFrontViewCapture(
    getFrontViewCaptureMemory(state, actorId),
    capture,
  );
}

/**
 * Commits requested front-view capture actions after vehicle movement applies.
 */
export function recordFrameFrontViewCaptures(
  state: RuntimeRecord,
  actionFrame: RuntimeRecord | null | undefined,
) {
  const frameIndex = state.frameIndex + 1;
  return {
    chaser: recordFrontViewCaptureAction(state, {
      actorId: "chaser",
      action: actionFrame?.chaserAction,
      frameIndex,
      actorPosition: state.chaserPosition,
      actorDirection: state.chaserLookDirection,
    }),
    evader: state.evaderExists === false
      ? null
      : recordFrontViewCaptureAction(state, {
        actorId: "evader",
        action: actionFrame?.evaderMovementDecision,
        frameIndex,
        actorPosition: state.evaderPosition,
        actorDirection: state.evaderDirection,
      }),
  };
}
