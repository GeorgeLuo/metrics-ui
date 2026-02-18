import { useCallback, useEffect, useRef, useState } from "react";

type UseStreamingActivityOptions = {
  idleMs: number;
};

export function useStreamingActivityTracker({ idleMs }: UseStreamingActivityOptions) {
  const [streamActivityVersion, setStreamActivityVersion] = useState(0);
  const streamingCapturesRef = useRef(new Set<string>());
  const streamLastActivityAtRef = useRef(new Map<string, number>());
  const streamIdleTimersRef = useRef(new Map<string, number>());

  const stopStreamingIndicator = useCallback((captureId: string) => {
    if (!captureId) {
      return;
    }
    const timer = streamIdleTimersRef.current.get(captureId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      streamIdleTimersRef.current.delete(captureId);
    }
    streamLastActivityAtRef.current.delete(captureId);
    if (streamingCapturesRef.current.delete(captureId)) {
      setStreamActivityVersion((v) => v + 1);
    }
  }, []);

  const noteStreamingActivity = useCallback(
    (captureId: string) => {
      if (!captureId) {
        return;
      }
      streamLastActivityAtRef.current.set(captureId, Date.now());

      if (!streamingCapturesRef.current.has(captureId)) {
        streamingCapturesRef.current.add(captureId);
        setStreamActivityVersion((v) => v + 1);
      }

      if (streamIdleTimersRef.current.has(captureId)) {
        return;
      }

      const scheduleIdleCheck = () => {
        const last = streamLastActivityAtRef.current.get(captureId) ?? 0;
        const elapsed = Date.now() - last;
        const delay = Math.max(0, idleMs - elapsed);
        const timer = window.setTimeout(() => {
          streamIdleTimersRef.current.delete(captureId);
          const nextLast = streamLastActivityAtRef.current.get(captureId) ?? 0;
          const nextElapsed = Date.now() - nextLast;
          if (nextElapsed >= idleMs) {
            streamLastActivityAtRef.current.delete(captureId);
            if (streamingCapturesRef.current.delete(captureId)) {
              setStreamActivityVersion((v) => v + 1);
            }
            return;
          }
          scheduleIdleCheck();
        }, delay);
        streamIdleTimersRef.current.set(captureId, timer);
      };

      scheduleIdleCheck();
    },
    [idleMs],
  );

  const pruneStreamingActivity = useCallback((activeCaptureIds: Set<string>) => {
    const isActiveCaptureId = (captureId: string) => activeCaptureIds.has(captureId);

    streamingCapturesRef.current.forEach((id) => {
      if (!isActiveCaptureId(id)) {
        streamingCapturesRef.current.delete(id);
      }
    });
    streamLastActivityAtRef.current.forEach((_value, id) => {
      if (!isActiveCaptureId(id)) {
        streamLastActivityAtRef.current.delete(id);
      }
    });
    streamIdleTimersRef.current.forEach((timerId, id) => {
      if (!isActiveCaptureId(id)) {
        if (typeof window !== "undefined") {
          window.clearTimeout(timerId);
        }
        streamIdleTimersRef.current.delete(id);
      }
    });
  }, []);

  const clearStreamingActivity = useCallback(() => {
    const hadEntries =
      streamingCapturesRef.current.size > 0
      || streamLastActivityAtRef.current.size > 0
      || streamIdleTimersRef.current.size > 0;
    streamingCapturesRef.current.clear();
    streamLastActivityAtRef.current.clear();
    streamIdleTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    streamIdleTimersRef.current.clear();
    if (hadEntries) {
      setStreamActivityVersion((v) => v + 1);
    }
  }, []);

  const getStreamingCaptureIds = useCallback(() => {
    return Array.from(streamingCapturesRef.current);
  }, []);

  useEffect(() => {
    return () => {
      streamIdleTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      streamIdleTimersRef.current.clear();
    };
  }, []);

  return {
    streamActivityVersion,
    noteStreamingActivity,
    stopStreamingIndicator,
    pruneStreamingActivity,
    clearStreamingActivity,
    getStreamingCaptureIds,
  };
}
