import type { SidebarMode } from "@/lib/dashboard/subapp-shell";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { EquationsPaneSelectedTextHighlight } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import type { EquationsMetaDocumentOption } from "@/lib/equations/meta-documents";
import type { EquationsTopicOption } from "@/lib/equations/topic-catalog";
import {
  getSidebarCardClass,
  getSidebarDotButtonClass,
  getSidebarSelectableItemClass,
  SIDEBAR_MICRO_COPY_CLASS,
  SIDEBAR_MUTED_COPY_CLASS,
  SIDEBAR_SECTION_KICKER_CLASS,
  SIDEBAR_SECTION_STACK_CLASS,
} from "./sidebar-pane-patterns";
import {
  EquationsTopicFilterControls,
  EquationsRecentTopicList,
  EquationsTopicList,
  useEquationsTopicBrowserState,
} from "./equations-topic-browser";

type EquationsTopicCatalogSourceEntry = {
  id: string;
  label: string;
  description: string;
  source: string;
};

type EquationsDocumentDebugSummary = {
  sourceKind: "semantic_layout" | "document";
  topicFormat: string;
  topicLabel: string | null;
  catalogLabel: string | null;
  grid: [number, number];
  frameAspect: [number, number];
  itemCount: number;
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
  canRefreshSelectedTopic: boolean;
  onRefreshSelectedTopic: () => void;
  metaDocuments: EquationsMetaDocumentOption[];
  selectedMetaDocumentId: string | null;
  onMetaDocumentSelect: (id: string) => void;
  selectedTextHighlights: EquationsPaneSelectedTextHighlight[];
  hiddenTextHighlightIds: number[];
  onToggleTextHighlightHidden: (highlightId: number) => void;
  onDeleteTextHighlight: (highlightId: number) => void;
  documentDebugSummary: EquationsDocumentDebugSummary;
};

function formatHighlightPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 56) {
    return collapsed;
  }
  return `${collapsed.slice(0, 24)}...${collapsed.slice(-24)}`;
}

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
  canRefreshSelectedTopic,
  onRefreshSelectedTopic,
  metaDocuments,
  selectedMetaDocumentId,
  onMetaDocumentSelect,
  selectedTextHighlights,
  hiddenTextHighlightIds,
  onToggleTextHighlightHidden,
  onDeleteTextHighlight,
  documentDebugSummary,
}: SidebarEquationsPaneProps) {
  const [isCatalogOpen, setIsCatalogOpen] = useState(true);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isTopicOpen, setIsTopicOpen] = useState(true);
  const [isMetaOpen, setIsMetaOpen] = useState(true);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const topicBrowserState = useEquationsTopicBrowserState({ topicOptions });
  const activeTopicOption = topicOptions.find(
    (option) => option.id === selectedTopicId,
  ) ?? null;
  const activeMetaDocument = selectedMetaDocumentId
    ? metaDocuments.find((document) => document.id === selectedMetaDocumentId) ?? null
    : null;
  const catalogSourceBlank = isInlineFieldBlank(topicCatalogSourceInput);

  useEffect(() => {
    if (topicCatalogSourceError) {
      setIsCatalogOpen(true);
    }
  }, [topicCatalogSourceError]);

  useEffect(() => {
    if (topicBrowserState.hasActiveFilter) {
      setIsFilterOpen(true);
    }
  }, [topicBrowserState.hasActiveFilter]);

  return (
    <div
      className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-2 overscroll-contain"
      data-testid={sidebarMode === "analysis" ? "equations-sidebar-catalog" : "equations-sidebar-setup"}
    >
      <Collapsible open={isCatalogOpen} onOpenChange={setIsCatalogOpen}>
        <SidebarGroup className={isCatalogOpen ? undefined : "px-2 py-1"}>
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
              <div className={SIDEBAR_SECTION_STACK_CLASS}>
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
                <div className={SIDEBAR_MUTED_COPY_CLASS}>
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
      {recentTopicOptions.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className={SIDEBAR_SECTION_STACK_CLASS}>
              <EquationsRecentTopicList
                recentTopicOptions={recentTopicOptions}
                selectedTopicId={selectedTopicId}
                onTopicSelect={onTopicSelect}
              />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      <Collapsible open={isTopicOpen} onOpenChange={setIsTopicOpen}>
        <SidebarGroup className={isTopicOpen ? undefined : "px-2 py-1"}>
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger
              className="flex w-full items-center justify-between"
              data-hint="Show or hide the equations topic catalog."
            >
              <span>Topic</span>
              <ChevronDown
                className={`h-3 w-3 text-muted-foreground transition-transform ${isTopicOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <SidebarGroupContent>
              <div className={SIDEBAR_SECTION_STACK_CLASS}>
                <Collapsible open={isFilterOpen} onOpenChange={setIsFilterOpen}>
                  <div className="flex flex-col gap-1">
                    <CollapsibleTrigger
                      className="w-full text-left"
                      data-hint="Show or hide equations topic filtering and ordering controls."
                    >
                      <span className={SIDEBAR_SECTION_KICKER_CLASS}>Filter</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent forceMount className="data-[state=closed]:hidden">
                      <EquationsTopicFilterControls
                        query={topicBrowserState.query}
                        onQueryChange={topicBrowserState.setQuery}
                        orderingScheme={topicBrowserState.orderingScheme}
                        onOrderingSchemeChange={topicBrowserState.setOrderingScheme}
                        filteredTopicCount={topicBrowserState.filteredTopicOptions.length}
                        inlineEditTextClass={inlineEditTextClass}
                      />
                    </CollapsibleContent>
                  </div>
                </Collapsible>
                <EquationsTopicList
                  organizedTopicOptions={topicBrowserState.organizedTopicOptions}
                  selectedTopicId={selectedTopicId}
                  onTopicSelect={onTopicSelect}
                  isGroupedByType={topicBrowserState.orderingScheme === "types"}
                  hasMatches={topicBrowserState.filteredTopicOptions.length > 0}
                />
                <div className={SIDEBAR_MUTED_COPY_CLASS}>
                  {activeMetaDocument
                    ? `Meta document in view: ${activeMetaDocument.description}`
                    : activeTopicOption
                    ? activeTopicOption.description
                    : "Current content does not match a bundled topic."}
                </div>
                {activeTopicOption && canRefreshSelectedTopic ? (
                  <div className={`flex flex-col gap-1 ${getSidebarCardClass()}`}>
                    <div className={SIDEBAR_MUTED_COPY_CLASS}>
                      Visible content has drifted from the catalog artifact for this topic.
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 self-start text-xs"
                      onClick={onRefreshSelectedTopic}
                      data-hint={`Reload the latest catalog artifact for "${activeTopicOption.label}".`}
                    >
                      Reload From Catalog
                    </Button>
                  </div>
                ) : null}
              </div>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
      {metaDocuments.length > 0 ? (
        <Collapsible open={isMetaOpen} onOpenChange={setIsMetaOpen}>
          <SidebarGroup className={isMetaOpen ? undefined : "px-2 py-1"}>
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger
                className="flex w-full items-center justify-between"
                data-hint="Show or hide equations meta documents like authoring guidance."
              >
                <span>Meta</span>
                <ChevronDown
                  className={`h-3 w-3 text-muted-foreground transition-transform ${isMetaOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent forceMount className="data-[state=closed]:hidden">
              <SidebarGroupContent>
                <div className={SIDEBAR_SECTION_STACK_CLASS}>
                  {metaDocuments.map((document) => {
                    const isActive = document.id === selectedMetaDocumentId;
                    return (
                      <button
                        key={document.id}
                        type="button"
                        className={getSidebarSelectableItemClass(isActive)}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => onMetaDocumentSelect(document.id)}
                        data-hint={`Open the equations meta document "${document.label}".`}
                        title={document.description}
                      >
                        <div className="text-foreground">{document.label}</div>
                        {document.description ? (
                          <div className={`mt-0.5 ${SIDEBAR_MICRO_COPY_CLASS}`}>
                            {document.description}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      ) : null}
      {selectedTextHighlights.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Highlights</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="flex flex-col gap-2 px-2 py-2">
              {selectedTextHighlights.map((highlight) => {
                const label = `H${highlight.highlightId ?? "?"}`;
                const preview = formatHighlightPreview(highlight.text);
                const details = `${highlight.selectionId} [${highlight.startOffset}-${highlight.endOffset}]`;
                const highlightId = highlight.highlightId ?? null;
                const isHidden = highlightId !== null && hiddenTextHighlightIds.includes(highlightId);
                return (
                  <div
                    key={`${label}-${highlight.selectionId}-${highlight.startOffset}-${highlight.endOffset}`}
                    className={`${getSidebarCardClass({ subdued: isHidden })} ${isHidden ? "opacity-70" : ""}`}
                    data-hint={`Selected text highlight ${label}: ${details}`}
                    title={details}
                  >
                    <div className="flex items-center gap-2">
                      <div className={SIDEBAR_SECTION_KICKER_CLASS}>
                        {label}
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        {highlightId !== null ? (
                          <button
                            type="button"
                            onClick={() => onToggleTextHighlightHidden(highlightId)}
                            aria-label={`${isHidden ? "Show" : "Hide"} highlight ${label}`}
                            aria-pressed={!isHidden}
                            className={getSidebarDotButtonClass("yellow", { active: !isHidden })}
                            data-hint={`${isHidden ? "Show" : "Hide"} equations highlight ${label} without deleting it.`}
                            title={`${isHidden ? "Show" : "Hide"} ${label}`}
                          />
                        ) : null}
                        {highlightId !== null ? (
                          <button
                            type="button"
                            onClick={() => onDeleteTextHighlight(highlightId)}
                            aria-label={`Delete highlight ${label}`}
                            className={getSidebarDotButtonClass("red", { shape: "square" })}
                            data-hint={`Delete equations highlight ${label}.`}
                            title={`Delete ${label}`}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div className={`mt-0.5 text-[11px] leading-snug ${isHidden ? "text-muted-foreground" : "text-foreground"}`}>
                      {preview}
                    </div>
                  </div>
                );
              })}
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      <Collapsible open={isDebugOpen} onOpenChange={setIsDebugOpen}>
        <SidebarGroup className={isDebugOpen ? undefined : "px-2 py-1"}>
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
              <div
                className="px-2 py-2"
                data-hint="Inspect the current equations document source, format, grid, frame aspect, and item count."
              >
                <div className="text-xs text-foreground leading-none">Document</div>
                <div className={`mt-1 ${getSidebarCardClass()} text-[11px] leading-relaxed text-muted-foreground`}>
                  <div><span className="text-foreground">Source:</span> {documentDebugSummary.sourceKind}</div>
                  <div><span className="text-foreground">Format:</span> {documentDebugSummary.topicFormat}</div>
                  <div><span className="text-foreground">Topic:</span> {documentDebugSummary.topicLabel ?? "custom / unmatched"}</div>
                  <div><span className="text-foreground">Catalog:</span> {documentDebugSummary.catalogLabel ?? "none"}</div>
                  <div><span className="text-foreground">Grid:</span> {documentDebugSummary.grid[0]} × {documentDebugSummary.grid[1]}</div>
                  <div><span className="text-foreground">Frame Aspect:</span> {documentDebugSummary.frameAspect[0]} : {documentDebugSummary.frameAspect[1]}</div>
                  <div><span className="text-foreground">Items:</span> {documentDebugSummary.itemCount}</div>
                </div>
              </div>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    </div>
  );
}
