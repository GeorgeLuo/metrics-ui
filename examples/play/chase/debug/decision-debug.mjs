import { WALL_AVOIDANCE_DETECTION_MIN_APPROACHES } from "../config/constants.mjs";

const THEME_COLORS = {
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  mutedForeground: "hsl(var(--muted-foreground))",
  border: "hsl(var(--border))",
};

const BASE_FONT_FAMILY = "var(--font-sans)";
const BASE_FONT_SIZE = "11px";
const BASE_LINE_HEIGHT = "1.45";

const ACTOR_IDS = Object.freeze({
  CHASER: "chaser",
  EVADER: "evader",
});

const ACTOR_LABELS = Object.freeze({
  [ACTOR_IDS.CHASER]: "Chaser",
  [ACTOR_IDS.EVADER]: "Evader",
});

const STAGE_IDS = Object.freeze({
  MEMORY: "memory",
  PATTERNS: "patterns",
  PROJECTIONS: "projections",
  ACTION: "action",
  PERFORMANCE: "performance",
});

const STAGE_LABELS = Object.freeze({
  [STAGE_IDS.MEMORY]: "Memory",
  [STAGE_IDS.PATTERNS]: "Patterns",
  [STAGE_IDS.PROJECTIONS]: "Projections",
  [STAGE_IDS.ACTION]: "Action",
  [STAGE_IDS.PERFORMANCE]: "Performance",
});

const PATTERN_VIEW_IDS = Object.freeze({
  DETAILS: "details",
  PREDICTIONS: "predictions",
});

const PATTERN_VIEW_LABELS = Object.freeze({
  [PATTERN_VIEW_IDS.DETAILS]: "Main view: normal",
  [PATTERN_VIEW_IDS.PREDICTIONS]: "Main view: prediction paths",
});

const PATTERN_LABELS = Object.freeze({
  continuance: "Continuance",
  wallAvoidance: "Wall avoidance",
});

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function formatVector(vector, digits = 2) {
  if (!vector) {
    return "n/a";
  }
  return `(${formatNumber(vector.x, digits)}, ${formatNumber(vector.z, digits)})`;
}

