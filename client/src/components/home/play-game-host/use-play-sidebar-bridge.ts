import { useCallback, useEffect, useRef } from "react";
import {
  normalizePlaySidebarSections,
  type PlaySidebarSection,
} from "@/lib/play/sidebar-sections";
import { normalizeSidebarActionId } from "./ids";

const SIDEBAR_VALUE_UPDATE_MIN_MS = 250;

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function getSidebarSectionsSignature(
  sections: PlaySidebarSection[],
  options: { ignoreDisplayValues?: boolean } = {},
): string {
  if (!options.ignoreDisplayValues) {
    return JSON.stringify(sections);
  }
  return JSON.stringify(
    sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => (
        row.kind === "value" ? { ...row, value: "" } : row
      )),
    })),
  );
}

export function usePlaySidebarBridge({
  onSidebarSectionsChange,
  onSidebarActionHandlerChange,
}: {
  onSidebarSectionsChange?: (sections: PlaySidebarSection[]) => void;
  onSidebarActionHandlerChange?: (handler: ((actionId: string, value?: unknown) => void) | null) => void;
}) {
  const actionHandlersRef = useRef<Map<string, (value?: unknown) => void>>(new Map());
  const onSectionsChangeRef = useRef(onSidebarSectionsChange);
  const pendingSectionsRef = useRef<PlaySidebarSection[] | null>(null);
  const pendingSignatureRef = useRef("");
  const pendingLayoutSignatureRef = useRef("");
  const signatureRef = useRef("");
  const layoutSignatureRef = useRef("");
  const lastPublishAtRef = useRef(0);
  const publishTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onSectionsChangeRef.current = onSidebarSectionsChange;
  }, [onSidebarSectionsChange]);

  const publishSections = useCallback((
    sections: PlaySidebarSection[],
    signature: string,
    layoutSignature: string,
  ) => {
    pendingSectionsRef.current = null;
    pendingSignatureRef.current = "";
    pendingLayoutSignatureRef.current = "";
    signatureRef.current = signature;
    layoutSignatureRef.current = layoutSignature;
    lastPublishAtRef.current = nowMs();
    onSectionsChangeRef.current?.(sections);
  }, []);

  const clearPendingSidebarPublish = useCallback(() => {
    if (publishTimerRef.current !== null) {
      window.clearTimeout(publishTimerRef.current);
      publishTimerRef.current = null;
    }
    pendingSectionsRef.current = null;
    pendingSignatureRef.current = "";
    pendingLayoutSignatureRef.current = "";
  }, []);

  const flushPendingSidebarSections = useCallback(() => {
    publishTimerRef.current = null;
    const sections = pendingSectionsRef.current;
    if (!sections) {
      return;
    }
    publishSections(sections, pendingSignatureRef.current, pendingLayoutSignatureRef.current);
  }, [publishSections]);

  const setSidebarSections = useCallback((sections: unknown) => {
    const normalized = normalizePlaySidebarSections(sections);
    const signature = getSidebarSectionsSignature(normalized);
    if (signature === signatureRef.current) {
      return;
    }
    const layoutSignature = getSidebarSectionsSignature(normalized, { ignoreDisplayValues: true });
    const elapsedMs = nowMs() - lastPublishAtRef.current;
    if (layoutSignature !== layoutSignatureRef.current
      || lastPublishAtRef.current === 0
      || elapsedMs >= SIDEBAR_VALUE_UPDATE_MIN_MS) {
      clearPendingSidebarPublish();
      publishSections(normalized, signature, layoutSignature);
      return;
    }
    pendingSectionsRef.current = normalized;
    pendingSignatureRef.current = signature;
    pendingLayoutSignatureRef.current = layoutSignature;
    if (publishTimerRef.current === null) {
      publishTimerRef.current = window.setTimeout(
        flushPendingSidebarSections,
        SIDEBAR_VALUE_UPDATE_MIN_MS - elapsedMs,
      );
    }
  }, [clearPendingSidebarPublish, flushPendingSidebarSections, publishSections]);

  const setSidebarActionHandler = useCallback((
    actionId: string,
    handler: ((value?: unknown) => void) | null,
  ) => {
    const normalizedActionId = normalizeSidebarActionId(actionId);
    if (!normalizedActionId) {
      return;
    }
    if (handler) {
      actionHandlersRef.current.set(normalizedActionId, handler);
    } else {
      actionHandlersRef.current.delete(normalizedActionId);
    }
  }, []);

  const dispatchSidebarAction = useCallback((actionId: string, value?: unknown) => {
    const normalizedActionId = normalizeSidebarActionId(actionId);
    if (!normalizedActionId) {
      return;
    }
    actionHandlersRef.current.get(normalizedActionId)?.(value);
  }, []);

  useEffect(() => {
    onSidebarActionHandlerChange?.(dispatchSidebarAction);
    return () => onSidebarActionHandlerChange?.(null);
  }, [dispatchSidebarAction, onSidebarActionHandlerChange]);

  const clearSidebarActionHandlers = useCallback(() => {
    actionHandlersRef.current.clear();
  }, []);

  return {
    setSidebarSections,
    setSidebarActionHandler,
    clearSidebarActionHandlers,
    clearPendingSidebarPublish,
  };
}
