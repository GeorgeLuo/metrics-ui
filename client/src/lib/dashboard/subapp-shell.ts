import { getSidebarAppMetadata, SIDEBAR_APP_STATES } from "@shared/sidebar-apps";
import type { SidebarAppState } from "@shared/schema";

export type SidebarApp = SidebarAppState;
export type SidebarMode = "setup" | "analysis";

export const SIDEBAR_APPS: SidebarApp[] = [...SIDEBAR_APP_STATES];

export function getSidebarAppLabel(app: SidebarApp): string {
  return getSidebarAppMetadata(app).label;
}

export function getSidebarSubmenuLabel(app: SidebarApp, mode: SidebarMode): string {
  if (app === "equations") {
    return mode === "analysis" ? "Library" : "Setup";
  }
  if (app === "play") {
    return mode === "analysis" ? "Timeline" : "Controls";
  }
  return mode === "analysis" ? "Derivations" : "Setup";
}
