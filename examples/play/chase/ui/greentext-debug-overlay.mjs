export function createGreentextDebugOverlay(container) {
  const element = document.createElement("pre");
  Object.assign(element.style, {
    position: "absolute",
    right: "12px",
    bottom: "12px",
    zIndex: "30",
    display: "none",
    margin: "0",
    padding: "0",
    maxWidth: "min(360px, calc(100% - 24px))",
    color: "rgb(34, 197, 94)",
    background: "transparent",
    border: "0",
    borderRadius: "0",
    font: "600 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    letterSpacing: "0.02em",
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
  });
  container.appendChild(element);

  return {
    update({ visible, text } = {}) {
      element.style.display = visible ? "block" : "none";
      element.textContent = text ?? "";
    },
    dispose() {
      element.remove();
    },
  };
}

export function buildGreentextDebugText(simulationState) {
  const motiveId = simulationState?.lastStep?.chaserAction
    ?.actionStrategies
    ?.motiveSignal
    ?.id ?? "none";
  return [
    `frame: ${Number(simulationState?.frameIndex) || 0}`,
    `chaser motive: ${motiveId}`,
  ].join("\n");
}
