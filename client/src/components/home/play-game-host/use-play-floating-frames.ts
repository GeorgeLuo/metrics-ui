import { useCallback, useState } from "react";
import { normalizeFrameId } from "./ids";
import { makeFrameMount } from "./floating-frame-mount";
import type {
  PlayFloatingFrameHandle,
  PlayFloatingFrameOptions,
  PlayFloatingFrameRecord,
} from "./types";

export function usePlayFloatingFrames() {
  const [floatingFrames, setFloatingFrames] = useState<PlayFloatingFrameRecord[]>([]);

  const closeFloatingFrame = useCallback((frameId: string) => {
    setFloatingFrames((prev) => {
      const frame = prev.find((candidate) => candidate.id === frameId);
      frame?.onClose?.();
      frame?.mount.replaceChildren();
      return prev.filter((candidate) => candidate.id !== frameId);
    });
  }, []);

  const clearFloatingFrames = useCallback(() => {
    setFloatingFrames((prev) => {
      prev.forEach((frame) => frame.mount.replaceChildren());
      return [];
    });
  }, []);

  const createFloatingFrame = useCallback((options: PlayFloatingFrameOptions): PlayFloatingFrameHandle => {
    const id = normalizeFrameId(options.id);
    const frame: PlayFloatingFrameRecord = {
      ...options,
      id,
      title: options.title.trim() || "Frame",
      mount: makeFrameMount(),
    };

    setFloatingFrames((prev) => {
      const replacedFrame = prev.find((candidate) => candidate.id === id);
      replacedFrame?.mount.replaceChildren();
      return [...prev.filter((candidate) => candidate.id !== id), frame];
    });

    return {
      mount: frame.mount,
      close: () => closeFloatingFrame(id),
      setTitle: (title: string) => {
        setFloatingFrames((prev) =>
          prev.map((candidate) =>
            candidate.id === id
              ? { ...candidate, title: title.trim() || candidate.title }
              : candidate,
          ),
        );
      },
    };
  }, [closeFloatingFrame]);

  return {
    floatingFrames,
    createFloatingFrame,
    closeFloatingFrame,
    clearFloatingFrames,
  };
}
