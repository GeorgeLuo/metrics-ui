import defaultScenarioDefinition from "./default.scenario.mjs";
import { createRoomBoundaryWalls } from "./room-boundary-walls.mjs";

const ROOM_COLUMNS = 9;
const ROOM_ROWS = 8;

const chaserDepthObstaclesScenarioDefinition = {
  ...defaultScenarioDefinition,
  id: "chaser-depth-obstacles",
  label: "Chaser Depth Obstacles",
  description: "Chaser-only view scene with near, middle, and far obstacles at different configured heights.",
  map: {
    layout: "chaser-depth-obstacles",
    columns: ROOM_COLUMNS,
    rows: ROOM_ROWS,
    obstacles: [
      ...createRoomBoundaryWalls(ROOM_COLUMNS, ROOM_ROWS),
      {
        id: "near-short-block",
        x: -0.75,
        z: 1.8,
        width: 0.8,
        depth: 0.45,
        height: 0.28,
        rotationDegrees: -10,
      },
      {
        id: "middle-medium-block",
        x: 0.15,
        z: 0.1,
        width: 1.05,
        depth: 0.55,
        height: 0.68,
        rotationDegrees: 7,
      },
      {
        id: "far-tall-block",
        x: 1.1,
        z: -2.2,
        width: 1.25,
        depth: 0.65,
        height: 1.12,
        rotationDegrees: 14,
      },
    ],
  },
  actors: {
    ...defaultScenarioDefinition.actors,
    chaser: {
      ...defaultScenarioDefinition.actors.chaser,
      position: { x: 0, z: 3.05 },
      direction: { x: 0, z: -1 },
      actionProposals: {
        ...defaultScenarioDefinition.actors.chaser.actionProposals,
        evaderPredictionPursuit: false,
        lineOfSightPursuit: false,
        mapDiscovery: true,
        mapRecencyRefresh: true,
        spin: true,
      },
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
  vehicleSettings: {
    ...defaultScenarioDefinition.vehicleSettings,
    fieldOfViewDegrees: 90,
  },
};

export default chaserDepthObstaclesScenarioDefinition;
