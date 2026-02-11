import { useEffect, useRef, useCallback, useMemo } from "react";
import type {
  ControlCommand,
  ControlResponse,
  VisualizationState,
  SelectedMetric,
  DerivationGroup,
  PlaybackState,
  CaptureSession,
  ComponentNode,
  Annotation,
  SubtitleOverlay,
  MemoryStatsResponse,
  UiDebugResponse,
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

type RestoreStateCommand = Extract<ControlCommand, { type: "restore_state" }>;

const WS_CLOSE_FRONTEND_BUSY = 4000;
const WS_CLOSE_FRONTEND_REPLACED = 4001;

const RESPONSE_TYPES = new Set<ControlResponse["type"]>([
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

const QUEUED_COMMAND_TYPES = new Set<ControlCommand["type"]>([
  // Critical for correctness: ensures server-side persisted capture sources are updated even if the
  // WS is temporarily disconnected when the user removes a capture.
  "remove_capture",
  "clear_captures",
]);

interface UseWebSocketControlProps {
  captures: CaptureSession[];
  selectedMetrics: SelectedMetric[];
  analysisMetrics: SelectedMetric[];
  derivationGroups: DerivationGroup[];
  activeDerivationGroupId: string;
  displayDerivationGroupId: string;
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
  onRestoreState?: (command: RestoreStateCommand) => void;
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
  onSelectAnalysisMetric: (captureId: string, path: string[]) => boolean;
  onDeselectAnalysisMetric: (captureId: string, fullPath: string) => void;
  onClearAnalysisMetrics: () => void;
  onCreateDerivationGroup: (options?: { groupId?: string; name?: string }) => void;
  onDeleteDerivationGroup: (groupId: string) => void;
  onSetActiveDerivationGroup: (groupId: string) => void;
  onUpdateDerivationGroup: (
    groupId: string,
    updates: { newGroupId?: string; name?: string },
  ) => void;
  onReorderDerivationGroupMetrics: (groupId: string, fromIndex: number, toIndex: number) => void;
  onSetDisplayDerivationGroup: (groupId: string) => void;
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
  getUiDebug?: () => UiDebugResponse;
  onUiNotice?: (notice: { message: string; context?: Record<string, unknown>; requestId?: string }) => void;
  onUiError?: (notice: { error: string; context?: Record<string, unknown>; requestId?: string }) => void;
  onReconnect?: () => void;
  onStateSync?: (captures: { captureId: string; lastTick?: number | null }[]) => void;
  onDerivationPlugins?: (plugins: unknown[]) => void;
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

function isBenignAbortErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "aborterror" ||
    normalized === "aborted" ||
    normalized.includes("aborterror") ||
    normalized.includes("operation was aborted") ||
    normalized.includes("request was aborted")
  );
}

export function useWebSocketControl({
  captures,
  selectedMetrics,
  analysisMetrics,
  derivationGroups,
  activeDerivationGroupId,
  displayDerivationGroupId,
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
  onRestoreState,
  onSourceModeChange,
  onLiveSourceChange,
  onToggleCapture,
  onRemoveCapture,
  onSelectMetric,
  onDeselectMetric,
  onClearSelection,
  onSelectAnalysisMetric,
  onDeselectAnalysisMetric,
  onClearAnalysisMetrics,
  onCreateDerivationGroup,
  onDeleteDerivationGroup,
  onSetActiveDerivationGroup,
  onUpdateDerivationGroup,
  onReorderDerivationGroupMetrics,
  onSetDisplayDerivationGroup,
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
  getUiDebug,
  onUiNotice,
  onUiError,
  onStateSync,
  onReconnect,
  onDerivationPlugins,
}: UseWebSocketControlProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const isRegisteredRef = useRef(false);
  const isBootstrappedRef = useRef(false);
  const reconnectDisabledRef = useRef(false);
  const outboundQueueRef = useRef<ControlCommand[]>([]);
  const autoSyncTimerRef = useRef<number | null>(null);

  const sendMessage = useCallback((message: ControlResponse | ControlCommand) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN && isRegisteredRef.current) {
      ws.send(JSON.stringify(message));
      return true;
    }
    const type = (message as { type?: unknown }).type;
    if (typeof type === "string" && !RESPONSE_TYPES.has(type as ControlResponse["type"])) {
      const commandType = type as ControlCommand["type"];
      if (QUEUED_COMMAND_TYPES.has(commandType)) {
        outboundQueueRef.current.push(message as ControlCommand);
        // Keep this bounded; if the queue grows without a connection something is wrong.
        if (outboundQueueRef.current.length > 200) {
          outboundQueueRef.current.splice(0, outboundQueueRef.current.length - 200);
        }
      }
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
        analysisMetrics,
        derivationGroups,
        activeDerivationGroupId,
        displayDerivationGroupId,
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
  }, [captures, selectedMetrics, analysisMetrics, derivationGroups, activeDerivationGroupId, displayDerivationGroupId, playbackState, windowSize, windowStart, windowEnd, autoScroll, isFullscreen, viewport, annotations, subtitles]);

  const sendStateRef = useRef(sendState);

  useEffect(() => {
    sendStateRef.current = sendState;
  }, [sendState]);

  const captureIdentity = useMemo(() => {
    return captures
      .map((capture) => `${capture.id}:${capture.isActive ? 1 : 0}:${capture.filename}`)
      .sort()
      .join("|");
  }, [captures]);

  const playbackIdentity = `${playbackState.isPlaying ? 1 : 0}:${playbackState.speed}`;

  useEffect(() => {
    if (!isRegisteredRef.current) {
      return;
    }

    const hasMeaningfulState =
      selectedMetrics.length > 0 ||
      derivationGroups.length > 0 ||
      annotations.length > 0 ||
      subtitles.length > 0;

    // Prevent an empty, freshly-loaded browser session from overwriting server-side state. Once the
    // user makes a meaningful selection (or the server restores state), we start syncing normally.
    if (!isBootstrappedRef.current && !hasMeaningfulState) {
      return;
    }
    if (!isBootstrappedRef.current && hasMeaningfulState) {
      isBootstrappedRef.current = true;
    }

    if (autoSyncTimerRef.current !== null) {
      window.clearTimeout(autoSyncTimerRef.current);
    }
    autoSyncTimerRef.current = window.setTimeout(() => {
      autoSyncTimerRef.current = null;
      sendStateRef.current("auto_state_sync");
    }, 250);

    return () => {
      if (autoSyncTimerRef.current !== null) {
        window.clearTimeout(autoSyncTimerRef.current);
        autoSyncTimerRef.current = null;
      }
    };
  }, [
    captureIdentity,
    selectedMetrics,
    analysisMetrics,
    derivationGroups,
    activeDerivationGroupId,
    displayDerivationGroupId,
    playbackIdentity,
    windowSize,
    windowStart,
    windowEnd,
    autoScroll,
    isFullscreen,
    annotations,
    subtitles,
  ]);

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
      case "restore_state":
        onRestoreState?.(command);
        isBootstrappedRef.current = true;
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
      case "select_analysis_metric":
        // Treated as "add to derivation group". The UI will ensure the metric exists in the HUD selection.
        onSelectAnalysisMetric(command.captureId, command.path);
        sendAck(requestId, command.type);
        break;
      case "deselect_analysis_metric":
        onDeselectAnalysisMetric(command.captureId, command.fullPath);
        sendAck(requestId, command.type);
        break;
      case "clear_analysis_metrics":
        onClearAnalysisMetrics();
        sendAck(requestId, command.type);
        break;
      case "create_derivation_group":
        onCreateDerivationGroup({ groupId: command.groupId, name: command.name });
        sendAck(requestId, command.type);
        break;
      case "delete_derivation_group":
        onDeleteDerivationGroup(command.groupId);
        sendAck(requestId, command.type);
        break;
      case "set_active_derivation_group":
        onSetActiveDerivationGroup(command.groupId);
        sendAck(requestId, command.type);
        break;
      case "update_derivation_group":
        onUpdateDerivationGroup(command.groupId, {
          newGroupId: command.newGroupId,
          name: command.name,
        });
        sendAck(requestId, command.type);
        break;
      case "reorder_derivation_group_metrics":
        onReorderDerivationGroupMetrics(command.groupId, command.fromIndex, command.toIndex);
        sendAck(requestId, command.type);
        break;
      case "set_display_derivation_group":
        onSetDisplayDerivationGroup(command.groupId ? String(command.groupId) : "");
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
      case "get_ui_debug": {
        if (!getUiDebug) {
          sendError(requestId, "UI debug not available.");
          break;
        }
        const debug = getUiDebug();
        sendMessage({
          type: "ui_debug",
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
      case "derivation_plugins": {
        const payload = (command as ControlResponse).payload as { plugins?: unknown } | undefined;
        const pluginsRaw = payload?.plugins;
        const plugins = Array.isArray(pluginsRaw) ? pluginsRaw : [];
        onDerivationPlugins?.(plugins);
        break;
      }
      case "ui_notice": {
        const payload = (command as ControlResponse).payload as
          | { message?: unknown; context?: unknown }
          | undefined;
        const message =
          typeof payload?.message === "string" && payload.message.trim().length > 0
            ? payload.message.trim()
            : "Notice";
        const context =
          payload?.context && typeof payload.context === "object" && !Array.isArray(payload.context)
            ? (payload.context as Record<string, unknown>)
            : undefined;
        onUiNotice?.({ message, context, requestId });
        break;
      }
      case "ui_error": {
        const payload = (command as ControlResponse).payload as
          | { context?: unknown }
          | undefined;
        const context =
          payload?.context && typeof payload.context === "object" && !Array.isArray(payload.context)
            ? (payload.context as Record<string, unknown>)
            : undefined;
        const errorMessage =
          typeof (command as ControlResponse).error === "string" &&
          (command as ControlResponse).error!.trim().length > 0
            ? (command as ControlResponse).error!.trim()
            : "UI error";
        if (isBenignAbortErrorMessage(errorMessage)) {
          break;
        }
        onUiError?.({ error: errorMessage, context, requestId });
        break;
      }
      case "error": {
        const errorMessage =
          typeof (command as ControlResponse).error === "string" &&
          (command as ControlResponse).error!.trim().length > 0
            ? (command as ControlResponse).error!.trim()
            : "Server error";
        if (isBenignAbortErrorMessage(errorMessage)) {
          break;
        }
        onUiError?.({ error: errorMessage, requestId });
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
    onDerivationPlugins,
    onUiNotice,
    onUiError,
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
        isRegisteredRef.current = false;
        if (reconnectDisabledRef.current) {
          console.warn("[ws] Reconnect disabled, skipping registration.");
          try {
            ws.close();
          } catch {
            // ignore close errors
          }
          return;
        }

        let instanceId = "";
        try {
          const key = "metrics-ui-frontend-instance-id";
          // sessionStorage is per-tab. This prevents two browser tabs from sharing the same
          // instance id, which would otherwise make "single frontend" enforcement impossible.
          instanceId = window.sessionStorage.getItem(key) ?? "";
          if (!instanceId.trim()) {
            instanceId = `frontend-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
            window.sessionStorage.setItem(key, instanceId);
          }
        } catch {
          // ignore storage errors
        }

        let takeover = false;
        try {
          const params = new URLSearchParams(window.location.search);
          const raw = (params.get("takeover") ?? "").trim().toLowerCase();
          takeover = raw === "1" || raw === "true" || raw === "yes";
        } catch {
          // ignore URL parsing errors
        }

        ws.send(JSON.stringify({ type: "register", role: "frontend", instanceId, takeover }));
        onReconnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ack") {
            console.log("[ws] Registration confirmed:", message.payload);
            if (message.payload === "registered as frontend") {
              isRegisteredRef.current = true;
              try {
                const stored = window.localStorage.getItem("metrics-ui-live-streams");
                const parsed = stored ? JSON.parse(stored) : [];
                const list = Array.isArray(parsed) ? parsed : [];
                const sources: Array<{
                  captureId: string;
                  source: string;
                  pollIntervalMs?: number;
                }> = [];
                list.forEach((entry) => {
                  const captureId =
                    typeof entry?.captureId === "string"
                      ? entry.captureId
                      : typeof entry?.id === "string"
                        ? entry.id
                        : "";
                  const source = typeof entry?.source === "string" ? entry.source : "";
                  const pollSecondsRaw = Number(entry?.pollSeconds);
                  const pollIntervalMs =
                    Number.isFinite(pollSecondsRaw) && pollSecondsRaw > 0
                      ? Math.round(pollSecondsRaw * 1000)
                      : undefined;
                  if (!captureId || !source.trim()) {
                    return;
                  }
                  sources.push({ captureId, source, pollIntervalMs });
                });
                if (sources.length > 0) {
                  ws.send(
                    JSON.stringify({
                      type: "sync_capture_sources",
                      sources,
                      replace: true,
                    } satisfies ControlCommand),
                  );
                }
              } catch (error) {
                console.warn("[ws] Failed to sync capture sources from localStorage:", error);
              }

              // Only push initial state when we have meaningful localStorage-driven state. A brand
              // new browser session should not overwrite server-side state; it will receive a
              // restore_state command instead.
              try {
                const storedSelected = window.localStorage.getItem("metrics-ui-selected-metrics");
                const selected = storedSelected ? JSON.parse(storedSelected) : [];
                const storedGroups = window.localStorage.getItem("metrics-ui-derivation-groups");
                const groups = storedGroups ? JSON.parse(storedGroups) : [];
                const hasLocalState =
                  (Array.isArray(selected) && selected.length > 0) ||
                  (Array.isArray(groups) && groups.length > 0);

                isBootstrappedRef.current = hasLocalState;
                if (hasLocalState) {
                  // Ensure the server has the latest state after a refresh/reconnect so agent-side
                  // derivation runs (which read derivationGroups from lastVisualizationState) work.
                  sendStateRef.current("initial_state_sync");
                }
              } catch (error) {
                console.warn("[ws] Failed to inspect localStorage for dashboard state:", error);
                isBootstrappedRef.current = false;
              }

              // Flush any queued user commands (remove/clear capture) that may have been triggered
              // while the WS was disconnected.
              if (outboundQueueRef.current.length > 0) {
                const queued = [...outboundQueueRef.current];
                outboundQueueRef.current = [];
                queued.forEach((command) => {
                  try {
                    ws.send(JSON.stringify(command));
                  } catch {
                    // If this fails, re-queue and rely on the next reconnect.
                    outboundQueueRef.current.push(command);
                  }
                });
              }
            }
            return;
          }
          handleCommandRef.current(message as ControlCommand);
        } catch (e) {
          console.error("[ws] Failed to parse message:", e);
        }
      };

      ws.onclose = (event) => {
        if (isCleanedUp) {
          return;
        }
        isRegisteredRef.current = false;

        if (event.code === WS_CLOSE_FRONTEND_BUSY) {
          reconnectDisabledRef.current = true;
          console.warn(
            "[ws] Another UI tab is already connected. Staying disconnected. (Use ?takeover=1 to take over.)",
          );
          return;
        }
        if (event.code === WS_CLOSE_FRONTEND_REPLACED) {
          reconnectDisabledRef.current = true;
          console.warn("[ws] This UI tab was replaced by another. Staying disconnected.");
          return;
        }
        if (reconnectDisabledRef.current) {
          return;
        }

        console.log("[ws] Disconnected, reconnecting in 3s...");
        reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
      };

      wsRef.current = ws;
    }
    
    connect();

    return () => {
      isCleanedUp = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (autoSyncTimerRef.current !== null) {
        window.clearTimeout(autoSyncTimerRef.current);
        autoSyncTimerRef.current = null;
      }
      wsRef.current?.close();
    };
  }, []);

  return { sendState, sendMessage };
}
