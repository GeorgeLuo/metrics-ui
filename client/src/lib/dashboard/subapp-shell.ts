export type SidebarMode = "setup" | "analysis";

export function getSidebarSubmenuLabel(mode: SidebarMode): string {
  return mode === "analysis" ? "Derivations" : "Setup";
}
