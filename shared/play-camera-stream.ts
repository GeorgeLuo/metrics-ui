/** Wire-level camera stream commands and payloads shared by the host and agents. */

export const PLAY_CAMERA_STREAM_SUBSCRIBE = "play_camera_stream_subscribe" as const;
export const PLAY_CAMERA_STREAM_UNSUBSCRIBE = "play_camera_stream_unsubscribe" as const;
export const PLAY_CAMERA_STREAM_FRAME = "play_camera_stream_frame" as const;
export const PLAY_CAMERA_STREAM_RESULT = "play_camera_stream_result" as const;

export const CAMERA_STREAM_IMAGE_FORMAT = "image/jpeg" as const;

export type CameraStreamDropPolicy = "latest-frame" | "none";

export type CameraStreamSubscribeCommand = {
  type: typeof PLAY_CAMERA_STREAM_SUBSCRIBE;
  request_id?: string;
  actorId?: unknown;
  cameraId?: unknown;
  width?: unknown;
  height?: unknown;
  imageFormat?: unknown;
  quality?: unknown;
  maxRateHz?: unknown;
  dropPolicy?: unknown;
};

export type CameraStreamUnsubscribeCommand = {
  type: typeof PLAY_CAMERA_STREAM_UNSUBSCRIBE;
  request_id?: string;
  subscriptionId?: unknown;
};

export type CameraStreamSubscribeRequest = Omit<
  CameraStreamSubscribeCommand,
  "type" | "request_id"
>;

export type CameraStreamUnsubscribeRequest = Omit<
  CameraStreamUnsubscribeCommand,
  "type" | "request_id"
>;

export type CameraStreamCapability = {
  supported: true;
  subscribeType: typeof PLAY_CAMERA_STREAM_SUBSCRIBE;
  unsubscribeType: typeof PLAY_CAMERA_STREAM_UNSUBSCRIBE;
  frameType: typeof PLAY_CAMERA_STREAM_FRAME;
  resultType: typeof PLAY_CAMERA_STREAM_RESULT;
  actors: string[];
  cameras: string[];
  imageFormat: typeof CAMERA_STREAM_IMAGE_FORMAT;
  defaults: {
    width: number;
    height: number;
    quality: number;
    maxRateHz: number;
    dropPolicy: CameraStreamDropPolicy;
  };
  bounds: {
    width: [number, number];
    height: [number, number];
    quality: [number, number];
    maxRateHz: [number, number];
  };
  backpressure: "latest-frame";
  timingFields: ["sourceTimestampUs", "publishedAtUs"];
  sourceTimestampClock: "performance.now-microseconds-at-jpeg-capture";
  publishedAtClock: "performance.now-microseconds-at-ws-send";
  dropPolicies: CameraStreamDropPolicy[];
  queueBound: 8;
  oneShotQueryId: "atomic-evaluation-capture";
  identityFields: ["gameId", "simulationEpoch", "frameIndex"];
  sessionIdentityFields: ["gameId", "scenarioId", "simulationEpoch", "actorId", "cameraId"];
};

export type CameraStreamControlInput = {
  source: string;
  forward: boolean;
  reverse: boolean;
  steering: number;
} | null;

export type CameraStreamSessionFingerprint = {
  gameId: string;
  scenarioId: string;
  simulationEpoch: string;
  playback: {
    frameIndex: number;
    phase: string;
    pendingAction: boolean;
  };
  controlSource: string;
  controlInput: CameraStreamControlInput;
  actorId: string;
  cameraId: string;
};

export type CameraStreamImage = {
  contentType: typeof CAMERA_STREAM_IMAGE_FORMAT;
  rendererId: string;
  width: number;
  height: number;
  dataUrl: string;
};

type CameraStreamFrameFields = {
  subscriptionId: string;
  actorId: string;
  cameraId: string;
  frameIdentity: {
    gameId: string;
    simulationEpoch: string;
    frameIndex: number;
  };
  sourceTimestampUs: number;
  playback: { advanced: false };
  droppedFrameCount: number;
  sensor: {
    image: CameraStreamImage;
  };
};

