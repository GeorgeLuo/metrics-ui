import { getEvaderProjectionSampleCount } from "../../decision-model/projections/chaser/evader-motion/plan.ts";
import { setProjectionFrame, syncProjectionFrames } from "./projection-frames.mjs";

export function updateEvaderProjectionDisplay(
  group,
  frames,
  estimate,
  evaderPrediction,
  projectionSettings,
  speedUnitsPerFrame,
  evaderProjectionPath = null,
) {
  const projectionVisible = projectionSettings?.visible === true;
  const hasExplicitPath = Array.isArray(evaderProjectionPath);
  const path = projectionVisible && hasExplicitPath ? evaderProjectionPath : [];
  const count = projectionVisible
    ? (hasExplicitPath ? path.length : getEvaderProjectionSampleCount(projectionSettings))
    : 0;
  const estimatePosition = estimate?.position ?? null;
  const predictionDirection = evaderPrediction?.direction ?? estimate?.direction ?? null;
  const canProject = Boolean(estimatePosition && predictionDirection && count > 0);
  group.visible = canProject;
  syncProjectionFrames(group, frames, canProject ? count : 0);
  if (!canProject) {
    return;
  }

  frames.forEach((frame, index) => {
    const pathSample = path[index];
    const projectionFramesAhead = Number.isFinite(pathSample?.framesAhead)
      ? pathSample.framesAhead
      : (index + 1) * projectionSettings.sampleSpacingFrames;
    const direction = pathSample?.direction ?? predictionDirection;
    setProjectionFrame(
      frame,
      pathSample?.position ?? {
        x: estimate.position.x + predictionDirection.x * speedUnitsPerFrame * projectionFramesAhead,
        z: estimate.position.z + predictionDirection.z * speedUnitsPerFrame * projectionFramesAhead,
      },
      direction,
    );
  });
}
