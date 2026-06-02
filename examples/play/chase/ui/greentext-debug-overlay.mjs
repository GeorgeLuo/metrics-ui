import { getPredictionPerformanceSnapshot } from "../debug/prediction-performance.mjs";

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

function formatConfidence(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? numericValue.toFixed(2)
    : "n/a";
}

function formatThresholdLabel(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "unknown";
  }
  return Number.isInteger(numericValue)
    ? numericValue.toFixed(1)
    : String(numericValue);
}

function getChaserPredictionConfidence(lastStep = {}) {
  const predictionConsensus = lastStep.chaserReasoning
    ?.snapshot
    ?.projections
    ?.evaderMotion
    ?.prediction
    ?.consensus;
  if (Number.isFinite(predictionConsensus)) {
    return predictionConsensus;
  }
  return lastStep.chaserAction
    ?.actionProposals
    ?.evaderPredictionPursuit
    ?.confidence;
}

function getPredictionSuccessRateLines(simulationState = {}) {
  const snapshot = getPredictionPerformanceSnapshot(simulationState?.predictionPerformance);
  const thresholdRows = Array.isArray(snapshot?.thresholdSuccessRates)
    ? snapshot.thresholdSuccessRates
    : [];
  const oneUnitRow = thresholdRows.find((row) => row.threshold === 1);
  if (!oneUnitRow) {
    return [`prediction successRate: ${formatConfidence(snapshot?.summary?.successRate)}`];
  }
  const horizonRows = Array.isArray(snapshot?.thresholdSuccessRatesByFrameOffset)
    ? snapshot.thresholdSuccessRatesByFrameOffset.filter((row) =>
      row.threshold === 1 && Number.isFinite(row.frameOffset))
    : [];

  return [
    `prediction successRate@${formatThresholdLabel(oneUnitRow.threshold)}: ${formatConfidence(oneUnitRow.successRate)}`,
    ...horizonRows.map((row) =>
      `prediction successRate@${formatThresholdLabel(row.threshold)}/+${row.frameOffset}: ${formatConfidence(row.successRate)}`),
  ];
}

export function buildGreentextDebugText(simulationState) {
  const lastStep = simulationState?.lastStep ?? {};
  const actionProposals = lastStep.chaserAction?.actionProposals;
  const motiveId = actionProposals?.motiveSignal?.id ?? "none";
  const predictionConfidence = getChaserPredictionConfidence(lastStep);
  return [
    `frame: ${Number(simulationState?.frameIndex) || 0}`,
    `chaser motive: ${motiveId}`,
    `prediction confidence: ${formatConfidence(predictionConfidence)}`,
    ...getPredictionSuccessRateLines(simulationState),
  ].join("\n");
}
