const defaultScenarioDefinition = {
  id: "default",
  label: "Default Chase",
  description: "Baseline chase setup with a central square obstacle, manual chaser control, and default movement parameters.",
  map: {
    layout: "center-square-default",
  },
  actors: {
    chaser: {
      position: { x: -3.42, z: 0 },
      direction: { x: 1, z: 0 },
    },
    target: {
      position: { x: 2.25, z: 0 },
      direction: { x: -1, z: 0.4 },
    },
  },
  vehicleSettings: {
    chaserSpeedUnitsPerFrame: 0.03666666666666667,
    targetSpeedUnitsPerFrame: 0.04666666666666667,
    turnRateDegreesPerFrame: 3.45,
    fieldOfViewDegrees: 60,
  },
  projectionSettings: {
    visible: false,
    horizonFrames: 120,
    sampleSpacingFrames: 20,
  },
  runtime: {
    programmaticChaserEnabled: false,
  },
  simulation: {
    framesPerSecond: 60,
  },
  trace: {
    enabled: false,
    sink: "none",
    everyNFrames: 1,
    filePath: null,
  },
  policies: {
    target: {
      id: "baseline-drift-wall-avoid",
      driftXPhasePerFrame: 0.011666666666666667,
      driftZPhasePerFrame: 0.008333333333333333,
      driftWeight: 0.45,
      wallAvoidWeight: 2.5,
    },
  },
  engines: {
    knowledge: {
      perception: true,
      targetTracking: true,
      wallAvoidanceInference: true,
      predictionPlanning: true,
    },
    action: {
      projectionPursuit: true,
      visibleBearingFallback: true,
      search: true,
      localNavigation: true,
    },
  },
};

export default defaultScenarioDefinition;
