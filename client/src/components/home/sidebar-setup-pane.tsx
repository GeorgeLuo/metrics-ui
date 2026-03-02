import type { MutableRefObject } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { FileUpload } from "@/components/file-upload";
import { ComponentTree } from "@/components/component-tree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@/components/ui/sidebar";
import type {
  CaptureSession,
  MemoryStatsResponse,
  PlaybackState,
  SelectedMetric,
} from "@shared/schema";
import type { MetricCoverageByCapture } from "@/lib/dashboard/chart-data";

const EMPTY_METRICS: SelectedMetric[] = [];

type LiveStreamStatus = "idle" | "connecting" | "retrying" | "connected" | "completed";

type LiveStreamEntry = {
  id: string;
  source: string;
  pollSeconds: number;
  status: LiveStreamStatus;
  error: string | null;
};

type SidebarSetupPaneProps = {
  sidebarMode: "setup" | "analysis";
  isCaptureSourceOpen: boolean;
  onCaptureSourceOpenChange: (open: boolean) => void;
  sourceMode: "file" | "live";
  onSourceModeChange: (mode: "file" | "live") => void;
  onFileUpload: (file: File) => void;
  isUploading: boolean;
  uploadError: string | null;
  onClearUploadError: () => void;
  liveStreams: LiveStreamEntry[];
  livePollInputDrafts: Record<string, string>;
  onLivePollInputDraftChange: (entryId: string, rawValue: string) => void;
  onLivePollInputDraftBlur: (entryId: string) => void;
  onLivePollChange: (entryId: string, seconds: number) => void;
  onRemoveLiveStream: (entryId: string) => void;
  onLiveSourceInput: (entryId: string, source: string) => void;
  onLiveRefresh: (entryId: string) => void;
  onAddLiveStream: () => void;
  inlineEditTextClass: string;
  inlineEditNumericClass: string;
  inlineEditEmptyClass: string;
  isInlineFieldBlank: (value: string) => boolean;
  captures: CaptureSession[];
  onToggleCapture: (captureId: string) => void;
  onRemoveCapture: (captureId: string) => void;
  getCaptureShortName: (capture: CaptureSession) => string;
  isSelectionOpen: boolean;
  onSelectionOpenChange: (open: boolean) => void;
  activeCaptures: CaptureSession[];
  selectionCaptureOpenById: Record<string, boolean>;
  onSelectionCaptureOpenChange: (captureId: string, open: boolean) => void;
  selectedMetricsByCapture: Map<string, SelectedMetric[]>;
  deferredMetricCoverage: MetricCoverageByCapture;
  getSelectionHandler: (captureId: string) => (metrics: SelectedMetric[]) => void;
  selectedMetricCount: number;
  playbackState: PlaybackState;
  windowStartInput: string;
  onWindowStartInputChange: (value: string) => void;
  windowStartEditingRef: MutableRefObject<boolean>;
  onCommitWindowStartInput: (value: string) => void;
  windowEndInput: string;
  onWindowEndInputChange: (value: string) => void;
  windowEndEditingRef: MutableRefObject<boolean>;
  onCommitWindowEndInput: (value: string) => void;
  yPrimaryMinInput: string;
  onYPrimaryMinInputChange: (value: string) => void;
  yPrimaryMinEditingRef: MutableRefObject<boolean>;
  onCommitYPrimaryBoundary: (boundary: "min" | "max", value: string) => void;
  yPrimaryMaxInput: string;
  onYPrimaryMaxInputChange: (value: string) => void;
  yPrimaryMaxEditingRef: MutableRefObject<boolean>;
  hasSecondaryAxis: boolean;
  ySecondaryMinInput: string;
  onYSecondaryMinInputChange: (value: string) => void;
  ySecondaryMinEditingRef: MutableRefObject<boolean>;
  onCommitYSecondaryBoundary: (boundary: "min" | "max", value: string) => void;
  ySecondaryMaxInput: string;
  onYSecondaryMaxInputChange: (value: string) => void;
  ySecondaryMaxEditingRef: MutableRefObject<boolean>;
  isAutoScroll: boolean;
  isDiagnosticsOpen: boolean;
  onDiagnosticsOpenChange: (open: boolean) => void;
  memoryStatsAt: number | null;
  onRefreshMemoryStats: () => void;
  memoryStatsSnapshot: MemoryStatsResponse | null;
  formatBytes: (value: number) => string;
};

