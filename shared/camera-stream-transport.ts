import type { ControlResponse } from "./schema";
import type { CameraStreamDropPolicy, CameraStreamReasonCode } from "./play-camera-stream";

// Each camera send waits for the preceding socket buffer to drain. A single
// JPEG envelope is capped too, so a non-reading peer cannot grow transport RAM.
export const CAMERA_STREAM_MAX_MESSAGE_BYTES = 1024 * 1024;
export const CAMERA_STREAM_QUEUE_BOUND = 8;
const POLL_MS = 10;
const DRAIN_TIMEOUT_MS = 5000;

export type CameraTransportSocket = {
  readyState?: number;
  bufferedAmount: number;
  send(data: string): unknown;
};
type Entry = { message: ControlResponse; resolve: (sent: boolean) => void };

export function createCameraStreamTransport({ socket, dropPolicy = "latest-frame", prepare = (message) => message, onSent = () => {}, onFailure }: {
  socket: CameraTransportSocket;
  dropPolicy?: CameraStreamDropPolicy;
  prepare?: (message: ControlResponse) => ControlResponse | null;
  onSent?: (message: ControlResponse) => void;
  onFailure: (code: CameraStreamReasonCode) => void;
}) {
  let active = true, inFlight: Entry | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let waitingSince = 0, dropped = 0;
  const queue: Entry[] = [];
  const cancel = () => {
    active = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    inFlight?.resolve(false);
    inFlight = null;
    queue.splice(0).forEach((entry) => entry.resolve(false));
  };
  const fail = (code: CameraStreamReasonCode) => { cancel(); onFailure(code); };
  const schedule = () => {
    timer = setTimeout(pump, POLL_MS);
    timer.unref?.();
  };
  const pump = () => {
    timer = null;
    if (!active) return;
    if (socket.readyState !== 1) { fail("frontend_disconnected"); return; }
    if (socket.bufferedAmount > CAMERA_STREAM_MAX_MESSAGE_BYTES) { fail("backpressure_overflow"); return; }
    if (socket.bufferedAmount > 0) {
      if (Date.now() - waitingSince >= DRAIN_TIMEOUT_MS) { fail("backpressure_overflow"); return; }
      schedule(); return;
    }
    inFlight?.resolve(true);
    inFlight = null;
    const next = queue.shift();
    if (!next) return;
    let message = next.message;
    if (message.type === "play_camera_stream_frame") {
      const payload = message.payload as { droppedFrameCount: number };
      message = { ...message, payload: { ...payload, droppedFrameCount: payload.droppedFrameCount + dropped } };
    }
    try {
      const prepared = prepare(message);
      if (!prepared) { next.resolve(false); fail("source_timestamp_invalid"); return; }
      const data = JSON.stringify(prepared);
      if (new TextEncoder().encode(data).byteLength > CAMERA_STREAM_MAX_MESSAGE_BYTES) {
        next.resolve(false); fail("backpressure_overflow"); return;
      }
      inFlight = next;
      waitingSince = Date.now();
      socket.send(data);
      onSent(prepared);
    } catch { next.resolve(false); fail("frontend_disconnected"); return; }
    if (socket.bufferedAmount === 0) {
      inFlight = null;
      next.resolve(true);
      if (queue.length) pump();
    } else schedule();
  };
  return {
    send(message: ControlResponse): Promise<boolean> {
      if (!active) return Promise.resolve(false);
      try {
        if (new TextEncoder().encode(JSON.stringify(message)).byteLength > CAMERA_STREAM_MAX_MESSAGE_BYTES) {
          fail("backpressure_overflow");
          return Promise.resolve(false);
        }
      } catch {
        fail("frontend_disconnected");
        return Promise.resolve(false);
      }
      return new Promise((resolve) => {
        const frame = message.type === "play_camera_stream_frame";
        if (frame && dropPolicy === "latest-frame") {
          const previous = queue.findIndex((entry) => entry.message.type === "play_camera_stream_frame");
          if (previous >= 0) {
            queue.splice(previous, 1)[0].resolve(true);
            dropped += 1;
          }
        }
        if (queue.length >= CAMERA_STREAM_QUEUE_BOUND) { resolve(false); fail("backpressure_overflow"); return; }
        queue.push({ message, resolve });
        if (!inFlight && timer === null) { waitingSince = Date.now(); pump(); }
      });
    },
    // Terminal notices bypass pending images, with a small bounded allowance.
    end(message: ControlResponse): void {
      cancel();
      if (socket.readyState !== 1) return;
      try {
        const data = JSON.stringify(message);
        if (socket.bufferedAmount + new TextEncoder().encode(data).byteLength <= CAMERA_STREAM_MAX_MESSAGE_BYTES + 4096) socket.send(data);
      } catch { /* The socket owner also observes disconnects. */ }
    },
    cancel,
  };
}
