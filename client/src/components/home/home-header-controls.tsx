import { BookOpen, ChevronDown, Eye, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { UI_TEXT_ROLE, UI_TEXT_SIZE } from "@/lib/ui-typography";

type LoadingEntry = {
  key: string;
  label: string;
  detail?: string;
};

type UiEvent = {
  id: string;
  level: "info" | "error";
  message: string;
  detail?: string;
};

type HomeHeaderControlsProps = {
  selectedMetricCount: number;
  annotationCount: number;
  onClearSelection: () => void;
  onClearAnnotations: () => void;
  onRecallVisualization: () => void;
  isVisualizationPoppedOut: boolean;
  isLoading: boolean;
  loadingEntries: LoadingEntry[];
  recentUiEvents: UiEvent[];
  isEventsVisible: boolean;
  onToggleEvents: () => void;
  isFullscreen: boolean;
  onSetFullscreen: (enabled: boolean) => void;
  onOpenDocs: () => void;
};

export function HomeHeaderControls({
  selectedMetricCount,
  annotationCount,
  onClearSelection,
  onClearAnnotations,
  onRecallVisualization,
  isVisualizationPoppedOut,
  isLoading,
  loadingEntries,
  recentUiEvents,
  isEventsVisible,
  onToggleEvents,
  isFullscreen,
  onSetFullscreen,
  onOpenDocs,
}: HomeHeaderControlsProps) {
  const hasClearActions = selectedMetricCount > 0 || annotationCount > 0;

  return (
    <header className="flex items-center justify-between gap-4 px-4 h-12 shrink-0">
      <div className="flex items-center gap-2">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {hasClearActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 gap-1 px-2 ${UI_TEXT_ROLE.panelHeader}`}
                data-testid="button-clear-selection"
              >
                Clear
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem
                disabled={selectedMetricCount === 0}
                onSelect={() => onClearSelection()}
                data-testid="menu-clear-metrics"
                className={`py-1.5 ${UI_TEXT_ROLE.menuItem}`}
              >
                Metrics ({selectedMetricCount})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={annotationCount === 0}
                onSelect={() => onClearAnnotations()}
                data-testid="menu-clear-annotations"
                className={`py-1.5 ${UI_TEXT_ROLE.menuItem}`}
              >
                Annotations ({annotationCount})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onRecallVisualization}
          data-testid="button-recall-visualization"
          title={
            isVisualizationPoppedOut
              ? "Recall visualization to this dashboard"
              : "Visualization is already docked"
          }
          data-hint={
            isVisualizationPoppedOut
              ? "Recall the popped-out visualization back into this control panel tab."
              : "Visualization is already docked in this tab."
          }
          disabled={!isVisualizationPoppedOut}
        >
          <Eye className="w-4 h-4" />
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 px-2"
              data-testid="button-loading-status"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              <span className={`${UI_TEXT_SIZE.xs} tabular-nums text-muted-foreground`}>
                {isLoading ? loadingEntries.length : "Stable"}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            <div className="flex items-center justify-between">
              <div className={`${UI_TEXT_ROLE.panelHeader} font-medium`}>Loading</div>
              <div className="flex h-6 min-w-[4.5rem] items-center justify-end">
                <div className={`text-right ${UI_TEXT_ROLE.panelBody} leading-none text-muted-foreground`}>
                  {isLoading ? "In progress" : "None"}
                </div>
              </div>
            </div>
            <ScrollArea className="mt-3 max-h-40 pr-2">
              {loadingEntries.length === 0 ? (
                <div className={`${UI_TEXT_ROLE.panelBody} text-muted-foreground`}>No active work.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {loadingEntries.map((entry) => (
                    <div key={entry.key} className={UI_TEXT_ROLE.panelBody}>
                      <div className="text-foreground">{entry.label}</div>
                      {entry.detail ? (
                        <div className="text-muted-foreground">{entry.detail}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
            <div className="my-3 h-px bg-border/50" />
            <div className="flex items-center justify-between">
              <div className={`${UI_TEXT_ROLE.panelHeader} font-medium`}>Events</div>
              <div className="ml-auto flex h-6 items-center justify-end gap-1">
                <div className={`text-right ${UI_TEXT_ROLE.panelBody} leading-none text-muted-foreground`}>
                  {recentUiEvents.length > 0 ? recentUiEvents.length : "None"}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 w-auto px-0 text-right ${UI_TEXT_ROLE.compactMeta}`}
                  onClick={onToggleEvents}
                  data-testid="button-toggle-events"
                >
                  {isEventsVisible ? "Hide" : "Show"}
                </Button>
              </div>
            </div>
            {isEventsVisible ? (
              <div className="mt-2 max-h-56 overflow-y-auto pr-2">
                {recentUiEvents.length === 0 ? (
                  <div className={`${UI_TEXT_ROLE.panelBody} text-muted-foreground`}>No recent events.</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {recentUiEvents.map((event) => (
                      <div key={event.id} className={UI_TEXT_ROLE.panelBody}>
                        <div
                          className={event.level === "error" ? "text-destructive" : "text-foreground"}
                        >
                          {event.message}
                        </div>
                        {event.detail ? (
                          <div className="text-muted-foreground break-all">{event.detail}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
        <div className="h-6 w-px bg-border/60 mx-1" />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onSetFullscreen(!isFullscreen)}
          data-testid="button-fullscreen"
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </Button>
        <Button variant="ghost" size="icon" data-testid="button-docs" onClick={onOpenDocs}>
          <BookOpen className="w-4 h-4" />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
