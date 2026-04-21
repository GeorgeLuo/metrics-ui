import type { SidebarAppState } from "./schema";

export const SIDEBAR_APP_STATES = ["metrics", "equations", "play"] as const satisfies readonly SidebarAppState[];

export function isSidebarAppState(value: unknown): value is SidebarAppState {
  return typeof value === "string" && SIDEBAR_APP_STATES.includes(value as SidebarAppState);
}

export function normalizeSidebarAppState(
  value: unknown,
  fallback: SidebarAppState = "metrics",
): SidebarAppState {
  return isSidebarAppState(value) ? value : fallback;
}
