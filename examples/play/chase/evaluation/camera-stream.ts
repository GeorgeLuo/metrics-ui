import type {
  CameraStreamCapability,
  CameraStreamFrameDraft,
  CameraStreamImage,
  CameraStreamDropPolicy,
  CameraStreamReason,
  CameraStreamReasonCode,
  CameraStreamResultPayloadDraft,
  CameraStreamSessionFingerprint,
  CameraStreamSubscribeRequest,
} from "../../../../shared/play-camera-stream.ts";
import { isValidCameraStreamTimestamp } from "./camera-stream-timing.ts";
export { stampCameraStreamFramePublished, toCameraStreamTimestampUs } from "./camera-stream-timing.ts";
import {
  CHASE_PASSIVE_OBSERVATION_CAMERA_ID,
  CHASE_PASSIVE_OBSERVATION_SESSION_IDENTITY_FIELDS,
  CHASE_PASSIVE_OBSERVATION_QUERY_ID,
  CHASE_PASSIVE_OBSERVATION_PRESERVED_FIELDS,
  buildChasePassiveObservationFingerprint,
  cloneChasePassiveObservationFingerprint,
  getChangedChasePassiveObservationFingerprintFields,
  type ChasePassiveObservationFingerprint,
} from "./passive-observation.ts";

export const CHASE_CAMERA_STREAM_SUBSCRIBE_TYPE = "play_camera_stream_subscribe" as const;
export const CHASE_CAMERA_STREAM_UNSUBSCRIBE_TYPE = "play_camera_stream_unsubscribe" as const;
export const CHASE_CAMERA_STREAM_FRAME_TYPE = "play_camera_stream_frame" as const;
export const CHASE_CAMERA_STREAM_RESULT_TYPE = "play_camera_stream_result" as const;
export const CHASE_CAMERA_STREAM_QUEUE_BOUND = 8 as const;
const CAMERA_STREAM_IMAGE_FORMAT = "image/jpeg" as const;

export const CHASE_CAMERA_STREAM_DEFAULTS = Object.freeze({
  width: 320,
  height: 240,
  quality: 0.6,
  maxRateHz: 15,
  dropPolicy: "latest-frame" as CameraStreamDropPolicy,
});

export const CHASE_CAMERA_STREAM_BOUNDS = Object.freeze({
  width: Object.freeze([80, 640]),
  height: Object.freeze([60, 480]),
  quality: Object.freeze([0.4, 0.9]),
  maxRateHz: Object.freeze([1, 30]),
});

export type NormalizedChaseCameraStreamRequest = {
  actorId: string;
  cameraId: string;
  width: number;
  height: number;
  imageFormat: typeof CAMERA_STREAM_IMAGE_FORMAT;
  quality: number;
  maxRateHz: number;
  dropPolicy: CameraStreamDropPolicy;
};

export type ChaseCameraStreamCapture = Partial<CameraStreamImage> & {
  contentType?: unknown;
  rendererId?: unknown;
  width?: unknown;
  height?: unknown;
  dataUrl?: unknown;
};

type InvalidRequest = {
  ok: false;
  result: CameraStreamResultPayloadDraft;
};

type ValidRequest = {
  ok: true;
  value: NormalizedChaseCameraStreamRequest;
};

export type CameraStreamRequestResolution = ValidRequest | InvalidRequest;

const CAMERA_STREAM_SESSION_IDENTITY_FIELDS =
  CHASE_PASSIVE_OBSERVATION_SESSION_IDENTITY_FIELDS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function clamp(value: number, bounds: readonly number[]): number {
  return Math.max(bounds[0], Math.min(bounds[1], value));
}

function buildReason(
  code: CameraStreamReasonCode,
  message: string,
  details: Partial<CameraStreamReason> = {},
): CameraStreamReason {
  return { code, message, ...details };
}

