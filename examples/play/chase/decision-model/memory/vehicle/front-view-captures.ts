import type {
  MemoryFrameIndex,
  RetentionPolicy,
} from "../core/interfaces.ts";
import { normalizeMemoryFrameIndex } from "../core/temporal-record.ts";
import {
  applyRetentionPolicy,
  normalizeRetentionPolicy,
} from "../core/temporal-window.ts";
import type {
  ObservedActor,
  ObservedMap,
  VectorXZ,
} from "../../observer-world/interfaces.ts";

export const VEHICLE_FRONT_VIEW_CAPTURE_RENDERER_ID = "chase-front-view-v1";
export const VEHICLE_FRONT_VIEW_CAPTURE_CONTENT_TYPE = "image/svg+xml";
export const VEHICLE_FRONT_VIEW_CAPTURE_DEFAULT_MAX_ENTRIES = 120;

/** Pose and camera parameters for reconstructing one vehicle front-view image. */
export type VehicleFrontViewCapturePose = {
  position: VectorXZ;
  direction: VectorXZ;
  fieldOfViewAngleRadians: number;
};

/** Image-rendering metadata retained without storing generated image bytes. */
export type VehicleFrontViewCaptureImageMetadata = {
  rendererId: string;
  contentType: string;
  width?: number;
  height?: number;
};

/** Visible actor fact encoded into a front-view capture. */
export type VehicleFrontViewCapturedActor = ObservedActor & {
  actorId: string;
  position?: VectorXZ | null;
  direction?: VectorXZ | null;
  radius?: number | null;
};

/** One committed vehicle front-view capture. */
export type VehicleFrontViewCaptureRecord = {
  id: string;
  actorId: string;
  frameIndex: MemoryFrameIndex;
  pose: VehicleFrontViewCapturePose;
  map: ObservedMap;
  visibleActors: VehicleFrontViewCapturedActor[];
  image: VehicleFrontViewCaptureImageMetadata;
};

/** Bounded temporal memory of front-view captures for a vehicle actor. */
export type VehicleFrontViewCaptureMemory = {
  records: VehicleFrontViewCaptureRecord[];
  latest: VehicleFrontViewCaptureRecord | null;
  retentionPolicy: Required<RetentionPolicy>;
};

/**
 * Creates bounded memory for requested front-view captures.
 */
export function createVehicleFrontViewCaptureMemory(
  retentionPolicy: RetentionPolicy = {},
): VehicleFrontViewCaptureMemory {
  return {
    records: [],
    latest: null,
    retentionPolicy: normalizeRetentionPolicy({
      maxEntries: VEHICLE_FRONT_VIEW_CAPTURE_DEFAULT_MAX_ENTRIES,
      ...retentionPolicy,
    }),
  };
}

/**
 * Stores a committed front-view capture and applies the memory retention policy.
 */
export function recordVehicleFrontViewCapture(
  memory: VehicleFrontViewCaptureMemory | null | undefined,
  capture: VehicleFrontViewCaptureRecord | null | undefined,
): VehicleFrontViewCaptureRecord | null {
  if (!memory || !capture) {
    return null;
  }

  const frameIndex = normalizeMemoryFrameIndex(capture.frameIndex);
  memory.records = applyRetentionPolicy(
    [
      ...memory.records,
      {
        ...capture,
        frameIndex,
      },
    ],
    {
      currentFrameIndex: frameIndex,
      getFrameIndex: (entry) => entry.frameIndex,
      retentionPolicy: memory.retentionPolicy,
    },
  );
  memory.latest = memory.records.at(-1) ?? null;
  return memory.latest;
}

/**
 * Returns the most recently retained front-view capture.
 */
export function getLatestVehicleFrontViewCapture(
  memory: VehicleFrontViewCaptureMemory | null | undefined,
): VehicleFrontViewCaptureRecord | null {
  return memory?.latest ?? null;
}

export const VEHICLE_FRONT_VIEW_CAPTURE_RECORD_FIELDS = Object.freeze([
  "id",
  "actorId",
  "frameIndex",
  "pose",
  "map",
  "visibleActors",
  "image",
]);
