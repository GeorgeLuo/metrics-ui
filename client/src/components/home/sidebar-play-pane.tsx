import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import type { FrameGridDebugSnapshot } from "@/components/frame-grid";

type SidebarPlayPaneProps = {
  frameGridLayoutDebug: boolean;
  onFrameGridLayoutDebugChange: (next: boolean) => void;
  frameGridDebugSnapshot: FrameGridDebugSnapshot | null;
};

function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "none";
}

export function SidebarPlayPane({
  frameGridLayoutDebug,
  onFrameGridLayoutDebugChange,
  frameGridDebugSnapshot,
}: SidebarPlayPaneProps) {
  const [isDebugOpen, setIsDebugOpen] = useState(true);
  const spec = frameGridDebugSnapshot?.spec;
  const layout = frameGridDebugSnapshot?.layout;

  return (
    <Collapsible open={isDebugOpen} onOpenChange={setIsDebugOpen}>
      <SidebarGroup className={isDebugOpen ? undefined : "px-2 py-1"} data-testid="play-sidebar-debug">
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger
            className="flex w-full items-center justify-between"
            data-hint="Inspect the Play FrameGrid layout, grid dimensions, and live sizing metadata."
          >
            <span>Debug</span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform ${isDebugOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
          <SidebarGroupContent className="flex flex-col gap-2">
            <div
              className="flex items-start justify-between gap-3 px-2 py-2"
              data-hint="Reveal FrameGrid guides and live layout dimensions for the Play board."
            >
              <div className="min-w-0">
                <div className="text-xs leading-none text-foreground">Layout debug</div>
                <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Show frame guides, cell guides, and live layout dimensions.
                </div>
              </div>
              <Switch
                checked={frameGridLayoutDebug}
                onCheckedChange={onFrameGridLayoutDebugChange}
                aria-label="Toggle Play FrameGrid layout debug"
                data-testid="switch-play-framegrid-layout-debug"
                data-hint="Turn on grid guides and sizing overlays to inspect the Play layout."
              />
            </div>
            <div
              className="px-2 py-2"
              data-hint="Inspect the current Play FrameGrid spec and measured layout values."
            >
              <div className="text-xs leading-none text-foreground">FrameGrid</div>
              <div className="mt-2 flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
                <div><span className="text-foreground">Debug ID:</span> {frameGridDebugSnapshot?.debugId ?? "none"}</div>
                <div><span className="text-foreground">Grid:</span> {spec ? `${spec.grid[0]} x ${spec.grid[1]}` : "9 x 6"}</div>
                <div><span className="text-foreground">Frame Aspect:</span> {spec ? `${spec.frameAspect[0]} : ${spec.frameAspect[1]}` : "9 : 6"}</div>
                <div><span className="text-foreground">Fit Mode:</span> {spec?.fitMode ?? "contain"}</div>
                <div><span className="text-foreground">Rendered Cells:</span> {frameGridDebugSnapshot?.renderedCellCount ?? 0}</div>
                <div><span className="text-foreground">Container:</span> {frameGridDebugSnapshot ? `${formatNumber(frameGridDebugSnapshot.container.width)} x ${formatNumber(frameGridDebugSnapshot.container.height)}` : "none"}</div>
                <div><span className="text-foreground">Cell:</span> {layout ? `${formatNumber(layout.cellWidth)} x ${formatNumber(layout.cellHeight)}` : "none"}</div>
              </div>
            </div>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
