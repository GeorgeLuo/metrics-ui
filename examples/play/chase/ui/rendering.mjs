import * as THREE from "three";
import {
  CAR_HEIGHT,
  CAR_LENGTH,
  CAR_WIDTH,
  CHASER_ACTION_PATH_VIEW_MODES,
  CHASER_FIELD_OF_VIEW_COLOR,
  CHASER_VIEW_CAMERA_HEIGHT,
  CHASER_VIEW_LOOK_DISTANCE,
  FIELD_OF_VIEW_DISTANCE,
  FIELD_OF_VIEW_SEGMENTS,
  OBSTACLE_PRISM_HEIGHT,
  EVADER_FIELD_OF_VIEW_COLOR,
  EVADER_PROJECTION_COLOR,
  DEFAULT_CHASER_ACTION_PATH_HORIZON_FRAMES,
  DEFAULT_CHASER_ACTION_PATH_SPACING_FRAMES,
} from "../config/constants.mjs";
import { normalizeVector, vectorToAngle } from "../decision-model/math.mjs";
import { getEvaderProjectionSampleCount } from "../prediction/evader-prediction-plan.mjs";

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
const PREDICTION_DEBUG_STRATEGY_PALETTE = Object.freeze([
  0xffffff,
  0xf43f5e,
  0x60a5fa,
  0xfacc15,
  0xc4b5fd,
  0x34d399,
]);
const CHASER_ACTION_PATH_DEBUG_SPECS = Object.freeze([
  {
    id: CHASER_ACTION_PATH_VIEW_MODES.ACTION_PATH_CONSENSUS,
    label: "Consensus",
    color: 0xffffff,
  },
  {
    id: CHASER_ACTION_PATH_VIEW_MODES.EVADER_PREDICTION_PURSUIT,
    label: "Prediction pursuit",
    color: 0x38bdf8,
  },
  {
    id: CHASER_ACTION_PATH_VIEW_MODES.LINE_OF_SIGHT_PURSUIT,
    label: "Line of sight",
    color: 0x22c55e,
  },
  {
    id: CHASER_ACTION_PATH_VIEW_MODES.MAP_DISCOVERY,
    label: "Map discovery",
    color: 0xfb923c,
  },
  {
    id: CHASER_ACTION_PATH_VIEW_MODES.MAP_RECENCY_REFRESH,
    label: "Map recency",
    color: 0xa78bfa,
  },
  {
    id: CHASER_ACTION_PATH_VIEW_MODES.SEARCH,
    label: "Search",
    color: 0xfacc15,
  },
]);

export function createCar(color) {
  const geometry = new THREE.BoxGeometry(CAR_WIDTH, CAR_HEIGHT, CAR_LENGTH);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.2,
    roughness: 0.45,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = CAR_HEIGHT / 2;
  return mesh;
}

export function createWall(wall) {
  const geometry = new THREE.BoxGeometry(wall.width, OBSTACLE_PRISM_HEIGHT, wall.depth);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(wall.x, OBSTACLE_PRISM_HEIGHT / 2, wall.z);
  return mesh;
}

