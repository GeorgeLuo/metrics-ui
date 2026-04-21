import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import type { FrameGridDebugSnapshot } from "@/components/frame-grid";
import type { PlaySidebarSection, PlaySidebarSectionRow } from "@/lib/play/sidebar-sections";
import {
  SIDEBAR_BODY_TEXT_CLASS,
  SIDEBAR_MUTED_COPY_CLASS,
  SIDEBAR_SECTION_KICKER_CLASS,
  SIDEBAR_SECTION_STACK_CLASS,
} from "./sidebar-pane-patterns";

type SidebarPlayPaneProps = {
  frameGridLayoutDebug: boolean;
  onFrameGridLayoutDebugChange: (next: boolean) => void;
  frameGridDebugSnapshot: FrameGridDebugSnapshot | null;
  gameSections: PlaySidebarSection[];
  onGameAction: (actionId: string, value?: unknown) => void;
};

const PLAY_INLINE_EDIT_NUMERIC_CLASS =
  "h-auto p-0 text-xs md:text-xs font-mono text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "none";
}

function PlayEditableValueRow({
  row,
  onGameAction,
}: {
  row: Extract<PlaySidebarSectionRow, { kind: "editableValue" }>;
  onGameAction: (actionId: string, value?: unknown) => void;
}) {
  const [draft, setDraft] = useState(row.value);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(row.value);
    }
  }, [row.value]);

  const commitDraft = (value: string) => {
    onGameAction(row.id, value);
  };

  return (
    <div
      className={`flex items-center justify-between gap-2 ${SIDEBAR_BODY_TEXT_CLASS}`}
      data-hint={row.hint}
    >
      <span className="min-w-0">{row.label}</span>
      <div className="flex shrink-0 items-baseline gap-1">
        <Input
          type="text"
          inputMode="decimal"
          value={draft}
          onFocus={() => {
            isFocusedRef.current = true;
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => {
            isFocusedRef.current = false;
            commitDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              isFocusedRef.current = false;
              commitDraft((event.target as HTMLInputElement).value);
              (event.target as HTMLInputElement).blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              isFocusedRef.current = false;
              setDraft(row.value);
              (event.target as HTMLInputElement).blur();
            }
          }}
          className={PLAY_INLINE_EDIT_NUMERIC_CLASS}
          style={{ width: `${Math.max(draft.length, 1)}ch` }}
          aria-label={row.label}
        />
        {row.suffix ? (
          <span className="text-[11px] text-muted-foreground">{row.suffix}</span>
        ) : null}
      </div>
    </div>
  );
}

function renderGameSectionRow(
  row: PlaySidebarSectionRow,
  index: number,
  onGameAction: (actionId: string, value?: unknown) => void,
) {
  if (row.kind === "toggle") {
    return (
      <div
        key={`${row.id}:${index}`}
        className={`flex items-center justify-between ${SIDEBAR_BODY_TEXT_CLASS}`}
        data-hint={row.hint}
      >
        <span>{row.label}</span>
        <button
          type="button"
          onClick={() => onGameAction(row.id)}
          aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.label}`}
          aria-pressed={row.enabled}
          className={`h-3 w-3 shrink-0 p-0 leading-none rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 ${
            row.enabled
              ? "bg-blue-500/80 hover:bg-blue-500 [animation:pulse_2.4s_ease-in-out_infinite]"
              : "bg-blue-500/50 hover:bg-blue-500"
          }`}
          data-hint={row.hint}
        />
      </div>
    );
  }

  if (row.kind === "editableValue") {
    return (
      <PlayEditableValueRow
        key={`${row.id}:${index}`}
        row={row}
        onGameAction={onGameAction}
      />
    );
  }

  if (row.kind === "value") {
    return (
      <div key={`${row.label}:${index}`} className="flex items-baseline justify-between gap-2 text-[11px] leading-relaxed">
        <span className="min-w-0 text-muted-foreground">{row.label}</span>
        <span className="shrink-0 font-mono text-foreground">{row.value}</span>
      </div>
    );
  }

  if (row.kind === "list") {
    return (
      <div key={`${row.label ?? "list"}:${index}`} className="flex flex-col gap-1">
        {row.label ? (
          <div className={SIDEBAR_SECTION_KICKER_CLASS}>{row.label}</div>
        ) : null}
        {row.items.map((item, itemIndex) => (
          <div key={`${item}:${itemIndex}`} className={SIDEBAR_MUTED_COPY_CLASS}>
            {item}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div key={`${row.text}:${index}`} className={SIDEBAR_MUTED_COPY_CLASS}>
      {row.text}
    </div>
  );
}

function PlayGameSidebarSection({
  section,
  onGameAction,
}: {
  section: PlaySidebarSection;
  onGameAction: (actionId: string, value?: unknown) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <SidebarGroup className={isOpen ? undefined : "px-2 py-1"} data-testid={`play-sidebar-game-${section.id}`}>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger
            className="flex w-full items-center justify-between"
            data-hint={section.hint}
          >
            <span>{section.title}</span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
          <SidebarGroupContent>
            <div className={SIDEBAR_SECTION_STACK_CLASS}>
              {section.rows.map((row, index) => renderGameSectionRow(row, index, onGameAction))}
            </div>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function SidebarPlayPane({
  frameGridLayoutDebug,
  onFrameGridLayoutDebugChange,
  frameGridDebugSnapshot,
  gameSections,
  onGameAction,
}: SidebarPlayPaneProps) {
  const [isDebugOpen, setIsDebugOpen] = useState(true);
  const spec = frameGridDebugSnapshot?.spec;
  const layout = frameGridDebugSnapshot?.layout;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto gap-2 overscroll-contain">
      {gameSections.map((section) => (
        <PlayGameSidebarSection key={section.id} section={section} onGameAction={onGameAction} />
      ))}
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
    </div>
  );
}
