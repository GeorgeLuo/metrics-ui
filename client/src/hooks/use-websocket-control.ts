import { useEffect, useRef, useCallback } from "react";
import type { ControlCommand, ControlResponse, VisualizationState, SelectedMetric, PlaybackState, CaptureSession } from "@shared/schema";

interface UseWebSocketControlProps {
  captures: CaptureSession[];
  selectedMetrics: SelectedMetric[];
  playbackState: PlaybackState;
  onToggleCapture: (captureId: string) => void;
  onSelectMetric: (captureId: string, path: string[]) => void;
  onDeselectMetric: (captureId: string, fullPath: string) => void;
  onClearSelection: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (tick: number) => void;
  onSpeedChange: (speed: number) => void;
}

export function useWebSocketControl({
  captures,
  selectedMetrics,
  playbackState,
  onToggleCapture,
  onSelectMetric,
  onDeselectMetric,
  onClearSelection,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSpeedChange,
}: UseWebSocketControlProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const sendState = useCallback(() => {
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
      };
      wsRef.current.send(JSON.stringify({
        type: "state_update",
        payload: state,
      } as ControlResponse));
    }
  }, [captures, selectedMetrics, playbackState]);

  const handleCommand = useCallback((command: ControlCommand) => {
    switch (command.type) {
      case "get_state":
        sendState();
        break;
      case "list_captures":
        sendState();
        break;
      case "toggle_capture":
        onToggleCapture(command.captureId);
        break;
      case "select_metric":
        onSelectMetric(command.captureId, command.path);
        break;
      case "deselect_metric":
        onDeselectMetric(command.captureId, command.fullPath);
        break;
      case "clear_selection":
        onClearSelection();
        break;
      case "play":
        onPlay();
        break;
      case "pause":
        onPause();
        break;
      case "stop":
        onStop();
        break;
      case "seek":
        onSeek(command.tick);
        break;
      case "set_speed":
        onSpeedChange(command.speed);
        break;
    }
  }, [sendState, onToggleCapture, onSelectMetric, onDeselectMetric, onClearSelection, onPlay, onPause, onStop, onSeek, onSpeedChange]);

  useEffect(() => {
    let isCleanedUp = false;
    
    function connect() {
      if (isCleanedUp) return;
      
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/control`);
      
      ws.onopen = () => {
        console.log("[ws] Connected to control server, registering as frontend...");
        ws.send(JSON.stringify({ type: "register", role: "frontend" }));
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
          handleCommand(message as ControlCommand);
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
  }, [handleCommand]);

  useEffect(() => {
    sendState();
  }, [captures, selectedMetrics, playbackState, sendState]);

  return { sendState };
}
