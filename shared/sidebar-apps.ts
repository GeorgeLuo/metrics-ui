import type { SidebarAppState } from "./schema";

export const SIDEBAR_APP_STATES = ["metrics", "equations", "play"] as const satisfies readonly SidebarAppState[];

export interface SidebarAppMetadata {
  id: SidebarAppState;
  label: string;
  description: string;
}

export const SIDEBAR_APP_METADATA: Record<SidebarAppState, SidebarAppMetadata> = {
  metrics: {
    id: "metrics",
    label: "Metrics",
    description: "Capture playback, metric selection, charts, annotations, derivations, and visualization plugins.",
  },
  equations: {
    id: "equations",
    label: "Equations",
    description: "FrameGrid topic documents, equation catalogs, textbook view, references, and highlights.",
  },
  play: {
    id: "play",
    label: "Play",
    description: "Browser-game surfaces loaded from a Play game catalog with game-provided controls.",
  },
};

export function getSidebarAppMetadata(app: SidebarAppState): SidebarAppMetadata {
  return SIDEBAR_APP_METADATA[app];
}

export function isSidebarAppState(value: unknown): value is SidebarAppState {
  return typeof value === "string" && SIDEBAR_APP_STATES.includes(value as SidebarAppState);
}

export function normalizeSidebarAppState(
  value: unknown,
  fallback: SidebarAppState = "metrics",
): SidebarAppState {
  return isSidebarAppState(value) ? value : fallback;
}
