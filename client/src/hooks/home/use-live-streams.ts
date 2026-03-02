import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  DASHBOARD_STORAGE_KEYS,
  readStorageJson,
  readStorageString,
} from "@/lib/dashboard/storage";

export type LiveStreamStatus = "idle" | "connecting" | "retrying" | "connected" | "completed";

export interface LiveStreamEntry {
  id: string;
  source: string;
  pollSeconds: number;
  status: LiveStreamStatus;
  error: string | null;
}

type UseLiveStreamsOptions = {
  createId: () => string;
  defaultPollSeconds?: number;
};

type UseLiveStreamsResult = {
  sourceMode: "file" | "live";
  setSourceMode: Dispatch<SetStateAction<"file" | "live">>;
  liveStreams: LiveStreamEntry[];
  setLiveStreams: Dispatch<SetStateAction<LiveStreamEntry[]>>;
  livePollInputDrafts: Record<string, string>;
  setLivePollInputDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  handleLivePollInputDraftChange: (captureId: string, rawValue: string) => void;
  handleLivePollInputDraftBlur: (captureId: string) => void;
};

export function useLiveStreams({
  createId,
  defaultPollSeconds = 2,
}: UseLiveStreamsOptions): UseLiveStreamsResult {
  const [sourceMode, setSourceMode] = useState<"file" | "live">(() => {
    return readStorageString(DASHBOARD_STORAGE_KEYS.sourceMode) === "live" ? "live" : "file";
  });

  const [liveStreams, setLiveStreams] = useState<LiveStreamEntry[]>(() => {
    const parsed = readStorageJson<unknown>(DASHBOARD_STORAGE_KEYS.liveStreams);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const hydrated = parsed
        .map((entry) => ({
          id:
            typeof (entry as { id?: unknown })?.id === "string"
              ? (entry as { id: string }).id
              : createId(),
          source:
            typeof (entry as { source?: unknown })?.source === "string"
              ? (entry as { source: string }).source
              : "",
          pollSeconds:
            Number.isFinite(Number((entry as { pollSeconds?: unknown })?.pollSeconds))
            && Number((entry as { pollSeconds?: unknown }).pollSeconds) > 0
              ? Number((entry as { pollSeconds: unknown }).pollSeconds)
              : defaultPollSeconds,
          status: "idle" as LiveStreamStatus,
          error: null,
        }))
        .filter((entry) => entry.source.trim().length > 0);

      if (hydrated.length > 0) {
        return hydrated;
      }
    }

    return [];
  });

  const [livePollInputDrafts, setLivePollInputDrafts] = useState<Record<string, string>>({});

  const handleLivePollInputDraftChange = useCallback((captureId: string, rawValue: string) => {
    setLivePollInputDrafts((prev) => ({
      ...prev,
      [captureId]: rawValue,
    }));
  }, []);

  const handleLivePollInputDraftBlur = useCallback((captureId: string) => {
    setLivePollInputDrafts((prev) => {
      if (!(captureId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[captureId];
      return next;
    });
  }, []);

  return {
    sourceMode,
    setSourceMode,
    liveStreams,
    setLiveStreams,
    livePollInputDrafts,
    setLivePollInputDrafts,
    handleLivePollInputDraftChange,
    handleLivePollInputDraftBlur,
  };
}
