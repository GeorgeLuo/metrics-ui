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
} from "@shared/schema";
import { RESPONSE_TYPES, QUEUED_COMMAND_TYPES, WS_CLOSE_FRONTEND_BUSY, WS_CLOSE_FRONTEND_REPLACED } from "@/hooks/ws/constants";
import { dispatchWsCommand } from "@/hooks/ws/command-dispatch";
import {
  buildCaptureSourceSyncCommand,
  hasMeaningfulLocalDashboardState,
  readCaptureSourcesForSync,
} from "@/hooks/ws/bootstrap";

type RestoreStateCommand = Extract<ControlCommand, { type: "restore_state" }>;

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
  yPrimaryDomain?: [number, number] | null;
  ySecondaryDomain?: [number, number] | null;
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
  onYPrimaryRangeChange: (min: number, max: number) => void;
  onYSecondaryRangeChange: (min: number, max: number) => void;
  onAutoScrollChange: (enabled: boolean) => void;
  onSetFullscreen: (enabled: boolean) => void;
  onSourceModeChange: (mode: "file" | "live") => void;
  onLiveSourceChange: (source: string, captureId?: string) => void;
  onToggleCapture: (captureId: string) => void;
  onRemoveCapture: (captureId: string) => void;
  onSelectMetric: (captureId: string, path: string[], groupId?: string) => void;
  onSetMetricAxis: (captureId: string, fullPath: string, axis: "y1" | "y2") => void;
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
    updates: { newGroupId?: string; name?: string; pluginId?: string },
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
  onCaptureEnd: (captureId: string, reason?: string, detail?: string) => void;
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
  onConnectionLock?: (event: {
    reason: "busy" | "replaced";
    message: string;
    closeCode: number;
    closeReason: string;
  }) => void;
  onConnectionUnlock?: () => void;
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
  yPrimaryDomain,
  ySecondaryDomain,
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
  onSetMetricAxis,
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
  onYPrimaryRangeChange,
  onYSecondaryRangeChange,
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
  onConnectionLock,
  onConnectionUnlock,
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
        yPrimaryDomain: yPrimaryDomain ?? null,
        ySecondaryDomain: ySecondaryDomain ?? null,
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
  }, [captures, selectedMetrics, analysisMetrics, derivationGroups, activeDerivationGroupId, displayDerivationGroupId, playbackState, windowSize, windowStart, windowEnd, yPrimaryDomain, ySecondaryDomain, autoScroll, isFullscreen, viewport, annotations, subtitles]);

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
      (Array.isArray(yPrimaryDomain) && yPrimaryDomain.length === 2) ||
      (Array.isArray(ySecondaryDomain) && ySecondaryDomain.length === 2) ||
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
    yPrimaryDomain,
    ySecondaryDomain,
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

  const markBootstrapped = useCallback(() => {
    isBootstrappedRef.current = true;
  }, []);

  const handleCommand = useCallback((command: ControlCommand | ControlResponse) => {
    dispatchWsCommand(command, {
      sendMessage,
      sendAck,
      sendError,
      sendState,
      markBootstrapped,
      resolveCapture,
      captures,
      selectedMetrics,
      playbackState,
      windowSize,
      windowStart,
      windowEnd,
      yPrimaryDomain,
      ySecondaryDomain,
      autoScroll,
      annotations,
      subtitles,
      isWindowed,
      onRestoreState,
      onToggleCapture,
      onRemoveCapture,
      onSelectMetric,
      onSetMetricAxis,
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
      onYPrimaryRangeChange,
      onYSecondaryRangeChange,
      onAutoScrollChange,
      onSetFullscreen,
      onSourceModeChange,
      onLiveSourceChange,
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
      onStateSync,
      onDerivationPlugins,
      onUiNotice,
      onUiError,
    });
  }, [
    sendMessage,
    sendAck,
    sendError,
    sendState,
    markBootstrapped,
    resolveCapture,
    captures,
    selectedMetrics,
    playbackState,
    windowSize,
    windowStart,
    windowEnd,
    yPrimaryDomain,
    ySecondaryDomain,
    autoScroll,
    annotations,
    subtitles,
    isWindowed,
    onRestoreState,
    onToggleCapture,
    onRemoveCapture,
    onSelectMetric,
    onSetMetricAxis,
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
    onYPrimaryRangeChange,
    onYSecondaryRangeChange,
    onAutoScrollChange,
    onSetFullscreen,
    onSourceModeChange,
    onLiveSourceChange,
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
    onStateSync,
    onDerivationPlugins,
    onUiNotice,
    onUiError,
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
              reconnectDisabledRef.current = false;
              onConnectionUnlock?.();
              try {
                const sources = readCaptureSourcesForSync();
                const syncCommand = buildCaptureSourceSyncCommand(sources);
                if (syncCommand) {
                  ws.send(JSON.stringify(syncCommand));
                }
              } catch (error) {
                console.warn("[ws] Failed to sync capture sources from localStorage:", error);
              }

              try {
                const hasLocalState = hasMeaningfulLocalDashboardState();
                isBootstrappedRef.current = hasLocalState;
                if (hasLocalState) {
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
          handleCommandRef.current(message as ControlCommand | ControlResponse);
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
          onConnectionLock?.({
            reason: "busy",
            message:
              "Another browser session already controls this dashboard. This tab is locked until you take over.",
            closeCode: event.code,
            closeReason: event.reason || "frontend already connected",
          });
          console.warn(
            "[ws] Another UI tab is already connected. Staying disconnected. (Use ?takeover=1 to take over.)",
          );
          return;
        }
        if (event.code === WS_CLOSE_FRONTEND_REPLACED) {
          reconnectDisabledRef.current = true;
          onConnectionLock?.({
            reason: "replaced",
            message: "This dashboard session was replaced by another tab and is now locked.",
            closeCode: event.code,
            closeReason: event.reason || "frontend replaced",
          });
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
