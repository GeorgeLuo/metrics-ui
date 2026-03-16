import {
  getSidebarAppLabel,
  getSidebarSubmenuLabel,
  SIDEBAR_APPS,
  type SidebarApp,
  type SidebarMode,
} from "@/lib/dashboard/subapp-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  return (
    <div className="flex items-baseline gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="text-sm font-medium tracking-tight leading-none hover:text-foreground/80"
            data-testid="button-toggle-sidebar-app"
          >
            {getSidebarAppLabel(sidebarApp)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          {SIDEBAR_APPS.map((app) => (
            <DropdownMenuItem
              key={app}
              onClick={() => onSelectApp(app)}
              data-testid={`sidebar-app-option-${app}`}
            >
              {getSidebarAppLabel(app)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={onToggleMode}
        className="text-[11px] text-muted-foreground uppercase tracking-wide leading-none hover:text-foreground/80"
        data-testid="button-toggle-sidebar-mode"
        aria-pressed={sidebarMode === "analysis"}
      >
        {getSidebarSubmenuLabel(sidebarApp, sidebarMode)}
      </button>
    </div>
  );
}
