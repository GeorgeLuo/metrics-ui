import {
  ASSUMED_GAME_FRAMES_PER_SECOND,
  DEFAULT_CHASER_SPEED_UNITS_PER_FRAME,
  DEFAULT_CAR_TURN_RATE_RADIANS_PER_FRAME,
  DEFAULT_FIELD_OF_VIEW_ANGLE_RADIANS,
  DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
  DEFAULT_EVADER_PROJECTION_SPACING_FRAMES,
  DEFAULT_EVADER_DRIFT_WEIGHT,
  DEFAULT_EVADER_DRIFT_X_PHASE_PER_FRAME,
  DEFAULT_EVADER_DRIFT_Z_PHASE_PER_FRAME,
  DEFAULT_EVADER_SPEED_UNITS_PER_FRAME,
  DEFAULT_EVADER_WALL_AVOID_WEIGHT,
  MAX_SIMULATION_FRAMES_PER_SECOND,
  MAX_EVADER_PROJECTION_HORIZON_FRAMES,
  MAX_EVADER_PROJECTION_SPACING_FRAMES,
  MIN_SIMULATION_FRAMES_PER_SECOND,
} from "./constants.mjs";
import {
  clampNumber,
  degreesToRadians,
  normalizeVector,
} from "./math.mjs";
import { CHASE_TRACE_SINKS } from "./trace-recorder.mjs";
import { CHASER_PATTERN_IDS, CHASER_STRATEGY_IDS, EVADER_STRATEGY_IDS } from "./strategy-ids.mjs";
import { getFieldObstacleLayout } from "./world.mjs";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizePosition(value, fallback) {
  const record = asRecord(value);
  if (!record) {
    return { ...fallback };
  }
  return {
    x: normalizeNumber(record.x, fallback.x),
    z: normalizeNumber(record.z, fallback.z),
  };
}

function normalizeDirection(value, fallback) {
  const record = asRecord(value);
  if (!record) {
    return { ...fallback };
  }
  const direction = normalizeVector(
    normalizeNumber(record.x, fallback.x),
    normalizeNumber(record.z, fallback.z),
  );
  return direction.x === 0 && direction.z === 0
    ? { ...fallback }
    : direction;
}

function normalizeObstacle(value, index) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const width = normalizeNumber(record.width, NaN);
  const depth = normalizeNumber(record.depth, NaN);
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) {
    return null;
  }
  return {
    id: typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : `obstacle-${index + 1}`,
    x: normalizeNumber(record.x, 0),
    z: normalizeNumber(record.z, 0),
    width,
    depth,
  };
}

function normalizeObstacles(value, fallback) {
  if (!Array.isArray(value)) {
    return { walls: fallback.walls.map((wall) => ({ ...wall })) };
  }
  const walls = value
    .map((obstacle, index) => normalizeObstacle(obstacle, index))
    .filter(Boolean);
  return walls.length > 0
    ? { walls }
    : { walls: fallback.walls.map((wall) => ({ ...wall })) };
}

function resolveMapScenario(mapConfig, columns, rows) {
  const fallbackLayout = getFieldObstacleLayout(columns, rows);
  const mapRecord = asRecord(mapConfig);
  if (!mapRecord) {
    return {
      layout: "center-square-default",
      obstacles: fallbackLayout,
    };
  }

  if (Array.isArray(mapRecord.obstacles)) {
    return {
      layout: "custom",
      obstacles: normalizeObstacles(mapRecord.obstacles, fallbackLayout),
    };
  }

  const layout = typeof mapRecord.layout === "string" && mapRecord.layout.trim()
    ? mapRecord.layout.trim()
    : "center-square-default";
  return {
    layout,
    obstacles: fallbackLayout,
  };
}

function normalizeBooleanMap(value) {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, entryValue]) =>
      typeof entryValue === "boolean" ? [[key, entryValue]] : []),
  );
}

function normalizeStrategyMap(value, knownIds, defaultEnabled = true) {
  const record = asRecord(value);
  const overrides = normalizeBooleanMap(record);
  return Object.fromEntries(
    knownIds.map((strategyId) => [
      strategyId,
      strategyId in overrides ? overrides[strategyId] : defaultEnabled,
    ]),
  );
}

