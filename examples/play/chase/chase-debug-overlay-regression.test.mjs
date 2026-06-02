import test from "node:test";
import assert from "node:assert/strict";
import { buildGreentextDebugText } from "./ui/greentext-debug-overlay.mjs";

test("greentext debug overlay shows prediction confidence and threshold success rates", () => {
  const text = buildGreentextDebugText({
    frameIndex: 42,
    lastStep: {
      chaserReasoning: {
        snapshot: {
          projections: {
            evaderMotion: {
              prediction: {
                consensus: 0.625,
              },
            },
          },
        },
      },
      chaserAction: {
        actionProposals: {
          motiveSignal: { id: "knowledgeAcquisition" },
          evaderPredictionPursuit: {
            active: false,
            confidence: 0,
          },
        },
      },
    },
    predictionPerformance: {
      schemaVersion: 1,
      pending: [],
      validatedCount: 4,
      droppedPendingCount: 0,
      options: {
        positionErrorThreshold: 0.5,
        recentWindowSize: 128,
        successRateThresholds: [1],
      },
      statsByKey: {
        __overall__: {
          targetId: "all",
          producerId: "all",
          sourceId: "all",
          frameOffset: "all",
          count: 4,
          successCount: 3,
          directionCount: 0,
          meanPositionError: 0.25,
          meanDirectionErrorRadians: 0,
          meanConfidence: 0.625,
          recentPositionErrors: [0.2, 0.3],
          recentDirectionErrorsRadians: [],
          latest: null,
        },
      },
      calibrationBuckets: {},
      thresholdSuccessStats: {
        "1": { threshold: 1, count: 4, successCount: 4 },
      },
      thresholdSuccessStatsByFrameOffset: {
        "1|20": { threshold: 1, frameOffset: 20, count: 2, successCount: 2 },
        "1|40": { threshold: 1, frameOffset: 40, count: 2, successCount: 1 },
      },
      recentValidations: [],
    },
  });

  assert.deepEqual(text.split("\n"), [
    "frame: 42",
    "chaser motive: knowledgeAcquisition",
    "prediction confidence: 0.63",
    "prediction successRate@1.0: 1.00",
    "prediction successRate@1.0/+20: 1.00",
    "prediction successRate@1.0/+40: 0.50",
  ]);
});
