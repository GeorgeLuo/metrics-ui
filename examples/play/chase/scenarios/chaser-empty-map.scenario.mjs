import defaultScenarioDefinition from "./default.scenario.mjs";

const CHASER_START_Z = 1.5;
const FRONT_OBSTACLE_Z = -0.35;
const FRONT_OBSTACLE_WIDTH = 1.4;
const FRONT_OBSTACLE_DEPTH = 0.7;

const chaserEmptyMapScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "chaser-empty-map",
  label: "Chaser Front Obstacle",
  description: "Single-chaser setup with no evader and a rectangular obstacle directly ahead of the vehicle.",
  map: {
    layout: "chaser-front-obstacle",
    obstacles: [
      {
        id: "front-rectangle",
        x: 0,
        z: FRONT_OBSTACLE_Z,
        width: FRONT_OBSTACLE_WIDTH,
        depth: FRONT_OBSTACLE_DEPTH,
      },
    ],
  },
  actors: {
    ...defaultScenarioDefinition.actors,
    chaser: {
      ...defaultScenarioDefinition.actors.chaser,
      position: { x: 0, z: CHASER_START_Z },
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
