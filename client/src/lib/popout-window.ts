import { isBrowserExtensionErrorEvent } from "./browser-extension-noise";

export const DEFAULT_POPOUT_WIDTH = 720;
export const DEFAULT_POPOUT_HEIGHT = 420;
const POPOUT_ERROR_DIAGNOSTIC_MS = 5000;
const POPOUT_ERROR_HISTORY_LIMIT = 40;

let popoutDiagnosticsUntil = 0;
let popoutDiagnosticContext = "popout";
let popoutErrorDiagnosticsInstalled = false;

declare global {
  interface Window {
    __metricsUiPopoutErrors?: Array<Record<string, unknown>>;
  }
}

function getEventErrorObject(event: Event): unknown {
  return "error" in event ? (event as ErrorEvent).error : null;
}

function isResizeObserverDeliveryWarning(event: ErrorEvent): boolean {
  return event.message === "ResizeObserver loop completed with undelivered notifications."
    || event.message === "ResizeObserver loop limit exceeded";
}

function getTargetSummary(target: EventTarget | null): Record<string, unknown> {
  if (!target) {
    return { kind: "null" };
  }
  if (target === window) {
    return { kind: "window", href: window.location.href };
  }
  const element = target as Partial<Element> & {
    href?: string;
    src?: string;
    rel?: string;
    id?: string;
    className?: string;
  };
  if (typeof element.tagName === "string") {
    return {
      kind: "element",
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === "string" ? element.className || null : null,
      rel: element.rel || null,
      href: element.href || null,
      src: element.src || null,
    };
  }
  return {
    kind: "object",
    type: Object.prototype.toString.call(target),
  };
}

function createPopoutErrorEntry(event: Event): Record<string, unknown> {
  const error = getEventErrorObject(event);
  const errorEvent = event as ErrorEvent;
  return {
    context: popoutDiagnosticContext,
    timestamp: new Date().toISOString(),
    eventType: event.type,
    eventConstructor: event.constructor?.name ?? null,
    message: typeof errorEvent.message === "string" ? errorEvent.message : null,
    filename: typeof errorEvent.filename === "string" ? errorEvent.filename : null,
    lineno: Number.isFinite(errorEvent.lineno) ? errorEvent.lineno : null,
    colno: Number.isFinite(errorEvent.colno) ? errorEvent.colno : null,
    error: error instanceof Error
      ? {
        name: error.name,
        message: error.message,
        stack: error.stack ?? null,
      }
      : error === null || error === undefined
        ? null
        : {
          type: typeof error,
          value: String(error),
        },
    target: getTargetSummary(event.target),
  };
}

function installPopoutErrorDiagnostics() {
  if (popoutErrorDiagnosticsInstalled || typeof window === "undefined") {
    return;
  }
  popoutErrorDiagnosticsInstalled = true;
  window.addEventListener(
    "error",
    (event) => {
      if (Date.now() > popoutDiagnosticsUntil) {
        return;
      }
      if (isResizeObserverDeliveryWarning(event)) {
        return;
      }
      if (isBrowserExtensionErrorEvent(event)) {
        return;
      }
      const entry = createPopoutErrorEntry(event);
      const history = window.__metricsUiPopoutErrors ?? [];
      history.push(entry);
      window.__metricsUiPopoutErrors = history.slice(-POPOUT_ERROR_HISTORY_LIMIT);
      console.warn("[metrics-ui popout error diagnostic]", entry);
    },
    true,
  );
}

export function startPopoutErrorDiagnostics(
  context: string,
  durationMs = POPOUT_ERROR_DIAGNOSTIC_MS,
) {
  if (typeof window === "undefined") {
    return;
  }
  installPopoutErrorDiagnostics();
  popoutDiagnosticContext = context.trim() || "popout";
  popoutDiagnosticsUntil = Math.max(
    popoutDiagnosticsUntil,
    Date.now() + Math.max(0, durationMs),
  );
  window.__metricsUiPopoutErrors = window.__metricsUiPopoutErrors ?? [];
  console.info(
    `[metrics-ui popout error diagnostic] tracing ${popoutDiagnosticContext} for ${durationMs}ms`,
  );
}

type PopoutFeaturesOptions = {
  width?: number;
  height?: number;
  resizable?: boolean;
  scrollbars?: boolean;
};

export function buildPopoutWindowFeatures(options?: PopoutFeaturesOptions): string {
  const width = Number.isFinite(options?.width) ? Math.max(320, Math.floor(options!.width!)) : DEFAULT_POPOUT_WIDTH;
  const height = Number.isFinite(options?.height)
    ? Math.max(240, Math.floor(options!.height!))
    : DEFAULT_POPOUT_HEIGHT;
  const resizable = options?.resizable ?? true;
  const scrollbars = options?.scrollbars ?? false;
  return [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `resizable=${resizable ? "yes" : "no"}`,
    `scrollbars=${scrollbars ? "yes" : "no"}`,
  ].join(",");
}

export function getAccessiblePopoutDocument(popup: Window | null): Document | null {
  if (!popup) {
    return null;
  }
  try {
    if (popup.closed) {
      return null;
    }
    return popup.document;
  } catch {
    return null;
  }
}

export function createPopoutContainer(popup: Window): HTMLDivElement | null {
  const popupDocument = getAccessiblePopoutDocument(popup);
  if (!popupDocument) {
    return null;
  }

  try {
    popupDocument.open();
    popupDocument.write("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
    popupDocument.close();

    const container = popupDocument.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    popupDocument.body.appendChild(container);
    return container;
  } catch {
    return null;
  }
}

function isSameOriginStylesheetLink(node: Element): node is HTMLLinkElement {
  if (!(node instanceof HTMLLinkElement) || node.rel !== "stylesheet" || !node.href) {
    return false;
  }
  try {
    return new URL(node.href, document.baseURI).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function copyPopoutStyleNodes({
  targetDocument,
  markerAttribute,
}: {
  targetDocument: Document;
  markerAttribute: string;
}) {
  const existingNodes = targetDocument.querySelectorAll(`[${markerAttribute}='1']`);
  existingNodes.forEach((node) => node.remove());

  const styleNodes = document.head.querySelectorAll("style, link[rel='stylesheet']");
  styleNodes.forEach((node) => {
    if (node instanceof HTMLLinkElement && !isSameOriginStylesheetLink(node)) {
      return;
    }
    const clone = node.cloneNode(true) as HTMLElement;
    clone.setAttribute(markerAttribute, "1");
    targetDocument.head.appendChild(clone);
  });
}