export function buildChaseCameraStreamUnsupportedResult(
  reason: CameraStreamReason,
): CameraStreamResultPayloadDraft {
  return {
    event: "unsupported",
    cameraStream: {
      supported: false,
      reason,
    },
  };
}

export const buildCameraStreamUnsupportedResult = buildChaseCameraStreamUnsupportedResult;

function invalid(
  code: CameraStreamReasonCode,
  message: string,
  details: Partial<CameraStreamReason> = {},
): InvalidRequest {
  return {
    ok: false,
    result: buildChaseCameraStreamUnsupportedResult(buildReason(code, message, details)),
  };
}

function resolveTarget(
  request: Record<string, unknown>,
  field: "actorId" | "cameraId",
  defaultValue: string,
): { ok: true; value: string } | { ok: false; requested: unknown } {
  if (!hasOwn(request, field)) {
    return { ok: true, value: defaultValue };
  }
  const requested = request[field];
  if (typeof requested === "string" && requested.trim()) {
    return { ok: true, value: requested.trim() };
  }
  return { ok: false, requested };
}

function resolveFiniteNumber(
  request: Record<string, unknown>,
  field: "width" | "height" | "quality" | "maxRateHz",
  fallback: number,
  bounds: readonly number[],
  integer: boolean,
): { ok: true; value: number } | { ok: false; requested: unknown } {
  if (!hasOwn(request, field)) {
    return { ok: true, value: fallback };
  }
  const requested = request[field];
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return { ok: false, requested };
  }
  const bounded = clamp(requested, bounds);
  return { ok: true, value: integer ? Math.round(bounded) : bounded };
}

function resolveDropPolicy(request: Record<string, unknown>, capability: CameraStreamCapability):
  { ok: true; value: CameraStreamDropPolicy } | { ok: false; requested: unknown } {
  if (!hasOwn(request, "dropPolicy")) {
    return { ok: true, value: capability.defaults.dropPolicy };
  }
  const requested = request.dropPolicy;
  return requested === "latest-frame" || requested === "none"
    ? { ok: true, value: requested }
    : { ok: false, requested };
}

