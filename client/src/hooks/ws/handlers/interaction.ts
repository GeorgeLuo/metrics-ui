import type { ControlCommand, ControlResponse } from "@shared/schema";
import {
  buildCapabilitiesPayload,
  buildMetricCoverage,
} from "@shared/protocol-utils";
import { normalizeCaptureAppendFrame } from "@/hooks/ws/normalizers";
import type { WsCommandDispatchContext } from "@/hooks/ws/dispatch-context";

export function handleInteractionCommand(
  command: ControlCommand | ControlResponse,
  requestId: string | undefined,
  context: WsCommandDispatchContext,
): boolean {
  switch (command.type) {
    case "hello": {
      context.sendMessage({
        type: "capabilities",
        request_id: requestId,
        payload: buildCapabilitiesPayload(),
      });
      context.sendAck(requestId, command.type);
      return true;
    }
    case "get_state":
    case "list_captures":
      context.sendState(requestId);
      context.sendAck(requestId, command.type);
      return true;
    case "restore_state":
      context.onRestoreState?.(command);
      context.markBootstrapped();
      context.sendAck(requestId, command.type);
      return true;
    case "toggle_capture":
      context.onToggleCapture(command.captureId);
      context.sendAck(requestId, command.type);
      return true;
    case "remove_capture":
      context.onRemoveCapture(command.captureId);
      context.sendAck(requestId, command.type);
      return true;
    case "select_metric": {
      context.onSelectMetric(command.captureId, command.path, command.groupId);
      const fullPath = command.path.join(".");
      const label = command.path[command.path.length - 1] ?? fullPath;
      const coverage = buildMetricCoverage({
        captures: context.captures,
        metrics: [
          {
            captureId: command.captureId,
            path: command.path,
            fullPath,
            label,
            color: "auto",
          },
        ],
        captureId: command.captureId,
      });
      const summary = coverage[0];
      if (summary) {
        context.sendMessage({
          type: "metric_coverage",
          request_id: requestId,
          payload: {
            captureId: command.captureId,
            metrics: [summary],
          },
        });
        if (summary.total > 0 && summary.numericCount === 0) {
          context.sendError(requestId, "Selected metric has no numeric values.", {
            captureId: command.captureId,
            path: command.path,
            fullPath,
          });
        }
      } else {
        context.sendError(requestId, "Unable to summarize selected metric.", {
          captureId: command.captureId,
          path: command.path,
          fullPath,
        });
      }
      context.sendAck(requestId, command.type);
      return true;
    }
    case "set_metric_axis": {
      const fullPath =
        typeof command.fullPath === "string" && command.fullPath.trim().length > 0
          ? command.fullPath.trim()
          : Array.isArray(command.path) && command.path.length > 0
            ? command.path.join(".")
            : "";
      if (!fullPath) {
        context.sendError(requestId, "set_metric_axis requires --full-path or --path.", {
          captureId: command.captureId,
          axis: command.axis,
        });
        return true;
      }
      context.onSetMetricAxis(command.captureId, fullPath, command.axis);
      context.sendAck(requestId, command.type);
      return true;
    }
    case "deselect_metric":
      context.onDeselectMetric(command.captureId, command.fullPath);
      context.sendAck(requestId, command.type);
      return true;
    case "clear_selection":
      context.onClearSelection();
      context.sendAck(requestId, command.type);
      return true;
    case "select_analysis_metric":
      context.onSelectAnalysisMetric(command.captureId, command.path);
      context.sendAck(requestId, command.type);
      return true;
    case "deselect_analysis_metric":
      context.onDeselectAnalysisMetric(command.captureId, command.fullPath);
      context.sendAck(requestId, command.type);
      return true;
    case "clear_analysis_metrics":
      context.onClearAnalysisMetrics();
      context.sendAck(requestId, command.type);
      return true;
    case "create_derivation_group":
      context.onCreateDerivationGroup({ groupId: command.groupId, name: command.name });
      context.sendAck(requestId, command.type);
      return true;
    case "delete_derivation_group":
      context.onDeleteDerivationGroup(command.groupId);
      context.sendAck(requestId, command.type);
      return true;
    case "set_active_derivation_group":
      context.onSetActiveDerivationGroup(command.groupId);
      context.sendAck(requestId, command.type);
      return true;
    case "update_derivation_group":
      context.onUpdateDerivationGroup(command.groupId, {
        newGroupId: command.newGroupId,
        name: command.name,
        pluginId: command.pluginId,
      });
      context.sendAck(requestId, command.type);
      return true;
    case "reorder_derivation_group_metrics":
      context.onReorderDerivationGroupMetrics(command.groupId, command.fromIndex, command.toIndex);
      context.sendAck(requestId, command.type);
      return true;
    case "set_display_derivation_group":
      context.onSetDisplayDerivationGroup(command.groupId ? String(command.groupId) : "");
      context.sendAck(requestId, command.type);
      return true;
    case "clear_captures":
      context.onClearCaptures();
      context.sendAck(requestId, command.type);
      return true;
    case "play":
      context.onPlay();
      context.sendAck(requestId, command.type);
      return true;
    case "pause":
      context.onPause();
      context.sendAck(requestId, command.type);
      return true;
    case "stop":
      context.onStop();
      context.sendAck(requestId, command.type);
      return true;
    case "seek":
      if (context.isWindowed) {
        context.sendError(
          requestId,
          "Seek disabled while a window range is set. Reset the window to re-enable seeking.",
        );
        return true;
      }
      context.onSeek(command.tick);
      context.sendAck(requestId, command.type);
      return true;
    case "set_speed":
      context.onSpeedChange(command.speed);
      context.sendAck(requestId, command.type);
      return true;
    case "set_window_size":
      context.onWindowSizeChange(command.windowSize);
      context.sendAck(requestId, command.type);
      return true;
    case "set_window_start":
      context.onWindowStartChange(command.windowStart);
      context.sendAck(requestId, command.type);
      return true;
    case "set_window_end":
      context.onWindowEndChange(command.windowEnd);
      context.sendAck(requestId, command.type);
      return true;
    case "set_window_range":
      context.onWindowRangeChange(command.windowStart, command.windowEnd);
      context.sendAck(requestId, command.type);
      return true;
    case "set_y_range": {
      const min = Number(command.min);
      const max = Number(command.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        context.sendError(requestId, "set_y_range requires numeric --min and --max with max > min.", {
          min: command.min,
          max: command.max,
        });
        return true;
      }
      context.onYPrimaryRangeChange(min, max);
      context.sendAck(requestId, command.type);
      return true;
    }
    case "set_y2_range": {
      const min = Number(command.min);
      const max = Number(command.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        context.sendError(requestId, "set_y2_range requires numeric --min and --max with max > min.", {
          min: command.min,
          max: command.max,
        });
        return true;
      }
      context.onYSecondaryRangeChange(min, max);
      context.sendAck(requestId, command.type);
      return true;
    }
    case "set_auto_scroll":
      context.onAutoScrollChange(command.enabled);
      context.sendAck(requestId, command.type);
      return true;
    case "set_fullscreen":
      context.onSetFullscreen(command.enabled);
      context.sendAck(requestId, command.type);
      return true;
    case "add_annotation":
      context.onAddAnnotation({
        id: command.id ?? "",
        tick: command.tick,
        label: command.label,
        color: command.color,
      });
      context.sendAck(requestId, command.type);
      return true;
    case "remove_annotation":
      context.onRemoveAnnotation({ id: command.id, tick: command.tick });
      context.sendAck(requestId, command.type);
      return true;
    case "clear_annotations":
      context.onClearAnnotations();
      context.sendAck(requestId, command.type);
      return true;
    case "jump_annotation":
      context.onJumpAnnotation(command.direction);
      context.sendAck(requestId, command.type);
      return true;
    case "add_subtitle":
      context.onAddSubtitle({
        id: command.id ?? "",
        startTick: command.startTick,
        endTick: command.endTick,
        text: command.text,
        color: command.color,
      });
      context.sendAck(requestId, command.type);
      return true;
    case "remove_subtitle":
      context.onRemoveSubtitle({
        id: command.id,
        startTick: command.startTick,
        endTick: command.endTick,
        text: command.text,
      });
      context.sendAck(requestId, command.type);
      return true;
    case "clear_subtitles":
      context.onClearSubtitles();
      context.sendAck(requestId, command.type);
      return true;
    case "set_source_mode":
      context.onSourceModeChange(command.mode);
      context.sendAck(requestId, command.type);
      return true;
    case "set_live_source":
      context.onLiveSourceChange(command.source, command.captureId);
      context.sendAck(requestId, command.type);
      return true;
    case "state_sync": {
      const captures = Array.isArray(command.captures) ? command.captures : [];
      context.onStateSync?.(captures);
      context.sendAck(requestId, command.type);
      return true;
    }
    case "live_start":
      context.onLiveStart({
        source: command.source,
        pollIntervalMs: command.pollIntervalMs,
        captureId: command.captureId,
        filename: command.filename,
      })
        .then(() => context.sendAck(requestId, command.type))
        .catch((error) => {
          context.sendError(
            requestId,
            error instanceof Error ? error.message : "Failed to start live stream.",
            { source: command.source, pollIntervalMs: command.pollIntervalMs },
          );
        });
      return true;
    case "live_stop":
      context.onLiveStop({ captureId: command.captureId })
        .then(() => context.sendAck(requestId, command.type))
        .catch((error) => {
          context.sendError(
            requestId,
            error instanceof Error ? error.message : "Failed to stop live stream.",
          );
        });
      return true;
    case "capture_init":
      context.onCaptureInit(command.captureId, command.filename, {
        reset: command.reset,
        source: command.source,
      });
      context.sendMessage({
        type: "ui_notice",
        payload: {
          message: "Capture initialized",
          context: { captureId: command.captureId, filename: command.filename },
        },
      });
      context.sendAck(requestId, command.type);
      return true;
    case "capture_components":
      context.onCaptureComponents(command.captureId, command.components);
      context.sendAck(requestId, command.type);
      return true;
    case "capture_append": {
      const normalized = normalizeCaptureAppendFrame(command.frame);
      if (!normalized) {
        context.sendError(
          requestId,
          "Invalid capture_append frame. Expected {tick, entities} or {tick, entityId, componentId, value}.",
          { captureId: command.captureId },
        );
        return true;
      }
      context.onCaptureAppend(command.captureId, normalized);
      return true;
    }
    case "capture_tick":
      context.onCaptureTick(command.captureId, command.tick);
      return true;
    case "capture_end":
      context.onCaptureEnd(command.captureId, command.reason, command.detail);
      context.sendMessage({
        type: "ui_notice",
        payload: {
          message: "Capture ended",
          context: {
            captureId: command.captureId,
            reason: typeof command.reason === "string" ? command.reason : "unspecified",
            detail: typeof command.detail === "string" ? command.detail : undefined,
          },
        },
      });
      context.sendAck(requestId, command.type);
      return true;
    default:
      return false;
  }
}