function normalizeEvaderPolicy(value) {
  const record = asRecord(value) ?? {};
  return {
    id: typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : "baseline-drift-wall-avoid",
    driftXPhasePerFrame: normalizeNumber(
      record.driftXPhasePerFrame,
      DEFAULT_EVADER_DRIFT_X_PHASE_PER_FRAME,
    ),
    driftZPhasePerFrame: normalizeNumber(
      record.driftZPhasePerFrame,
      DEFAULT_EVADER_DRIFT_Z_PHASE_PER_FRAME,
    ),
    driftXPhaseOffset: normalizeNumber(record.driftXPhaseOffset, 0),
    driftZPhaseOffset: normalizeNumber(record.driftZPhaseOffset, 0),
    driftWeight: normalizeNumber(record.driftWeight, DEFAULT_EVADER_DRIFT_WEIGHT),
    wallAvoidWeight: normalizeNumber(record.wallAvoidWeight, DEFAULT_EVADER_WALL_AVOID_WEIGHT),
    evadeChaserWhenVisible: normalizeBoolean(record.evadeChaserWhenVisible, true),
    evadeChaserWeight: normalizeNumber(record.evadeChaserWeight, 1.35),
    baselineWeightWhenEvading: normalizeNumber(
      record.baselineWeightWhenEvading,
      DEFAULT_EVADER_DRIFT_WEIGHT,
    ),
  };
}

function normalizeUnitsPerFrame(record, {
  frameKey,
  fallback,
  min,
  max,
}) {
  const frameValue = Number(record?.[frameKey]);
  if (Number.isFinite(frameValue)) {
    return clampNumber(frameValue, min, max);
  }

  return clampNumber(fallback, min, max);
}

function normalizeTurnRateRadiansPerFrame(record) {
  const degreesPerFrame = Number(record?.turnRateDegreesPerFrame);
  if (Number.isFinite(degreesPerFrame)) {
    return degreesToRadians(clampNumber(
      degreesPerFrame,
      10 / ASSUMED_GAME_FRAMES_PER_SECOND,
      720 / ASSUMED_GAME_FRAMES_PER_SECOND,
    ));
  }

  return DEFAULT_CAR_TURN_RATE_RADIANS_PER_FRAME;
}

function normalizeProjectionSpacingFrames(record) {
  const spacingFrames = Number(record?.sampleSpacingFrames);
  if (Number.isFinite(spacingFrames)) {
    return Math.round(clampNumber(spacingFrames, 1, MAX_EVADER_PROJECTION_SPACING_FRAMES));
  }

  return DEFAULT_EVADER_PROJECTION_SPACING_FRAMES;
}

function normalizeTraceSink(value) {
  return Object.values(CHASE_TRACE_SINKS).includes(value)
    ? value
    : CHASE_TRACE_SINKS.NONE;
}

function normalizeTraceConfig(value) {
  const record = asRecord(value) ?? {};
  return {
    enabled: normalizeBoolean(record.enabled, false),
    sink: normalizeTraceSink(record.sink),
    filePath: typeof record.filePath === "string" && record.filePath.trim()
      ? record.filePath.trim()
      : null,
    everyNFrames: Math.round(clampNumber(
      normalizeNumber(record.everyNFrames, 1),
      1,
      10_000,
    )),
  };
}

