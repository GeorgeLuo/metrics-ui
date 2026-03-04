import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getSidebarAppLabel,
  getSidebarSubmenuLabel,
  isMetricsSidebarApp,
  type SidebarApp,
  type SidebarMode,
} from "@/lib/dashboard/subapp-shell";

interface SidebarSubappHeaderProps {
  sidebarApp: SidebarApp;
  sidebarMode: SidebarMode;
  onSelectApp: (app: SidebarApp) => void;
  onToggleMode: () => void;
}

export function SidebarSubappHeader({
  sidebarApp,
  sidebarMode,
  onSelectApp,
  onToggleMode,
}: SidebarSubappHeaderProps) {
  const isMetrics = isMetricsSidebarApp(sidebarApp);

  return (
    <div className="flex items-baseline gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="text-sm font-medium tracking-tight leading-none hover:text-foreground/80"
            data-testid="button-sidebar-app-menu"
          >
            {getSidebarAppLabel(sidebarApp)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-28">
          <DropdownMenuItem
            onClick={() => onSelectApp("metrics")}
            data-testid="menuitem-sidebar-app-metrics"
            className={sidebarApp === "metrics" ? "bg-muted" : undefined}
          >
            Metrics
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onSelectApp("texts")}
            data-testid="menuitem-sidebar-app-texts"
            className={sidebarApp === "texts" ? "bg-muted" : undefined}
          >
            Texts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isMetrics ? (
        <button
          type="button"
          onClick={onToggleMode}
          className="text-[11px] text-muted-foreground uppercase tracking-wide leading-none hover:text-foreground/80"
          data-testid="button-toggle-sidebar-mode"
          aria-pressed={sidebarMode === "analysis"}
        >
          {getSidebarSubmenuLabel(sidebarApp, sidebarMode)}
        </button>
      ) : (
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide leading-none">
          {getSidebarSubmenuLabel(sidebarApp, sidebarMode)}
        </span>
      )}
    </div>
  );
}

