import * as THREE from "three";
import {
  CAR_HEIGHT,
  CHASER_ACTION_PATH_VIEW_MODES,
  DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
  DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
} from "../../config/constants.mjs";
import { normalizeVector } from "../../decision-model/core/math.ts";
import { setProjectionFrame, syncProjectionFrames } from "./projection-frames.mjs";

const PREDICTION_DEBUG_PATTERN_PALETTE = Object.freeze([
  0x38bdf8,
  0xf59e0b,
  0x22c55e,
  0xa855f7,
  0x14b8a6,
  0xf97316,
  0x84cc16,
  0xec4899,
]);
const PREDICTION_DEBUG_PROJECTION_PALETTE = Object.freeze([
  0xffffff,
  0xf43f5e,
  0x60a5fa,
  0xfacc15,
  0xc4b5fd,
  0x34d399,
]);
const CHASER_ACTION_PATH_DEBUG_SPECS = Object.freeze([
  { id: CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS, label: "Consensus", color: 0xffffff },
  { id: CHASER_ACTION_PATH_VIEW_MODES.EVADER_PREDICTION_PURSUIT, label: "Prediction pursuit", color: 0x38bdf8 },
  { id: CHASER_ACTION_PATH_VIEW_MODES.LINE_OF_SIGHT_PURSUIT, label: "Line of sight", color: 0x22c55e },
  { id: CHASER_ACTION_PATH_VIEW_MODES.MAP_DISCOVERY, label: "Map discovery", color: 0xfb923c },
  { id: CHASER_ACTION_PATH_VIEW_MODES.MAP_RECENCY_REFRESH, label: "Map recency", color: 0xa78bfa },
  { id: CHASER_ACTION_PATH_VIEW_MODES.SPIN, label: "Spin", color: 0xfacc15 },
]);

function hashString(value) {
  return String(value).split("").reduce(
    (hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0,
    0,
  );
}

function getPaletteColor(id, palette) {
  const index = Math.abs(hashString(id)) % palette.length;
  return palette[index];
}

function clonePosition(position) {
  return position
    && Number.isFinite(position.x)
    && Number.isFinite(position.z)
    ? {
      x: position.x,
      z: position.z,
    }
    : null;
}

function cloneDirection(direction) {
  return direction
    && Number.isFinite(direction.x)
    && Number.isFinite(direction.z)
    ? {
      x: direction.x,
      z: direction.z,
    }
    : null;
}

function getPredictionSamplePosition(sample) {
  return clonePosition(sample?.position ?? sample?.predictedPosition);
}

function getPredictionSampleDirection(sample, index, samples) {
  const directDirection = cloneDirection(sample?.direction ?? sample?.predictedDirection);
  if (directDirection) {
    return directDirection;
  }
  const previousPosition = getPredictionSamplePosition(samples[index - 1]);
  const nextPosition = getPredictionSamplePosition(samples[index + 1]);
  if (previousPosition && nextPosition) {
    const direction = normalizeVector(
      nextPosition.x - previousPosition.x,
      nextPosition.z - previousPosition.z,
    );
    if (direction.x !== 0 || direction.z !== 0) {
      return direction;
    }
  }
  return { x: 0, z: 1 };
}

function normalizePredictionSamples(path = []) {
  return (Array.isArray(path) ? path : [])
    .map((sample, index, samples) => {
      const position = getPredictionSamplePosition(sample);
      if (!position) {
        return null;
      }
      return {
        position,
        direction: getPredictionSampleDirection(sample, index, samples),
        framesAhead: Number(sample?.framesAhead ?? sample?.frameOffset) || index + 1,
        confidence: Number.isFinite(sample?.confidence) ? sample.confidence : 0,
      };
    })
    .filter(Boolean);
}

function normalizeChaserActionPathViewMode(viewMode) {
  return Object.values(CHASER_ACTION_PATH_VIEW_MODES).includes(viewMode)
    ? viewMode
    : CHASER_ACTION_PATH_VIEW_MODES.HIDDEN;
}

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.floor(numericValue))
    : fallback;
}

function applyActionPathDisplayWindow(samples, {
  horizonFrames = DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
  sampleSpacingFrames = DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
} = {}) {
  const horizon = normalizePositiveInteger(
    horizonFrames,
    DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
  );
  const spacing = normalizePositiveInteger(
    sampleSpacingFrames,
    DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
  );
  const windowed = samples.filter((sample) => sample.framesAhead <= horizon);
  const lastFramesAhead = windowed.at(-1)?.framesAhead ?? horizon;
  return windowed.filter((sample) =>
    sample.framesAhead % spacing === 0 || sample.framesAhead === lastFramesAhead);
}

function getChaserActionPath(action, proposalId) {
  const proposals = action?.actionProposals ?? action?.actionPlan?.proposals ?? {};
  if (proposalId === CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS) {
    return proposals.actionPathConsensus?.path ?? action?.actionPath ?? [];
  }
  return proposals[proposalId]?.actionPath ?? [];
}

export function getChaserActionPathDebugEntries(
  action,
  viewMode = CHASER_ACTION_PATH_VIEW_MODES.HIDDEN,
  options = {},
) {
  const normalizedViewMode = normalizeChaserActionPathViewMode(viewMode);
  if (normalizedViewMode === CHASER_ACTION_PATH_VIEW_MODES.HIDDEN) {
    return [];
  }
  return CHASER_ACTION_PATH_DEBUG_SPECS
    .filter((spec) =>
      normalizedViewMode === CHASER_ACTION_PATH_VIEW_MODES.ALL
      || normalizedViewMode === spec.id)
    .map((spec) => ({
      id: `action:${spec.id}`,
      sourceId: spec.id,
      label: spec.label,
      kind: "action",
      color: spec.color,
      samples: applyActionPathDisplayWindow(
        normalizePredictionSamples(getChaserActionPath(action, spec.id)),
        options,
      ),
    }))
    .filter((entry) => entry.samples.length > 0);
}

