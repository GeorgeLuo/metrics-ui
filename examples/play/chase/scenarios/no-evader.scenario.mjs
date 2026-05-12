import defaultScenarioDefinition from "./default.scenario.mjs";

const noEvaderScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "no-evader",
  label: "No Evader",
  description: "Chaser-only setup for validating search and no-target reasoning without hiding an evader through runtime debug code.",
  actors: {
    ...defaultScenarioDefinition.actors,
    chaser: {
      ...defaultScenarioDefinition.actors.chaser,
    },
    evader: {
      exists: false,
    },
  },
  runtime: {
    ...defaultScenarioDefinition.runtime,
    programmaticChaserEnabled: true,
  },
};

export default noEvaderScenarioDefinition;