/** Internal frame before the publish-time timestamp is applied. */
export type CameraStreamFrameDraft = CameraStreamFrameFields & {
  publishedAtUs?: never;
};

/** Public wire frame; both timing fields are required once sent. */
export type CameraStreamFrame = CameraStreamFrameFields & {
  publishedAtUs: number;
};

export type CameraStreamReasonCode =
  | "actor_invalid"
  | "camera_invalid"
  | "actor_unavailable"
  | "camera_unavailable"
  | "image_format_unsupported"
  | "image_dimension_invalid"
  | "max_rate_invalid"
  | "quality_invalid"
  | "drop_policy_invalid"
  | "already_subscribed"
  | "subscription_not_found"
  | "session_fingerprint_unavailable"
  | "capture_unavailable"
  | "capture_identity_mismatch"
  | "source_timestamp_invalid"
  | "backpressure_overflow"
  | "session_identity_changed"
  | "frontend_not_connected"
  | "frontend_unresponsive"
  | "frontend_disconnected";

export type CameraStreamReason = {
  code: CameraStreamReasonCode;
  message: string;
  field?: string;
  requested?: unknown;
  available?: unknown;
  changedFields?: string[];
};

export type CameraStreamSubscribedPayload = {
  event: "subscribed";
  subscriptionId: string;
  cameraStream: { supported: true };
  playback: { advanced: false };
  preservation: {
    preserved: true;
    before: CameraStreamSessionFingerprint;
    after: CameraStreamSessionFingerprint;
  };
  frame: CameraStreamFrame;
};

export type CameraStreamSubscribedPayloadDraft = Omit<
  CameraStreamSubscribedPayload,
  "frame"
> & {
  frame: CameraStreamFrameDraft;
};

export type CameraStreamUnsupportedPayload = {
  event: "unsupported";
  cameraStream: {
    supported: false;
    reason: CameraStreamReason;
  };
};

export type CameraStreamUnsubscribedPayload = {
  event: "unsubscribed";
  subscriptionId: string;
};

export type CameraStreamEndedPayload = {
  event: "ended";
  subscriptionId: string;
  reason: {
    code: "session_identity_changed" | "frontend_disconnected" | CameraStreamReasonCode;
    message: string;
    changedFields?: string[];
  };
};

export type CameraStreamResultPayload =
  | CameraStreamSubscribedPayload
  | CameraStreamUnsupportedPayload
  | CameraStreamUnsubscribedPayload
  | CameraStreamEndedPayload;

export type CameraStreamResultPayloadDraft =
  | CameraStreamSubscribedPayloadDraft
  | CameraStreamUnsupportedPayload
  | CameraStreamUnsubscribedPayload
  | CameraStreamEndedPayload;

export type CameraStreamFrameMessage = {
  type: typeof PLAY_CAMERA_STREAM_FRAME;
  payload: CameraStreamFrame;
};

export type CameraStreamResultMessage = {
  type: typeof PLAY_CAMERA_STREAM_RESULT;
  request_id?: string;
  payload: CameraStreamResultPayload;
};

export type CameraStreamPushMessage = CameraStreamFrameMessage | CameraStreamResultMessage;

export function isValidCameraStreamTimestamp(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0;
}

/** Converts a monotonic millisecond clock reading to the wire's integer microseconds. */
export function toCameraStreamTimestampUs(clockMs: unknown): number | null {
  if (typeof clockMs !== "number" || !Number.isFinite(clockMs) || clockMs < 0) {
    return null;
  }
  const timestampUs = Math.round(clockMs * 1000);
  return isValidCameraStreamTimestamp(timestampUs) ? timestampUs : null;
}

/** Adds the publish-time stamp at the handoff boundary without mutating the draft. */
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

/** Stamps the first frame nested in a subscribe result immediately before send. */
export function stampCameraStreamResultPublished(
  result: CameraStreamResultPayloadDraft,
  publishedAtUs: unknown,
): CameraStreamResultPayload | null {
  if (result.event !== "subscribed") {
    return result;
  }
  const frame = stampCameraStreamFramePublished(result.frame, publishedAtUs);
  return frame ? { ...result, frame } : null;
}
