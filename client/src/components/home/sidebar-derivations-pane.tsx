import type { Dispatch, DragEvent, MutableRefObject, SetStateAction } from "react";
import { Code, GripVertical, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@/components/ui/sidebar";
import type { CaptureSession, DerivationGroup, SelectedMetric } from "@shared/schema";
import {
  getDerivationGroupDerivedMetrics,
  getDerivationGroupInputMetrics,
} from "@/lib/dashboard/derivation-utils";

type DerivationPluginOutput = { key: string; label?: string };
type DerivationPluginRecord = {
  id: string;
  name: string;
  description?: string;
  minInputs: number;
  maxInputs: number | null;
  outputs: DerivationPluginOutput[];
  uploadedAt: string;
  valid: boolean;
  error: string | null;
};

type DerivationDragState = {
  groupId: string;
  fromIndex: number;
} | null;

type DerivationDropState = {
  groupId: string;
  targetIndex: number;
  position: "before" | "after";
} | null;

type SidebarDerivationsPaneProps = {
  sidebarMode: "setup" | "analysis";
  derivationPluginFileRef: MutableRefObject<HTMLInputElement | null>;
  onUploadDerivationPlugin: (file: File) => void;
  derivationPlugins: DerivationPluginRecord[];
  derivationPluginsError: string | null;
  onViewDerivationPluginSource: (pluginId: string) => void;
  onDeleteDerivationPlugin: (pluginId: string) => void;
  derivationGroups: DerivationGroup[];
  onCreateDerivationGroupFromActive: (mode: "new" | "deep-copy" | "shallow-copy") => void;
  resolvedActiveDerivationGroupId: string;
  resolvedDisplayDerivationGroupId: string;
  onSetActiveDerivationGroup: (groupId: string) => void;
  derivationGroupNameDrafts: Record<string, string>;
  setDerivationGroupNameDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  focusedDerivationGroupNameId: string;
  setFocusedDerivationGroupNameId: Dispatch<SetStateAction<string>>;
  onUpdateDerivationGroup: (
    groupId: string,
    updates: { newGroupId?: string; name?: string; pluginId?: string },
  ) => void;
  onRunDerivationPlugin: (options: { groupId: string; pluginId: string; outputCaptureId?: string }) => void;
  onSetDisplayDerivationGroup: (groupId: string) => void;
  onDeleteDerivationGroup: (groupId: string) => void;
  captures: CaptureSession[];
  getCaptureShortName: (capture: CaptureSession) => string;
  derivationDragState: DerivationDragState;
  derivationDropState: DerivationDropState;
  getAnalysisKey: (metric: SelectedMetric) => string;
  onDerivationMetricDragStart: (
    event: DragEvent<HTMLDivElement>,
    groupId: string,
    index: number,
  ) => void;
  onDerivationMetricDragOver: (
    event: DragEvent<HTMLDivElement>,
    groupId: string,
    index: number,
  ) => void;
  onDerivationMetricDrop: (
    event: DragEvent<HTMLDivElement>,
    groupId: string,
    index: number,
  ) => void;
  onDerivationMetricDragEnd: () => void;
  onRemoveDerivationMetric: (groupId: string, metric: SelectedMetric) => void;
};

export function SidebarDerivationsPane({
  sidebarMode,
  derivationPluginFileRef,
  onUploadDerivationPlugin,
  derivationPlugins,
  derivationPluginsError,
  onViewDerivationPluginSource,
  onDeleteDerivationPlugin,
  derivationGroups,
  onCreateDerivationGroupFromActive,
  resolvedActiveDerivationGroupId,
  resolvedDisplayDerivationGroupId,
  onSetActiveDerivationGroup,
  derivationGroupNameDrafts,
  setDerivationGroupNameDrafts,
  focusedDerivationGroupNameId,
  setFocusedDerivationGroupNameId,
  onUpdateDerivationGroup,
  onRunDerivationPlugin,
  onSetDisplayDerivationGroup,
  onDeleteDerivationGroup,
  captures,
  getCaptureShortName,
  derivationDragState,
  derivationDropState,
  getAnalysisKey,
  onDerivationMetricDragStart,
  onDerivationMetricDragOver,
  onDerivationMetricDrop,
  onDerivationMetricDragEnd,
  onRemoveDerivationMetric,
}: SidebarDerivationsPaneProps) {
  return (
    <div
      className={
        sidebarMode === "analysis"
          ? "flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden gap-2 overscroll-contain"
          : "hidden"
      }
      aria-hidden={sidebarMode !== "analysis"}
    >
      <SidebarGroup>
        <SidebarGroupLabel>Derivations</SidebarGroupLabel>
        <SidebarGroupContent>
          <input
            ref={derivationPluginFileRef}
            type="file"
            accept=".mjs,.js"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onUploadDerivationPlugin(file);
              }
              event.target.value = "";
            }}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-xs text-muted-foreground">{derivationPlugins.length} systems</span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => derivationPluginFileRef.current?.click()}
              data-testid="button-derivation-plugin-upload"
              aria-label="Upload derivation system"
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
          {derivationPluginsError && (
            <div className="px-2 text-xs text-red-500">{derivationPluginsError}</div>
          )}
          {derivationPlugins.length === 0 && (
            <div className="px-2 text-xs text-muted-foreground">
              Upload a derivation system plugin to compute derived metrics.
            </div>
          )}
          {derivationPlugins.length > 0 && (
            <div className="flex flex-col gap-2 px-2 pb-2 text-xs text-muted-foreground">
              {derivationPlugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className={`rounded-md border px-2 py-1.5 flex items-start justify-between gap-2 ${
                    plugin.valid ? "border-border/50" : "border-red-500/40"
                  }`}
                >
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-medium text-foreground">{plugin.name}</span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {plugin.id}
                      </span>
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      outputs:{" "}
                      {plugin.outputs.length > 0
                        ? plugin.outputs.map((output) => output.key).join(", ")
                        : "-"}
                    </div>
                    {!plugin.valid && plugin.error && (
                      <div className="text-[10px] text-red-500">{plugin.error}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    <button
                      type="button"
                      onClick={() => onViewDerivationPluginSource(plugin.id)}
                      aria-label={`View derivation system source ${plugin.name}`}
                      data-testid={`button-derivation-plugin-source-${plugin.id}`}
                      className="h-3 w-3 rounded-sm bg-muted/40 hover:bg-muted/60 transition-colors flex items-center justify-center"
                    >
                      <Code className="w-[10px] h-[10px] text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteDerivationPlugin(plugin.id)}
                      aria-label={`Delete derivation system ${plugin.name}`}
                      className="h-3 w-3 rounded-sm bg-red-500/50 hover:bg-red-500 transition-colors"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mx-2 h-px bg-border/50" />

          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-xs text-muted-foreground">{derivationGroups.length} groups</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  data-testid="button-derivation-group-create"
                  aria-label="Create derivation group"
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-44"
                data-testid="menu-derivation-group-create"
              >
                <DropdownMenuItem
                  onClick={() => onCreateDerivationGroupFromActive("new")}
                  data-testid="menu-item-derivation-group-new"
                >
                  New Group
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={derivationGroups.length === 0}
                  onClick={() => onCreateDerivationGroupFromActive("deep-copy")}
                  data-testid="menu-item-derivation-group-deep-copy"
                >
                  Deep Copy
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={derivationGroups.length === 0}
                  onClick={() => onCreateDerivationGroupFromActive("shallow-copy")}
                  data-testid="menu-item-derivation-group-shallow-copy"
                >
                  Shallow Copy
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {derivationGroups.length === 0 && (
            <div className="px-2 text-xs text-muted-foreground">
              Click a metric in the HUD to create a default group.
            </div>
          )}
          <div className="flex flex-col gap-3 px-2 text-xs text-muted-foreground min-w-0">
            {derivationGroups.map((group) => {
              const isActive = group.id === resolvedActiveDerivationGroupId;
              const isDisplayed = group.id === resolvedDisplayDerivationGroupId;
              const selectedPluginId = typeof group.pluginId === "string" ? group.pluginId : "";
              const selectedPlugin = selectedPluginId
                ? derivationPlugins.find((plugin) => plugin.id === selectedPluginId) ?? null
                : null;
              const canRunPlugin = Boolean(selectedPluginId && selectedPlugin && selectedPlugin.valid);
              const inputMetricRows = getDerivationGroupInputMetrics(group).map((metric, index) => ({
                metric,
                index,
              }));
              const derivedMetricRows = getDerivationGroupDerivedMetrics(group);
              return (
                <div
                  key={group.id}
                  className={`rounded-md border p-2 flex flex-col gap-2 ${
                    isActive ? "border-foreground/40" : "border-border/50"
                  } cursor-pointer w-full min-w-0 overflow-hidden`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSetActiveDerivationGroup(group.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) {
                      return;
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSetActiveDerivationGroup(group.id);
                    }
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Input
                      value={derivationGroupNameDrafts[group.id] ?? group.name}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setDerivationGroupNameDrafts((prev) => {
                          if (prev[group.id] === nextValue) {
                            return prev;
                          }
                          return { ...prev, [group.id]: nextValue };
                        });
                      }}
                      onFocus={() => {
                        setFocusedDerivationGroupNameId(group.id);
                        setDerivationGroupNameDrafts((prev) => {
                          if (typeof prev[group.id] === "string") {
                            return prev;
                          }
                          return { ...prev, [group.id]: group.name };
                        });
                      }}
                      onBlur={(event) => {
                        const rawValue = derivationGroupNameDrafts[group.id] ?? event.target.value;
                        const nextName = rawValue.trim();
                        if (nextName && nextName !== group.name) {
                          onUpdateDerivationGroup(group.id, { name: nextName });
                        }
                        setFocusedDerivationGroupNameId((prev) => (prev === group.id ? "" : prev));
                        setDerivationGroupNameDrafts((prev) => {
                          if (!(group.id in prev)) {
                            return prev;
                          }
                          const { [group.id]: _removed, ...rest } = prev;
                          return rest;
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          (event.target as HTMLInputElement).blur();
                        }
                      }}
                      className="flex-1 min-w-0 h-auto p-0 text-xs font-mono tracking-tight text-foreground bg-transparent border-0 shadow-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                      aria-label="Derivation group name"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <div className="w-[7.5rem]" onClick={(event) => event.stopPropagation()}>
                        <Select
                          value={selectedPluginId || "__none__"}
                          onValueChange={(value) => {
                            onUpdateDerivationGroup(group.id, {
                              pluginId: value === "__none__" ? "" : value,
                            });
                          }}
                        >
                          <SelectTrigger
                            className="h-6 px-2 py-1 text-xs font-mono tracking-tight bg-transparent border-border/50 focus:ring-0 focus:ring-offset-0"
                            aria-label={`Derivation system for ${group.name}`}
                            data-testid={`select-derivation-group-plugin-${group.id}`}
                          >
                            <SelectValue placeholder="No system" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No system</SelectItem>
                            {derivationPlugins.map((plugin) => (
                              <SelectItem key={plugin.id} value={plugin.id} disabled={!plugin.valid}>
                                {plugin.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!canRunPlugin) {
                            return;
                          }
                          const stableOutputCaptureId = `derive-${group.id}-${selectedPluginId}`;
                          onRunDerivationPlugin({
                            groupId: group.id,
                            pluginId: selectedPluginId,
                            outputCaptureId: stableOutputCaptureId,
                          });
                        }}
                        disabled={!canRunPlugin}
                        aria-label={`Run derivation system for ${group.name}`}
                        data-testid={`button-derivation-group-run-plugin-${group.id}`}
                        className={`h-5 w-5 flex items-center justify-center rounded-sm transition-colors ${
                          canRunPlugin
                            ? "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            : "text-muted-foreground/30 cursor-not-allowed"
                        }`}
                      >
                        <Play className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetDisplayDerivationGroup(isDisplayed ? "" : group.id)}
                        data-testid={`button-derivation-group-display-${group.id}`}
                        aria-label={
                          isDisplayed
                            ? `Show all metrics (stop solo display for ${group.name})`
                            : `Show only metrics in ${group.name}`
                        }
                        className={`h-3 w-3 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30 ${
                          isDisplayed
                            ? "bg-yellow-400/90 hover:bg-yellow-400"
                            : "bg-yellow-400/20 hover:bg-yellow-400/30"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => onDeleteDerivationGroup(group.id)}
                        data-testid={`button-derivation-group-delete-${group.id}`}
                        aria-label={`Delete derivation group ${group.name}`}
                        className="h-3 w-3 rounded-sm bg-red-500/50 hover:bg-red-500 transition-colors"
                      />
                    </div>
                  </div>
                  {focusedDerivationGroupNameId === group.id && (
                    <div
                      className="rounded-sm border border-border/50 bg-muted/20 px-2 py-1 text-xs font-mono text-foreground break-all"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {derivationGroupNameDrafts[group.id] ?? group.name}
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    {inputMetricRows.length === 0 && derivedMetricRows.length === 0 && (
                      <div className="text-xs text-muted-foreground">No metrics yet.</div>
                    )}
                    {inputMetricRows.length > 0 && (
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        Inputs
                      </div>
                    )}
                    {inputMetricRows.map((row) => {
                      const { metric, index } = row;
                      const capture = captures.find((entry) => entry.id === metric.captureId);
                      const captureName = capture ? getCaptureShortName(capture) : metric.captureId;
                      const isDraggingThis =
                        derivationDragState?.groupId === group.id
                        && derivationDragState?.fromIndex === index;
                      const isDropTarget =
                        derivationDropState?.groupId === group.id
                        && derivationDropState?.targetIndex === index;
                      const dropBefore = isDropTarget && derivationDropState?.position === "before";
                      const dropAfter = isDropTarget && derivationDropState?.position === "after";
                      return (
                        <div
                          key={`${group.id}-${getAnalysisKey(metric)}`}
                          className={`relative flex items-center gap-2 rounded-sm ${
                            isDraggingThis ? "opacity-60" : ""
                          }`}
                          draggable
                          onDragStart={(event) => {
                            event.stopPropagation();
                            onDerivationMetricDragStart(event, group.id, index);
                          }}
                          onDragOver={(event) => {
                            event.stopPropagation();
                            onDerivationMetricDragOver(event, group.id, index);
                          }}
                          onDrop={(event) => {
                            event.stopPropagation();
                            onDerivationMetricDrop(event, group.id, index);
                          }}
                          onDragEnd={(event) => {
                            event.stopPropagation();
                            onDerivationMetricDragEnd();
                          }}
                        >
                          {dropBefore && (
                            <span className="pointer-events-none absolute -top-0.5 left-0 right-0 h-px bg-foreground/70" />
                          )}
                          {dropAfter && (
                            <span className="pointer-events-none absolute -bottom-0.5 left-0 right-0 h-px bg-foreground/70" />
                          )}
                          <span className="text-muted-foreground/70 cursor-grab active:cursor-grabbing">
                            <GripVertical className="w-3 h-3" />
                          </span>
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: metric.color }}
                          />
                          <span className="truncate flex-1">
                            {captureName}: {metric.label}
                          </span>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRemoveDerivationMetric(group.id, metric);
                            }}
                            aria-label={`Remove ${captureName}: ${metric.label} from ${group.name}`}
                          >
                            x
                          </button>
                        </div>
                      );
                    })}
                    {derivedMetricRows.length > 0 && (
                      <div className="pt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        Derived
                      </div>
                    )}
                    {derivedMetricRows.map((metric) => {
                      const capture = captures.find((entry) => entry.id === metric.captureId);
                      const captureName = capture ? getCaptureShortName(capture) : metric.captureId;
                      return (
                        <div
                          key={`${group.id}-${getAnalysisKey(metric)}`}
                          className="flex items-center gap-2 opacity-90"
                        >
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: metric.color }}
                          />
                          <span className="truncate flex-1">
                            {captureName}: {metric.label}
                          </span>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRemoveDerivationMetric(group.id, metric);
                            }}
                            aria-label={`Remove ${captureName}: ${metric.label} from ${group.name}`}
                          >
                            x
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </div>
  );
}