/** Validates and clamps one untrusted subscribe payload without coercing types. */
export function resolveChaseCameraStreamRequest(
  request: CameraStreamSubscribeRequest | unknown = {},
  capability: CameraStreamCapability = buildChaseCameraStreamCapability(),
): CameraStreamRequestResolution {
  const value = isRecord(request) ? request : {};
  const actor = resolveTarget(value, "actorId", "chaser");
  if (!actor.ok) {
    return invalid(
      "actor_invalid",
      "Requested actorId must be a non-empty string when provided.",
      { field: "actorId", requested: actor.requested, available: capability.actors },
    );
  }
  const camera = resolveTarget(value, "cameraId", CHASE_PASSIVE_OBSERVATION_CAMERA_ID);
  if (!camera.ok) {
    return invalid(
      "camera_invalid",
      "Requested cameraId must be a non-empty string when provided.",
      { field: "cameraId", requested: camera.requested, available: capability.cameras },
    );
  }
  if (!capability.actors.includes(actor.value)) {
    return invalid("actor_unavailable", "Requested actor is not available.", {
      field: "actorId",
      requested: actor.value,
      available: capability.actors,
    });
  }
  if (!capability.cameras.includes(camera.value)) {
    return invalid("camera_unavailable", "Requested camera is not available.", {
      field: "cameraId",
      requested: camera.value,
      available: capability.cameras,
    });
  }
  if (hasOwn(value, "imageFormat") && value.imageFormat !== CAMERA_STREAM_IMAGE_FORMAT) {
    return invalid("image_format_unsupported", "Only image/jpeg camera streams are supported.", {
      field: "imageFormat",
      requested: value.imageFormat,
      available: [CAMERA_STREAM_IMAGE_FORMAT],
    });
  }

  const width = resolveFiniteNumber(
    value,
    "width",
    capability.defaults.width,
    capability.bounds.width,
    true,
  );
  if (!width.ok) {
    return invalid("image_dimension_invalid", "Camera stream width must be a finite number.", {
      field: "width",
      requested: width.requested,
      available: capability.bounds.width,
    });
  }
  const height = resolveFiniteNumber(
    value,
    "height",
    capability.defaults.height,
    capability.bounds.height,
    true,
  );
  if (!height.ok) {
    return invalid("image_dimension_invalid", "Camera stream height must be a finite number.", {
      field: "height",
      requested: height.requested,
      available: capability.bounds.height,
    });
  }
  const quality = resolveFiniteNumber(
    value,
    "quality",
    capability.defaults.quality,
    capability.bounds.quality,
    false,
  );
  if (!quality.ok) {
    return invalid("quality_invalid", "Camera stream quality must be a finite number.", {
      field: "quality",
      requested: quality.requested,
      available: capability.bounds.quality,
    });
  }
  const maxRateHz = resolveFiniteNumber(
    value,
    "maxRateHz",
    capability.defaults.maxRateHz,
    capability.bounds.maxRateHz,
    true,
  );
  if (!maxRateHz.ok) {
    return invalid("max_rate_invalid", "Camera stream maxRateHz must be a finite number.", {
      field: "maxRateHz",
      requested: maxRateHz.requested,
      available: capability.bounds.maxRateHz,
    });
  }

  const dropPolicy = resolveDropPolicy(value, capability);
  if (!dropPolicy.ok) {
    return invalid("drop_policy_invalid", "Camera stream dropPolicy must be latest-frame or none.", {
      field: "dropPolicy",
      requested: dropPolicy.requested,
      available: capability.dropPolicies,
    });
  }

  return {
    ok: true,
    value: {
      actorId: actor.value,
      cameraId: camera.value,
      width: width.value,
      height: height.value,
      imageFormat: CAMERA_STREAM_IMAGE_FORMAT,
      quality: quality.value,
      maxRateHz: maxRateHz.value,
      dropPolicy: dropPolicy.value,
    },
  };
}

/** Describes the push stream supported by the current Chase session. */
export function buildChaseCameraStreamCapability({
  evaderExists = true,
}: {
  evaderExists?: boolean;
} = {}): CameraStreamCapability {
  return {
    supported: true,
    subscribeType: CHASE_CAMERA_STREAM_SUBSCRIBE_TYPE,
    unsubscribeType: CHASE_CAMERA_STREAM_UNSUBSCRIBE_TYPE,
    frameType: CHASE_CAMERA_STREAM_FRAME_TYPE,
    resultType: CHASE_CAMERA_STREAM_RESULT_TYPE,
    actors: evaderExists ? ["chaser", "evader"] : ["chaser"],
    cameras: [CHASE_PASSIVE_OBSERVATION_CAMERA_ID],
    imageFormat: CAMERA_STREAM_IMAGE_FORMAT,
    defaults: { ...CHASE_CAMERA_STREAM_DEFAULTS },
    bounds: {
      width: [80, 640],
      height: [60, 480],
      quality: [0.4, 0.9],
      maxRateHz: [1, 30],
    },
    backpressure: "latest-frame",
    timingFields: ["sourceTimestampUs", "publishedAtUs"],
    sourceTimestampClock: "performance.now-microseconds-at-jpeg-capture",
    publishedAtClock: "performance.now-microseconds-at-ws-send",
    dropPolicies: ["latest-frame", "none"],
    queueBound: CHASE_CAMERA_STREAM_QUEUE_BOUND,
    oneShotQueryId: CHASE_PASSIVE_OBSERVATION_QUERY_ID,
    identityFields: ["gameId", "simulationEpoch", "frameIndex"],
    sessionIdentityFields: ["gameId", "scenarioId", "simulationEpoch", "actorId", "cameraId"],
  };
}

