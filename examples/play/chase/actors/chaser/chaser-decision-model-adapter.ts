import {
  createChaserAutopilotState,
  getProgrammaticChaserInput,
  setChaserActionEngineEnabled,
  type ChaserAutopilotState,
} from "./chaser-controller.ts";
import {
  createChaserKnowledgeBase,
  getChaserKnowledgeSnapshot,
  observeChaserEnvironment,
  setChaserKnowledgeEngineEnabled,
  updateChaserMemoryStage,
  updateChaserPatternStage,
  updateChaserProjectionStage,
  updateChaserSuccessMetricsStage,
} from "./knowledge/index.ts";
import {
  buildActorSnapshot,
  createActorIdae,
  stepActorIdae,
  type ActorDecisionCycle,
  type ActorDecisionEngine,
  type ActorFrameworkState,
  type ActorModule,
} from "../../decision-model/core/actor-decision-model.ts";
import type { ProgrammaticChaserAction } from "../../decision-model/actions/chaser/interfaces.ts";
import type { VehicleFrontViewCaptureAction } from "../../decision-model/actions/vehicle/interfaces.ts";
import type { VectorXZ } from "../../decision-model/core/math.ts";

type ToggleMap = Record<string, boolean | undefined>;
type RuntimeRecord = Record<string, any>;

type HumanInput = {
  forward?: boolean;
  reverse?: boolean;
  steering?: number;
  captureFrontView?: boolean;
  frontViewCapture?: VehicleFrontViewCaptureAction | null;
};

type HumanChaserAction = {
  source: "human";
  forward: boolean;
  reverse: boolean;
  steering: number;
  frontViewCapture: VehicleFrontViewCaptureAction | null;
};

type IdaeChaserAction = ProgrammaticChaserAction & {
  source: "idae";
};

type ChaserAction = HumanChaserAction | IdaeChaserAction;

type ChaseScenario = {
  actors?: {
    chaser?: {
      actionProposals?: ToggleMap;
      patterns?: ToggleMap;
    };
    evader?: {
      exists?: boolean;
      direction?: VectorXZ | null;
    };
  };
  engines?: {
    knowledge?: ToggleMap;
  };
};

type ChaserFrameContext = RuntimeRecord & {
  chaserPosition?: VectorXZ | null;
  evaderPosition?: VectorXZ | null;
  chaserLookDirection?: VectorXZ | null;
  evaderExists?: boolean;
  frameIndex?: number | null;
  fieldOfViewAngleRadians?: number;
  obstacles?: unknown;
  columns?: number;
  rows?: number;
  projectionSettings?: RuntimeRecord;
  humanInput?: HumanInput | null;
  programmaticChaserEnabled?: boolean;
  chaserSpeedUnitsPerFrame?: number;
  turnRateRadiansPerFrame?: number;
};

type ChaserSelfState = {
  position: VectorXZ | null;
  direction: VectorXZ | null;
  frameIndex: number | null;
};

type ChaserActorState = ActorFrameworkState & RuntimeRecord & {
  controllerState: ChaserAutopilotState;
  evaderExists?: boolean;
};

type CreateChaserIdaeOptions = {
  scenario?: ChaseScenario | null;
};

type ChaserSuccessOutcomeContext = {
  chaserPosition?: VectorXZ | null;
  evaderPosition?: VectorXZ | null;
  evaderExists?: boolean;
  frameIndex?: number | null;
};

/**
 * Applies scenario-configured chaser toggles to a freshly created actor state.
 *
 * Knowledge engines live on the IDAE state, while action proposal toggles live
 * on the controller state that feeds the action planner.
 */
function applyScenarioEngineToggles(
  scenario: ChaseScenario | null | undefined,
  actorState: ChaserActorState,
): void {
  Object.entries(scenario?.engines?.knowledge ?? {}).forEach(([engineId, enabled]) => {
    setChaserKnowledgeEngineEnabled(actorState, engineId, enabled);
  });
  Object.entries(scenario?.actors?.chaser?.actionProposals ?? {}).forEach(([engineId, enabled]) => {
    setChaserActionEngineEnabled(actorState.controllerState, engineId, enabled);
  });
}

/**
 * Normalizes direct human input into the same action slot used by IDAE output.
 */
