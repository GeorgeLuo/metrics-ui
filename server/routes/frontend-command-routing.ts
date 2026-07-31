import type {
  ControlCommand,
  ControlResponse,
} from "@shared/schema";

const FRONTEND_RESPONSE_REQUIRED_COMMANDS = new Set<ControlCommand["type"]>([
  "hello",
  "get_state",
  "list_captures",
  "get_display_snapshot",
  "get_series_window",
  "query_components",
  "get_render_table",
  "get_render_debug",
  "get_ui_debug",
  "get_play_debug",
  "get_play_game_usage",
  "play_game_query",
  "get_play_front_view_snapshot",
  "get_memory_stats",
  "get_metric_coverage",
]);

/** Returns whether an agent command must receive a frontend-generated response. */
export function requiresFrontendResponse(command: ControlCommand): boolean {
  return FRONTEND_RESPONSE_REQUIRED_COMMANDS.has(command.type);
}

/** Builds an immediate structured failure when a required frontend is absent. */
export function buildFrontendUnavailableResponse(
  command: ControlCommand,
): ControlResponse {
  return {
    type: "error",
    error: "Frontend not connected",
    request_id: command.request_id,
    payload: {
      supported: false,
      code: "frontend_not_connected",
      missing: "frontend_registration",
      command: command.type,
      ...("queryId" in command && typeof command.queryId === "string"
        ? { queryId: command.queryId }
        : {}),
    },
  };
}

/** Builds a bounded failure when a registered frontend does not answer. */
export function buildFrontendUnresponsiveResponse(
  command: ControlCommand,
  timeoutMs: number,
): ControlResponse {
  return {
    type: "error",
    error: "Registered frontend did not respond",
    request_id: command.request_id,
    payload: {
      supported: false,
      code: "frontend_unresponsive",
      missing: "frontend_response",
      command: command.type,
      timeoutMs,
      ...("queryId" in command && typeof command.queryId === "string"
        ? { queryId: command.queryId }
        : {}),
    },
  };
}

/** Builds a failure when the owning frontend disconnects during a request. */
export function buildFrontendDisconnectedResponse(
  command: ControlCommand,
): ControlResponse {
  return {
    type: "error",
    error: "Frontend disconnected before responding",
    request_id: command.request_id,
    payload: {
      supported: false,
      code: "frontend_disconnected",
      missing: "frontend_response",
      command: command.type,
      ...("queryId" in command && typeof command.queryId === "string"
        ? { queryId: command.queryId }
        : {}),
    },
  };
}
