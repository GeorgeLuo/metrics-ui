import defaultScenarioDefinition from "./default.scenario.mjs";

export default {
  baseScenarioDefinition: defaultScenarioDefinition,
  columns: 9,
  rows: 6,
  totalFrames: 80_000,
  warmupFrames: 8_000,
  combinations: [
    {
      id: "baseline",
      label: "All default action proposals enabled",
    },
    {
      id: "evader-no-evade-on-sight",
      label: "Evader evade-on-sight disabled",
      evaderActionProposals: {
        evadeOnSight: false,
      },
    },
    {
      id: "chaser-no-evader-prediction-pursuit",
      label: "Chaser evader projection pursuit disabled",
      chaserActionProposals: {
        evaderPredictionPursuit: false,
      },
    },
    {
      id: "prediction-pursuit-off_evade-off",
      label: "Chaser evader projection pursuit off and evader evade-on-sight off",
      chaserActionProposals: {
        evaderPredictionPursuit: false,
      },
      evaderActionProposals: {
        evadeOnSight: false,
      },
    },
  ],
};