function normalizeHumanAction(humanInput: HumanInput | null | undefined): HumanChaserAction {
  const requestedCapture = humanInput?.frontViewCapture?.requested
    ? humanInput.frontViewCapture
    : humanInput?.captureFrontView
      ? { requested: true }
      : null;
  return {
    source: "human",
    forward: Boolean(humanInput?.forward),
    reverse: Boolean(humanInput?.reverse),
    steering: Number.isFinite(humanInput?.steering) ? Number(humanInput?.steering) : 0,
    frontViewCapture: requestedCapture,
  };
}

/**
 * Creates the complete chaser actor state for the generic actor decision model.
 *
 * `createChaserKnowledgeBase` owns memory, patterns, projections, and knowledge
 * engines. This adapter adds controller state and scenario action toggles.
 */
function createChaserIdaeState({ scenario }: CreateChaserIdaeOptions = {}): ChaserActorState {
  const evaderExists = scenario?.actors?.evader?.exists !== false;
  const actorState = {
    ...createChaserKnowledgeBase({
      evaderDirection: evaderExists ? scenario?.actors?.evader?.direction : null,
      engines: scenario?.engines?.knowledge,
      patterns: scenario?.actors?.chaser?.patterns,
    }),
    policy: {},
    selfState: null,
    controllerState: createChaserAutopilotState(),
  } as ChaserActorState;
  applyScenarioEngineToggles(scenario, actorState);
  return actorState;
}

/**
 * Converts simulator frame context into the chaser's observed-world payload.
 */
function observeChaserIdae(
  state: ChaserActorState,
  frameContext: ChaserFrameContext,
): ReturnType<typeof observeChaserEnvironment> {
  return observeChaserEnvironment(state, frameContext);
}

/**
 * Stores the chaser's own pose in the generic actor self-state slot.
 */
function deriveChaserSelfState(
  _state: ChaserActorState,
  frameContext: ChaserFrameContext = {},
): ChaserSelfState {
  return {
    position: frameContext.chaserPosition
      ? {
        x: Number(frameContext.chaserPosition.x) || 0,
        z: Number(frameContext.chaserPosition.z) || 0,
      }
      : null,
    direction: frameContext.chaserLookDirection
      ? {
        x: Number(frameContext.chaserLookDirection.x) || 0,
        z: Number(frameContext.chaserLookDirection.z) || 0,
      }
      : null,
    frameIndex: Number.isFinite(frameContext.frameIndex)
      ? Number(frameContext.frameIndex)
      : null,
  };
}

/**
 * Returns remembered obstacle geometry for action planning.
 *
 * Action proposals intentionally use the chaser's learned map, not simulator
 * obstacle truth, so this selector reads from the latest knowledge snapshot.
 */
function getRememberedObstaclesFromSnapshot(
  snapshot: RuntimeRecord | null | undefined,
): RuntimeRecord {
  return snapshot?.memory?.abstracted?.mapShape?.obstacles ?? { walls: [] };
}

/**
 * Memory-stage module list passed to the generic actor decision wrapper.
 */
const CHASER_MEMORY_MODULES: ActorModule<ChaserActorState>[] = [
  {
    id: "observationMemory",
    update: ({ state, frameContext, cycle }) => {
      const context = frameContext as ChaserFrameContext;
      return updateChaserMemoryStage(state, {
        perception: cycle.observation as RuntimeRecord | null,
        chaserPosition: context.chaserPosition,
        chaserLookDirection: context.chaserLookDirection,
        frameIndex: context.frameIndex,
      });
    },
  },
];

/**
 * Pattern-stage module list passed to the generic actor decision wrapper.
 */
const CHASER_PATTERN_MODULES: ActorModule<ChaserActorState>[] = [
  {
    id: "patternInference",
    update: ({ state, frameContext }) => {
      const context = frameContext as ChaserFrameContext;
      return updateChaserPatternStage(state, {
        evaderExists: context.evaderExists !== false,
        columns: context.columns,
        rows: context.rows,
        projectionSettings: context.projectionSettings,
      });
    },
  },
];

/**
 * Projection-stage module list passed to the generic actor decision wrapper.
 */
const CHASER_PROJECTION_MODULES: ActorModule<ChaserActorState>[] = [
  {
    id: "evaderMotion",
    update: ({ state, frameContext, cycle }) => {
      const context = frameContext as ChaserFrameContext;
      const patternInference = (cycle.patterns?.patternInference ?? {}) as RuntimeRecord;
      return updateChaserProjectionStage(state, {
        evaderExists: context.evaderExists !== false,
        columns: context.columns,
        rows: context.rows,
        projectionSettings: context.projectionSettings,
        evaderMotionModel: patternInference.evaderMotionModel,
        patternUnits: patternInference.patternUnits,
      });
    },
  },
];