export function getPredictionDebugPathEntries(snapshot) {
  const patternEntries = Object.entries(snapshot?.patternUnits ?? {})
    .map(([id, patternUnit]) => ({
      id: `pattern:${id}`,
      sourceId: id,
      label: id,
      kind: "pattern",
      color: getPaletteColor(`pattern:${id}`, PREDICTION_DEBUG_PATTERN_PALETTE),
      samples: normalizePredictionSamples(patternUnit?.predictions),
    }))
    .filter((entry) => entry.samples.length > 0);
  const projectionEntries = Object.entries(snapshot?.projections ?? {})
    .map(([id, projection]) => ({
      id: `projection:${id}`,
      sourceId: id,
      label: `${id} consensus`,
      kind: "projection",
      color: getPaletteColor(`projection:${id}`, PREDICTION_DEBUG_PROJECTION_PALETTE),
      samples: normalizePredictionSamples(projection?.path),
    }))
    .filter((entry) => entry.samples.length > 0);

  return [...patternEntries, ...projectionEntries];
}

function createPredictionPathDisplay(color) {
  const group = new THREE.Group();
  const lineGeometry = new THREE.BufferGeometry();
  const lineMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const line = new THREE.Line(lineGeometry, lineMaterial);
  group.add(line);
  return {
    group,
    line,
    frames: [],
  };
}

function disposePredictionPathDisplay(parentGroup, display) {
  if (!display) {
    return;
  }
  syncProjectionFrames(display.group, display.frames, 0);
  parentGroup.remove(display.group);
  display.line.geometry.dispose();
  display.line.material.dispose();
}

function syncPredictionPathLine(display, samples, color, opacity) {
  display.line.material.color.setHex(color);
  display.line.material.opacity = opacity;
  display.line.visible = samples.length > 1;
  display.line.geometry.dispose();
  const positions = samples.flatMap((sample) => [
    sample.position.x,
    CAR_HEIGHT + 0.035,
    sample.position.z,
  ]);
  display.line.geometry = new THREE.BufferGeometry();
  display.line.geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
}

export function createPredictionDebugDisplayState() {
  return {
    displays: new Map(),
  };
}

export function disposePredictionDebugDisplayState(group, state) {
  for (const display of state?.displays?.values?.() ?? []) {
    disposePredictionPathDisplay(group, display);
  }
  state?.displays?.clear?.();
}

function updatePathDebugDisplayEntries(group, state, entries, getStyle) {
  const activeIds = new Set(entries.map((entry) => entry.id));

  for (const [id, display] of state.displays.entries()) {
    if (!activeIds.has(id)) {
      disposePredictionPathDisplay(group, display);
      state.displays.delete(id);
    }
  }

  for (const entry of entries) {
    if (!state.displays.has(entry.id)) {
      const display = createPredictionPathDisplay(entry.color);
      state.displays.set(entry.id, display);
      group.add(display.group);
    }
    const display = state.displays.get(entry.id);
    const style = getStyle(entry);
    syncPredictionPathLine(display, entry.samples, entry.color, style.lineOpacity);
    syncProjectionFrames(display.group, display.frames, entry.samples.length, {
      color: entry.color,
      maxOpacity: style.maxOpacity,
      minOpacity: style.minOpacity,
      scale: style.scale,
    });
    display.frames.forEach((frame, index) => {
      const sample = entry.samples[index];
      setProjectionFrame(frame, sample.position, sample.direction);
    });
  }

  group.visible = entries.length > 0;
  return entries;
}

export function updatePredictionDebugDisplay(group, state, snapshot, {
  visible = false,
} = {}) {
  const entries = visible ? getPredictionDebugPathEntries(snapshot) : [];
  const renderedEntries = updatePathDebugDisplayEntries(group, state, entries, (entry) => {
    const isProposalPath = entry.kind === "proposal";
    return {
      lineOpacity: isProposalPath ? 0.82 : 0.48,
      maxOpacity: isProposalPath ? 0.82 : 0.36,
      minOpacity: isProposalPath ? 0.18 : 0.07,
      scale: isProposalPath ? 1.12 : 0.86,
    };
  });

  group.visible = visible && renderedEntries.length > 0;
  return renderedEntries;
}

export function updateChaserActionPathDebugDisplay(group, state, action, {
  viewMode = CHASER_ACTION_PATH_VIEW_MODES.HIDDEN,
  horizonFrames = DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
  sampleSpacingFrames = DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
} = {}) {
  const entries = getChaserActionPathDebugEntries(action, viewMode, {
    horizonFrames,
    sampleSpacingFrames,
  });
  const renderedEntries = updatePathDebugDisplayEntries(group, state, entries, (entry) => ({
    lineOpacity:
      entry.sourceId === CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS ? 0.86 : 0.56,
    maxOpacity:
      entry.sourceId === CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS ? 0.86 : 0.46,
    minOpacity:
      entry.sourceId === CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS ? 0.2 : 0.08,
    scale:
      entry.sourceId === CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS ? 0.92 : 0.72,
  }));

  group.visible = renderedEntries.length > 0;
  return renderedEntries;
}
