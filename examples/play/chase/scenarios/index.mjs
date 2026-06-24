import chaserEmptyMapScenarioDefinition from "./chaser-empty-map.scenario.mjs";
import defaultScenarioDefinition from "./default.scenario.mjs";
import largeOpenRoomScenarioDefinition from "./large-open-room.scenario.mjs";
import noEvaderScenarioDefinition from "./no-evader.scenario.mjs";
import openRoomScenarioDefinition from "./open-room.scenario.mjs";
import piracerRoomSketchScenarioDefinition from "./piracer-room-sketch.scenario.mjs";
import surfacePatchesScenarioDefinition from "./surface-patches.scenario.mjs";
import twoRoomsScenarioDefinition from "./two-rooms.scenario.mjs";

export const DEFAULT_CHASE_SCENARIO_ID = defaultScenarioDefinition.id;

export const CHASE_SCENARIO_DEFINITIONS = Object.freeze([
  defaultScenarioDefinition,
  openRoomScenarioDefinition,
  largeOpenRoomScenarioDefinition,
  chaserEmptyMapScenarioDefinition,
  noEvaderScenarioDefinition,
  surfacePatchesScenarioDefinition,
  twoRoomsScenarioDefinition,
  piracerRoomSketchScenarioDefinition,
]);

export function getChaseScenarioDefinition(scenarioId = DEFAULT_CHASE_SCENARIO_ID) {
  return CHASE_SCENARIO_DEFINITIONS.find((definition) => definition?.id === scenarioId)
    ?? defaultScenarioDefinition;
}

export function getChaseScenarioOptions() {
  return CHASE_SCENARIO_DEFINITIONS.map((definition) => ({
    value: definition.id,
    label: definition.label ?? definition.id,
    description: definition.description ?? null,
  }));
}