/**
 * Chooses the chaser action for the current IDAE cycle.
 *
 * Manual control bypasses action proposal planning. Programmatic control builds
 * a knowledge snapshot and delegates proposal construction, mixing, and vehicle
 * control selection to the chaser controller.
 */
function chooseChaserIdaeAction(
  state: ChaserActorState,
  frameContext: ChaserFrameContext,
): ChaserAction {
  if (!frameContext.programmaticChaserEnabled) {
    return normalizeHumanAction(frameContext.humanInput);
  }

  const snapshot = getChaserKnowledgeSnapshot(state);
  return {
    ...getProgrammaticChaserInput({
      snapshot,
      chaserPosition: frameContext.chaserPosition,
      chaserLookDirection: frameContext.chaserLookDirection,
      autopilotState: state.controllerState,
      chaserSpeedUnitsPerFrame: frameContext.chaserSpeedUnitsPerFrame,
      turnRateRadiansPerFrame: frameContext.turnRateRadiansPerFrame,
      frameIndex: frameContext.frameIndex,
      columns: frameContext.columns,
      rows: frameContext.rows,
      obstacles: getRememberedObstaclesFromSnapshot(snapshot),
    }),
    source: "idae",
  };
}

/**
 * Builds the debug/test snapshot exposed by the chaser IDAE cycle.
 */
function getChaserIdaeSnapshot(state: ChaserActorState): RuntimeRecord {
  const snapshot = getChaserKnowledgeSnapshot(state);
  return buildActorSnapshot(state, {
    memory: snapshot.memory,
    patterns: snapshot.patterns,
    projections: snapshot.projections,
    patternUnits: snapshot.patternUnits,
    patternStatus: snapshot.patternStatus,
    projectionStatus: snapshot.projectionStatus,
    assumedBehavior: snapshot.assumedBehavior,
    controllerState: {
      spinSteering: Number(state.controllerState?.spinSteering) || 0,
      lastPursuitSource: state.controllerState?.lastPursuitSource ?? "spin",
      wallFollowSign: Number(state.controllerState?.wallFollowSign) || 0,
      actionEngines: { ...(state.controllerState?.actionEngines ?? {}) },
    },
  });
}

/**
 * Creates the chaser IDAE engine used by the simulation harness.
 *
 * This is the high-level access point from `simulation/simulation.mjs` into the
 * chaser decision model. It wires chaser-specific observation, stage modules,
 * action selection, and snapshot projection into the generic actor engine.
 */
export function createChaserIdae({
  scenario,
}: CreateChaserIdaeOptions = {}): ActorDecisionEngine<ChaserActorState> {
  return createActorIdae<ChaserActorState>({
    id: "chaser-idae",
    createState: () => createChaserIdaeState({ scenario }),
    observe: observeChaserIdae,
    deriveSelfState: deriveChaserSelfState,
    memoryModules: CHASER_MEMORY_MODULES,
    patternModules: CHASER_PATTERN_MODULES,
    projectionModules: CHASER_PROJECTION_MODULES,
    chooseAction: chooseChaserIdaeAction,
    getSnapshot: getChaserIdaeSnapshot,
  });
}

/**
 * Advances the chaser IDAE model by one synchronized simulation frame context.
 */
export function stepChaserIdae(
  chaserIdae: ActorDecisionEngine<ChaserActorState>,
  frameContext: ChaserFrameContext = {},
): ActorDecisionCycle | null {
  return stepActorIdae(chaserIdae, frameContext);
}

/**
 * Records committed post-action outcome metrics into chaser memory.
 *
 * This is called after the simulation applies vehicle actions, so the memory
 * entry describes the realized frame outcome rather than a predicted one.
 */
export function recordChaserSuccessMetrics(
  chaserIdae: ActorDecisionEngine<ChaserActorState> | null | undefined,
  outcomeContext: ChaserSuccessOutcomeContext = {},
): ReturnType<typeof updateChaserSuccessMetricsStage> {
  return updateChaserSuccessMetricsStage(chaserIdae?.state, outcomeContext);
}
