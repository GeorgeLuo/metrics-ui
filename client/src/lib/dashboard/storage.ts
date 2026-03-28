export const DASHBOARD_STORAGE_KEYS = {
  sidebarApp: "metrics-ui-sidebar-app",
  selectedMetrics: "metrics-ui-selected-metrics",
  derivationGroups: "metrics-ui-derivation-groups",
  activeDerivationGroupId: "metrics-ui-active-derivation-group",
  displayDerivationGroupId: "metrics-ui-display-derivation-group",
  visualizationFrame: "metrics-ui-visualization-frame",
  equationsPane: "metrics-ui-equations-pane",
  equationsTopicCatalogSource: "metrics-ui-equations-topic-catalog-source",
  equationsRecentTopics: "metrics-ui-equations-recent-topics",
  frameGridLayoutDebug: "metrics-ui-framegrid-layout-debug",
  equationsSignalBlocksDebug: "metrics-ui-equations-signal-blocks-debug",
  equationsVisualizationFloatingFrame: "metrics-ui-equations-visualization-floating-frame",
  equationsReferenceFloatingFrame: "metrics-ui-equations-reference-floating-frame",
  metricsHudFrame: "metrics-ui-metrics-hud-frame",
  visualizationFloatingFrame: "metrics-ui-visualization-floating-frame",
  equationsInteractionSignalFrame: "metrics-ui-equations-interaction-signal-frame",
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
