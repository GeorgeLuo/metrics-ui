import { WALL_AVOIDANCE_DETECTION_MIN_APPROACHES } from "./constants.mjs";

const THEME_COLORS = {
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  mutedForeground: "hsl(var(--muted-foreground))",
  border: "hsl(var(--border))",
};

const BASE_FONT_FAMILY = "var(--font-sans)";
const BASE_FONT_SIZE = "11px";
const BASE_LINE_HEIGHT = "1.45";

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function formatRatio(numerator, denominator) {
  const ratio = denominator > 0 ? numerator / denominator : 0;
  return `${formatNumber(ratio)} (${numerator}/${denominator})`;
}

function formatStatus(state) {
  if (state.approachEpisodeCount < WALL_AVOIDANCE_DETECTION_MIN_APPROACHES) {
    return `pending ${state.approachEpisodeCount}/${WALL_AVOIDANCE_DETECTION_MIN_APPROACHES}`;
  }
  return `${state.approachEpisodeCount} episodes`;
}

function formatEpisodeStatus(latest) {
  return `${latest.episodeStatus} ${latest.nearingWall ? "near" : "not near"}${latest.hitWall ? " hit" : ""}`;
}

function appendDebugRow(parent, label) {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    borderBottom: `1px solid ${THEME_COLORS.border}`,
    padding: "6px 0",
    alignItems: "baseline",
  });

  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  Object.assign(labelElement.style, {
    color: THEME_COLORS.mutedForeground,
    fontWeight: "400",
  });

  const valueElement = document.createElement("span");
  Object.assign(valueElement.style, {
    color: THEME_COLORS.foreground,
    textAlign: "right",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: "400",
    fontVariantNumeric: "tabular-nums",
  });

  row.append(labelElement, valueElement);
  parent.appendChild(row);
  return valueElement;
}

function appendSummaryCard(parent, label) {
  const card = document.createElement("div");
  Object.assign(card.style, {
    padding: "0",
  });

  const header = document.createElement("div");
  header.textContent = label;
  Object.assign(header.style, {
    color: THEME_COLORS.mutedForeground,
    fontSize: BASE_FONT_SIZE,
    fontWeight: "400",
    marginBottom: "6px",
  });

  const score = document.createElement("div");
  Object.assign(score.style, {
    color: THEME_COLORS.foreground,
    fontSize: "13px",
    fontWeight: "500",
    lineHeight: "1.35",
    fontVariantNumeric: "tabular-nums",
  });

  const counts = document.createElement("div");
  Object.assign(counts.style, {
    color: THEME_COLORS.foreground,
    marginTop: "4px",
    fontWeight: "400",
    fontVariantNumeric: "tabular-nums",
  });

  const status = document.createElement("div");
  Object.assign(status.style, {
    color: THEME_COLORS.mutedForeground,
    marginTop: "4px",
    fontWeight: "400",
  });

  card.append(header, score, counts, status);
  parent.appendChild(card);
  return { score, counts, status };
}

function updateSummaryCard(elements, state) {
  elements.score.textContent = formatRatio(
    state.avoidedApproachCount,
    state.approachEpisodeCount,
  );
  elements.counts.textContent = `${state.avoidedApproachCount} avoided / ${state.hitApproachCount} hit`;
  elements.status.textContent = formatStatus(state);
}

