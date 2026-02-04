import { useEffect, useRef, useCallback } from "react";
import type {
  ControlCommand,
  ControlResponse,
  VisualizationState,
  SelectedMetric,
  PlaybackState,
  CaptureSession,
  ComponentNode,
  Annotation,
  SubtitleOverlay,
  MemoryStatsResponse,
  CaptureAppendFrame,
  CaptureRecord,
  CaptureRecordLine,
} from "@shared/schema";
import {
  buildCapabilitiesPayload,
  buildComponentsList,
  buildDisplaySnapshot,
  buildMetricCoverage,
  buildRenderTable,
  buildRenderDebug,
  buildSeriesWindow,
} from "@shared/protocol-utils";

interface UseWebSocketControlProps {
  captures: CaptureSession[];
  selectedMetrics: SelectedMetric[];
  playbackState: PlaybackState;
  windowSize: number;
  windowStart: number;
  windowEnd: number;
  autoScroll: boolean;
  isWindowed: boolean;
  isFullscreen: boolean;
  viewport?: VisualizationState["viewport"];
  annotations: Annotation[];
  subtitles: SubtitleOverlay[];
  onWindowSizeChange: (windowSize: number) => void;
  onWindowStartChange: (windowStart: number) => void;
  onWindowEndChange: (windowEnd: number) => void;
  onWindowRangeChange: (windowStart: number, windowEnd: number) => void;
  onAutoScrollChange: (enabled: boolean) => void;
  onSetFullscreen: (enabled: boolean) => void;
  onSourceModeChange: (mode: "file" | "live") => void;
  onLiveSourceChange: (source: string, captureId?: string) => void;
  onToggleCapture: (captureId: string) => void;
  onRemoveCapture: (captureId: string) => void;
  onSelectMetric: (captureId: string, path: string[]) => void;
  onDeselectMetric: (captureId: string, fullPath: string) => void;
  onClearSelection: () => void;
  onClearCaptures: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (tick: number) => void;
  onSpeedChange: (speed: number) => void;
  onLiveStart: (options: {
    source?: string;
    pollIntervalMs?: number;
    captureId?: string;
    filename?: string;
  }) => Promise<void>;
  onLiveStop: (options?: { captureId?: string }) => Promise<void>;
  onCaptureInit: (
    captureId: string,
    filename?: string,
    options?: { reset?: boolean; source?: string },
  ) => void;
  onCaptureComponents: (captureId: string, components: ComponentNode[]) => void;
  onCaptureAppend: (captureId: string, frame: CaptureSession["records"][number]) => void;
  onCaptureTick: (captureId: string, tick: number) => void;
  onCaptureEnd: (captureId: string) => void;
  onAddAnnotation: (annotation: Annotation) => void;
  onRemoveAnnotation: (options: { id?: string; tick?: number }) => void;
  onClearAnnotations: () => void;
  onJumpAnnotation: (direction: "next" | "previous") => void;
  onAddSubtitle: (subtitle: SubtitleOverlay) => void;
  onRemoveSubtitle: (options: { id?: string; startTick?: number; endTick?: number; text?: string }) => void;
  onClearSubtitles: () => void;
  getMemoryStats: () => MemoryStatsResponse;
  onReconnect?: () => void;
  onStateSync?: (captures: { captureId: string; lastTick?: number | null }[]) => void;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeCaptureAppendFrame(frame: CaptureAppendFrame): CaptureRecord | null {
  if (!frame || typeof frame !== "object") {
    return null;
  }

  const maybe = frame as CaptureRecord & CaptureRecordLine;
  if (!isFiniteNumber(maybe.tick)) {
    return null;
  }

  if (
    maybe.entities &&
    typeof maybe.entities === "object" &&
    !Array.isArray(maybe.entities)
  ) {
    return {
      tick: maybe.tick,
      entities: maybe.entities as Record<string, Record<string, unknown>>,
    };
  }

  if (typeof maybe.entityId === "string" && typeof maybe.componentId === "string") {
    return {
      tick: maybe.tick,
      entities: {
        [maybe.entityId]: {
          [maybe.componentId]: maybe.value,
        },
      },
    };
  }

  return null;
}

export function useWebSocketControl({
  captures,
  selectedMetrics,
  playbackState,
  windowSize,
  windowStart,
  windowEnd,
  autoScroll,
  isWindowed,
  isFullscreen,
  viewport,
  annotations,
  subtitles,
  onSourceModeChange,
  onLiveSourceChange,
  onToggleCapture,
  onRemoveCapture,
  onSelectMetric,
  onDeselectMetric,
  onClearSelection,
  onClearCaptures,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSpeedChange,
  onWindowSizeChange,
  onWindowStartChange,
  onWindowEndChange,
  onWindowRangeChange,
  onAutoScrollChange,
  onSetFullscreen,
  onLiveStart,
  onLiveStop,
  onCaptureInit,
  onCaptureComponents,
  onCaptureAppend,
  onCaptureTick,
  onCaptureEnd,
  onAddAnnotation,
  onRemoveAnnotation,
  onClearAnnotations,
  onJumpAnnotation,
  onAddSubtitle,
  onRemoveSubtitle,
  onClearSubtitles,
  getMemoryStats,
  onStateSync,
  onReconnect,
}: UseWebSocketControlProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const sendMessage = useCallback((message: ControlResponse | ControlCommand) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  const sendState = useCallback((requestId?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const state: VisualizationState = {
        captures: captures.map(c => ({
          id: c.id,
          filename: c.filename,
          tickCount: c.tickCount,
          isActive: c.isActive,
        })),
        selectedMetrics,
        playback: playbackState,
        windowSize,
        windowStart,
        windowEnd,
        autoScroll,
        isFullscreen,
        viewport,
        annotations,
        subtitles,
      };
      wsRef.current.send(JSON.stringify({
        type: "state_update",
        payload: state,
        request_id: requestId,
      } as ControlResponse));
    }
  }, [captures, selectedMetrics, playbackState, windowSize, windowStart, windowEnd, autoScroll, isFullscreen, viewport, annotations, subtitles]);

  const sendAck = useCallback((requestId: string | undefined, command: string) => {
    if (!requestId) {
      return;
    }
    sendMessage({
      type: "ack",
      request_id: requestId,
      payload: { command },
    });
  }, [sendMessage]);

  const sendError = useCallback(
    (requestId: string | undefined, error: string, context?: Record<string, unknown>) => {
      sendMessage({
        type: "error",
        request_id: requestId,
        error,
      });
      sendMessage({
        type: "ui_error",
        request_id: requestId,
        error,
        payload: context ? { context } : undefined,
      });
    },
    [sendMessage],
  );

  const resolveCapture = useCallback((captureId?: string) => {
    if (captureId) {
      return captures.find((capture) => capture.id === captureId);
    }
    if (selectedMetrics.length > 0) {
      return captures.find((capture) => capture.id === selectedMetrics[0].captureId);
    }
    return captures.find((capture) => capture.isActive) ?? captures[0];
  }, [captures, selectedMetrics]);

  const handleCommand = useCallback((command: ControlCommand | ControlResponse) => {
    const requestId = "request_id" in command ? command.request_id : undefined;

    switch (command.type) {
      case "hello": {
        sendMessage({
          type: "capabilities",
          request_id: requestId,
          payload: buildCapabilitiesPayload(),
        });
        sendAck(requestId, command.type);
        break;
      }
      case "get_state":
        sendState(requestId);
        sendAck(requestId, command.type);
        break;
      case "list_captures":
        sendState(requestId);
        sendAck(requestId, command.type);
        break;
      case "toggle_capture":
        onToggleCapture(command.captureId);
        sendAck(requestId, command.type);
        break;
      case "remove_capture":
        onRemoveCapture(command.captureId);
        sendAck(requestId, command.type);
        break;
      case "select_metric":
        onSelectMetric(command.captureId, command.path);
        {
          const fullPath = command.path.join(".");
          const label = command.path[command.path.length - 1] ?? fullPath;
          const coverage = buildMetricCoverage({
            captures,
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
            sendMessage({
              type: "metric_coverage",
              request_id: requestId,
              payload: {
                captureId: command.captureId,
                metrics: [summary],
              },
            });
            if (summary.total > 0 && summary.numericCount === 0) {
              sendError(requestId, "Selected metric has no numeric values.", {
                captureId: command.captureId,
                path: command.path,
                fullPath,
              });
            }
          } else {
            sendError(requestId, "Unable to summarize selected metric.", {
              captureId: command.captureId,
              path: command.path,
              fullPath,
            });
          }
        }
        sendAck(requestId, command.type);
        break;
      case "deselect_metric":
        onDeselectMetric(command.captureId, command.fullPath);
        sendAck(requestId, command.type);
        break;
      case "clear_selection":
        onClearSelection();
        sendAck(requestId, command.type);
        break;
      case "clear_captures":
        onClearCaptures();
        sendAck(requestId, command.type);
        break;
      case "play":
        onPlay();
        sendAck(requestId, command.type);
        break;
      case "pause":
        onPause();
        sendAck(requestId, command.type);
        break;
      case "stop":
        onStop();
        sendAck(requestId, command.type);
        break;
      case "seek":
        if (isWindowed) {
          sendError(
            requestId,
            "Seek disabled while a window range is set. Reset the window to re-enable seeking.",
          );
          break;
        }
        onSeek(command.tick);
        sendAck(requestId, command.type);
        break;
      case "set_speed":
        onSpeedChange(command.speed);
        sendAck(requestId, command.type);
        break;
      case "set_window_size":
        onWindowSizeChange(command.windowSize);
        sendAck(requestId, command.type);
        break;
      case "set_window_start":
        onWindowStartChange(command.windowStart);
        sendAck(requestId, command.type);
        break;
      case "set_window_end":
        onWindowEndChange(command.windowEnd);
        sendAck(requestId, command.type);
        break;
      case "set_window_range":
        onWindowRangeChange(command.windowStart, command.windowEnd);
        sendAck(requestId, command.type);
        break;
      case "set_auto_scroll":
        onAutoScrollChange(command.enabled);
        sendAck(requestId, command.type);
        break;
      case "set_fullscreen":
        onSetFullscreen(command.enabled);
        sendAck(requestId, command.type);
        break;
      case "add_annotation":
        onAddAnnotation({
          id: command.id ?? "",
          tick: command.tick,
          label: command.label,
          color: command.color,
        });
        sendAck(requestId, command.type);
        break;
      case "remove_annotation":
        onRemoveAnnotation({ id: command.id, tick: command.tick });
        sendAck(requestId, command.type);
        break;
      case "clear_annotations":
        onClearAnnotations();
        sendAck(requestId, command.type);
        break;
      case "jump_annotation":
        onJumpAnnotation(command.direction);
        sendAck(requestId, command.type);
        break;
      case "add_subtitle":
        onAddSubtitle({
          id: command.id ?? "",
          startTick: command.startTick,
          endTick: command.endTick,
          text: command.text,
          color: command.color,
        });
        sendAck(requestId, command.type);
        break;
      case "remove_subtitle":
        onRemoveSubtitle({
          id: command.id,
          startTick: command.startTick,
          endTick: command.endTick,
          text: command.text,
        });
        sendAck(requestId, command.type);
        break;
      case "clear_subtitles":
        onClearSubtitles();
        sendAck(requestId, command.type);
        break;
      case "set_source_mode":
        onSourceModeChange(command.mode);
        sendAck(requestId, command.type);
        break;
      case "set_live_source":
        onLiveSourceChange(command.source, command.captureId);
        sendAck(requestId, command.type);
        break;
      case "state_sync": {
        const captures = Array.isArray(command.captures) ? command.captures : [];
        onStateSync?.(captures);
        sendAck(requestId, command.type);
        break;
      }
      case "live_start": {
        onLiveStart({
          source: command.source,
          pollIntervalMs: command.pollIntervalMs,
          captureId: command.captureId,
          filename: command.filename,
        })
          .then(() => sendAck(requestId, command.type))
          .catch((error) => {
            sendError(
              requestId,
              error instanceof Error ? error.message : "Failed to start live stream.",
              { source: command.source, pollIntervalMs: command.pollIntervalMs },
            );
          });
        break;
      }
      case "live_stop": {
        onLiveStop({ captureId: command.captureId })
          .then(() => sendAck(requestId, command.type))
          .catch((error) => {
            sendError(
              requestId,
              error instanceof Error ? error.message : "Failed to stop live stream.",
            );
          });
        break;
      }
      case "capture_init":
        onCaptureInit(command.captureId, command.filename, { reset: command.reset, source: command.source });
        sendMessage({
          type: "ui_notice",
          payload: {
            message: "Capture initialized",
            context: { captureId: command.captureId, filename: command.filename },
          },
        });
        sendAck(requestId, command.type);
        break;
      case "capture_components":
        onCaptureComponents(command.captureId, command.components);
        sendAck(requestId, command.type);
        break;
      case "capture_append":
        {
          const normalized = normalizeCaptureAppendFrame(command.frame);
          if (!normalized) {
            sendError(
              requestId,
              "Invalid capture_append frame. Expected {tick, entities} or {tick, entityId, componentId, value}.",
              { captureId: command.captureId },
            );
            break;
          }
          onCaptureAppend(command.captureId, normalized);
        }
        break;
      case "capture_tick":
        onCaptureTick(command.captureId, command.tick);
        break;
      case "capture_end":
        onCaptureEnd(command.captureId);
        sendMessage({
          type: "ui_notice",
          payload: {
            message: "Capture ended",
            context: { captureId: command.captureId },
          },
        });
        sendAck(requestId, command.type);
        break;
      case "get_display_snapshot": {
        const snapshot = buildDisplaySnapshot({
          captures,
          selectedMetrics,
          playback: playbackState,
          windowSize: command.windowSize ?? windowSize,
          windowStart: command.windowStart ?? windowStart,
          windowEnd: command.windowEnd ?? windowEnd,
          autoScroll,
          annotations,
          subtitles,
          captureId: command.captureId,
        });
        sendMessage({
          type: "display_snapshot",
          request_id: requestId,
          payload: snapshot,
        });
        sendAck(requestId, command.type);
        break;
      }
      case "get_series_window": {
        const capture = captures.find((item) => item.id === command.captureId);
        if (!capture) {
          sendError(requestId, `Capture not found: ${command.captureId}`, {
            captureId: command.captureId,
          });
          break;
        }
        const series = buildSeriesWindow({
          records: capture.records,
          path: command.path,
          currentTick: playbackState.currentTick,
          windowSize: command.windowSize ?? windowSize,
          windowStart: command.windowStart ?? windowStart,
          windowEnd: command.windowEnd ?? windowEnd,
          captureId: capture.id,
        });
        sendMessage({
          type: "series_window",
          request_id: requestId,
          payload: series,
        });
        sendAck(requestId, command.type);
        break;
      }
      case "query_components": {
        const capture = resolveCapture(command.captureId);
        if (!capture) {
          sendError(requestId, "No capture available for component query.", {
            captureId: command.captureId ?? null,
          });
          break;
        }
        const list = buildComponentsList({
          components: capture.components,
          captureId: capture.id,
          search: command.search,
          limit: command.limit,
        });
        sendMessage({
          type: "components_list",
          request_id: requestId,
          payload: list,
        });
        sendAck(requestId, command.type);
        break;
      }
      case "get_render_table": {
        const capture = resolveCapture(command.captureId);
        if (!capture) {
          sendError(requestId, "No capture available for render table.", {
            captureId: command.captureId ?? null,
          });
          break;
        }
        const metrics = selectedMetrics.filter(
          (metric) => metric.captureId === capture.id,
        );
        if (metrics.length === 0) {
          sendError(requestId, "No selected metrics for render table.", {
            captureId: capture.id,
          });
          break;
        }
        const table = buildRenderTable({
          records: capture.records,
          metrics,
          currentTick: playbackState.currentTick,
          windowSize: command.windowSize ?? windowSize,
          windowStart: command.windowStart ?? windowStart,
          windowEnd: command.windowEnd ?? windowEnd,
          captureId: capture.id,
        });
        sendMessage({
          type: "render_table",
          request_id: requestId,
          payload: table,
        });
        sendAck(requestId, command.type);
        break;
      }
      case "get_render_debug": {
        const debug = buildRenderDebug({
          captures,
          selectedMetrics,
          playback: playbackState,
          windowSize: command.windowSize ?? windowSize,
          windowStart: command.windowStart ?? windowStart,
          windowEnd: command.windowEnd ?? windowEnd,
          autoScroll,
          captureId: command.captureId,
        });
        sendMessage({
          type: "render_debug",
          request_id: requestId,
          payload: debug,
        });
        sendAck(requestId, command.type);
        break;
      }
      case "get_memory_stats": {
        const stats = getMemoryStats();
        sendMessage({
          type: "memory_stats",
          request_id: requestId,
          payload: stats,
        });
        sendAck(requestId, command.type);
        break;
      }
      case "get_metric_coverage": {
        const targetCaptureId = command.captureId;
        const metrics = targetCaptureId
          ? selectedMetrics.filter((metric) => metric.captureId === targetCaptureId)
          : selectedMetrics;
        if (metrics.length === 0) {
          sendError(requestId, "No selected metrics to summarize.", {
            captureId: targetCaptureId ?? null,
          });
          break;
        }
        const coverage = buildMetricCoverage({
          captures,
          metrics,
          captureId: targetCaptureId,
        });
        sendMessage({
          type: "metric_coverage",
          request_id: requestId,
          payload: {
            captureId: targetCaptureId ?? null,
            metrics: coverage,
          },
        });
        sendAck(requestId, command.type);
        break;
      }
    }
  }, [
    sendState,
    sendMessage,
    sendAck,
    sendError,
    resolveCapture,
    onToggleCapture,
    onSelectMetric,
    onDeselectMetric,
    onClearSelection,
    onPlay,
    onPause,
    onStop,
    onSeek,
    onSpeedChange,
    onWindowSizeChange,
    onWindowStartChange,
    onWindowEndChange,
    onWindowRangeChange,
    onAutoScrollChange,
    onSetFullscreen,
    onLiveStart,
    onLiveStop,
    onCaptureInit,
    onCaptureComponents,
    onCaptureAppend,
    onCaptureEnd,
    onAddAnnotation,
    onRemoveAnnotation,
    onClearAnnotations,
    onJumpAnnotation,
    onAddSubtitle,
    onRemoveSubtitle,
    onClearSubtitles,
    getMemoryStats,
    buildMetricCoverage,
    captures,
    selectedMetrics,
    playbackState,
    windowSize,
    windowStart,
    windowEnd,
    autoScroll,
    annotations,
    subtitles,
  ]);

  const handleCommandRef = useRef(handleCommand);

  useEffect(() => {
    handleCommandRef.current = handleCommand;
  }, [handleCommand]);

  useEffect(() => {
    let isCleanedUp = false;
    
    function connect() {
      if (isCleanedUp) return;
      
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/control`);
      
      ws.onopen = () => {
        console.log("[ws] Connected to control server, registering as frontend...");
        ws.send(JSON.stringify({ type: "register", role: "frontend" }));
        onReconnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ack") {
            console.log("[ws] Registration confirmed:", message.payload);
            return;
          }
          if (message.type === "error") {
            console.error("[ws] Server error:", message.error);
            return;
          }
          handleCommandRef.current(message as ControlCommand);
        } catch (e) {
          console.error("[ws] Failed to parse message:", e);
        }
      };

      ws.onclose = () => {
        if (!isCleanedUp) {
          console.log("[ws] Disconnected, reconnecting in 3s...");
          reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
        }
      };

      wsRef.current = ws;
    }
    
    connect();

    return () => {
      isCleanedUp = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    sendState();
  }, [captures, selectedMetrics, playbackState, windowSize, windowStart, windowEnd, autoScroll, annotations, subtitles, sendState]);

  return { sendState, sendMessage };
}
