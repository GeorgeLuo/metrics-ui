import {
  createActionFrame,
  cloneDirection,
  clonePosition,
  clampUnit,
  stepActionPathFrame,
} from "../../../vehicle/action-paths.ts";
import type {
  VehicleActionFrame,
  VehicleActionPathConsensus,
  VehicleActionProposal,
} from "../../../vehicle/interfaces.ts";

/**
 * Reads the requested future frame from a proposal path.
 *
 * Shorter proposal paths hold their last frame so all active proposals can
 * contribute across the full mixed horizon.
 */
function getProposalFrame(proposal: VehicleActionProposal, index: number): VehicleActionFrame | null {
  if (!proposal?.actionPath?.length) {
    return null;
  }
  return proposal.actionPath[Math.min(index, proposal.actionPath.length - 1)] ?? null;
}

/**
 * Current mutable policy for reducing proposal confidence to path weights.
 *
 * Each frame mixes throttle and steering by clamped proposal confidence. This
 * file is intentionally policy-specific because this weighting is not stable.
 */
function mixProposalActionAtFrame(proposals: VehicleActionProposal[], index: number) {
  const weightedFrames = proposals.flatMap((proposal) => {
    const frame = getProposalFrame(proposal, index);
    const confidence = Number.isFinite(proposal?.confidence)
      ? Math.max(0, Math.min(1, proposal.confidence))
      : 1;
    return frame && confidence > 0
      ? [{
        frame,
        proposal,
        weight: confidence,
      }]
      : [];
  });
  const totalWeight = weightedFrames.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }
  const throttle = weightedFrames.reduce(
    (sum, entry) => sum + (Number(entry.frame.throttle) || 0) * entry.weight,
    0,
  ) / totalWeight;
  const steering = weightedFrames.reduce(
    (sum, entry) => sum + (Number(entry.frame.steer) || 0) * entry.weight,
    0,
  ) / totalWeight;

  return {
    throttle: clampUnit(throttle),
    steering: clampUnit(steering),
    sourceProposalIds: weightedFrames.map((entry) => entry.proposal.id),
  };
}

/**
 * Builds a feasible chaser path from active proposal paths using confidence
 * weighted throttle and steering at each future frame.
 */
export function buildWeightedPathConsensus({
  id = "actionPathConsensus",
  activeProposals = [],
  vehiclePosition,
  vehicleDirection,
  speedUnitsPerFrame,
  maxSteeringAngleRadians,
}: Record<string, any> = {}): VehicleActionPathConsensus {
  if (activeProposals.length === 0) {
    return {
      id,
      active: false,
      path: [],
      firstAction: null,
      sourceProposalIds: [],
    };
  }

  const horizonFrames = Math.max(
    1,
    ...activeProposals.map((proposal: VehicleActionProposal) => proposal.actionPath.length),
  );
  let position = clonePosition(vehiclePosition);
  let direction = cloneDirection(vehicleDirection);
  const path: VehicleActionFrame[] = [];

  for (let index = 0; index < horizonFrames; index += 1) {
    const mixedAction = mixProposalActionAtFrame(activeProposals, index);
    if (!mixedAction) {
      break;
    }
    const nextFrame = stepActionPathFrame({
      position,
      direction,
      throttle: mixedAction.throttle,
      steering: mixedAction.steering,
      speedUnitsPerFrame,
      maxSteeringAngleRadians,
    });
    position = nextFrame.position;
    direction = nextFrame.direction;
    path.push(createActionFrame({
      frameOffset: index + 1,
      throttle: nextFrame.throttle,
      steering: nextFrame.steering,
      position,
      direction,
      metadata: {
        sourceProposalIds: mixedAction.sourceProposalIds,
      },
    }));
  }

  return {
    id,
    active: path.length > 0,
    path,
    firstAction: path[0] ?? null,
    sourceProposalIds: activeProposals.map((proposal: VehicleActionProposal) => proposal.id),
  };
}