export function SidebarSetupPane({
  sidebarMode,
  isCaptureSourceOpen,
  onCaptureSourceOpenChange,
  sourceMode,
  onSourceModeChange,
  onFileUpload,
  isUploading,
  uploadError,
  onClearUploadError,
  liveStreams,
  livePollInputDrafts,
  onLivePollInputDraftChange,
  onLivePollInputDraftBlur,
  onLivePollChange,
  onRemoveLiveStream,
  onLiveSourceInput,
  onLiveRefresh,
  onAddLiveStream,
  inlineEditTextClass,
  inlineEditNumericClass,
  inlineEditEmptyClass,
  isInlineFieldBlank,
  captures,
  onToggleCapture,
  onRemoveCapture,
  getCaptureShortName,
  isSelectionOpen,
  onSelectionOpenChange,
  activeCaptures,
  selectionCaptureOpenById,
  onSelectionCaptureOpenChange,
  selectedMetricsByCapture,
  deferredMetricCoverage,
  getSelectionHandler,
  selectedMetricCount,
  playbackState,
  windowStartInput,
  onWindowStartInputChange,
  windowStartEditingRef,
  onCommitWindowStartInput,
  windowEndInput,
  onWindowEndInputChange,
  windowEndEditingRef,
  onCommitWindowEndInput,
  yPrimaryMinInput,
  onYPrimaryMinInputChange,
  yPrimaryMinEditingRef,
  onCommitYPrimaryBoundary,
  yPrimaryMaxInput,
  onYPrimaryMaxInputChange,
  yPrimaryMaxEditingRef,
  hasSecondaryAxis,
  ySecondaryMinInput,
  onYSecondaryMinInputChange,
  ySecondaryMinEditingRef,
  onCommitYSecondaryBoundary,
  ySecondaryMaxInput,
  onYSecondaryMaxInputChange,
  ySecondaryMaxEditingRef,
  isAutoScroll,
  isDiagnosticsOpen,
  onDiagnosticsOpenChange,
  memoryStatsAt,
  onRefreshMemoryStats,
  memoryStatsSnapshot,
  formatBytes,
}: SidebarSetupPaneProps) {
  return (
    <div
      className={
        sidebarMode === "setup"
          ? "flex flex-col flex-1 min-h-0 overflow-y-auto gap-2 overscroll-contain"
          : "hidden"
      }
      aria-hidden={sidebarMode !== "setup"}
    >
      <Collapsible open={isCaptureSourceOpen} onOpenChange={onCaptureSourceOpenChange}>
        <SidebarGroup>
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger className="flex w-full items-center justify-between">
              <span>Capture Source</span>
              <ChevronDown
                className={`h-3 w-3 text-muted-foreground transition-transform ${
                  isCaptureSourceOpen ? "rotate-180" : ""
                }`}
              />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <SidebarGroupContent>
              <div className="px-2">
                <Tabs
                  value={sourceMode}
                  onValueChange={(value) => onSourceModeChange(value === "live" ? "live" : "file")}
                  className="w-full"
                >
                  <TabsList className="grid h-9 w-full grid-cols-2">
                    <TabsTrigger value="file" className="text-xs">
                      File
                    </TabsTrigger>
                    <TabsTrigger value="live" className="text-xs">
                      Live
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="file" className="mt-3">
                    <FileUpload
                      onFileUpload={onFileUpload}
                      isUploading={isUploading}
                      uploadedFile={null}
                      error={uploadError}
                      onClear={onClearUploadError}
                    />
                  </TabsContent>
                  <TabsContent value="live" className="mt-3">
                    <div className="flex flex-col gap-3">
                      {liveStreams.map((entry, index) => {
                        const isConnected = entry.status === "connected";
                        const isConnecting = entry.status === "connecting";
                        const isRetrying = entry.status === "retrying";
                        const isCompleted = entry.status === "completed";
                        const sourceBlank = isInlineFieldBlank(entry.source);
                        const pollDraft = livePollInputDrafts[entry.id];
                        const pollInputValue = pollDraft ?? String(entry.pollSeconds);
                        const pollBlank = isInlineFieldBlank(pollInputValue);
                        const statusLabel = isConnected
                          ? `Connected (${entry.id})`
                          : isConnecting
                            ? "Connecting..."
                            : isRetrying
                              ? "Retrying..."
                              : isCompleted
                                ? "Completed"
                                : "Idle";

                        return (
                          <div
                            key={entry.id}
                            className="rounded-md border border-border/50 p-2 flex flex-col gap-2"
                          >
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <span>Stream {index + 1}</span>
                              <div className="flex items-center">
                                <button
                                  type="button"
                                  onClick={() => onRemoveLiveStream(entry.id)}
                                  data-testid={`button-live-remove-${entry.id}`}
                                  aria-label={`Remove live stream ${index + 1}`}
                                  className="h-3 w-3 shrink-0 p-0 leading-none rounded-sm bg-red-500/50 hover:bg-red-500 transition-colors"
                                />
                              </div>
                            </div>
                            <Input
                              value={entry.source}
                              onChange={(event) => {
                                onLiveSourceInput(entry.id, event.target.value);
                              }}
                              className={`${inlineEditTextClass} w-full ${sourceBlank ? inlineEditEmptyClass : ""}`}
                              aria-label={`Capture file source ${index + 1}`}
                            />
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>polling (s)</span>
                              <Input
                                type="number"
                                min={0.5}
                                step={0.5}
                                value={pollInputValue}
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  onLivePollInputDraftChange(entry.id, raw);
                                  const parsed = Number(raw);
                                  if (Number.isFinite(parsed) && parsed > 0) {
                                    onLivePollChange(entry.id, parsed);
                                  }
                                }}
                                onBlur={() => onLivePollInputDraftBlur(entry.id)}
                                className={`${inlineEditNumericClass} ${pollBlank ? inlineEditEmptyClass : ""}`}
                                style={{ width: `${Math.max(pollInputValue.length, 1)}ch` }}
                                disabled={isConnected || isConnecting}
                                aria-label={`Poll interval seconds ${index + 1}`}
                              />
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{statusLabel}</span>
                              {isConnected ? (
                                <span
                                  data-testid={`live-connected-light-${entry.id}`}
                                  aria-label={`Live stream connected ${index + 1}`}
                                  className="h-3 w-3 shrink-0 rounded-full bg-blue-500/80 [animation:pulse_2.4s_ease-in-out_infinite]"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onLiveRefresh(entry.id)}
                                  disabled={!entry.source.trim() || isConnecting}
                                  data-testid={`button-live-refresh-${entry.id}`}
                                  aria-label={`Refresh live source ${index + 1}`}
                                  className="h-3 w-3 shrink-0 p-0 leading-none rounded-full bg-blue-500/50 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                />
                              )}
                            </div>
                            {entry.error && (
                              <div className="text-xs text-destructive">{entry.error}</div>
                            )}
                          </div>
                        );
                      })}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={onAddLiveStream}
                        data-testid="button-live-add"
                      >
                        Add live stream
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>

      <SidebarGroup>
        <SidebarGroupLabel>Captures</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col gap-1 px-2">
            {captures.map((capture) => (
              <div
                key={capture.id}
                className="flex items-center gap-2 py-1.5 text-sm"
                data-testid={`capture-item-${capture.id}`}
              >
                <button
                  type="button"
                  onClick={() => onToggleCapture(capture.id)}
                  data-testid={`checkbox-capture-${capture.id}`}
                  aria-label={`${capture.isActive ? "Disable" : "Enable"} capture ${capture.id}`}
                  aria-pressed={capture.isActive}
                  className={`h-3 w-3 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 ${
                    capture.isActive
                      ? "bg-yellow-400/90 hover:bg-yellow-400"
                      : "bg-yellow-400/20 hover:bg-yellow-400/30"
                  }`}
                />
                <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="truncate flex-1 text-xs" title={capture.filename}>
                  {getCaptureShortName(capture)}
                </span>
                <span className="text-xs text-muted-foreground font-mono">{capture.tickCount}</span>
                <button
                  type="button"
                  className="h-3 w-3 shrink-0 rounded-sm bg-red-500/50 hover:bg-red-500 transition-colors"
                  onClick={() => onRemoveCapture(capture.id)}
                  data-testid={`button-remove-capture-${capture.id}`}
                  aria-label={`Remove capture ${capture.id}`}
                />
              </div>
            ))}
            {captures.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No captures loaded</p>
            )}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <Collapsible open={isSelectionOpen} onOpenChange={onSelectionOpenChange}>
        <SidebarGroup>
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger className="flex w-full items-center justify-between">
              <span>Selection</span>
              <ChevronDown
                className={`h-3 w-3 text-muted-foreground transition-transform ${
                  isSelectionOpen ? "rotate-180" : ""
                }`}
              />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <SidebarGroupContent>
              <div className="flex flex-col gap-3">
                {activeCaptures.length === 0 && (
                  <div className="px-2 text-xs text-muted-foreground">No active captures</div>
                )}
                {activeCaptures.map((capture) => {
                  const isCaptureSelectionOpen = selectionCaptureOpenById[capture.id] ?? true;
                  return (
                    <Collapsible
                      key={capture.id}
                      open={isCaptureSelectionOpen}
                      onOpenChange={(open) => onSelectionCaptureOpenChange(capture.id, open)}
                    >
                      <div className="flex flex-col gap-1">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="group flex w-full items-center px-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={`Toggle metric tree for ${capture.id}`}
                            data-testid={`button-toggle-selection-capture-${capture.id}`}
                          >
                            <span className="truncate text-left" title={capture.filename}>
                              {getCaptureShortName(capture)}
                            </span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
                          <ComponentTree
                            captureId={capture.id}
                            components={capture.components}
                            selectedMetrics={selectedMetricsByCapture.get(capture.id) ?? EMPTY_METRICS}
                            metricCoverage={deferredMetricCoverage[capture.id]}
                            onSelectionChange={getSelectionHandler(capture.id)}
                            colorOffset={captures.findIndex((c) => c.id === capture.id)}
                            isVisible={isSelectionOpen && isCaptureSelectionOpen}
                          />
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>

      <SidebarGroup>
        <SidebarGroupLabel>Overview</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col gap-2 px-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Captures</span>
              <span className="font-mono text-foreground">{captures.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Active</span>
              <span className="font-mono text-foreground">{activeCaptures.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Selected metrics</span>
              <span className="font-mono text-foreground">{selectedMetricCount}</span>
            </div>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>View</SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col gap-2 px-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Tick</span>
              <span className="font-mono text-foreground">
                {playbackState.currentTick} / {playbackState.totalTicks}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Window</span>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  value={windowStartInput}
                  onFocus={() => {
                    windowStartEditingRef.current = true;
                  }}
                  onChange={(event) => onWindowStartInputChange(event.target.value)}
                  onBlur={(event) => {
                    windowStartEditingRef.current = false;
                    onCommitWindowStartInput(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      windowStartEditingRef.current = false;
                      onCommitWindowStartInput((event.target as HTMLInputElement).value);
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                  className={inlineEditNumericClass}
                  style={{ width: `${Math.max(windowStartInput.length, 1)}ch` }}
                  aria-label="Window start tick"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  min={1}
                  value={windowEndInput}
                  onFocus={() => {
                    windowEndEditingRef.current = true;
                  }}
                  onChange={(event) => onWindowEndInputChange(event.target.value)}
                  onBlur={(event) => {
                    windowEndEditingRef.current = false;
                    onCommitWindowEndInput(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      windowEndEditingRef.current = false;
                      onCommitWindowEndInput((event.target as HTMLInputElement).value);
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                  className={inlineEditNumericClass}
                  style={{ width: `${Math.max(windowEndInput.length, 1)}ch` }}
                  aria-label="Window end tick"
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span>Y</span>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={yPrimaryMinInput}
                  onFocus={() => {
                    yPrimaryMinEditingRef.current = true;
                  }}
                  onChange={(event) => onYPrimaryMinInputChange(event.target.value)}
                  onBlur={(event) => {
                    yPrimaryMinEditingRef.current = false;
                    onCommitYPrimaryBoundary("min", event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      yPrimaryMinEditingRef.current = false;
                      onCommitYPrimaryBoundary("min", (event.target as HTMLInputElement).value);
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                  className={inlineEditNumericClass}
                  style={{ width: `${Math.max(yPrimaryMinInput.length, 1)}ch` }}
                  aria-label="Primary axis minimum"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  value={yPrimaryMaxInput}
                  onFocus={() => {
                    yPrimaryMaxEditingRef.current = true;
                  }}
                  onChange={(event) => onYPrimaryMaxInputChange(event.target.value)}
                  onBlur={(event) => {
                    yPrimaryMaxEditingRef.current = false;
                    onCommitYPrimaryBoundary("max", event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      yPrimaryMaxEditingRef.current = false;
                      onCommitYPrimaryBoundary("max", (event.target as HTMLInputElement).value);
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                  className={inlineEditNumericClass}
                  style={{ width: `${Math.max(yPrimaryMaxInput.length, 1)}ch` }}
                  aria-label="Primary axis maximum"
                />
              </div>
            </div>
            {hasSecondaryAxis ? (
              <div className="flex items-center justify-between">
                <span>Y2</span>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={ySecondaryMinInput}
                    onFocus={() => {
                      ySecondaryMinEditingRef.current = true;
                    }}
                    onChange={(event) => onYSecondaryMinInputChange(event.target.value)}
                    onBlur={(event) => {
                      ySecondaryMinEditingRef.current = false;
                      onCommitYSecondaryBoundary("min", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        ySecondaryMinEditingRef.current = false;
                        onCommitYSecondaryBoundary("min", (event.target as HTMLInputElement).value);
                        (event.target as HTMLInputElement).blur();
                      }
                    }}
                    className={inlineEditNumericClass}
                    style={{ width: `${Math.max(ySecondaryMinInput.length, 1)}ch` }}
                    aria-label="Secondary axis minimum"
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    type="number"
                    value={ySecondaryMaxInput}
                    onFocus={() => {
                      ySecondaryMaxEditingRef.current = true;
                    }}
                    onChange={(event) => onYSecondaryMaxInputChange(event.target.value)}
                    onBlur={(event) => {
                      ySecondaryMaxEditingRef.current = false;
                      onCommitYSecondaryBoundary("max", event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        ySecondaryMaxEditingRef.current = false;
                        onCommitYSecondaryBoundary("max", (event.target as HTMLInputElement).value);
                        (event.target as HTMLInputElement).blur();
                      }
                    }}
                    className={inlineEditNumericClass}
                    style={{ width: `${Math.max(ySecondaryMaxInput.length, 1)}ch` }}
                    aria-label="Secondary axis maximum"
                  />
                </div>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span>Auto-scroll</span>
              <span className="font-mono text-foreground">{isAutoScroll ? "On" : "Off"}</span>
            </div>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <Collapsible open={isDiagnosticsOpen} onOpenChange={onDiagnosticsOpenChange}>
        <SidebarGroup>
          <SidebarGroupLabel asChild>
            <CollapsibleTrigger className="flex w-full items-center justify-between">
              <span>Diagnostics</span>
              <ChevronDown
                className={`h-3 w-3 text-muted-foreground transition-transform ${
                  isDiagnosticsOpen ? "rotate-180" : ""
                }`}
              />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <SidebarGroupContent>
              <div className="flex items-center justify-between px-2 text-[11px] text-muted-foreground">
                <span>
                  {memoryStatsAt
                    ? `Updated ${new Date(memoryStatsAt).toLocaleTimeString()}`
                    : "Not sampled"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={onRefreshMemoryStats}
                  data-testid="button-refresh-diagnostics"
                >
                  Refresh
                </Button>
              </div>
              {!memoryStatsSnapshot && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Click refresh to capture telemetry.
                </div>
              )}
              {memoryStatsSnapshot && (
                <div className="flex flex-col gap-3 px-2 py-2 text-xs text-muted-foreground">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span>Heap used</span>
                      <span className="font-mono text-foreground">
                        {formatBytes(memoryStatsSnapshot.usedHeap ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Record store</span>
                      <span className="font-mono text-foreground">
                        {formatBytes(memoryStatsSnapshot.estimates.recordStoreBytes ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Series bytes</span>
                      <span className="font-mono text-foreground">
                        {formatBytes(memoryStatsSnapshot.totals.seriesBytes ?? 0)}
                      </span>
                    </div>
                    <div className="text-[10px] uppercase tracking-wide">
                      Estimates ({memoryStatsSnapshot.estimates.estimateSource})
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Bytes / prop</span>
                      <span className="font-mono text-foreground">
                        {memoryStatsSnapshot.estimates.effectiveBytesPerObjectProp.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Bytes / point</span>
                      <span className="font-mono text-foreground">
                        {memoryStatsSnapshot.estimates.effectiveBytesPerSeriesPoint.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  {memoryStatsSnapshot.captures.map((capture) => {
                    const topSeries = [...capture.seriesMetrics]
                      .sort((a, b) => b.estBytes - a.estBytes)
                      .slice(0, 5);
                    return (
                      <div
                        key={capture.captureId}
                        className="rounded-md border border-border/50 p-2 flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="truncate font-medium text-foreground">
                            {capture.filename}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            {capture.tickCount}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                          <span>Records</span>
                          <span className="font-mono text-foreground">{capture.records}</span>
                          <span>Record bytes</span>
                          <span className="font-mono text-foreground">
                            {formatBytes(capture.estimatedRecordBytes ?? 0)}
                          </span>
                          <span>Series points</span>
                          <span className="font-mono text-foreground">{capture.seriesPoints}</span>
                          <span>Series bytes</span>
                          <span className="font-mono text-foreground">
                            {formatBytes(capture.seriesBytes ?? 0)}
                          </span>
                        </div>
                        {topSeries.length > 0 && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Top series
                            </span>
                            {topSeries.map((entry) => (
                              <div
                                key={`${capture.captureId}-${entry.fullPath}`}
                                className="flex items-center justify-between text-[11px]"
                              >
                                <span className="truncate">{entry.fullPath}</span>
                                <span className="font-mono text-foreground">
                                  {formatBytes(entry.estBytes)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SidebarGroupContent>
          </CollapsibleContent>
        </SidebarGroup>
      </Collapsible>
    </div>
  );
}
