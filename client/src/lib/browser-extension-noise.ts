const EXTENSION_URL_PREFIXES = [
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
];

const EXTENSION_SCRIPT_NAMES = [
  "contentscript.js",
  "content-script.js",
  "inpage.js",
  "lockdown-install.js",
];

const EXTENSION_MESSAGE_PATTERNS = [
  /metamask/i,
  /objectmultiplex/i,
  /app-init-liveness/i,
  /background-liveness/i,
  /maxlistenersexceededwarning/i,
  /possible eventemitter memory leak detected/i,
  /ses_uncaught_exception:\s*null/i,
];

let browserExtensionErrorFilterInstalled = false;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return normalizeText(error);
}

function getErrorStack(error: unknown): string {
  return error instanceof Error && typeof error.stack === "string" ? error.stack : "";
}

export function isBrowserExtensionUrl(value: unknown): boolean {
  const text = normalizeText(value).toLowerCase();
  return EXTENSION_URL_PREFIXES.some((prefix) => text.startsWith(prefix));
}

export function isKnownBrowserExtensionNoiseMessage(value: unknown): boolean {
  const message = normalizeText(value);
  return message.length > 0
    && EXTENSION_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function isLikelyExtensionScript(value: unknown): boolean {
  const text = normalizeText(value).toLowerCase();
  return text.length > 0
    && EXTENSION_SCRIPT_NAMES.some((scriptName) =>
      text === scriptName || text.endsWith(`/${scriptName}`) || text.includes(`/${scriptName}:`),
    );
}

export function isBrowserExtensionErrorEvent(event: Event | null | undefined): boolean {
  if (!event || !("message" in event)) {
    return false;
  }

  const errorEvent = event as ErrorEvent;
  const filename = normalizeText(errorEvent.filename);
  const message = normalizeText(errorEvent.message);
  const error = "error" in errorEvent ? errorEvent.error : null;
  const errorMessage = getErrorMessage(error);
  const errorStack = getErrorStack(error);

  if (isBrowserExtensionUrl(filename) || isBrowserExtensionUrl(errorStack)) {
    return true;
  }

  return isKnownBrowserExtensionNoiseMessage(message)
    || isKnownBrowserExtensionNoiseMessage(errorMessage)
    || (isLikelyExtensionScript(filename) && (message.length > 0 || errorMessage.length > 0));
}

export function isBrowserExtensionRuntimeError(error: Error | null | undefined): boolean {
  if (!error) {
    return false;
  }

  const message = getErrorMessage(error);
  const stack = getErrorStack(error);

  return isKnownBrowserExtensionNoiseMessage(message)
    || isBrowserExtensionUrl(stack)
    || isLikelyExtensionScript(stack);
}

function isBrowserExtensionRejection(event: PromiseRejectionEvent): boolean {
  const reason = event.reason;
  return isKnownBrowserExtensionNoiseMessage(reason)
    || isKnownBrowserExtensionNoiseMessage(getErrorMessage(reason))
    || isBrowserExtensionUrl(getErrorStack(reason));
}

export function installBrowserExtensionErrorOverlayFilter() {
  if (
    browserExtensionErrorFilterInstalled
    || typeof window === "undefined"
    || typeof window.addEventListener !== "function"
  ) {
    return;
  }

  browserExtensionErrorFilterInstalled = true;

  window.addEventListener(
    "error",
    (event) => {
      if (!isBrowserExtensionErrorEvent(event)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      if (!isBrowserExtensionRejection(event)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
