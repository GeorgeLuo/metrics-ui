export type SidebarApp = "metrics" | "equations";
export type SidebarMode = "setup" | "analysis";

export const SIDEBAR_APPS: SidebarApp[] = ["metrics", "equations"];

export function getSidebarAppLabel(app: SidebarApp): string {
  return app === "equations" ? "Equations" : "Metrics";
}

export function getSidebarSubmenuLabel(app: SidebarApp, mode: SidebarMode): string {
  if (app === "equations") {
    return mode === "analysis" ? "Library" : "Setup";
  }
  return mode === "analysis" ? "Derivations" : "Setup";
}
