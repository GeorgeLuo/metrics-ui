import type { SidebarMode } from "@/lib/dashboard/subapp-shell";
import type { EquationHitBoxClickSignal } from "@/components/home/equation-interaction.types";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";

type SidebarEquationsPaneProps = {
  sidebarMode: SidebarMode;
  frameGridLayoutDebug: boolean;
  onFrameGridLayoutDebugChange: (next: boolean) => void;
  equationHitBoxClick: EquationHitBoxClickSignal | null;
};

export function SidebarEquationsPane({
  sidebarMode,
  frameGridLayoutDebug,
  onFrameGridLayoutDebugChange,
  equationHitBoxClick,
}: SidebarEquationsPaneProps) {
  return (
    <div
      className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-2 overscroll-contain"
      data-testid={sidebarMode === "analysis" ? "equations-sidebar-library" : "equations-sidebar-setup"}
    >
      <SidebarGroup>
        <SidebarGroupLabel>FrameGrid</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex items-start justify-between gap-3 px-2 py-2">
            <div className="min-w-0">
              <div className="text-xs text-foreground leading-none">Layout debug</div>
              <div className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                Show frame guides, cell guides, and live layout dimensions.
              </div>
            </div>
            <Switch
              checked={frameGridLayoutDebug}
              onCheckedChange={onFrameGridLayoutDebugChange}
              aria-label="Toggle FrameGrid layout debug"
              data-testid="switch-framegrid-layout-debug"
            />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Selection</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="px-2 py-2 flex flex-col gap-1.5" data-testid="equation-hitbox-list">
            {equationHitBoxClick ? (
              <div className="rounded-sm border border-border/50 px-2 py-1.5">
                <div className="font-mono text-sm leading-none text-foreground">
                  {equationHitBoxClick.hitBox.label}
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {equationHitBoxClick.hitBox.sequence}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground leading-relaxed">
                This pane stays generic. Equation-specific capture spaces belong to the document or renderer that introduces them.
              </div>
            )}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
      {sidebarMode === "analysis" ? (
        <SidebarGroup>
          <SidebarGroupLabel>Equation Library</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-2 py-2 text-xs text-muted-foreground leading-relaxed">
              Placeholder for reusable equation templates and derived formula snippets.
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : (
        <>
          <SidebarGroup>
            <SidebarGroupLabel>Equation Source</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="px-2 py-2 text-xs text-muted-foreground leading-relaxed">
                Create and manage equation-driven views for side-by-side learning workflows.
                This pane is intentionally isolated so Equation-specific controls can evolve
                without touching metrics setup flows.
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Equation Inputs</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="px-2 py-2 text-xs text-muted-foreground leading-relaxed">
                Placeholder for equation variables, constants, and capture mappings.
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </>
      )}
    </div>
  );
}