export function mountStrategyDebugFrame(createFloatingFrame, { onClose } = {}) {
  if (typeof createFloatingFrame !== "function") {
    return null;
  }

  const frameWidth = 320;
  const frame = createFloatingFrame({
    id: "strategy-debug",
    title: "Strategy Debug",
    bounds: "viewport",
    defaultPosition: {
      x: Math.max(16, window.innerWidth - frameWidth - 24),
      y: 304,
    },
    defaultSize: { width: frameWidth, height: 275 },
    minSize: { width: 240, height: 190 },
    minimizable: true,
    resizable: true,
    popoutable: true,
    closeable: true,
    onClose,
  });

  const root = document.createElement("div");
  Object.assign(root.style, {
    boxSizing: "border-box",
    height: "100%",
    overflow: "auto",
    padding: "12px",
    background: THEME_COLORS.background,
    color: THEME_COLORS.foreground,
    fontFamily: BASE_FONT_FAMILY,
    fontSize: BASE_FONT_SIZE,
    lineHeight: BASE_LINE_HEIGHT,
    fontWeight: "400",
  });

  const title = document.createElement("div");
  title.textContent = "Wall avoidance report";
  Object.assign(title.style, {
    color: THEME_COLORS.foreground,
    fontSize: "12px",
    fontWeight: "500",
    marginBottom: "8px",
  });

  const summaryGrid = document.createElement("div");
  Object.assign(summaryGrid.style, {
    display: "grid",
    gap: "8px",
  });

  const summaryValues = {
    target: appendSummaryCard(summaryGrid, "Target Truth"),
    chaser: appendSummaryCard(summaryGrid, "Chaser Inference"),
  };

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "Show details";
  Object.assign(toggle.style, {
    appearance: "none",
    border: "0",
    background: "transparent",
    color: THEME_COLORS.mutedForeground,
    cursor: "pointer",
    font: "inherit",
    margin: "10px 0 0",
    padding: "4px 0",
    textAlign: "left",
    fontWeight: "400",
  });

  const details = document.createElement("div");
  Object.assign(details.style, {
    display: "none",
    marginTop: "4px",
  });

  let detailsVisible = false;
  toggle.addEventListener("click", () => {
    detailsVisible = !detailsVisible;
    details.style.display = detailsVisible ? "block" : "none";
    toggle.textContent = detailsVisible ? "Hide details" : "Show details";
  });

  const detailValues = {
    targetNearestWall: appendDebugRow(details, "Target nearest"),
    targetEpisode: appendDebugRow(details, "Target episode"),
    targetSamples: appendDebugRow(details, "Target samples"),
    chaserVisible: appendDebugRow(details, "Target visible"),
    chaserNearestWall: appendDebugRow(details, "Chaser nearest"),
    chaserEpisode: appendDebugRow(details, "Chaser episode"),
    chaserSamples: appendDebugRow(details, "Chaser samples"),
    targetSpeedEstimate: appendDebugRow(details, "Target est. speed"),
  };

  root.append(title, summaryGrid, toggle, details);
  frame.mount.appendChild(root);

  return {
    update({ wallEvidence, targetVisible, targetWallTruth, targetEstimate }) {
      const latest = wallEvidence.latest;
      const targetLatest = targetWallTruth.latest;
      updateSummaryCard(summaryValues.target, targetWallTruth);
      updateSummaryCard(summaryValues.chaser, wallEvidence);

      detailValues.targetNearestWall.textContent = targetLatest.nearestDistance === null
        ? "n/a"
        : `${targetLatest.nearestWall} (${formatNumber(targetLatest.nearestDistance)})`;
      detailValues.targetEpisode.textContent = formatEpisodeStatus(targetLatest);
      detailValues.targetSamples.textContent = `${targetWallTruth.observedSampleCount} observed`;
      detailValues.chaserVisible.textContent = targetVisible ? "yes" : "no";
      detailValues.chaserNearestWall.textContent = latest.nearestDistance === null
        ? "n/a"
        : `${latest.nearestWall} (${formatNumber(latest.nearestDistance)})`;
      detailValues.chaserEpisode.textContent = formatEpisodeStatus(latest);
      detailValues.chaserSamples.textContent = `${wallEvidence.observedSampleCount} observed`;
      detailValues.targetSpeedEstimate.textContent = Number.isFinite(targetEstimate?.speedEstimateUnitsPerSecond)
        ? `${formatNumber(targetEstimate.speedEstimateUnitsPerSecond)} units/s (${targetEstimate.speedObservationCount ?? 0})`
        : "n/a";
    },
    close() {
      frame.close();
    },
  };
}
