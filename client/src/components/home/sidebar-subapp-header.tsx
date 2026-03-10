import {
  getSidebarSubmenuLabel,
  type SidebarMode,
} from "@/lib/dashboard/subapp-shell";

interface SidebarSubappHeaderProps {
  sidebarMode: SidebarMode;
  onToggleMode: () => void;
}

export function SidebarSubappHeader({
  sidebarMode,
  onToggleMode,
}: SidebarSubappHeaderProps) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-sm font-medium tracking-tight leading-none">
        Metrics
      </span>
      <button
        type="button"
        onClick={onToggleMode}
        className="text-[11px] text-muted-foreground uppercase tracking-wide leading-none hover:text-foreground/80"
        data-testid="button-toggle-sidebar-mode"
        aria-pressed={sidebarMode === "analysis"}
      >
        {getSidebarSubmenuLabel(sidebarMode)}
      </button>
    </div>
  );
}
