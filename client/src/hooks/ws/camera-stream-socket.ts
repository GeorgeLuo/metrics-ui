import type { ControlResponse } from "@shared/schema";
import type { CameraStreamDropPolicy, CameraStreamReasonCode, CameraStreamUnsubscribeRequest } from "@shared/play-camera-stream";
import { stampCameraStreamFramePublished, stampCameraStreamResultPublished, toCameraStreamTimestampUs } from "@shared/play-camera-stream";
import { createCameraStreamTransport, type CameraTransportSocket } from "@shared/camera-stream-transport";

/** One socket owns its runtime subscription; it never follows wsRef on reconnect. */
export function createCameraStreamSocketSession(socket: CameraTransportSocket, unsubscribe: (request: CameraStreamUnsubscribeRequest) => unknown) {
  let subscriptionId: string | null = null;
  let transport: ReturnType<typeof createCameraStreamTransport> | null = null;
  let closed = false;
  let subscribeRequestId: string | undefined;
  let subscribedSent = false;
  const release = () => {
    const id = subscriptionId;
    subscriptionId = null;
    transport?.cancel();
    transport = null;
    if (id) { try { unsubscribe({ subscriptionId: id }); } catch { /* Already disposed game. */ } }
  };
  const fail = (code: CameraStreamReasonCode) => {
    const id = subscriptionId, sender = transport;
    release();
    if (id) sender?.end({ type: "play_camera_stream_result", request_id: subscribedSent ? undefined : subscribeRequestId,
      payload: subscribedSent
        ? { event: "ended", subscriptionId: id, reason: { code, message: "Camera stream socket transport ended." } }
        : { event: "unsupported", cameraStream: { supported: false, reason: { code, message: "Camera stream socket transport failed before subscription delivery." } } },
    });
  };
  return {
    start(id: string, dropPolicy: CameraStreamDropPolicy) {
      if (closed) { unsubscribe({ subscriptionId: id }); return; }
      release();
      subscriptionId = id;
      subscribedSent = false;
      subscribeRequestId = undefined;
      transport = createCameraStreamTransport({ socket, dropPolicy, onFailure: fail, onSent(message) {
        if (message.type === "play_camera_stream_result") subscribedSent = true;
      }, prepare(message) {
        const nowUs = toCameraStreamTimestampUs(globalThis.performance?.now());
        if (message.type === "play_camera_stream_frame") {
          const frame = stampCameraStreamFramePublished(message.payload as Parameters<typeof stampCameraStreamFramePublished>[0], nowUs);
          return frame ? { ...message, payload: frame } : null;
        }
        if (message.type === "play_camera_stream_result") {
          const result = stampCameraStreamResultPublished(message.payload as Parameters<typeof stampCameraStreamResultPublished>[0], nowUs);
          return result ? { ...message, payload: result } : null;
        }
        return message;
      } });
    },
    send(message: ControlResponse) {
      const payload = message.payload as { subscriptionId?: string; event?: string } | undefined;
      if (!transport || payload?.subscriptionId !== subscriptionId) return Promise.resolve(false);
      if (payload.event === "ended") {
        const sender = transport;
        const terminal = subscribedSent ? message : {
          type: "play_camera_stream_result" as const,
          request_id: subscribeRequestId,
          payload: { event: "unsupported", cameraStream: { supported: false, reason: (message.payload as { reason: unknown }).reason } },
        };
        release();
        sender.end(terminal);
        return Promise.resolve(true);
      }
      if (payload.event === "subscribed") subscribeRequestId = message.request_id;
      return transport.send(message);
    },
    release(id: unknown) { if (id === subscriptionId) release(); },
    close() { closed = true; release(); },
  };
}
export type CameraStreamSocketSession = ReturnType<typeof createCameraStreamSocketSession>;
