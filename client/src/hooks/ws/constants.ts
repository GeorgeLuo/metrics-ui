import type { ControlCommand, ControlResponse } from "@shared/schema";

export const WS_CLOSE_FRONTEND_BUSY = 4000;
export const WS_CLOSE_FRONTEND_REPLACED = 4001;

export const RESPONSE_TYPES = new Set<ControlResponse["type"]>([
  "state_update",
  "captures_list",
  "error",
  "ack",
  "capabilities",
  "derivation_plugins",
  "display_snapshot",
  "series_window",
  "components_list",
  "render_table",
  "render_debug",
  "ui_debug",
  "ui_notice",
  "ui_error",
  "memory_stats",
  "metric_coverage",
]);

export const QUEUED_COMMAND_TYPES = new Set<ControlCommand["type"]>([
  // Critical for correctness: ensures server-side persisted capture sources are updated even if the
  // WS is temporarily disconnected when the user removes a capture.
  "remove_capture",
  "clear_captures",
]);
