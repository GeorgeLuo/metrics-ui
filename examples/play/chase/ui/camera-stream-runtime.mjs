import {
  buildChaseCameraStreamEndedResult,
  buildChaseCameraStreamFrame,
  buildChaseCameraStreamSubscribeResult,
  buildChaseCameraStreamUnsupportedResult,
  CHASE_CAMERA_STREAM_QUEUE_BOUND,
  getChaseCameraStreamSessionIdentityChanges,
  resolveChaseCameraStreamRequest,
  selectLatestCameraStreamFrame,
  stampCameraStreamFramePublished,
} from "../evaluation/camera-stream.ts";
import {
  toCameraStreamTimestampUs,
} from "../../../../shared/play-camera-stream.ts";

function createCameraStreamSubscriptionId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (typeof randomUuid === "string" && randomUuid) {
    return `chase-cam:${randomUuid}`;
  }
  return `chase-cam:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function readMonotonicClockMs() {
  if (typeof globalThis.performance?.now !== "function") {
    return null;
  }
  try {
    return globalThis.performance.now();
  } catch {
    return null;
  }
}

function readRateClockMs() {
  return readMonotonicClockMs() ?? Date.now();
}

/** Owns one local passive camera stream without coupling it to playback controls. */
export function createChaseCameraStreamRuntime({
  getCapability,
  getFingerprint,
  capture,
  now,
  sourceNow,
  publishNow,
  createSubscriptionId = createCameraStreamSubscriptionId,
} = {}) {
  const rateNow = typeof now === "function" ? now : readRateClockMs;
  const sourceClock = typeof sourceNow === "function"
    ? sourceNow
    : typeof now === "function" ? now : readMonotonicClockMs;
  const publishClock = typeof publishNow === "function"
    ? publishNow
    : typeof now === "function" ? now : readMonotonicClockMs;
  let subscription = null;

  const readSourceTimestampUs = () => {
    try {
      return toCameraStreamTimestampUs(sourceClock());
    } catch {
      return null;
    }
  };
  const readPublishedTimestampUs = () => {
    try {
      return toCameraStreamTimestampUs(publishClock());
    } catch {
      return null;
    }
  };

  const stampFrameForPublish = (frame) => stampCameraStreamFramePublished(
    frame,
    readPublishedTimestampUs(),
  );

  const emitMessage = (current, message) => {
    if (subscription !== current || current.cancelled) {
      return;
    }
    if (current.sending) {
      if (message.type === "play_camera_stream_frame") {
        if (current.dropPolicy === "none") {
          if (current.pendingFrames.length >= current.queueBound) {
            end(
              "backpressure_overflow",
              "Camera stream pending-frame queue exceeded its configured bound.",
            );
            return;
          }
          current.pendingFrames.push(message.payload);
        } else {
          current.pendingFrame = selectLatestCameraStreamFrame(
            [current.pendingFrame, message.payload].filter(Boolean),
          );
          current.droppedFrameCount += 1;
        }
      }
      return;
    }

    let outgoingMessage = message;
    if (message.type === "play_camera_stream_frame") {
      const stampedFrame = stampFrameForPublish(message.payload);
      if (!stampedFrame) {
        end(
          "source_timestamp_invalid",
          "Camera stream publish timestamp was unavailable or earlier than capture.",
        );
        return;
      }
      outgoingMessage = { ...message, payload: stampedFrame };
    }
    current.sending = true;
    current.lastSentAt = rateNow();
    let delivery;
    try {
      delivery = current.emit(outgoingMessage);
    } catch {
      delivery = null;
    }
    const finishDelivery = () => {
      if (subscription !== current || current.cancelled) {
        return;
      }
      current.sending = false;
      const pendingFrame = current.dropPolicy === "none"
        ? current.pendingFrames.shift()
        : current.pendingFrame;
      if (!pendingFrame) {
        return;
      }
      const nextFrame = {
        ...pendingFrame,
        droppedFrameCount: current.droppedFrameCount,
      };
      current.pendingFrame = null;
      emitMessage(current, {
        type: "play_camera_stream_frame",
        payload: nextFrame,
      });
    };
    if (delivery && typeof delivery.then === "function") {
      delivery.then(finishDelivery, finishDelivery);
    } else {
      finishDelivery();
    }
  };

  const end = (code, message, changedFields) => {
    const current = subscription;
    if (!current) {
      return;
    }
    subscription = null;
    current.cancelled = true;
    current.pendingFrame = null;
    current.pendingFrames.length = 0;
    try {
      current.emit({
        type: "play_camera_stream_result",
        payload: buildChaseCameraStreamEndedResult(
          current.subscriptionId,
          code,
          message,
          changedFields,
        ),
      });
    } catch {
      // The owning frontend may be closing; the server also observes that close.
    }
  };

  const handleSubscribe = (request = {}, emit = () => {}) => {
    if (subscription) {
      return buildChaseCameraStreamUnsupportedResult({
        code: "already_subscribed",
        message: "This agent already has an active camera stream subscription.",
      });
    }

    const capability = getCapability();
    const resolved = resolveChaseCameraStreamRequest(request, capability);
    if (!resolved.ok) {
      return resolved.result;
    }
    const subscriptionId = createSubscriptionId();
    const result = buildChaseCameraStreamSubscribeResult({
      subscriptionId,
      request: resolved.value,
      capability,
      getFingerprint,
      capture,
      getSourceTimestampUs: readSourceTimestampUs,
    });
    if (result.event !== "subscribed") {
      return result;
    }

    subscription = {
      subscriptionId,
      actorId: result.frame.actorId,
      cameraId: result.frame.cameraId,
      width: resolved.value.width,
      height: resolved.value.height,
      quality: resolved.value.quality,
      maxRateHz: resolved.value.maxRateHz,
      dropPolicy: resolved.value.dropPolicy,
      queueBound: CHASE_CAMERA_STREAM_QUEUE_BOUND,
      sessionFingerprint: result.preservation.before,
      lastFrameIndex: result.frame.frameIdentity.frameIndex,
      lastSourceTimestampUs: result.frame.sourceTimestampUs,
      lastSentAt: rateNow(),
      droppedFrameCount: 0,
      pendingFrame: null,
      pendingFrames: [],
      sending: false,
      cancelled: false,
      emit: typeof emit === "function" ? emit : () => {},
    };
    return result;
  };

  const handleUnsubscribe = (request = {}) => {
    const requested = request && typeof request === "object" && !Array.isArray(request)
      ? request.subscriptionId
      : undefined;
    const current = subscription;
    if (!current || typeof requested !== "string" || requested.trim() !== current.subscriptionId) {
      return buildChaseCameraStreamUnsupportedResult({
        code: "subscription_not_found",
        message: "Camera stream subscription was not found for this frontend.",
        field: "subscriptionId",
        requested,
      });
    }
    subscription = null;
    current.cancelled = true;
    current.pendingFrame = null;
    current.pendingFrames.length = 0;
    return {
      event: "unsubscribed",
      subscriptionId: current.subscriptionId,
    };
  };

  const handleSimulationFrame = ({ frameIndex, simulationEpoch } = {}) => {
    const current = subscription;
    if (!current) {
      return;
    }
    const fingerprint = getFingerprint(current.actorId, current.cameraId);
    if (!fingerprint) {
      end(
        "session_identity_changed",
        "Camera stream session identity changed while the stream was active.",
      );
      return;
    }
    const changedIdentityFields = getChaseCameraStreamSessionIdentityChanges(
      current.sessionFingerprint,
      fingerprint,
    );
    if (changedIdentityFields.length > 0
      || (typeof simulationEpoch === "string" && simulationEpoch !== fingerprint.simulationEpoch)) {
      end(
        "session_identity_changed",
        "Camera stream session identity changed while the stream was active.",
        changedIdentityFields.length > 0 ? changedIdentityFields : ["simulationEpoch"],
      );
      return;
    }

    const nextFrameIndex = fingerprint.playback.frameIndex;
    if (nextFrameIndex === current.lastFrameIndex
      || (Number.isInteger(frameIndex) && frameIndex === current.lastFrameIndex)) {
      return;
    }
    current.lastFrameIndex = nextFrameIndex;
    const currentTime = rateNow();
    if (currentTime - current.lastSentAt < 1000 / current.maxRateHz) {
      current.droppedFrameCount += 1;
      return;
    }

    let image;
    try {
      image = capture(current);
    } catch (error) {
      end(
        "capture_unavailable",
        error instanceof Error ? error.message : "Camera capture is unavailable.",
      );
      return;
    }
    if (!image) {
      end("capture_unavailable", "Camera capture is unavailable.");
      return;
    }
    const sourceTimestampUs = readSourceTimestampUs();
    const frame = buildChaseCameraStreamFrame({
      subscriptionId: current.subscriptionId,
      actorId: current.actorId,
      cameraId: current.cameraId,
      fingerprint,
      image,
      sourceTimestampUs,
      droppedFrameCount: current.droppedFrameCount,
    });
    if (!frame) {
      end(
        "source_timestamp_invalid",
        "Camera capture did not produce a valid monotonic source timestamp.",
      );
      return;
    }
    if (frame.sourceTimestampUs < current.lastSourceTimestampUs) {
      end(
        "source_timestamp_invalid",
        "Camera stream source timestamp regressed within the subscription.",
      );
      return;
    }
    current.lastSourceTimestampUs = frame.sourceTimestampUs;
    emitMessage(current, {
      type: "play_camera_stream_frame",
      payload: frame,
    });
  };

  return {
    handleSubscribe,
    handleUnsubscribe,
    handleSimulationFrame,
    dispose() {
      end(
        "frontend_disconnected",
        "Frontend disconnected before the camera stream ended.",
      );
    },
  };
}