export function createFieldOfViewConeGeometry(fieldOfViewAngleRadians) {
  const positions = [0, 0.012, 0];
  for (let index = 0; index <= FIELD_OF_VIEW_SEGMENTS; index += 1) {
    const t = index / FIELD_OF_VIEW_SEGMENTS;
    const angle = -fieldOfViewAngleRadians / 2 + t * fieldOfViewAngleRadians;
    positions.push(
      Math.sin(angle) * FIELD_OF_VIEW_DISTANCE,
      0.012,
      Math.cos(angle) * FIELD_OF_VIEW_DISTANCE,
    );
  }

  const indices = [];
  for (let index = 1; index <= FIELD_OF_VIEW_SEGMENTS; index += 1) {
    indices.push(0, index, index + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createFieldOfViewCone(
  fieldOfViewAngleRadians,
  {
    color = CHASER_FIELD_OF_VIEW_COLOR,
    opacity = 0.16,
  } = {},
) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(createFieldOfViewConeGeometry(fieldOfViewAngleRadians), material);
}

export function createEvaderFieldOfViewCone(fieldOfViewAngleRadians) {
  return createFieldOfViewCone(fieldOfViewAngleRadians, {
    color: EVADER_FIELD_OF_VIEW_COLOR,
    opacity: 0.12,
  });
}

export function configureCamera(camera, columns, rows, width, height) {
  const fieldAspect = columns / rows;
  const containerAspect = width > 0 && height > 0 ? width / height : fieldAspect;
  let viewWidth = columns;
  let viewHeight = rows;

  if (containerAspect > fieldAspect) {
    viewWidth = rows * containerAspect;
  } else {
    viewHeight = columns / containerAspect;
  }

  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
}

export function configureChaserViewCamera(camera, chaserPosition, lookDirection) {
  camera.position.set(chaserPosition.x, CHASER_VIEW_CAMERA_HEIGHT, chaserPosition.z);
  camera.lookAt(
    chaserPosition.x + lookDirection.x * CHASER_VIEW_LOOK_DISTANCE,
    CAR_HEIGHT / 2,
    chaserPosition.z + lookDirection.z * CHASER_VIEW_LOOK_DISTANCE,
  );
}

function setProjectionFrame(frame, centerPosition, direction) {
  frame.position.set(centerPosition.x, CAR_HEIGHT / 2, centerPosition.z);
  frame.rotation.y = vectorToAngle(direction);
}

function createProjectionFrame(opacity, color = EVADER_PROJECTION_COLOR) {
  const boxGeometry = new THREE.BoxGeometry(CAR_WIDTH, CAR_HEIGHT, CAR_LENGTH);
  const geometry = new THREE.EdgesGeometry(boxGeometry);
  boxGeometry.dispose();
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}

export function syncProjectionFrames(group, frames, count, {
  color = EVADER_PROJECTION_COLOR,
  maxOpacity = 0.42,
  minOpacity = 0.08,
  scale = 1,
} = {}) {
  while (frames.length < count) {
    const index = frames.length;
    const opacity = Math.max(minOpacity, maxOpacity * (1 - index / Math.max(count, 1)));
    const frame = createProjectionFrame(opacity, color);
    frames.push(frame);
    group.add(frame);
  }

  while (frames.length > count) {
    const frame = frames.pop();
    if (frame) {
      group.remove(frame);
      frame.geometry.dispose();
      frame.material.dispose();
    }
  }

  frames.forEach((frame, index) => {
    frame.material.opacity = Math.max(minOpacity, maxOpacity * (1 - index / Math.max(count, 1)));
    frame.material.color.setHex(color);
    frame.scale.setScalar(scale);
  });
}

export function updateEvaderProjectionDisplay(
  group,
  frames,
  estimate,
  evaderPrediction,
  projectionSettings,
  speedUnitsPerFrame,
  evaderProjectionPath = null,
) {
  const projectionVisible = projectionSettings?.visible === true;
  const hasExplicitPath = Array.isArray(evaderProjectionPath);
  const path = projectionVisible && hasExplicitPath ? evaderProjectionPath : [];
  const count = projectionVisible
    ? (hasExplicitPath ? path.length : getEvaderProjectionSampleCount(projectionSettings))
    : 0;
  const estimatePosition = estimate?.position ?? null;
  const predictionDirection = evaderPrediction?.direction ?? estimate?.direction ?? null;
  const canProject = Boolean(estimatePosition && predictionDirection && count > 0);
  group.visible = canProject;
  syncProjectionFrames(group, frames, canProject ? count : 0);
  if (!canProject) {
    return;
  }

  frames.forEach((frame, index) => {
    const pathSample = path[index];
    const projectionFramesAhead = Number.isFinite(pathSample?.framesAhead)
      ? pathSample.framesAhead
      : (index + 1) * projectionSettings.sampleSpacingFrames;
    const direction = pathSample?.direction ?? predictionDirection;
    setProjectionFrame(
      frame,
      pathSample?.position ?? {
        x: estimate.position.x + predictionDirection.x * speedUnitsPerFrame * projectionFramesAhead,
        z: estimate.position.z + predictionDirection.z * speedUnitsPerFrame * projectionFramesAhead,
      },
      direction,
    );
  });
}

function createMapKnowledgeAreaMesh(material) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.renderOrder = -1;
  return mesh;
}

function syncMapKnowledgeAreaGeometry(mesh, vertices, y = 0.018) {
  mesh.geometry.dispose();
  const positions = vertices.flatMap((vertex) => [
    vertex.x,
    y,
    vertex.z,
  ]);
  const indices = [];
  for (let index = 1; index < vertices.length - 1; index += 1) {
    indices.push(0, index, index + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  mesh.geometry = geometry;
}

function normalizeKnownAreas(mapShapeMemory) {
  return (Array.isArray(mapShapeMemory?.knownAreas) ? mapShapeMemory.knownAreas : [])
    .map((area) => ({
      id: String(area?.id ?? ""),
      vertices: (Array.isArray(area?.vertices) ? area.vertices : [])
        .map(clonePosition)
        .filter(Boolean),
    }))
    .filter((area) => area.id && area.vertices.length >= 3);
}

function normalizeRecentlyObservedAreas(mapShapeMemory, currentFrame) {
  const maxAgeFrames = Math.max(1, Number(mapShapeMemory?.recentVisitationMaxAgeFrames) || 1);
  const resolvedCurrentFrame = Number.isFinite(currentFrame)
    ? currentFrame
    : Number(mapShapeMemory?.lastObservationFrame);
  return (Array.isArray(mapShapeMemory?.recentlyObservedAreas)
    ? mapShapeMemory.recentlyObservedAreas
    : [])
    .map((area) => {
      const lastObservedFrame = Number(area?.lastObservedFrame);
      const ageFrames = Number.isFinite(resolvedCurrentFrame) && Number.isFinite(lastObservedFrame)
        ? Math.max(0, resolvedCurrentFrame - lastObservedFrame)
        : maxAgeFrames;
      const recency = Math.max(0, 1 - ageFrames / maxAgeFrames);
      return {
        id: String(area?.id ?? ""),
        opacity: 0.08 + recency * 0.34,
        vertices: (Array.isArray(area?.vertices) ? area.vertices : [])
          .map(clonePosition)
          .filter(Boolean),
      };
    })
    .filter((area) => area.id && area.vertices.length >= 3);
}

function getKnownAreaRenderSignature(area) {
  return [
    area.id,
    ...area.vertices.map((vertex) =>
      `${Number(vertex.x).toFixed(3)},${Number(vertex.z).toFixed(3)}`),
  ].join("|");
}

export function createMapKnowledgeOverlayDisplayState() {
  return {
    material: new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.075,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    meshes: [],
  };
}

export function disposeMapKnowledgeOverlayDisplayState(group, state) {
  for (const mesh of state?.meshes ?? []) {
    group.remove(mesh);
    mesh.geometry.dispose();
  }
  state?.meshes?.splice?.(0);
  state?.material?.dispose?.();
}

export function updateMapKnowledgeOverlayDisplay(group, state, mapShapeMemory, {
  visible = false,
} = {}) {
  const areas = visible ? normalizeKnownAreas(mapShapeMemory) : [];

  while (state.meshes.length < areas.length) {
    const mesh = createMapKnowledgeAreaMesh(state.material);
    state.meshes.push(mesh);
    group.add(mesh);
  }
  while (state.meshes.length > areas.length) {
    const mesh = state.meshes.pop();
    group.remove(mesh);
    mesh.geometry.dispose();
  }

  areas.forEach((area, index) => {
    const mesh = state.meshes[index];
    const signature = getKnownAreaRenderSignature(area);
    if (mesh.userData.signature !== signature) {
      syncMapKnowledgeAreaGeometry(mesh, area.vertices);
      mesh.userData.signature = signature;
    }
  });

  group.visible = visible && areas.length > 0;
  return areas;
}

function createMapRecencyAreaMesh() {
  return createMapKnowledgeAreaMesh(new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
}

export function createMapRecencyOverlayDisplayState() {
  return {
    meshes: [],
  };
}

export function disposeMapRecencyOverlayDisplayState(group, state) {
  for (const mesh of state?.meshes ?? []) {
    group.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  state?.meshes?.splice?.(0);
}

export function updateMapRecencyOverlayDisplay(group, state, mapShapeMemory, {
  visible = false,
  currentFrame = null,
} = {}) {
  const areas = visible ? normalizeRecentlyObservedAreas(mapShapeMemory, currentFrame) : [];

  while (state.meshes.length < areas.length) {
    const mesh = createMapRecencyAreaMesh();
    state.meshes.push(mesh);
    group.add(mesh);
  }
  while (state.meshes.length > areas.length) {
    const mesh = state.meshes.pop();
    group.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  areas.forEach((area, index) => {
    const mesh = state.meshes[index];
    const signature = getKnownAreaRenderSignature(area);
    if (mesh.userData.signature !== signature) {
      syncMapKnowledgeAreaGeometry(mesh, area.vertices, 0.022);
      mesh.userData.signature = signature;
    }
    mesh.material.opacity = area.opacity;
  });

  group.visible = visible && areas.length > 0;
  return areas;
}

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
  const proposals = action?.actionStrategies ?? action?.actionPlan?.proposals ?? {};
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
  const strategyEntries = Object.entries(snapshot?.strategies ?? {})
    .map(([id, strategy]) => ({
      id: `strategy:${id}`,
      sourceId: id,
      label: `${id} consensus`,
      kind: "strategy",
      color: getPaletteColor(`strategy:${id}`, PREDICTION_DEBUG_STRATEGY_PALETTE),
      samples: normalizePredictionSamples(strategy?.path),
    }))
    .filter((entry) => entry.samples.length > 0);

  return [...patternEntries, ...strategyEntries];
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
    syncPredictionPathLine(
      display,
      entry.samples,
      entry.color,
      style.lineOpacity,
    );
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
    const isStrategyPath = entry.kind === "strategy";
    return {
      lineOpacity: isStrategyPath ? 0.82 : 0.48,
      maxOpacity: isStrategyPath ? 0.82 : 0.36,
      minOpacity: isStrategyPath ? 0.18 : 0.07,
      scale: isStrategyPath ? 1.12 : 0.86,
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