function toCameraStreamImage(
  capture: ChaseCameraStreamCapture | null | undefined,
): CameraStreamImage | null {
  if (!capture || capture.contentType !== CAMERA_STREAM_IMAGE_FORMAT
    || typeof capture.rendererId !== "string" || !capture.rendererId.trim()
    || !Number.isInteger(capture.width) || Number(capture.width) <= 0
    || !Number.isInteger(capture.height) || Number(capture.height) <= 0
    || typeof capture.dataUrl !== "string" || !capture.dataUrl.startsWith("data:image/jpeg")) {
    return null;
  }
  return {
    contentType: CAMERA_STREAM_IMAGE_FORMAT,
    rendererId: capture.rendererId,
    width: Number(capture.width),
    height: Number(capture.height),
    dataUrl: capture.dataUrl,
  };
}

const toSharedFingerprint = (fingerprint: ChasePassiveObservationFingerprint): CameraStreamSessionFingerprint => cloneChasePassiveObservationFingerprint(fingerprint);

function captureFailure(
  message: string,
  before?: ChasePassiveObservationFingerprint,
): CameraStreamResultPayloadDraft {
  return buildChaseCameraStreamUnsupportedResult(buildReason("capture_unavailable", message, {
    field: "cameraId",
    ...(before ? { requested: before.cameraId } : {}),
  }));
}

const sourceTimestampFailure = (requested?: unknown): CameraStreamResultPayloadDraft => buildChaseCameraStreamUnsupportedResult(buildReason("source_timestamp_invalid", "Camera stream capture did not produce a valid monotonic source timestamp.", { field: "sourceTimestampUs", ...(requested !== undefined ? { requested } : {}) }));

export type BuildChaseCameraStreamSubscribeResultOptions = {
  subscriptionId: string;
  request?: CameraStreamSubscribeRequest | unknown;
  capability: CameraStreamCapability;
  getFingerprint: (
    actorId: string,
    cameraId: string,
  ) => ChasePassiveObservationFingerprint | null;
  capture: (options: NormalizedChaseCameraStreamRequest) => ChaseCameraStreamCapture | null;
  sourceTimestampUs?: unknown;
  getSourceTimestampUs?: () => unknown;
};

/** Builds a first stream result while proving the full passive fingerprint stayed stable. */
export function buildChaseCameraStreamSubscribeResult({
  subscriptionId,
  request = {},
  capability,
  getFingerprint,
  capture,
  sourceTimestampUs,
  getSourceTimestampUs,
}: BuildChaseCameraStreamSubscribeResultOptions): CameraStreamResultPayloadDraft {
  const resolved = resolveChaseCameraStreamRequest(request, capability);
  if (!resolved.ok) {
    return resolved.result;
  }
  const normalized = resolved.value;
  const fingerprintBeforeCapture = getFingerprint(normalized.actorId, normalized.cameraId);
  if (!fingerprintBeforeCapture) {
    return buildChaseCameraStreamUnsupportedResult(buildReason(
      "session_fingerprint_unavailable",
      "Required session state is unavailable.",
      { field: "session" },
    ));
  }
  const before = cloneChasePassiveObservationFingerprint(fingerprintBeforeCapture);

  let captured: ChaseCameraStreamCapture | null;
  try {
    captured = capture(normalized);
  } catch (error) {
    return captureFailure(error instanceof Error ? error.message : "Camera capture is unavailable.", before);
  }
  const image = toCameraStreamImage(captured);
  if (!image) {
    return captureFailure("Camera capture is unavailable.", before);
  }

  const capturedAtUs = getSourceTimestampUs ? getSourceTimestampUs() : sourceTimestampUs;
  const frame = buildChaseCameraStreamFrame({
    subscriptionId,
    actorId: normalized.actorId,
    cameraId: normalized.cameraId,
    fingerprint: before,
    image,
    sourceTimestampUs: capturedAtUs,
    droppedFrameCount: 0,
  });
  if (!frame) {
    return sourceTimestampFailure(capturedAtUs);
  }

  const fingerprintAfterCapture = getFingerprint(normalized.actorId, normalized.cameraId);
  if (!fingerprintAfterCapture) {
    return buildChaseCameraStreamUnsupportedResult(buildReason(
      "session_fingerprint_unavailable",
      "Required session state became unavailable.",
      { field: "session" },
    ));
  }
  const after = cloneChasePassiveObservationFingerprint(fingerprintAfterCapture);
  const changedFields = getChangedChasePassiveObservationFingerprintFields(
    before,
    after,
    CHASE_PASSIVE_OBSERVATION_PRESERVED_FIELDS,
  );
  if (changedFields.length > 0) {
    return buildChaseCameraStreamUnsupportedResult(buildReason(
      "capture_identity_mismatch",
      "Camera frame identity does not match the preserved session.",
      { changedFields },
    ));
  }

  return {
    event: "subscribed",
    subscriptionId,
    cameraStream: { supported: true },
    playback: { advanced: false },
    preservation: {
      preserved: true,
      before: toSharedFingerprint(before),
      after: toSharedFingerprint(after),
    },
    frame,
  };
}

