import type { ControlCommand, ControlResponse } from "@shared/schema";
import type {
  CameraStreamPushMessage,
  CameraStreamResultPayload,
  CameraStreamResultPayloadDraft,
  CameraStreamSubscribeRequest,
  CameraStreamUnsubscribeRequest,
} from "@shared/play-camera-stream";
import {
  stampCameraStreamResultPublished,
  toCameraStreamTimestampUs,
} from "@shared/play-camera-stream";
import type { WsCommandDispatchContext } from "@/hooks/ws/dispatch-context";

function copyPresentFields(
  command: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(command, field)) {
      request[field] = command[field];
    }
  });
  return request;
}

function readPublishTimestampUs(): number | null {
  if (typeof globalThis.performance?.now !== "function") {
    return null;
  }
  try {
    return toCameraStreamTimestampUs(globalThis.performance.now());
  } catch {
    return null;
  }
}

function sendResult(
  context: WsCommandDispatchContext,
  requestId: string | undefined,
  result: CameraStreamResultPayloadDraft,
): void {
  let wireResult: CameraStreamResultPayload;
  if (result.event === "subscribed") {
    const publishedAtUs = readPublishTimestampUs();
    wireResult = stampCameraStreamResultPublished(result, publishedAtUs)
      ?? {
        event: "unsupported",
        cameraStream: {
          supported: false,
          reason: {
            code: "source_timestamp_invalid",
            message: "Camera stream publish timestamp was unavailable or invalid.",
            field: "publishedAtUs",
          },
        },
      };
    if (wireResult.event === "unsupported") {
      try {
        context.onPlayCameraStreamUnsubscribe?.({ subscriptionId: result.subscriptionId });
      } catch {
        // The runtime may already be closing; the unsupported result is still sent.
      }
    }
  } else {
    wireResult = result;
  }
  context.sendMessage({
    type: "play_camera_stream_result",
    request_id: requestId,
    payload: wireResult,
  });
}

export function handleCameraStreamCommand(
  command: ControlCommand | ControlResponse,
  requestId: string | undefined,
  context: WsCommandDispatchContext,
): boolean {
  switch (command.type) {
    case "play_camera_stream_subscribe": {
      if (!context.onPlayCameraStreamSubscribe) {
        context.sendError(
          requestId,
          "Camera stream subscription is not available. Activate the Play sub-app and wait for the game to load.",
        );
        return true;
      }
      const request = copyPresentFields(command as unknown as Record<string, unknown>, [
        "actorId",
        "cameraId",
        "width",
        "height",
        "imageFormat",
        "quality",
        "maxRateHz",
        "dropPolicy",
      ]) as CameraStreamSubscribeRequest;
      let result: CameraStreamResultPayloadDraft;
      try {
        result = context.onPlayCameraStreamSubscribe(
          request,
          (message: CameraStreamPushMessage) => context.sendMessage(message),
        );
      } catch (error) {
        context.sendError(
          requestId,
          error instanceof Error ? error.message : "Failed to subscribe to the camera stream.",
          { command: "play_camera_stream_subscribe" },
        );
        return true;
      }
      if (!result) {
        context.sendError(requestId, "Camera stream subscription returned no result.", {
          command: "play_camera_stream_subscribe",
        });
        return true;
      }
      sendResult(context, requestId, result);
      return true;
    }
    case "play_camera_stream_unsubscribe": {
      if (!context.onPlayCameraStreamUnsubscribe) {
        context.sendError(
          requestId,
          "Camera stream unsubscription is not available. Activate the Play sub-app and wait for the game to load.",
        );
        return true;
      }
      const request = copyPresentFields(command as unknown as Record<string, unknown>, [
        "subscriptionId",
      ]) as CameraStreamUnsubscribeRequest;
      let result: CameraStreamResultPayloadDraft;
      try {
        result = context.onPlayCameraStreamUnsubscribe(request);
      } catch (error) {
        context.sendError(
          requestId,
          error instanceof Error ? error.message : "Failed to unsubscribe from the camera stream.",
          { command: "play_camera_stream_unsubscribe" },
        );
        return true;
      }
      if (!result) {
        context.sendError(requestId, "Camera stream unsubscription returned no result.", {
          command: "play_camera_stream_unsubscribe",
        });
        return true;
      }
      sendResult(context, requestId, result);
      return true;
    }
    default:
      return false;
  }
}
