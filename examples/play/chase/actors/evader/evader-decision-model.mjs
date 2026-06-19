import {
  createActorLocationMemory,
  updateActorLocationMemory,
} from "../../decision-model/memory/actors/perceived-actor-location.ts";
import {
  createVehicleFrontViewCaptureMemory,
} from "../../decision-model/memory/vehicle/front-view-captures.ts";
import {
  buildActorSnapshot,
  createActorIdae,
  stepActorIdae,
} from "../../decision-model/core/actor-decision-model.ts";
import {
  createEvaderActionState,
  getEvaderActionSnapshot,
  planEvaderIdaeAction,
} from "../../decision-model/actions/evader/plan.mjs";
import { EVADER_ACTION_PROPOSAL_IDS } from "../../config/decision-ids.mjs";
import { observeEvaderWorld } from "../../perception/evader/observe.ts";

function asEnabled(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function createEvaderActionProposalEngines(overrides = {}) {
  return {
    [EVADER_ACTION_PROPOSAL_IDS.DEFAULT_ROAM]: asEnabled(
      overrides[EVADER_ACTION_PROPOSAL_IDS.DEFAULT_ROAM],
      true,
    ),
    [EVADER_ACTION_PROPOSAL_IDS.EVADE_ON_SIGHT]: asEnabled(
      overrides[EVADER_ACTION_PROPOSAL_IDS.EVADE_ON_SIGHT],
      true,
    ),
  };
}

export function setEvaderActionProposalEngineEnabled(evaderState, actionProposalId, enabled) {
  if (!evaderState?.engines || !(actionProposalId in evaderState.engines)) {
    return;
  }
  evaderState.engines[actionProposalId] = Boolean(enabled);
}

function createEvaderIdaeState({ scenario } = {}) {
  return {
    policy: { ...(scenario?.policies?.evader ?? {}) },
    selfState: null,
    memory: {
      directObservation: {
        chaserLocation: createActorLocationMemory(),
        frontViewCaptures: createVehicleFrontViewCaptureMemory(),
      },
      abstracted: {},
    },
    patterns: {},
    projections: {},
    controllerState: {},
    engines: createEvaderActionProposalEngines(scenario?.actors?.evader?.actionProposals),
    actionState: createEvaderActionState(),
  };
}

function observeEvaderEnvironment(state, frameContext = {}) {
  return observeEvaderWorld({
    evaderPosition: frameContext.evaderPosition,
    evaderDirection: frameContext.evaderDirection,
    chaserPosition: frameContext.chaserPosition,
    fieldOfViewAngleRadians: frameContext.fieldOfViewAngleRadians,
    obstacles: frameContext.obstacles,
    columns: frameContext.columns,
    rows: frameContext.rows,
    frameIndex: frameContext.frameIndex,
    maxSteeringAngleRadians: frameContext.maxSteeringAngleRadians,
    policy: state.policy,
  });
}

function deriveEvaderSelfState(_state, _frameContext, cycle) {
  const observation = cycle.observation;
  return observation
    ? {
      position: observation.position
        ? {
          x: Number(observation.position.x) || 0,
          z: Number(observation.position.z) || 0,
        }
        : null,
      direction: observation.direction
        ? {
          x: Number(observation.direction.x) || 0,
          z: Number(observation.direction.z) || 0,
        }
        : null,
      frameIndex: Number(observation.frameIndex) || 0,
    }
    : null;
}

const EVADER_MEMORY_MODULES = [
  {
    id: "chaserLocation",
    update: ({ state, cycle }) => {
      updateActorLocationMemory(
        state.memory.directObservation.chaserLocation,
        cycle.observation?.chaserPerception ?? { visible: false },
        cycle.observation?.position,
        cycle.observation?.direction,
      );
      return state.memory.directObservation.chaserLocation;
    },
  },
];

function chooseEvaderAction(state, _frameContext, cycle) {
  return planEvaderIdaeAction({
    actionState: state.actionState,
    engines: state.engines,
    policy: state.policy,
    memory: state.memory,
    observation: cycle?.observation,
  });
}

function getEvaderIdaeSnapshot(state) {
  const actionSnapshot = getEvaderActionSnapshot(state.actionState);
  return buildActorSnapshot(state, {
    selfState: state.selfState,
    memory: state.memory,
    patterns: {},
    projections: {},
    controllerState: state.controllerState,
    actionProposals: actionSnapshot.actionProposals,
    actionStatus: actionSnapshot.actionStatus,
  });
}

export function createEvaderIdae({ scenario } = {}) {
  return createActorIdae({
    id: "evader-idae",
    createState: () => createEvaderIdaeState({ scenario }),
    observe: observeEvaderEnvironment,
    deriveSelfState: deriveEvaderSelfState,
    memoryModules: EVADER_MEMORY_MODULES,
    patternModules: [],
    chooseAction: chooseEvaderAction,
    getSnapshot: getEvaderIdaeSnapshot,
  });
}

export function stepEvaderIdae(evaderIdae, frameContext = {}) {
  return stepActorIdae(evaderIdae, frameContext);
}
