import defaultScenarioDefinition from "./default.scenario.mjs";

const chaserEmptyMapScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "chaser-empty-map",
  label: "Chaser Empty Map",
  description: "Single-chaser setup in an empty room with no evader and no interior obstacles.",
  map: {
    layout: "chaser-empty-map",
    obstacles: [],
  },
  actors: {
    ...defaultScenarioDefinition.actors,
    chaser: {
      ...defaultScenarioDefinition.actors.chaser,
      position: { x: 0, z: 0 },
      direction: { x: 0, z: -1 },
    },
    evader: {
      exists: false,
    },
  },
  runtime: {
    ...defaultScenarioDefinition.runtime,
    chaserControlSource: "keyboard",
    programmaticChaserEnabled: false,
  },
};

export default chaserEmptyMapScenarioDefinition;
