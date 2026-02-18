import type { ControlCommand } from "@shared/schema";
import { isDerivedCaptureSource } from "@/lib/dashboard/source-utils";
import {
  DASHBOARD_STORAGE_KEYS,
  readStorageJson,
} from "@/lib/dashboard/storage";

type SyncCaptureSource = {
  captureId: string;
  source: string;
  pollIntervalMs?: number;
};

export function readCaptureSourcesForSync(): SyncCaptureSource[] {
  const parsed = readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.liveStreams);
  const list = Array.isArray(parsed) ? parsed : [];
  const sources: SyncCaptureSource[] = [];

  list.forEach((entry) => {
    const captureId =
      typeof (entry as { captureId?: unknown })?.captureId === "string"
        ? (entry as { captureId: string }).captureId
        : typeof (entry as { id?: unknown })?.id === "string"
          ? (entry as { id: string }).id
          : "";
    const source =
      typeof (entry as { source?: unknown })?.source === "string"
        ? (entry as { source: string }).source
        : "";
    const pollSecondsRaw = Number((entry as { pollSeconds?: unknown })?.pollSeconds);
    const pollIntervalMs =
      Number.isFinite(pollSecondsRaw) && pollSecondsRaw > 0
        ? Math.round(pollSecondsRaw * 1000)
        : undefined;

    if (!captureId || !source.trim() || isDerivedCaptureSource(source)) {
      return;
    }

    sources.push({ captureId, source, pollIntervalMs });
  });

  return sources;
}

export function buildCaptureSourceSyncCommand(
  sources: SyncCaptureSource[],
): Extract<ControlCommand, { type: "sync_capture_sources" }> | null {
  if (!Array.isArray(sources) || sources.length === 0) {
    return null;
  }
  return {
    type: "sync_capture_sources",
    sources,
    // Merge local sources into server state instead of replacing. Replacing can
    // drop valid server-side sources during reconnect and leave captures in a
    // "stable but no data" state until a manual live-start is triggered.
    replace: false,
  };
}

export function hasMeaningfulLocalDashboardState(): boolean {
  const selected = readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.selectedMetrics);
  const groups = readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.derivationGroups);
  return (Array.isArray(selected) && selected.length > 0) || (Array.isArray(groups) && groups.length > 0);
}