export function resolveChaseScenario(definition, { columns, rows } = {}) {
  const safeColumns = Number.isFinite(columns) && columns > 0 ? columns : 9;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 6;
  const root = asRecord(definition) ?? {};
  const actors = asRecord(root.actors) ?? {};
  const chaser = asRecord(actors.chaser) ?? {};
  const evader = asRecord(actors.evader) ?? {};
  const fallbackChaserPosition = { x: -safeColumns * 0.38, z: 0 };
  const fallbackEvaderPosition = { x: safeColumns / 4, z: 0 };
  const fallbackChaserDirection = { x: 1, z: 0 };
  const fallbackEvaderDirection = normalizeVector(-1, 0.4);
  const vehicleSettings = asRecord(root.vehicleSettings) ?? {};
  const projectionSettings = asRecord(root.projectionSettings) ?? {};
  const runtime = asRecord(root.runtime) ?? {};
  const simulation = asRecord(root.simulation) ?? {};
  const engines = asRecord(root.engines) ?? {};
  const policies = asRecord(root.policies) ?? {};

  return {
    id: typeof root.id === "string" && root.id.trim() ? root.id.trim() : "default",
    label: typeof root.label === "string" && root.label.trim() ? root.label.trim() : "Default Chase",
    description: typeof root.description === "string" && root.description.trim()
      ? root.description.trim()
      : "Baseline chase scenario.",
    map: resolveMapScenario(root.map, safeColumns, safeRows),
    actors: {
      chaser: {
        position: normalizePosition(chaser.position, fallbackChaserPosition),
        direction: normalizeDirection(chaser.direction, fallbackChaserDirection),
        patterns: normalizeStrategyMap(
          chaser.patterns,
          Object.values(CHASER_PATTERN_IDS),
        ),
        strategies: normalizeStrategyMap(
          chaser.strategies,
          Object.values(CHASER_STRATEGY_IDS),
        ),
      },
      evader: {
        position: normalizePosition(evader.position, fallbackEvaderPosition),
        direction: normalizeDirection(evader.direction, fallbackEvaderDirection),
        strategies: normalizeStrategyMap(
          evader.strategies,
          Object.values(EVADER_STRATEGY_IDS),
        ),
      },
    },
    vehicleSettings: {
      chaserSpeedUnitsPerFrame: normalizeUnitsPerFrame(vehicleSettings, {
        frameKey: "chaserSpeedUnitsPerFrame",
        fallback: DEFAULT_CHASER_SPEED_UNITS_PER_FRAME,
        min: 0.2 / ASSUMED_GAME_FRAMES_PER_SECOND,
        max: 12 / ASSUMED_GAME_FRAMES_PER_SECOND,
      }),
      evaderSpeedUnitsPerFrame: normalizeUnitsPerFrame(vehicleSettings, {
        frameKey: "evaderSpeedUnitsPerFrame",
        fallback: DEFAULT_EVADER_SPEED_UNITS_PER_FRAME,
        min: 0.2 / ASSUMED_GAME_FRAMES_PER_SECOND,
        max: 12 / ASSUMED_GAME_FRAMES_PER_SECOND,
      }),
      turnRateRadiansPerFrame: normalizeTurnRateRadiansPerFrame(vehicleSettings),
      fieldOfViewAngleRadians: degreesToRadians(clampNumber(
        normalizeNumber(
          vehicleSettings.fieldOfViewDegrees,
          DEFAULT_FIELD_OF_VIEW_ANGLE_RADIANS * 180 / Math.PI,
        ),
        20,
        140,
      )),
    },
    projectionSettings: {
      visible: normalizeBoolean(projectionSettings.visible, false),
      horizonFrames: Math.round(clampNumber(
        normalizeNumber(
          projectionSettings.horizonFrames,
          DEFAULT_EVADER_PROJECTION_HORIZON_FRAMES,
        ),
        1,
        MAX_EVADER_PROJECTION_HORIZON_FRAMES,
      )),
      sampleSpacingFrames: normalizeProjectionSpacingFrames(projectionSettings),
    },
    runtime: {
      programmaticChaserEnabled: normalizeBoolean(runtime.programmaticChaserEnabled, false),
    },
    simulation: {
      framesPerSecond: Math.round(clampNumber(
        normalizeNumber(simulation.framesPerSecond, ASSUMED_GAME_FRAMES_PER_SECOND),
        MIN_SIMULATION_FRAMES_PER_SECOND,
        MAX_SIMULATION_FRAMES_PER_SECOND,
      )),
    },
    trace: normalizeTraceConfig(root.trace),
    policies: {
      evader: normalizeEvaderPolicy(policies.evader),
    },
    engines: {
      knowledge: normalizeBooleanMap(engines.knowledge),
    },
  };
}
