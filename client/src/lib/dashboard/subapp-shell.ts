export type SidebarApp = "metrics" | "texts";
export type SidebarMode = "setup" | "analysis";

export function normalizeSidebarApp(value: unknown): SidebarApp {
  return value === "texts" ? "texts" : "metrics";
}

export function isMetricsSidebarApp(app: SidebarApp): boolean {
  return app === "metrics";
}

export function getSidebarAppLabel(app: SidebarApp): string {
  return app === "texts" ? "Texts" : "Metrics";
}

export function getSidebarSubmenuLabel(app: SidebarApp, mode: SidebarMode): string {
  if (app === "texts") {
    return "Texts";
  }
  return mode === "analysis" ? "Derivations" : "Setup";
}

