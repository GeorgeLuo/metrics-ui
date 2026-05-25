import { useCallback, useState } from "react";
import { normalizeFloatingFrameRegistryId } from "./ids";
import { makeFloatingFrameMount } from "./floating-frame-mount";
import type {
  FloatingFrameRegistryFrameHandle,
  FloatingFrameRegistryFrameOptions,
  FloatingFrameRegistryFrameRecord,
} from "./types";

export function useFloatingFrameRegistry() {
  const [floatingFrames, setFloatingFrames] = useState<FloatingFrameRegistryFrameRecord[]>([]);

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

  const createFloatingFrame = useCallback((
    options: FloatingFrameRegistryFrameOptions,
  ): FloatingFrameRegistryFrameHandle => {
    const id = normalizeFloatingFrameRegistryId(options.id, "frame");
    const frame: FloatingFrameRegistryFrameRecord = {
      ...options,
      id,
      title: options.title.trim() || "Frame",
      mount: makeFloatingFrameMount(),
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
