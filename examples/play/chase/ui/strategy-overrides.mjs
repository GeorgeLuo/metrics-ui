import { setChaserActionEngineEnabled } from "../actors/chaser/chaser-controller.mjs";
import { setEvaderStrategyEngineEnabled } from "../actors/evader/evader-decision-model.mjs";

export function getActorStrategyCollections(simulationState) {
  return {
    chaser: {
      ...(simulationState?.chaserIdae?.state?.controllerState?.actionEngines ?? {}),
    },
    evader: {
      ...(simulationState?.evaderIdae?.state?.engines ?? {}),
    },
  };
}

export function cloneActorStrategyCollections(collections = {}) {
  return Object.fromEntries(
    Object.entries(collections).map(([actorId, strategies]) => [
      actorId,
      { ...(strategies ?? {}) },
    ]),
  );
}

export function applyActorStrategyOverrides(simulationState, actorStrategyOverrides = {}) {
  Object.entries(actorStrategyOverrides.chaser ?? {}).forEach(([strategyId, enabled]) => {
    setChaserActionEngineEnabled(
      simulationState.chaserIdae?.state?.controllerState,
      strategyId,
      enabled,
    );
  });
  Object.entries(actorStrategyOverrides.evader ?? {}).forEach(([strategyId, enabled]) => {
    setEvaderStrategyEngineEnabled(
      simulationState.evaderIdae?.state,
      strategyId,
      enabled,
    );
  });
}

export function setActorStrategyOverride({
  simulationState,
  actorStrategyOverrides,
  actorId,
  strategyId,
  enabled,
}) {
  const nextOverrides = {
    ...actorStrategyOverrides,
    [actorId]: {
      ...(actorStrategyOverrides[actorId] ?? {}),
      [strategyId]: Boolean(enabled),
    },
  };
  applyActorStrategyOverrides(simulationState, nextOverrides);
  return nextOverrides;
}
