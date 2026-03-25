import type { SidebarMode } from "@/lib/dashboard/subapp-shell";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import type { EquationsTopicOption } from "@/lib/equations/topic-catalog";

type EquationsTopicCatalogSourceEntry = {
  id: string;
  label: string;
  description: string;
  source: string;
};

type SidebarEquationsPaneProps = {
  sidebarMode: SidebarMode;
  frameGridLayoutDebug: boolean;
  onFrameGridLayoutDebugChange: (next: boolean) => void;
  equationsSignalBlocksDebug: boolean;
  onEquationsSignalBlocksDebugChange: (next: boolean) => void;
  topicCatalogEntries: EquationsTopicCatalogSourceEntry[];
  topicCatalogSourceInput: string;
  onTopicCatalogSourceInputChange: (value: string) => void;
  onTopicCatalogSourceCommit: () => void;
  topicCatalogSourceError: string | null;
  inlineEditTextClass: string;
  inlineEditEmptyClass: string;
  isInlineFieldBlank: (value: string) => boolean;
  topicOptions: EquationsTopicOption[];
  recentTopicOptions: EquationsTopicOption[];
  selectedTopicId: string;
  onTopicSelect: (id: string) => void;
};

export function SidebarEquationsPane({
  sidebarMode,
  frameGridLayoutDebug,
  onFrameGridLayoutDebugChange,
  equationsSignalBlocksDebug,
  onEquationsSignalBlocksDebugChange,
  topicCatalogEntries,
  topicCatalogSourceInput,
  onTopicCatalogSourceInputChange,
  onTopicCatalogSourceCommit,
  topicCatalogSourceError,
  inlineEditTextClass,
  inlineEditEmptyClass,
  isInlineFieldBlank,
  topicOptions,
  recentTopicOptions,
  selectedTopicId,
  onTopicSelect,
}: SidebarEquationsPaneProps) {
  const [isCatalogOpen, setIsCatalogOpen] = useState(true);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const activeTopicOption = topicOptions.find(
    (option) => option.id === selectedTopicId,
  ) ?? null;
  const catalogSourceBlank = isInlineFieldBlank(topicCatalogSourceInput);

  useEffect(() => {
    if (topicCatalogSourceError) {
      setIsCatalogOpen(true);
    }
  }, [topicCatalogSourceError]);

  return (
    <div
      className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-2 overscroll-contain"
      data-testid={sidebarMode === "analysis" ? "equations-sidebar-catalog" : "equations-sidebar-setup"}
    >
      <Collapsible open={isCatalogOpen} onOpenChange={setIsCatalogOpen}>
        <SidebarGroup>
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger
              className="flex w-full items-center justify-between"
              data-hint="Show or hide the equations topic catalog source input."
            >
              <span>Catalog</span>
              <ChevronDown
                className={`h-3 w-3 text-muted-foreground transition-transform ${isCatalogOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <SidebarGroupContent>
              <div className="flex flex-col gap-2 px-2 py-2">
                <Input
                  value={topicCatalogSourceInput}
                  onChange={(event) => onTopicCatalogSourceInputChange(event.target.value)}
                  onBlur={onTopicCatalogSourceCommit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onTopicCatalogSourceCommit();
                    }
                  }}
                  className={`${inlineEditTextClass} w-full ${catalogSourceBlank ? inlineEditEmptyClass : ""}`}
                  aria-label="Equations topic catalog source"
                  placeholder="/examples/.../equations-topic-catalog.json"
                  data-hint="Set the absolute path to the bundled equations topic catalog artifact."
                />
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                  {topicCatalogEntries.find((catalog) => catalog.source === topicCatalogSourceInput.trim())?.description
                    ?? "Enter the catalog JSON source path for this topic collection."}
                </div>
                {topicCatalogSourceError ? (
                  <div className="text-[11px] leading-relaxed text-destructive">
                    {topicCatalogSourceError}
                  </div>
                ) : null}
              </div>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
      <SidebarGroup>
        <SidebarGroupLabel>Topic</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col gap-2 px-2 py-2">
            <Select value={selectedTopicId} onValueChange={onTopicSelect}>
              <SelectTrigger
                className="h-8 text-xs"
                aria-label="Select equations topic"
                data-hint="Choose which topic document to load into the equations workspace."
              >
                <SelectValue placeholder="Choose a topic" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="text-xs" value="__custom__" disabled>
                  Custom / unmatched
                </SelectItem>
                {topicOptions.map((option) => (
                  <SelectItem className="text-xs" key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              {activeTopicOption
                ? activeTopicOption.description
                : "Current content does not match a bundled topic."}
            </div>
            {recentTopicOptions.length > 0 ? (
              <div className="flex flex-col gap-1 pt-1">
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
                  Recent
                </div>
                <div className="flex flex-col gap-1">
                  {recentTopicOptions.map((option) => {
                    const isActive = option.id === selectedTopicId;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={[
                          "w-full rounded-sm border px-2 py-1.5 text-left text-[11px] leading-snug transition-colors",
                          isActive
                            ? "border-border bg-accent/45 text-foreground"
                            : "border-border/60 bg-background/35 text-muted-foreground hover:bg-accent/18 hover:text-foreground",
                        ].join(" ")}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => onTopicSelect(option.id)}
                        data-hint={`Reopen the recent topic "${option.label}".`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
      <Collapsible open={isDebugOpen} onOpenChange={setIsDebugOpen}>
        <SidebarGroup>
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger
              className="flex w-full items-center justify-between"
              data-hint="Show authoring and inspection controls for debugging equations layout and interaction surfaces."
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
                data-hint="Reveal every mapped hit-box segment so you can inspect what is clickable and how the equation has been segmented."
              >
                <div className="min-w-0">
                  <div className="text-xs text-foreground leading-none">Show signal blocks</div>
                  <div className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                    Outline every mapped interaction segment in the equations view.
                  </div>
                </div>
                <Switch
                  checked={equationsSignalBlocksDebug}
                  onCheckedChange={onEquationsSignalBlocksDebugChange}
                  aria-label="Toggle equation signal block visibility"
                  data-testid="switch-equations-signal-blocks-debug"
                  data-hint="Turn on hit-box outlines to debug mapped term boundaries and click targets."
                />
              </div>
              <div
                className="flex items-start justify-between gap-3 px-2 py-2"
                data-hint="Reveal the FrameGrid structure and sizing overlays so you can debug card placement, spans, and layout fit."
              >
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
                  data-hint="Turn on grid guides and sizing overlays to inspect the equations layout."
                />
              </div>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    </div>
  );
}
