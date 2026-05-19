import { mountIdaeDebugFrame } from "../debug/decision-debug.mjs";

export function createIdaeDebugController({
  createFloatingFrame,
  onVisibilityChange,
  onPredictionDebugChange,
  getPredictionDebugState,
}) {
  let mountedDebugFrame = null;
  let suppressNextCloseNotification = false;

  const handleFrameClose = () => {
    const notifyVisibilityChange = !suppressNextCloseNotification;
    suppressNextCloseNotification = false;
    mountedDebugFrame = null;
    if (notifyVisibilityChange) {
      onVisibilityChange?.(false);
    }
  };

  const open = () => {
    if (mountedDebugFrame) {
      return;
    }
    const requestedPredictionDebug = getPredictionDebugState?.() ?? null;
    mountedDebugFrame = mountIdaeDebugFrame(createFloatingFrame, {
      onClose: handleFrameClose,
      onPredictionDebugChange,
    });
    if (requestedPredictionDebug?.visible) {
      mountedDebugFrame?.setPredictionDebug?.(requestedPredictionDebug);
    }
    if (mountedDebugFrame) {
      onVisibilityChange?.(true);
    }
  };

  const close = ({ notifyVisibilityChange = true } = {}) => {
    if (!mountedDebugFrame) {
      if (notifyVisibilityChange) {
        onVisibilityChange?.(false);
      }
      return;
    }
    suppressNextCloseNotification = !notifyVisibilityChange;
    mountedDebugFrame.close();
  };

  return {
    open,
    close,
    dispose: () => close({ notifyVisibilityChange: false }),
    setPredictionDebug: (nextState) => mountedDebugFrame?.setPredictionDebug?.(nextState),
    update: (payload) => mountedDebugFrame?.update(payload),
    isOpen: () => mountedDebugFrame !== null,
  };
}
