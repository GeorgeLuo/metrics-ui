import type { ControlCommand, ControlResponse } from "@shared/schema";
import type {
  CameraStreamPushMessage,
  CameraStreamResultPayload,
  CameraStreamSubscribeRequest,
  CameraStreamUnsubscribeRequest,
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

function sendResult(
  context: WsCommandDispatchContext,
  requestId: string | undefined,
  result: CameraStreamResultPayload,
): void {
  context.sendMessage({
    type: "play_camera_stream_result",
    request_id: requestId,
    payload: result,
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
      ]) as CameraStreamSubscribeRequest;
      let result: CameraStreamResultPayload;
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
      let result: CameraStreamResultPayload;
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
