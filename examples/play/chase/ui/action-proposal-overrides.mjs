import { setChaserActionEngineEnabled } from "../actors/chaser/chaser-controller.mjs";
import { setEvaderActionProposalEngineEnabled } from "../actors/evader/evader-decision-model.mjs";

export function getActorActionProposalCollections(simulationState) {
  return {
    chaser: {
      ...(simulationState?.chaserIdae?.state?.controllerState?.actionEngines ?? {}),
    },
    evader: {
      ...(simulationState?.evaderIdae?.state?.engines ?? {}),
    },
  };
}

export function cloneActorActionProposalCollections(collections = {}) {
  return Object.fromEntries(
    Object.entries(collections).map(([actorId, actionProposals]) => [
      actorId,
      { ...(actionProposals ?? {}) },
    ]),
  );
}

export function applyActorActionProposalOverrides(simulationState, actorActionProposalOverrides = {}) {
  Object.entries(actorActionProposalOverrides.chaser ?? {}).forEach(([actionProposalId, enabled]) => {
    setChaserActionEngineEnabled(
      simulationState.chaserIdae?.state?.controllerState,
      actionProposalId,
      enabled,
    );
  });
  Object.entries(actorActionProposalOverrides.evader ?? {}).forEach(([actionProposalId, enabled]) => {
    setEvaderActionProposalEngineEnabled(
      simulationState.evaderIdae?.state,
      actionProposalId,
      enabled,
    );
  });
}

export function setActorActionProposalOverride({
  simulationState,
  actorActionProposalOverrides,
  actorId,
  actionProposalId,
  enabled,
}) {
  const nextOverrides = {
    ...actorActionProposalOverrides,
    [actorId]: {
      ...(actorActionProposalOverrides[actorId] ?? {}),
      [actionProposalId]: Boolean(enabled),
    },
  };
  applyActorActionProposalOverrides(simulationState, nextOverrides);
  return nextOverrides;
}
