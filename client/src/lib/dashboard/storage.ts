export const DASHBOARD_STORAGE_KEYS = {
  selectedMetrics: "metrics-ui-selected-metrics",
  derivationGroups: "metrics-ui-derivation-groups",
  activeDerivationGroupId: "metrics-ui-active-derivation-group",
  displayDerivationGroupId: "metrics-ui-display-derivation-group",
  sourceMode: "metrics-ui-source-mode",
  liveStreams: "metrics-ui-live-streams",
} as const;

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function readStorageString(key: string): string | null {
  if (!hasWindowStorage()) {
    return null;
  }
  return window.localStorage.getItem(key);
}

export function writeStorageString(key: string, value: string): void {
  if (!hasWindowStorage()) {
    return;
  }
  window.localStorage.setItem(key, value);
}

export function readStorageJson<T>(key: string): T | null {
  const raw = readStorageString(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStorageJson(key: string, value: unknown): void {
  if (!hasWindowStorage()) {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}