function formatRadians(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${(value * 180 / Math.PI).toFixed(digits)} deg`;
}

function formatRatio(numerator, denominator) {
  const ratio = denominator > 0 ? numerator / denominator : 0;
  return `${formatNumber(ratio)} (${numerator}/${denominator})`;
}

function formatWallStatus(state) {
  if (state.approachEpisodeCount < WALL_AVOIDANCE_DETECTION_MIN_APPROACHES) {
    return `pending ${state.approachEpisodeCount}/${WALL_AVOIDANCE_DETECTION_MIN_APPROACHES}`;
  }
  return `${state.approachEpisodeCount} episodes`;
}

function formatEpisodeStatus(latest) {
  if (!latest) {
    return "n/a";
  }
  return `${latest.episodeStatus} ${latest.nearingWall ? "near" : "not near"}${latest.hitWall ? " hit" : ""}`;
}

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function isVectorLike(value) {
  return value
    && typeof value === "object"
    && Number.isFinite(value.x)
    && Number.isFinite(value.z)
    && Object.keys(value).every((key) => key === "x" || key === "z");
}

function formatLeafValue(path, value) {
  if (value === null || value === undefined) {
    return "n/a";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (isVectorLike(value)) {
    return formatVector(value);
  }
  if (typeof value === "number") {
    return /bearing|radians|turn/i.test(path)
      ? formatRadians(value)
      : formatNumber(value, Number.isInteger(value) ? 0 : 4);
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function formatPatternUnitSummary(unit) {
  if (!unit) {
    return "n/a";
  }
  if (typeof unit === "string") {
    return unit;
  }
  return unit.id ?? unit.type ?? "structured";
}

function createSection(parent, title) {
  const section = document.createElement("section");
  Object.assign(section.style, {
    marginBottom: "14px",
  });

  const header = document.createElement("h2");
  header.textContent = title;
  Object.assign(header.style, {
    color: THEME_COLORS.foreground,
    fontSize: "12px",
    fontWeight: "500",
    lineHeight: "1.35",
    margin: "0 0 8px",
  });

  const body = document.createElement("div");
  section.append(header, body);
  parent.appendChild(section);
  return body;
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
    minWidth: "0",
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
    maxWidth: "58%",
  });

  row.append(labelElement, valueElement);
  parent.appendChild(row);
  return valueElement;
}

function renderCollectionRows(parent, prefix, value) {
  if (value && typeof value === "object" && !Array.isArray(value) && !isVectorLike(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return;
    }
    for (const [key, childValue] of entries) {
      renderCollectionRows(parent, prefix ? `${prefix}.${key}` : key, childValue);
    }
    return;
  }

  appendDebugRow(parent, prefix).textContent = formatLeafValue(prefix, value);
}

function renderCollection(parent, collection = {}) {
  const entries = Object.entries(collection ?? {});
  if (entries.length === 0) {
    appendDebugRow(parent, "entries").textContent = "none";
    return;
  }
  for (const [key, value] of entries) {
    renderCollectionRows(parent, key, value);
  }
}

function getPatternOptions(snapshot) {
  const patternIds = new Set();
  for (const patternId of Object.keys(snapshot?.patternUnits ?? {})) {
    patternIds.add(patternId);
  }
  for (const patternId of Object.keys(snapshot?.patterns ?? {})) {
    if (patternId !== "evaderMotionModel") {
      patternIds.add(patternId);
    }
  }
  for (const patternId of Object.keys(snapshot?.patternStatus ?? {})) {
    patternIds.add(patternId);
  }
  return Object.fromEntries(
    [...patternIds]
      .sort((first, second) => {
        const firstLabel = PATTERN_LABELS[first] ?? first;
        const secondLabel = PATTERN_LABELS[second] ?? second;
        return firstLabel.localeCompare(secondLabel);
      })
      .map((patternId) => [patternId, PATTERN_LABELS[patternId] ?? patternId]),
  );
}

function normalizeSelectedPatternId(snapshot, requestedPatternId) {
  const patternIds = Object.keys(getPatternOptions(snapshot));
  if (patternIds.length === 0) {
    return null;
  }
  return patternIds.includes(requestedPatternId)
    ? requestedPatternId
    : patternIds[0];
}

function renderPredictionRows(parent, predictions = []) {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    appendDebugRow(parent, "predictions").textContent = "none";
    return;
  }

  appendDebugRow(parent, "predictionCount").textContent = String(predictions.length);
  for (const prediction of predictions) {
    const frameOffset = prediction?.frameOffset ?? prediction?.framesAhead;
    const label = Number.isFinite(frameOffset)
      ? `frame +${frameOffset}`
      : "frame n/a";
    const strategy = prediction?.metadata?.strategy ?? prediction?.prediction?.strategy ?? "";
    const strategyLabel = strategy ? ` ${strategy}` : "";
    const confidenceParts = prediction?.confidenceParts ?? {};
    appendDebugRow(parent, label).textContent = [
      `conf ${formatNumber(prediction?.confidence)}`,
      Number.isFinite(confidenceParts.probability)
        ? `p ${formatNumber(confidenceParts.probability)}`
        : null,
      Number.isFinite(confidenceParts.uncertainty)
        ? `unc ${formatNumber(confidenceParts.uncertainty)}`
        : null,
      `dir ${formatVector(prediction?.direction)}`,
      `pos ${formatVector(prediction?.position)}`,
      strategyLabel.trim(),
    ].filter(Boolean).join(" | ");
  }
}

function appendSummaryCard(parent, label, { score = "n/a", counts = "", status = "" } = {}) {
  const card = document.createElement("div");
  const header = document.createElement("div");
  const scoreElement = document.createElement("div");
  const countsElement = document.createElement("div");
  const statusElement = document.createElement("div");

  header.textContent = label;
  scoreElement.textContent = score;
  countsElement.textContent = counts;
  statusElement.textContent = status;

  Object.assign(header.style, {
    color: THEME_COLORS.mutedForeground,
    fontSize: BASE_FONT_SIZE,
    fontWeight: "400",
    marginBottom: "6px",
  });
  Object.assign(scoreElement.style, {
    color: THEME_COLORS.foreground,
    fontSize: "13px",
    fontWeight: "500",
    lineHeight: "1.35",
    fontVariantNumeric: "tabular-nums",
  });
  Object.assign(countsElement.style, {
    color: THEME_COLORS.foreground,
    marginTop: "4px",
    fontWeight: "400",
    fontVariantNumeric: "tabular-nums",
  });
  Object.assign(statusElement.style, {
    color: THEME_COLORS.mutedForeground,
    marginTop: "4px",
    fontWeight: "400",
  });

  card.append(header, scoreElement, countsElement, statusElement);
  parent.appendChild(card);
}

function renderWallAvoidanceStrategy(parent, { chaserSnapshot, evaderWallTruth } = {}) {
  const wallAvoidancePattern = chaserSnapshot?.patterns?.wallAvoidance ?? null;
  const observedEvaderMotion = chaserSnapshot?.memory?.abstracted?.observedEvaderMotion
    ?? chaserSnapshot?.patterns?.evaderMotionModel
    ?? null;
  const evaderVisible = chaserSnapshot?.memory?.directObservation?.evaderLocation?.visible ?? false;
  const summaryBody = createSection(parent, "Wall avoidance strategy");

  if (!wallAvoidancePattern || !evaderWallTruth) {
    appendDebugRow(summaryBody, "status").textContent = "inactive";
    return;
  }

  appendSummaryCard(summaryBody, "Evader Truth", {
    score: formatRatio(evaderWallTruth.avoidedApproachCount, evaderWallTruth.approachEpisodeCount),
    counts: `${evaderWallTruth.avoidedApproachCount} avoided / ${evaderWallTruth.hitApproachCount} hit`,
    status: formatWallStatus(evaderWallTruth),
  });
  appendSummaryCard(summaryBody, "Chaser Inference", {
    score: formatRatio(wallAvoidancePattern.avoidedApproachCount, wallAvoidancePattern.approachEpisodeCount),
    counts: `${wallAvoidancePattern.avoidedApproachCount} avoided / ${wallAvoidancePattern.hitApproachCount} hit`,
    status: formatWallStatus(wallAvoidancePattern),
  });

  const detailBody = createSection(parent, "Wall avoidance details");
  const latest = wallAvoidancePattern.latest;
  const evaderLatest = evaderWallTruth.latest;
  appendDebugRow(detailBody, "Evader nearest").textContent = evaderLatest?.nearestDistance === null
    ? "n/a"
    : `${evaderLatest?.nearestWall} (${formatNumber(evaderLatest?.nearestDistance)})`;
  appendDebugRow(detailBody, "Evader episode").textContent = formatEpisodeStatus(evaderLatest);
  appendDebugRow(detailBody, "Evader samples").textContent = `${evaderWallTruth.observedSampleCount} observed`;
  appendDebugRow(detailBody, "Chaser visible").textContent = evaderVisible ? "yes" : "no";
  appendDebugRow(detailBody, "Chaser nearest").textContent = latest?.nearestDistance === null
    ? "n/a"
    : `${latest?.nearestWall} (${formatNumber(latest?.nearestDistance)})`;
  appendDebugRow(detailBody, "Chaser episode").textContent = formatEpisodeStatus(latest);
  appendDebugRow(detailBody, "Chaser samples").textContent = `${wallAvoidancePattern.observedSampleCount} observed`;
  appendDebugRow(detailBody, "Evader est. speed").textContent = Number.isFinite(observedEvaderMotion?.speedEstimateUnitsPerFrame)
    ? `${formatNumber(observedEvaderMotion.speedEstimateUnitsPerFrame)} u/frame (${observedEvaderMotion.speedObservationCount ?? 0})`
    : "n/a";
}

function renderEvasionOnSightStrategy(parent, { evaderReasoning } = {}) {
  const evaderSnapshot = evaderReasoning?.snapshot ?? null;
  const chaserLocation = evaderSnapshot?.memory?.directObservation?.chaserLocation ?? null;
  const evadeOnSight = evaderSnapshot?.actionStatus?.evadeOnSight ?? null;
  const defaultRoam = evaderSnapshot?.actionStatus?.defaultRoam ?? null;
  const evadeOnSightState = evadeOnSight?.state ?? null;
  const evaderActionDebug = evaderReasoning?.action?.debug ?? null;
  const summaryBody = createSection(parent, "Evasion on sight strategy");

  appendSummaryCard(summaryBody, "Evader Evasion", {
    score: formatRatio(
      Number(evadeOnSightState?.executionEpisodeCount) || 0,
      Number(evadeOnSightState?.actionableEpisodeCount) || 0,
    ),
    counts: `${Number(evadeOnSightState?.executionEpisodeCount) || 0} executed / ${Number(evadeOnSightState?.actionableEpisodeCount) || 0} actionable episodes`,
    status: `${Number(evadeOnSightState?.visibilityEpisodeCount) || 0} sight episodes`,
  });

  const detailBody = createSection(parent, "Evasion on sight details");
  appendDebugRow(detailBody, "Visible frames").textContent = String(Number(evadeOnSightState?.visibleFrameCount) || 0);
  appendDebugRow(detailBody, "Sight episodes").textContent = String(Number(evadeOnSightState?.visibilityEpisodeCount) || 0);
  appendDebugRow(detailBody, "Actionable frames").textContent = String(Number(evadeOnSightState?.actionableFrameCount) || 0);
  appendDebugRow(detailBody, "Actionable episodes").textContent = String(Number(evadeOnSightState?.actionableEpisodeCount) || 0);
  appendDebugRow(detailBody, "Executed frames").textContent = String(Number(evadeOnSightState?.executedFrameCount) || 0);
  appendDebugRow(detailBody, "Execution episodes").textContent = String(Number(evadeOnSightState?.executionEpisodeCount) || 0);
  appendDebugRow(detailBody, "Chaser visible").textContent = chaserLocation?.visible ? "yes" : "no";

  const displayChaserDistance = Number.isFinite(chaserLocation?.distance)
    ? chaserLocation.distance
    : evadeOnSightState?.lastSeenDistance;
  appendDebugRow(detailBody, "Chaser distance").textContent = Number.isFinite(displayChaserDistance)
    ? `${formatNumber(displayChaserDistance)} u`
    : "n/a";
  appendDebugRow(detailBody, "Chaser bearing").textContent = formatRadians(
    chaserLocation?.bearingRadians ?? evadeOnSightState?.lastSeenBearingRadians,
  );
  appendDebugRow(detailBody, "Evade actionable").textContent = evadeOnSight?.actionable ? "yes" : "no";
  appendDebugRow(detailBody, "Evade confidence").textContent = Number.isFinite(evadeOnSight?.confidence)
    ? formatNumber(evadeOnSight.confidence)
    : "n/a";
  appendDebugRow(detailBody, "Evade active").textContent = evaderActionDebug?.evadeActive ? "yes" : "no";
  appendDebugRow(detailBody, "Default roam actionable").textContent = defaultRoam?.actionable ? "yes" : "no";
  appendDebugRow(detailBody, "Current policy").textContent = evaderActionDebug?.policyId ?? "n/a";
  appendDebugRow(detailBody, "Active action strategies").textContent = Array.isArray(evaderActionDebug?.activeStrategyIds)
    && evaderActionDebug.activeStrategyIds.length > 0
    ? evaderActionDebug.activeStrategyIds.join(", ")
    : "none";
  appendDebugRow(detailBody, "Consensus order").textContent = Number.isFinite(evaderActionDebug?.consensusOrder)
    ? formatNumber(evaderActionDebug.consensusOrder)
    : "n/a";
}

function createSelector({
  options,
  getValue,
  setValue,
  onChange,
  onOpenChange,
}) {
  const root = document.createElement("div");
  const button = document.createElement("button");
  const label = document.createElement("span");
  const caret = document.createElement("span");
  const menu = document.createElement("div");
  let open = false;

  Object.assign(root.style, {
    position: "relative",
    minWidth: "0",
  });
  button.type = "button";
  Object.assign(button.style, {
    appearance: "none",
    border: "0",
    background: "transparent",
    color: THEME_COLORS.foreground,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    maxWidth: "100%",
    padding: "0",
    font: "inherit",
    textAlign: "left",
  });
  Object.assign(label.style, {
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  Object.assign(caret.style, {
    width: "7px",
    height: "7px",
    borderRight: `1px solid ${THEME_COLORS.mutedForeground}`,
    borderBottom: `1px solid ${THEME_COLORS.mutedForeground}`,
    transform: "rotate(45deg)",
    marginTop: "-3px",
    flex: "0 0 auto",
  });
  Object.assign(menu.style, {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: "0",
    minWidth: "170px",
    border: `1px solid ${THEME_COLORS.border}`,
    background: THEME_COLORS.background,
    borderRadius: "6px",
    overflow: "hidden",
    display: "none",
    zIndex: "10",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
  });

  const setOpen = (nextOpen) => {
    const changed = open !== nextOpen;
    open = nextOpen;
    menu.style.display = open ? "block" : "none";
    caret.style.transform = open ? "rotate(225deg)" : "rotate(45deg)";
    caret.style.marginTop = open ? "2px" : "-3px";
    if (changed) {
      onOpenChange?.(open);
    }
  };
  const syncLabel = () => {
    label.textContent = options[getValue()] ?? "Unknown";
  };

  button.addEventListener("click", () => {
    setOpen(!open);
  });
  Object.entries(options).forEach(([optionId, optionLabel]) => {
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.textContent = optionLabel;
    Object.assign(optionButton.style, {
      appearance: "none",
      border: "0",
      background: "transparent",
      color: THEME_COLORS.foreground,
      cursor: "pointer",
      display: "block",
      width: "100%",
      padding: "8px 10px",
      textAlign: "left",
      font: "inherit",
    });
    optionButton.addEventListener("click", () => {
      setValue(optionId);
      syncLabel();
      setOpen(false);
      onChange?.();
    });
    menu.appendChild(optionButton);
  });

  button.append(label, caret);
  root.append(button, menu);
  syncLabel();
  return root;
}

function getActorSnapshot(payload, actorId) {
  if (actorId === ACTOR_IDS.CHASER) {
    return payload.chaserSnapshot ?? null;
  }
  return payload.evaderReasoning?.snapshot ?? null;
}

function getActorAction(payload, actorId) {
  if (actorId === ACTOR_IDS.CHASER) {
    return payload.chaserAction ?? null;
  }
  return payload.evaderReasoning?.action ?? null;
}

function renderMemoryStage(parent, snapshot) {
  const directBody = createSection(parent, "Direct observation");
  renderCollection(directBody, snapshot?.memory?.directObservation ?? {});
  const abstractedBody = createSection(parent, "Abstracted memory");
  renderCollection(abstractedBody, snapshot?.memory?.abstracted ?? {});
}

function renderPatternStage(parent, snapshot, {
  selectedPatternId = null,
  setSelectedPatternId = null,
} = {}) {
  const normalizedPatternId = normalizeSelectedPatternId(snapshot, selectedPatternId);
  if (normalizedPatternId && normalizedPatternId !== selectedPatternId) {
    setSelectedPatternId?.(normalizedPatternId);
  }

  if (!normalizedPatternId) {
    const emptyBody = createSection(parent, "Pattern");
    appendDebugRow(emptyBody, "entries").textContent = "none";
    return;
  }

  const patternUnit = snapshot?.patternUnits?.[normalizedPatternId] ?? null;
  const patternState = snapshot?.patterns?.[normalizedPatternId] ?? null;
  const status = snapshot?.patternStatus?.[normalizedPatternId] ?? null;
  const summaryBody = createSection(parent, PATTERN_LABELS[normalizedPatternId] ?? normalizedPatternId);
  appendDebugRow(summaryBody, "unit").textContent = formatPatternUnitSummary(patternUnit?.unit);
  appendDebugRow(summaryBody, "status").textContent = patternUnit?.status ?? "n/a";
  appendDebugRow(summaryBody, "confidence").textContent = Number.isFinite(patternUnit?.confidence)
    ? formatNumber(patternUnit.confidence, 4)
    : "n/a";
  appendDebugRow(summaryBody, "predictionCount").textContent = String(
    Number(patternUnit?.predictionCount ?? status?.predictionCount) || 0,
  );
  appendDebugRow(summaryBody, "horizonFrames").textContent = Number.isFinite(patternUnit?.horizonFrames)
    ? String(patternUnit.horizonFrames)
    : "n/a";

  if (patternUnit?.unit && typeof patternUnit.unit === "object") {
    const unitBody = createSection(parent, "Pattern unit definition");
    renderCollection(unitBody, patternUnit.unit);
  }

  const evidenceBody = createSection(parent, "Evidence");
  renderCollection(evidenceBody, patternUnit?.evidence ?? patternState ?? {});

  const primaryBody = createSection(parent, "Primary prediction");
  renderCollection(primaryBody, patternUnit?.primaryPrediction ?? {});

  const predictionBody = createSection(parent, "Frame predictions");
  renderPredictionRows(predictionBody, patternUnit?.predictions ?? []);

  const statusBody = createSection(parent, "Pattern status");
  renderCollection(statusBody, status ?? {});
}

function renderProjectionStage(parent, payload, actorId) {
  const snapshot = getActorSnapshot(payload, actorId);
  const projectionBody = createSection(parent, "Projections");
  renderCollection(projectionBody, snapshot?.projections ?? {});
  const statusBody = createSection(parent, "Projection status");
  renderCollection(statusBody, snapshot?.projectionStatus ?? {});

  if (actorId === ACTOR_IDS.CHASER) {
    renderWallAvoidanceStrategy(parent, payload);
  }
}

function renderActionStage(parent, payload, actorId) {
  const actionBody = createSection(parent, "IDAE action");
  renderCollection(actionBody, getActorAction(payload, actorId) ?? {});
  if (actorId === ACTOR_IDS.EVADER) {
    const snapshot = getActorSnapshot(payload, actorId);
    const actionStrategiesBody = createSection(parent, "Action strategies");
    renderCollection(actionStrategiesBody, snapshot?.actionStrategies ?? {});
    const actionStatusBody = createSection(parent, "Action status");
    renderCollection(actionStatusBody, snapshot?.actionStatus ?? {});
    renderEvasionOnSightStrategy(parent, payload);
    const appliedBody = createSection(parent, "Applied movement");
    renderCollection(appliedBody, payload.evaderMovementDecision ?? {});
  }
}

function renderPerformanceStage(parent, payload = {}) {
  const performanceSnapshot = payload.performance ?? null;
  const latestBody = createSection(parent, "Latest frame");
  renderCollection(latestBody, performanceSnapshot?.latest ?? {});

  const summaryBody = createSection(parent, "Summary");
  renderCollection(summaryBody, performanceSnapshot?.summary ?? {});

  const causesBody = createSection(parent, "Suspected causes");
  renderCollection(causesBody, performanceSnapshot?.suspectedCauses ?? {});

  const slowBody = createSection(parent, "Recent slow/catch-up frames");
  renderCollection(slowBody, performanceSnapshot?.slowSamples ?? []);
}

export function mountIdaeDebugFrame(createFloatingFrame, {
  onClose,
  onPredictionDebugChange,
} = {}) {
  if (typeof createFloatingFrame !== "function") {
    return null;
  }

  const frameWidth = 390;
  let activeActorId = ACTOR_IDS.CHASER;
  let activeStageId = STAGE_IDS.MEMORY;
  let patternSelectorOpen = false;
  let patternSelectorSignature = null;
  let patternViewSelectorOpen = false;
  let patternViewSelectorSignature = null;
  let predictionDebugSignature = null;
  const activePatternIds = {
    [ACTOR_IDS.CHASER]: null,
    [ACTOR_IDS.EVADER]: null,
  };
  const activePatternViewIds = {
    [ACTOR_IDS.CHASER]: PATTERN_VIEW_IDS.DETAILS,
    [ACTOR_IDS.EVADER]: PATTERN_VIEW_IDS.DETAILS,
  };
  let latestPayload = {};

  const emitPredictionDebugChange = ({ forceHidden = false } = {}) => {
    if (typeof onPredictionDebugChange !== "function") {
      return;
    }
    const visible = !forceHidden
      && activeStageId === STAGE_IDS.PATTERNS
      && activePatternViewIds[activeActorId] === PATTERN_VIEW_IDS.PREDICTIONS;
    const nextState = {
      visible,
      actorId: activeActorId,
    };
    const signature = `${nextState.visible ? "1" : "0"}|${nextState.actorId}`;
    if (signature === predictionDebugSignature) {
      return;
    }
    predictionDebugSignature = signature;
    onPredictionDebugChange(nextState);
  };

  const frame = createFloatingFrame({
    id: "idae-debug",
    title: "IDAE Debug",
    bounds: "viewport",
    defaultPosition: {
      x: Math.max(16, window.innerWidth - frameWidth - 24),
      y: 304,
    },
    defaultSize: { width: frameWidth, height: 430 },
    minSize: { width: 280, height: 220 },
    minimizable: true,
    resizable: true,
    popoutable: true,
    closeable: true,
    onClose: () => {
      emitPredictionDebugChange({ forceHidden: true });
      onClose?.();
    },
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
    pointerEvents: "auto",
    userSelect: "text",
    WebkitUserSelect: "text",
  });
  Object.assign(frame.mount.style, {
    pointerEvents: "auto",
  });

  const selectorRow = document.createElement("div");
  Object.assign(selectorRow.style, {
    display: "flex",
    flexWrap: "wrap",
    gap: "18px",
    alignItems: "center",
    marginBottom: "12px",
    minWidth: "0",
  });

  const patternSelectorSlot = document.createElement("div");
  Object.assign(patternSelectorSlot.style, {
    minWidth: "0",
    maxWidth: "100%",
  });

  const patternViewSelectorSlot = document.createElement("div");
  Object.assign(patternViewSelectorSlot.style, {
    minWidth: "0",
    maxWidth: "100%",
  });

  const content = document.createElement("div");

  const syncPatternViewSelector = ({ force = false } = {}) => {
    const shouldShow = activeStageId === STAGE_IDS.PATTERNS;
    if (!shouldShow) {
      patternViewSelectorOpen = false;
      patternViewSelectorSignature = null;
      patternViewSelectorSlot.style.display = "none";
      clearElement(patternViewSelectorSlot);
      return;
    }

    const signature = [
      activeActorId,
      activeStageId,
      activePatternViewIds[activeActorId] ?? "",
    ].join("|");
    if (!force && (patternViewSelectorOpen || signature === patternViewSelectorSignature)) {
      patternViewSelectorSlot.style.display = "block";
      return;
    }

    patternViewSelectorSignature = signature;
    patternViewSelectorSlot.style.display = "block";
    clearElement(patternViewSelectorSlot);
    patternViewSelectorSlot.appendChild(createSelector({
      options: PATTERN_VIEW_LABELS,
      getValue: () => activePatternViewIds[activeActorId],
      setValue: (value) => {
        activePatternViewIds[activeActorId] = value;
      },
      onChange: () => {
        patternViewSelectorOpen = false;
        patternSelectorOpen = false;
        patternSelectorSignature = null;
        syncPatternViewSelector({ force: true });
        renderActiveView();
      },
      onOpenChange: (open) => {
        patternViewSelectorOpen = open;
      },
    }));
  };

  const syncPatternSelector = ({ force = false } = {}) => {
    const snapshot = getActorSnapshot(latestPayload, activeActorId);
    const patternOptions = getPatternOptions(snapshot);
    const patternIds = Object.keys(patternOptions);
    const shouldShow = activeStageId === STAGE_IDS.PATTERNS && patternIds.length > 0;
    if (!shouldShow) {
      patternSelectorOpen = false;
      patternSelectorSignature = null;
      patternSelectorSlot.style.display = "none";
      clearElement(patternSelectorSlot);
      return;
    }

    const normalizedPatternId = normalizeSelectedPatternId(
      snapshot,
      activePatternIds[activeActorId],
    );
    if (normalizedPatternId && normalizedPatternId !== activePatternIds[activeActorId]) {
      activePatternIds[activeActorId] = normalizedPatternId;
    }

    const signature = [
      activeActorId,
      activeStageId,
      activePatternIds[activeActorId] ?? "",
      ...patternIds,
    ].join("|");
    if (!force && (patternSelectorOpen || signature === patternSelectorSignature)) {
      patternSelectorSlot.style.display = "block";
      return;
    }

    patternSelectorSignature = signature;
    patternSelectorSlot.style.display = "block";
    clearElement(patternSelectorSlot);
    patternSelectorSlot.appendChild(createSelector({
      options: patternOptions,
      getValue: () => activePatternIds[activeActorId],
      setValue: (value) => {
        activePatternIds[activeActorId] = value;
      },
      onChange: () => {
        patternSelectorOpen = false;
        syncPatternSelector({ force: true });
        renderActiveView();
      },
      onOpenChange: (open) => {
        patternSelectorOpen = open;
      },
    }));
  };

  const renderActiveView = () => {
    syncPatternViewSelector();
    syncPatternSelector();
    clearElement(content);
    const snapshot = getActorSnapshot(latestPayload, activeActorId);
    if (activeStageId === STAGE_IDS.MEMORY) {
      renderMemoryStage(content, snapshot);
    } else if (activeStageId === STAGE_IDS.PATTERNS) {
      renderPatternStage(content, snapshot, {
        selectedPatternId: activePatternIds[activeActorId],
        setSelectedPatternId: (patternId) => {
          activePatternIds[activeActorId] = patternId;
        },
      });
    } else if (activeStageId === STAGE_IDS.PROJECTIONS) {
      renderProjectionStage(content, latestPayload, activeActorId);
    } else if (activeStageId === STAGE_IDS.ACTION) {
      renderActionStage(content, latestPayload, activeActorId);
    } else if (activeStageId === STAGE_IDS.PERFORMANCE) {
      renderPerformanceStage(content, latestPayload);
    }
    emitPredictionDebugChange();
  };

  selectorRow.append(
    createSelector({
      options: ACTOR_LABELS,
      getValue: () => activeActorId,
      setValue: (value) => {
        patternSelectorOpen = false;
        patternSelectorSignature = null;
        patternViewSelectorOpen = false;
        patternViewSelectorSignature = null;
        activeActorId = value;
      },
      onChange: renderActiveView,
    }),
    createSelector({
      options: STAGE_LABELS,
      getValue: () => activeStageId,
      setValue: (value) => {
        patternSelectorOpen = false;
        patternSelectorSignature = null;
        patternViewSelectorOpen = false;
        patternViewSelectorSignature = null;
        activeStageId = value;
      },
      onChange: renderActiveView,
    }),
    patternViewSelectorSlot,
    patternSelectorSlot,
  );

  root.append(selectorRow, content);
  frame.mount.appendChild(root);
  renderActiveView();

  return {
    setPredictionDebug(nextState = {}) {
      const requestedActorId = typeof nextState.actorId === "string"
        && Object.hasOwn(ACTOR_LABELS, nextState.actorId)
        ? nextState.actorId
        : activeActorId;
      activeActorId = requestedActorId;
      activeStageId = STAGE_IDS.PATTERNS;
      activePatternViewIds[activeActorId] = nextState.visible
        ? PATTERN_VIEW_IDS.PREDICTIONS
        : PATTERN_VIEW_IDS.DETAILS;
      patternSelectorOpen = false;
      patternSelectorSignature = null;
      patternViewSelectorOpen = false;
      patternViewSelectorSignature = null;
      renderActiveView();
    },
    update(payload = {}) {
      latestPayload = payload;
      renderActiveView();
    },
    close() {
      emitPredictionDebugChange({ forceHidden: true });
      frame.close();
    },
  };
}
