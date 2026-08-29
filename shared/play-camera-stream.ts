/** Wire-level camera stream commands and payloads shared by the host and agents. */

export const PLAY_CAMERA_STREAM_SUBSCRIBE = "play_camera_stream_subscribe" as const;
export const PLAY_CAMERA_STREAM_UNSUBSCRIBE = "play_camera_stream_unsubscribe" as const;
export const PLAY_CAMERA_STREAM_FRAME = "play_camera_stream_frame" as const;
export const PLAY_CAMERA_STREAM_RESULT = "play_camera_stream_result" as const;

export const CAMERA_STREAM_IMAGE_FORMAT = "image/jpeg" as const;

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
  };
  bounds: {
    width: [number, number];
    height: [number, number];
    quality: [number, number];
    maxRateHz: [number, number];
  };
  backpressure: "latest-frame";
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

export type CameraStreamFrame = {
  subscriptionId: string;
  actorId: string;
  cameraId: string;
  frameIdentity: {
    gameId: string;
    simulationEpoch: string;
    frameIndex: number;
  };
  playback: { advanced: false };
  droppedFrameCount: number;
  sensor: {
    image: CameraStreamImage;
  };
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
  | "already_subscribed"
  | "subscription_not_found"
  | "session_fingerprint_unavailable"
  | "capture_unavailable"
  | "capture_identity_mismatch"
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
