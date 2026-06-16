import { resolveChaseScenario } from "../simulation/scenario.mjs";
import {
  DEFAULT_CHASE_SCENARIO_ID,
  getChaseScenarioDefinition,
  getChaseScenarioOptions,
} from "../scenarios/index.mjs";

export function createScenarioDefinitionWithEvaderOverride(scenarioDefinition, evaderExists) {
  const nextDefinition = structuredClone(scenarioDefinition);
  nextDefinition.actors = {
    ...(nextDefinition.actors ?? {}),
    evader: {
      ...(nextDefinition.actors?.evader ?? {}),
      exists: Boolean(evaderExists),
    },
  };
  return nextDefinition;
}

function getScenarioEvaderExists(scenarioDefinition, dimensions) {
  return resolveChaseScenario(scenarioDefinition, dimensions).actors.evader.exists !== false;
}

function createViewportSpec(scenario) {
  const columns = Number(scenario?.map?.columns);
  const rows = Number(scenario?.map?.rows);
  if (!Number.isFinite(columns) || !Number.isFinite(rows) || columns <= 0 || rows <= 0) {
    return null;
  }
  return {
    frameAspect: [columns, rows],
  };
}

export function createChaseScenarioSession({ columns, rows } = {}) {
  const dimensions = { columns, rows };
  const scenarioOptions = getChaseScenarioOptions();
  let activeScenarioId = DEFAULT_CHASE_SCENARIO_ID;
  let activeScenarioDefinition = getChaseScenarioDefinition(activeScenarioId);
  let evaderExistsOverride = getScenarioEvaderExists(activeScenarioDefinition, dimensions);

  const buildScenario = () => resolveChaseScenario(
    createScenarioDefinitionWithEvaderOverride(activeScenarioDefinition, evaderExistsOverride),
    dimensions,
  );

  const loadScenario = (scenarioId) => {
    activeScenarioDefinition = getChaseScenarioDefinition(scenarioId);
    activeScenarioId = activeScenarioDefinition.id ?? DEFAULT_CHASE_SCENARIO_ID;
    evaderExistsOverride = getScenarioEvaderExists(activeScenarioDefinition, dimensions);
    return buildScenario();
  };

  const setEvaderExists = (evaderExists) => {
    evaderExistsOverride = Boolean(evaderExists);
    return buildScenario();
  };

  return {
    buildScenario,
    loadScenario,
    setEvaderExists,
    getSidebarControls(simulationState) {
      return {
        activeScenarioId,
        options: scenarioOptions,
        evaderExists: simulationState?.evaderExists !== false,
      };
    },
    getViewportSpec: createViewportSpec,
  };
}
