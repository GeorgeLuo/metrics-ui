import type { ControlCommand, ControlResponse } from "@shared/schema";
import {
  buildComponentsList,
  buildDisplaySnapshot,
  buildMetricCoverage,
  buildRenderDebug,
  buildRenderTable,
  buildSeriesWindow,
} from "@shared/protocol-utils";
import type { WsCommandDispatchContext } from "@/hooks/ws/dispatch-context";

export function handleQueryCommand(
  command: ControlCommand | ControlResponse,
  requestId: string | undefined,
  context: WsCommandDispatchContext,
): boolean {
  switch (command.type) {
    case "get_display_snapshot": {
      const snapshot = buildDisplaySnapshot({
        captures: context.captures,
        selectedMetrics: context.selectedMetrics,
        playback: context.playbackState,
        windowSize: command.windowSize ?? context.windowSize,
        windowStart: command.windowStart ?? context.windowStart,
        windowEnd: command.windowEnd ?? context.windowEnd,
        autoScroll: context.autoScroll,
        annotations: context.annotations,
        subtitles: context.subtitles,
        captureId: command.captureId,
      });
      context.sendMessage({
        type: "display_snapshot",
        request_id: requestId,
        payload: snapshot,
      });
      context.sendAck(requestId, command.type);
      return true;
    }
    case "get_series_window": {
      const capture = context.captures.find((item) => item.id === command.captureId);
      if (!capture) {
        context.sendError(requestId, `Capture not found: ${command.captureId}`, {
          captureId: command.captureId,
        });
        return true;
      }
      const series = buildSeriesWindow({
        records: capture.records,
        path: command.path,
        currentTick: context.playbackState.currentTick,
        windowSize: command.windowSize ?? context.windowSize,
        windowStart: command.windowStart ?? context.windowStart,
        windowEnd: command.windowEnd ?? context.windowEnd,
        captureId: capture.id,
      });
      context.sendMessage({
        type: "series_window",
        request_id: requestId,
        payload: series,
      });
      context.sendAck(requestId, command.type);
      return true;
    }
    case "query_components": {
      const capture = context.resolveCapture(command.captureId);
      if (!capture) {
        context.sendError(requestId, "No capture available for component query.", {
          captureId: command.captureId ?? null,
        });
        return true;
      }
      const list = buildComponentsList({
        components: capture.components,
        captureId: capture.id,
        search: command.search,
        limit: command.limit,
      });
      context.sendMessage({
        type: "components_list",
        request_id: requestId,
        payload: list,
      });
      context.sendAck(requestId, command.type);
      return true;
    }
    case "get_render_table": {
      const capture = context.resolveCapture(command.captureId);
      if (!capture) {
        context.sendError(requestId, "No capture available for render table.", {
          captureId: command.captureId ?? null,
        });
        return true;
      }
      const metrics = context.selectedMetrics.filter(
        (metric) => metric.captureId === capture.id,
      );
      if (metrics.length === 0) {
        context.sendError(requestId, "No selected metrics for render table.", {
          captureId: capture.id,
        });
        return true;
      }
      const table = buildRenderTable({
        records: capture.records,
        metrics,
        currentTick: context.playbackState.currentTick,
        windowSize: command.windowSize ?? context.windowSize,
        windowStart: command.windowStart ?? context.windowStart,
        windowEnd: command.windowEnd ?? context.windowEnd,
        captureId: capture.id,
      });
      context.sendMessage({
        type: "render_table",
        request_id: requestId,
        payload: table,
      });
      context.sendAck(requestId, command.type);
      return true;
    }
    case "get_render_debug": {
      const debug = buildRenderDebug({
        captures: context.captures,
        selectedMetrics: context.selectedMetrics,
        playback: context.playbackState,
        windowSize: command.windowSize ?? context.windowSize,
        windowStart: command.windowStart ?? context.windowStart,
        windowEnd: command.windowEnd ?? context.windowEnd,
        autoScroll: context.autoScroll,
        yPrimaryDomain: context.yPrimaryDomain,
        ySecondaryDomain: context.ySecondaryDomain,
        captureId: command.captureId,
      });
      context.sendMessage({
        type: "render_debug",
        request_id: requestId,
        payload: debug,
      });
      context.sendAck(requestId, command.type);
      return true;
    }
    case "get_ui_debug": {
      if (!context.getUiDebug) {
        context.sendError(requestId, "UI debug not available.");
        return true;
      }
      const debug = context.getUiDebug();
      context.sendMessage({
        type: "ui_debug",
        request_id: requestId,
        payload: debug,
      });
      context.sendAck(requestId, command.type);
      return true;
    }
    case "get_memory_stats": {
      const stats = context.getMemoryStats();
      context.sendMessage({
        type: "memory_stats",
        request_id: requestId,
        payload: stats,
      });
      context.sendAck(requestId, command.type);
      return true;
    }
    case "get_metric_coverage": {
      const targetCaptureId = command.captureId;
      const metrics = targetCaptureId
        ? context.selectedMetrics.filter((metric) => metric.captureId === targetCaptureId)
        : context.selectedMetrics;
      if (metrics.length === 0) {
        context.sendError(requestId, "No selected metrics to summarize.", {
          captureId: targetCaptureId ?? null,
        });
        return true;
      }
      const coverage = buildMetricCoverage({
        captures: context.captures,
        metrics,
        captureId: targetCaptureId,
      });
      context.sendMessage({
        type: "metric_coverage",
        request_id: requestId,
        payload: {
          captureId: targetCaptureId ?? null,
          metrics: coverage,
        },
      });
      context.sendAck(requestId, command.type);
      return true;
    }
    default:
      return false;
  }
}
