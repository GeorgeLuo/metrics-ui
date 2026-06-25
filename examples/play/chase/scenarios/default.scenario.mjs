const defaultScenarioDefinition = {
  id: "default",
  label: "Default Chase",
  description: "Baseline chase setup with a central square obstacle, programmatic chaser control, and default movement parameters.",
  map: {
    layout: "center-square-default",
  },
  actors: {
    chaser: {
      position: { x: -3.42, z: 0 },
      direction: { x: 1, z: 0 },
      actionProposals: {
        evaderPredictionPursuit: true,
        lineOfSightPursuit: true,
        mapDiscovery: true,
        mapRecencyRefresh: true,
        spin: true,
      },
    },
    evader: {
      position: { x: 2.25, z: 0 },
      direction: { x: -1, z: 0.4 },
      actionProposals: {
        defaultRoam: true,
        evadeOnSight: true,
      },
    },
  },
  vehicleSettings: {
    chaserSpeedUnitsPerFrame: 0.03666666666666667,
    evaderSpeedUnitsPerFrame: 0.04666666666666667,
    maxSteeringAngleDegrees: 37,
    fieldOfViewDegrees: 60,
  },
  projectionSettings: {
    visible: false,
    horizonFrames: 120,
    sampleSpacingFrames: 20,
  },
  runtime: {
    programmaticChaserEnabled: true,
  },
  simulation: {
    framesPerSecond: 60,
    greentextDebugVisible: true,
    floorGridVisible: false,
  },
  trace: {
    enabled: false,
    sink: "none",
    everyNFrames: 1,
    filePath: null,
  },
  policies: {
    evader: {
      id: "baseline-drift-wall-avoid",
      driftXPhasePerFrame: 0.011666666666666667,
      driftZPhasePerFrame: 0.008333333333333333,
      driftWeight: 0.45,
      wallAvoidWeight: 2.5,
      evadeChaserWhenVisible: true,
      evadeChaserWeight: 1.35,
      baselineWeightWhenEvading: 0.45,
    },
  },
  engines: {
    knowledge: {
      evaderTracking: true,
      wallAvoidanceInference: true,
      predictionPlanning: true,
    },
  },
};

export default defaultScenarioDefinition;
