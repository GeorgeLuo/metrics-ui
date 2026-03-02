import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  CaptureSession,
  ControlCommand,
  ControlResponse,
  DerivationGroup,
  SelectedMetric,
} from "@shared/schema";
import {
  cloneMetric,
  getMetricIdentityKey as getMetricKey,
  uniqueMetrics,
} from "@/lib/dashboard/metric-utils";
import {
  getDerivationGroupDerivedMetrics,
  getDerivationGroupInputMetrics,
} from "@/lib/dashboard/derivation-utils";
import type {
  DerivationDragState,
  DerivationDropState,
  DerivationPluginRecord,
} from "./use-derivation-groups";

type RuntimeUiEvent = {
  level: "info" | "error";
  message: string;
  detail?: string;
};

type UseDerivationRuntimeOptions = {
  captures: CaptureSession[];
  initialSyncReady: boolean;
  derivationGroups: DerivationGroup[];
  derivationGroupsRef: MutableRefObject<DerivationGroup[]>;
  derivationPluginsRef: MutableRefObject<DerivationPluginRecord[]>;
  setDerivationGroups: Dispatch<SetStateAction<DerivationGroup[]>>;
  derivationDragState: DerivationDragState;
  derivationDropState: DerivationDropState;
  setDerivationDragState: Dispatch<SetStateAction<DerivationDragState>>;
  setDerivationDropState: Dispatch<SetStateAction<DerivationDropState>>;
  sendMessageRef: MutableRefObject<(message: ControlCommand | ControlResponse) => boolean>;
  pushUiEvent: (event: RuntimeUiEvent) => void;
  generateId: () => string;
};

type UseDerivationRuntimeResult = {
  pendingDerivationRuns: Array<{ requestId: string; outputCaptureId: string; label: string }>;
  syncPendingDerivationRuns: () => void;
  derivationRerunTimersRef: MutableRefObject<Map<string, number>>;
  derivationOutputGroupByCaptureRef: MutableRefObject<Map<string, string>>;
  pendingDerivationByRequestRef: MutableRefObject<
    Map<string, { outputCaptureId: string; label: string }>
  >;
  pendingDerivationRequestsByCaptureRef: MutableRefObject<Map<string, Set<string>>>;
  autoReplayDerivationsRef: MutableRefObject<Set<string>>;
  markDerivationRunPending: (requestId: string, outputCaptureId: string, label: string) => void;
  clearDerivationRunPendingByRequest: (requestId?: string) => void;
  clearDerivationRunPendingByCapture: (captureId: string) => void;
  clearAllPendingDerivationRuns: () => void;
  scheduleDerivationRecompute: (groupId: string, pluginId: string) => void;
  handleReorderDerivationGroupMetrics: (groupId: string, fromIndex: number, toIndex: number) => void;
  handleDerivationMetricDragStart: (
    event: React.DragEvent<HTMLDivElement>,
    groupId: string,
    fromIndex: number,
  ) => void;
  handleDerivationMetricDragOver: (
    event: React.DragEvent<HTMLDivElement>,
    groupId: string,
    targetIndex: number,
  ) => void;
  handleDerivationMetricDrop: (
    event: React.DragEvent<HTMLDivElement>,
    groupId: string,
    targetIndex: number,
  ) => void;
  handleDerivationMetricDragEnd: () => void;
  handleRunDerivation: (options: {
    groupId: string;
    kind: "moving_average" | "diff";
    window?: number;
  }) => void;
  handleRunDerivationPlugin: (options: {
    groupId: string;
    pluginId: string;
    outputCaptureId?: string;
  }) => void;
};

