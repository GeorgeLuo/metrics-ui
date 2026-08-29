import type {
  CameraStreamFrame,
  CameraStreamFrameDraft,
} from "../../../../shared/play-camera-stream.ts";

export function isValidCameraStreamTimestamp(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0;
}

export function toCameraStreamTimestampUs(clockMs: unknown): number | null {
  if (typeof clockMs !== "number" || !Number.isFinite(clockMs) || clockMs < 0) {
    return null;
  }
  const timestampUs = Math.round(clockMs * 1000);
  return isValidCameraStreamTimestamp(timestampUs) ? timestampUs : null;
}

export function stampCameraStreamFramePublished(
  frame: CameraStreamFrameDraft | CameraStreamFrame,
  publishedAtUs: unknown,
): CameraStreamFrame | null {
  if (!isValidCameraStreamTimestamp(frame.sourceTimestampUs)
    || !isValidCameraStreamTimestamp(publishedAtUs)
    || publishedAtUs < frame.sourceTimestampUs) {
    return null;
  }
  return { ...frame, publishedAtUs };
}
