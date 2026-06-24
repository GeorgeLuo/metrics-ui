import defaultScenarioDefinition from "./default.scenario.mjs";

const surfacePatchesScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "surface-patches",
  label: "Surface Patches",
  description: "Manual chaser setup with rotated floor patches that scale vehicle speed.",
  map: {
    layout: "surface-patches",
    obstacles: [],
    surfaces: [
      {
        id: "slow-blue-mat",
        x: -1.5,
        z: -0.2,
        width: 2.4,
        depth: 3.6,
        rotationDegrees: -18,
        speedMultiplier: 0.45,
        color: "#2563eb",
        opacity: 0.18,
      },
      {
        id: "fast-green-strip",
        x: 1.65,
        z: 0.45,
        width: 1.2,
        depth: 4,
        rotationDegrees: 12,
        speedMultiplier: 1.35,
        color: "#16a34a",
        opacity: 0.16,
      },
    ],
  },
  actors: {
    ...defaultScenarioDefinition.actors,
    chaser: {
      ...defaultScenarioDefinition.actors.chaser,
      position: { x: -3.4, z: -1.2 },
      direction: { x: 1, z: 0 },
    },
    evader: {
      exists: false,
    },
  },
  runtime: {
    ...defaultScenarioDefinition.runtime,
    chaserControlSource: "keyboard",
  },
};

export default surfacePatchesScenarioDefinition;