export function buildChaseCameraStreamFrame({
  subscriptionId,
  actorId,
  cameraId,
  fingerprint,
  image,
  sourceTimestampUs,
  droppedFrameCount = 0,
}: {
  subscriptionId: string;
  actorId: string;
  cameraId: string;
  fingerprint: ChasePassiveObservationFingerprint;
  image: CameraStreamImage;
  sourceTimestampUs: unknown;
  droppedFrameCount?: number;
}): CameraStreamFrameDraft | null {
  if (!isValidCameraStreamTimestamp(sourceTimestampUs)) {
    return null;
  }
  const normalizedDroppedFrameCount = Number.isFinite(droppedFrameCount)
    ? Math.max(0, Math.floor(droppedFrameCount))
    : 0;
  return {
    subscriptionId,
    actorId,
    cameraId,
    frameIdentity: {
      gameId: fingerprint.gameId,
      simulationEpoch: fingerprint.simulationEpoch,
      frameIndex: fingerprint.playback.frameIndex,
    },
    sourceTimestampUs,
    playback: { advanced: false },
    droppedFrameCount: normalizedDroppedFrameCount,
    sensor: {
      image: {
        contentType: CAMERA_STREAM_IMAGE_FORMAT,
        rendererId: image.rendererId,
        width: image.width,
        height: image.height,
        dataUrl: image.dataUrl,
      },
    },
  };
}

/** Returns only the identity fields whose drift must end an active stream. */
export function getChaseCameraStreamSessionIdentityChanges(
  before: ChasePassiveObservationFingerprint,
  after: ChasePassiveObservationFingerprint,
): string[] {
  return getChangedChasePassiveObservationFingerprintFields(
    before,
    after,
    CAMERA_STREAM_SESSION_IDENTITY_FIELDS,
  );
}

export const getCameraStreamSessionIdentityChanges = getChaseCameraStreamSessionIdentityChanges;

export function buildChaseCameraStreamEndedResult(
  subscriptionId: string,
  code: CameraStreamReasonCode,
  message: string,
  changedFields?: string[],
): CameraStreamResultPayloadDraft {
  return {
    event: "ended",
    subscriptionId,
    reason: {
      code,
      message,
      ...(changedFields && changedFields.length > 0 ? { changedFields } : {}),
    },
  };
}

/** Selects the newest candidate, keeping at most one frame for latest-frame delivery. */
export function selectLatestCameraStreamFrame(
  frames: readonly CameraStreamFrameDraft[],
): CameraStreamFrameDraft | null {
  return frames.length > 0 ? frames[frames.length - 1] ?? null : null;
}

export {
  buildChasePassiveObservationFingerprint,
  cloneChasePassiveObservationFingerprint,
};
