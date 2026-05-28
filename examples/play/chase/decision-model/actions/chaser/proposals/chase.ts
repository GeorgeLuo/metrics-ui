import {
  buildActionPathToDirection,
  buildActionPathToPosition,
  createInactiveActionProposal,
  getDirectionFromPerception,
  getDirectionToPosition,
} from "../../vehicle/action-paths.ts";
import type { VehicleActionProposal } from "../../vehicle/interfaces.ts";

/**
 * Selects the evader prediction sample the chaser can plausibly intercept.
 *
 * The selector prefers the earliest projected point reachable at chaser speed,
 * then falls back to the furthest prediction or current continuance estimate.
 */
export function selectPursuitPoint({
  chaserPosition,
  snapshot,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
}: Record<string, any> = {}): Record<string, any> | null {
  if (!chaserPosition) {
    return null;
  }

  const evaderPredictionPlan = snapshot?.strategies?.evaderPrediction ?? null;
  const continuance = snapshot?.patterns?.continuance ?? null;

  if (evaderPredictionPlan?.actionable === false) {
    return null;
  }

  const path = Array.isArray(evaderPredictionPlan?.path) ? evaderPredictionPlan.path : [];
  const safeSpeed = Math.max(
    0.001,
    Number(chaserSpeedUnitsPerFrame ?? speedUnitsPerFrame) || 0,
  );
  let fallbackSample = null;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (path[index]?.position) {
      fallbackSample = path[index];
      break;
    }
  }

  for (const sample of path) {
    if (!sample?.position || !Number.isFinite(sample.framesAhead)) {
      continue;
    }

    const distance = Math.hypot(
      sample.position.x - chaserPosition.x,
      sample.position.z - chaserPosition.z,
    );
    if (sample.framesAhead >= distance / safeSpeed) {
      return {
        position: sample.position,
        source: "reachable-projection",
        sample,
      };
    }
  }

  if (fallbackSample?.position) {
    return {
      position: fallbackSample.position,
      source: "projection-lookahead",
      sample: fallbackSample,
    };
  }

  if (continuance?.position) {
    return {
      position: continuance.position,
      source: "current-estimate",
      sample: null,
    };
  }

  return null;
}

/**
 * Builds the chase proposal that pursues the predicted evader path.
 */
export function buildEvaderPredictionPursuitProposal({
  enabled,
  chaserPosition,
  chaserLookDirection,
  snapshot,
  chaserSpeedUnitsPerFrame,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
}: Record<string, any> = {}): VehicleActionProposal {
  if (!enabled) {
    return createInactiveActionProposal("evaderPredictionPursuit");
  }

  const pursuitPoint = selectPursuitPoint({
    chaserPosition,
    snapshot,
    chaserSpeedUnitsPerFrame,
    speedUnitsPerFrame,
  }) as { position: any; source?: string; sample?: any } | null;

  if (!pursuitPoint?.position) {
    return createInactiveActionProposal("evaderPredictionPursuit", { pursuitPoint: null });
  }

  const goalDirection = getDirectionToPosition(chaserPosition, pursuitPoint.position);
  const actionPath = buildActionPathToPosition({
    vehiclePosition: chaserPosition,
    vehicleDirection: chaserLookDirection,
    targetPosition: pursuitPoint.position,
    speedUnitsPerFrame: chaserSpeedUnitsPerFrame ?? speedUnitsPerFrame,
    turnRateRadiansPerFrame,
    horizonFrames: pursuitPoint.sample?.framesAhead,
    metadata: {
      proposalId: "evaderPredictionPursuit",
      pursuitSource: pursuitPoint.source,
    },
  });

  return {
    id: "evaderPredictionPursuit",
    active: true,
    confidence: Number(snapshot?.strategies?.evaderPrediction?.prediction?.consensus) || 1,
    pursuitPoint,
    pursuitSource: pursuitPoint.source,
    goalDirection,
    actionPath,
    firstAction: actionPath[0] ?? null,
  };
}

/**
 * Builds the direct line-of-sight fallback proposal from the observed bearing.
 */
export function buildVisibleBearingFallbackProposal({
  enabled,
  chaserPosition,
  chaserLookDirection,
  evaderLocation,
  speedUnitsPerFrame,
  turnRateRadiansPerFrame,
}: Record<string, any> = {}): VehicleActionProposal {
  if (!enabled || !evaderLocation?.visible || !chaserLookDirection) {
    return createInactiveActionProposal("lineOfSightPursuit");
  }

  const goalDirection = getDirectionFromPerception(chaserLookDirection, evaderLocation);
  const actionPath = buildActionPathToDirection({
    vehiclePosition: chaserPosition,
    vehicleDirection: chaserLookDirection,
    targetDirection: goalDirection,
    speedUnitsPerFrame,
    turnRateRadiansPerFrame,
    metadata: {
      proposalId: "lineOfSightPursuit",
      pursuitSource: "visible-bearing",
    },
  });

  return {
    id: "lineOfSightPursuit",
    active: true,
    confidence: 1,
    pursuitSource: "visible-bearing",
    goalDirection,
    actionPath,
    firstAction: actionPath[0] ?? null,
  };
}