export function useDerivationRuntime({
  captures,
  initialSyncReady,
  derivationGroups,
  derivationGroupsRef,
  derivationPluginsRef,
  setDerivationGroups,
  derivationDragState,
  derivationDropState,
  setDerivationDragState,
  setDerivationDropState,
  sendMessageRef,
  pushUiEvent,
  generateId,
}: UseDerivationRuntimeOptions): UseDerivationRuntimeResult {
  const [pendingDerivationRuns, setPendingDerivationRuns] = useState<
    Array<{ requestId: string; outputCaptureId: string; label: string }>
  >([]);
  const derivationRerunTimersRef = useRef(new Map<string, number>());
  const derivationOutputGroupByCaptureRef = useRef(new Map<string, string>());
  const pendingDerivationByRequestRef = useRef(
    new Map<string, { outputCaptureId: string; label: string }>(),
  );
  const pendingDerivationRequestsByCaptureRef = useRef(new Map<string, Set<string>>());
  const autoReplayDerivationsRef = useRef(new Set<string>());

  const syncPendingDerivationRuns = useCallback(() => {
    const next = Array.from(pendingDerivationByRequestRef.current.entries()).map(
      ([requestId, entry]) => ({
        requestId,
        outputCaptureId: entry.outputCaptureId,
        label: entry.label,
      }),
    );
    setPendingDerivationRuns(next);
  }, []);

  const markDerivationRunPending = useCallback(
    (requestId: string, outputCaptureId: string, label: string) => {
      if (!requestId.trim() || !outputCaptureId.trim()) {
        return;
      }
      pendingDerivationByRequestRef.current.set(requestId, {
        outputCaptureId,
        label: label.trim(),
      });
      const existing = pendingDerivationRequestsByCaptureRef.current.get(outputCaptureId);
      if (existing) {
        existing.add(requestId);
      } else {
        pendingDerivationRequestsByCaptureRef.current.set(outputCaptureId, new Set([requestId]));
      }
      syncPendingDerivationRuns();
    },
    [syncPendingDerivationRuns],
  );

  const clearDerivationRunPendingByRequest = useCallback(
    (requestId?: string) => {
      if (!requestId || !requestId.trim()) {
        return;
      }
      const existing = pendingDerivationByRequestRef.current.get(requestId);
      if (!existing) {
        return;
      }
      pendingDerivationByRequestRef.current.delete(requestId);
      const captureSet = pendingDerivationRequestsByCaptureRef.current.get(
        existing.outputCaptureId,
      );
      if (captureSet) {
        captureSet.delete(requestId);
        if (captureSet.size === 0) {
          pendingDerivationRequestsByCaptureRef.current.delete(existing.outputCaptureId);
        }
      }
      syncPendingDerivationRuns();
    },
    [syncPendingDerivationRuns],
  );

  const clearDerivationRunPendingByCapture = useCallback(
    (captureId: string) => {
      if (!captureId.trim()) {
        return;
      }
      const captureSet = pendingDerivationRequestsByCaptureRef.current.get(captureId);
      if (!captureSet || captureSet.size === 0) {
        return;
      }
      captureSet.forEach((requestId) => {
        pendingDerivationByRequestRef.current.delete(requestId);
      });
      pendingDerivationRequestsByCaptureRef.current.delete(captureId);
      syncPendingDerivationRuns();
    },
    [syncPendingDerivationRuns],
  );

  const clearAllPendingDerivationRuns = useCallback(() => {
    pendingDerivationByRequestRef.current.clear();
    pendingDerivationRequestsByCaptureRef.current.clear();
    syncPendingDerivationRuns();
  }, [syncPendingDerivationRuns]);

  const scheduleDerivationRecompute = useCallback(
    (groupId: string, pluginId: string) => {
      const normalizedGroupId = groupId.trim();
      const normalizedPluginId = pluginId.trim();
      if (!normalizedGroupId || !normalizedPluginId) {
        return;
      }

      const timerKey = `${normalizedGroupId}::${normalizedPluginId}`;
      const existingTimer = derivationRerunTimersRef.current.get(timerKey);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }

      const timer = window.setTimeout(() => {
        derivationRerunTimersRef.current.delete(timerKey);
        const currentGroup = derivationGroupsRef.current.find(
          (group) => group.id === normalizedGroupId,
        );
        if (!currentGroup) {
          pushUiEvent({
            level: "info",
            message: "Derivation recompute canceled",
            detail: `group deleted: ${normalizedGroupId}`,
          });
          return;
        }
        const currentPluginId =
          typeof currentGroup.pluginId === "string" ? currentGroup.pluginId.trim() : "";
        if (currentPluginId !== normalizedPluginId) {
          pushUiEvent({
            level: "info",
            message: "Derivation recompute canceled",
            detail: `plugin changed: ${normalizedGroupId}`,
          });
          return;
        }
        const outputCaptureId = `derive-${normalizedGroupId}-${normalizedPluginId}`;
        const inputMetrics = getDerivationGroupInputMetrics(currentGroup).map(cloneMetric);
        const requestId = `derive-recompute-${generateId()}`;
        pushUiEvent({
          level: "info",
          message: "Derivation recompute started",
          detail: `${normalizedGroupId} -> ${normalizedPluginId}`,
        });
        markDerivationRunPending(
          requestId,
          outputCaptureId,
          `${normalizedGroupId} -> ${normalizedPluginId}`,
        );
        const sent = sendMessageRef.current({
          type: "run_derivation_plugin",
          groupId: normalizedGroupId,
          pluginId: normalizedPluginId,
          outputCaptureId,
          metrics: inputMetrics,
          request_id: requestId,
        });
        if (!sent) {
          clearDerivationRunPendingByRequest(requestId);
        }
      }, 180);

      derivationRerunTimersRef.current.set(timerKey, timer);
      pushUiEvent({
        level: "info",
        message: "Derivation recompute queued",
        detail: `${normalizedGroupId} -> ${normalizedPluginId}`,
      });
    },
    [
      clearDerivationRunPendingByRequest,
      derivationGroupsRef,
      generateId,
      markDerivationRunPending,
      pushUiEvent,
      sendMessageRef,
    ],
  );

  const handleReorderDerivationGroupMetrics = useCallback(
    (groupId: string, fromIndex: number, toIndex: number) => {
      if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) {
        return;
      }
      const from = Math.floor(fromIndex);
      const to = Math.floor(toIndex);

      const existingGroup = derivationGroupsRef.current.find((group) => group.id === groupId);
      if (!existingGroup) {
        return;
      }
      const size = getDerivationGroupInputMetrics(existingGroup).length;
      if (size <= 1) {
        return;
      }
      if (from < 0 || from >= size || to < 0 || to >= size || from === to) {
        return;
      }

      setDerivationGroups((prev) => {
        const next = prev.map((group) => {
          if (group.id !== groupId) {
            return group;
          }
          const nextMetrics = [...getDerivationGroupInputMetrics(group)];
          const [moved] = nextMetrics.splice(from, 1);
          if (!moved) {
            return group;
          }
          nextMetrics.splice(to, 0, moved);
          return { ...group, metrics: nextMetrics };
        });
        derivationGroupsRef.current = next;
        return next;
      });

      const pluginId = typeof existingGroup.pluginId === "string" ? existingGroup.pluginId.trim() : "";
      if (pluginId) {
        scheduleDerivationRecompute(groupId, pluginId);
      }
    },
    [derivationGroupsRef, scheduleDerivationRecompute, setDerivationGroups],
  );

  const handleDerivationMetricDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, groupId: string, fromIndex: number) => {
      setDerivationDragState({ groupId, fromIndex });
      setDerivationDropState(null);
      try {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ type: "derivation-metric", groupId, fromIndex }),
        );
      } catch {
        // ignore dataTransfer errors
      }
    },
    [setDerivationDragState, setDerivationDropState],
  );

  const handleDerivationMetricDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>, groupId: string, targetIndex: number) => {
      if (!derivationDragState || derivationDragState.groupId !== groupId) {
        return;
      }
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const middleY = rect.top + rect.height / 2;
      const position: "before" | "after" = event.clientY < middleY ? "before" : "after";
      setDerivationDropState({ groupId, targetIndex, position });
      event.dataTransfer.dropEffect = "move";
    },
    [derivationDragState, setDerivationDropState],
  );

  const handleDerivationMetricDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>, groupId: string, targetIndex: number) => {
      if (!derivationDragState || derivationDragState.groupId !== groupId) {
        return;
      }
      event.preventDefault();

      const fromIndex = derivationDragState.fromIndex;
      const position =
        derivationDropState &&
        derivationDropState.groupId === groupId &&
        derivationDropState.targetIndex === targetIndex
          ? derivationDropState.position
          : "before";

      const rawInsertIndex = position === "before" ? targetIndex : targetIndex + 1;
      const normalizedInsertIndex =
        fromIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;

      setDerivationDragState(null);
      setDerivationDropState(null);
      handleReorderDerivationGroupMetrics(groupId, fromIndex, normalizedInsertIndex);
    },
    [
      derivationDragState,
      derivationDropState,
      handleReorderDerivationGroupMetrics,
      setDerivationDragState,
      setDerivationDropState,
    ],
  );

  const handleDerivationMetricDragEnd = useCallback(() => {
    setDerivationDragState(null);
    setDerivationDropState(null);
  }, [setDerivationDragState, setDerivationDropState]);

  const handleRunDerivation = useCallback(
    (options: { groupId: string; kind: "moving_average" | "diff"; window?: number }) => {
      const derivedCaptureId =
        options.kind === "moving_average"
          ? `derive-${options.groupId}-moving_average-${options.window ?? 5}`
          : `derive-${options.groupId}-diff`;
      const requestId = `derive-run-${generateId()}`;
      derivationOutputGroupByCaptureRef.current.set(derivedCaptureId, options.groupId);
      markDerivationRunPending(
        requestId,
        derivedCaptureId,
        `${options.groupId} -> ${options.kind}`,
      );
      const sent = sendMessageRef.current({
        type: "run_derivation",
        groupId: options.groupId,
        kind: options.kind,
        window: options.window,
        request_id: requestId,
      });
      if (!sent) {
        clearDerivationRunPendingByRequest(requestId);
      }
      pushUiEvent({
        level: "info",
        message: "Derivation run requested",
        detail: `${options.kind} on ${options.groupId}`,
      });
    },
    [
      clearDerivationRunPendingByRequest,
      generateId,
      markDerivationRunPending,
      pushUiEvent,
      sendMessageRef,
    ],
  );

  const handleRunDerivationPlugin = useCallback(
    (options: { groupId: string; pluginId: string; outputCaptureId?: string }) => {
      const outputCaptureId =
        options.outputCaptureId || `derive-${options.groupId}-${options.pluginId}`;
      const requestId = `derive-plugin-${generateId()}`;
      const group = derivationGroupsRef.current.find(
        (entry) => entry.id === options.groupId,
      );
      if (!group) {
        pushUiEvent({
          level: "error",
          message: `Derivation group not found: ${options.groupId}`,
        });
        return;
      }
      let inputMetrics = uniqueMetrics(getDerivationGroupInputMetrics(group).map(cloneMetric));
      const plugin = derivationPluginsRef.current.find(
        (entry) => entry.id === options.pluginId,
      );
      if (plugin) {
        const minInputs = Number.isInteger(plugin.minInputs) ? plugin.minInputs : 1;
        const maxInputs =
          Number.isInteger(plugin.maxInputs) && (plugin.maxInputs as number) >= minInputs
            ? (plugin.maxInputs as number)
            : null;
        if (maxInputs !== null && inputMetrics.length > maxInputs) {
          inputMetrics = inputMetrics.slice(0, maxInputs);
          pushUiEvent({
            level: "info",
            message: "Trimmed derivation inputs",
            detail: `${options.groupId} -> ${options.pluginId} (${maxInputs} max)`,
          });
        }
        if (inputMetrics.length < minInputs) {
          pushUiEvent({
            level: "error",
            message: `Plugin ${options.pluginId} requires at least ${minInputs} input metrics`,
            detail: `${options.groupId} has ${inputMetrics.length}`,
          });
          return;
        }
      }
      derivationOutputGroupByCaptureRef.current.set(outputCaptureId, options.groupId);
      markDerivationRunPending(
        requestId,
        outputCaptureId,
        `${options.groupId} -> ${options.pluginId}`,
      );
      const sent = sendMessageRef.current({
        type: "run_derivation_plugin",
        groupId: options.groupId,
        pluginId: options.pluginId,
        outputCaptureId,
        metrics: inputMetrics,
        request_id: requestId,
      });
      if (!sent) {
        clearDerivationRunPendingByRequest(requestId);
      }
      pushUiEvent({
        level: "info",
        message: "Derivation plugin run requested",
        detail: `${options.groupId} -> ${options.pluginId}`,
      });
    },
    [
      clearDerivationRunPendingByRequest,
      derivationGroupsRef,
      derivationPluginsRef,
      generateId,
      markDerivationRunPending,
      pushUiEvent,
      sendMessageRef,
    ],
  );

  useEffect(() => {
    return () => {
      derivationRerunTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      derivationRerunTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!initialSyncReady) {
      return;
    }
    if (derivationGroups.length === 0) {
      return;
    }
    derivationGroups.forEach((group) => {
      const pluginId = typeof group.pluginId === "string" ? group.pluginId.trim() : "";
      if (!pluginId) {
        return;
      }
      const metrics = getDerivationGroupInputMetrics(group);
      if (metrics.length === 0) {
        return;
      }
      const persistedDerivedMetrics = getDerivationGroupDerivedMetrics(group);
      if (persistedDerivedMetrics.length === 0) {
        return;
      }
      const knownDerivedCaptureIds = Array.from(
        new Set(
          persistedDerivedMetrics
            .map((metric) => metric.captureId)
            .filter((captureId) => typeof captureId === "string" && captureId.length > 0),
        ),
      );
      const outputCaptureId =
        knownDerivedCaptureIds[0] ?? `derive-${group.id}-${pluginId}`;
      const existing = captures.find((capture) => capture.id === outputCaptureId);
      // Replay only when the output capture already has records in this session.
      // This restores derived outputs after refresh without creating duplicate output captures.
      if (existing && existing.records.length > 0) {
        return;
      }
      const key = `${group.id}::${pluginId}`;
      if (autoReplayDerivationsRef.current.has(key)) {
        return;
      }
      autoReplayDerivationsRef.current.add(key);
      handleRunDerivationPlugin({ groupId: group.id, pluginId, outputCaptureId });
    });
  }, [captures, derivationGroups, handleRunDerivationPlugin, initialSyncReady]);

  return {
    pendingDerivationRuns,
    syncPendingDerivationRuns,
    derivationRerunTimersRef,
    derivationOutputGroupByCaptureRef,
    pendingDerivationByRequestRef,
    pendingDerivationRequestsByCaptureRef,
    autoReplayDerivationsRef,
    markDerivationRunPending,
    clearDerivationRunPendingByRequest,
    clearDerivationRunPendingByCapture,
    clearAllPendingDerivationRuns,
    scheduleDerivationRecompute,
    handleReorderDerivationGroupMetrics,
    handleDerivationMetricDragStart,
    handleDerivationMetricDragOver,
    handleDerivationMetricDrop,
    handleDerivationMetricDragEnd,
    handleRunDerivation,
    handleRunDerivationPlugin,
  };
}
