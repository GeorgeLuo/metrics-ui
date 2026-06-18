import { CAR_BOUND_RADIUS } from "../../config/constants.mjs";
import type {
  ObservedActor,
  ObstacleSet,
  VectorXZ,
} from "../../decision-model/observer-world/interfaces.ts";
import {
  VEHICLE_FRONT_VIEW_CAPTURE_CONTENT_TYPE,
  VEHICLE_FRONT_VIEW_CAPTURE_RENDERER_ID,
  type VehicleFrontViewCapturedActor,
  type VehicleFrontViewCaptureRecord,
} from "../../decision-model/memory/vehicle/front-view-captures.ts";
import { getObservedActor } from "../core/actor-visibility.ts";
import { getObservedMap } from "../core/map-visibility.ts";

export type VehicleFrontViewCaptureSubject = {
  actorId: string;
  position?: VectorXZ | null;
  direction?: VectorXZ | null;
  radius?: number | null;
};

export type CreateVehicleFrontViewCaptureRecordOptions = {
  actorId: string;
  frameIndex?: number | null;
  actorPosition?: VectorXZ | null;
  actorDirection?: VectorXZ | null;
  fieldOfViewAngleRadians: number;
  obstacles?: ObstacleSet | null;
  columns?: number;
  rows?: number;
  visibleActors?: VehicleFrontViewCaptureSubject[];
  rendererId?: string;
};

function cloneVector(vector: VectorXZ | null | undefined): VectorXZ | null {
  return vector
    ? {
      x: Number(vector.x) || 0,
      z: Number(vector.z) || 0,
    }
    : null;
}

function normalizeFrameIndex(frameIndex: unknown): number | null {
  return Number.isFinite(frameIndex) ? Number(frameIndex) : null;
}

function buildCapturedActor({
  actorPosition,
  actorDirection,
  fieldOfViewAngleRadians,
  obstacles,
  subject,
}: {
  actorPosition: VectorXZ;
  actorDirection: VectorXZ;
  fieldOfViewAngleRadians: number;
  obstacles?: ObstacleSet | null;
  subject: VehicleFrontViewCaptureSubject;
}): VehicleFrontViewCapturedActor | null {
  const perception: ObservedActor = getObservedActor(
    actorPosition,
    subject.position,
    actorDirection,
    fieldOfViewAngleRadians,
    obstacles,
  );
  if (!perception.visible) {
    return null;
  }

  return {
    actorId: subject.actorId,
    visible: true,
    bearingRadians: perception.bearingRadians,
    distance: perception.distance,
    position: cloneVector(subject.position),
    direction: cloneVector(subject.direction),
    radius: Number.isFinite(subject.radius)
      ? Number(subject.radius)
      : CAR_BOUND_RADIUS,
  };
}

/**
 * Creates a compact front-view capture from simulator state.
 *
 * The record stores observed facts plus camera pose, so image generation can be
 * deferred without granting memory access to unseen world geometry.
 */
export function createVehicleFrontViewCaptureRecord({
  actorId,
  frameIndex = null,
  actorPosition,
  actorDirection,
  fieldOfViewAngleRadians,
  obstacles = null,
  columns,
  rows,
  visibleActors = [],
  rendererId = VEHICLE_FRONT_VIEW_CAPTURE_RENDERER_ID,
}: CreateVehicleFrontViewCaptureRecordOptions): VehicleFrontViewCaptureRecord | null {
  const position = cloneVector(actorPosition);
  const direction = cloneVector(actorDirection);
  if (!actorId || !position || !direction) {
    return null;
  }

  const normalizedFrameIndex = normalizeFrameIndex(frameIndex);
  const observedMap = getObservedMap(
    position,
    direction,
    fieldOfViewAngleRadians,
    obstacles,
    { columns, rows },
  );
  const capturedActors = visibleActors
    .map((subject) => buildCapturedActor({
      actorPosition: position,
      actorDirection: direction,
      fieldOfViewAngleRadians,
      obstacles,
      subject,
    }))
    .filter((subject): subject is VehicleFrontViewCapturedActor => Boolean(subject));

  return {
    id: `${actorId}:front-view:${normalizedFrameIndex ?? "unknown"}`,
    actorId,
    frameIndex: normalizedFrameIndex,
    pose: {
      position,
      direction,
      fieldOfViewAngleRadians,
    },
    map: observedMap,
    visibleActors: capturedActors,
    image: {
      rendererId,
      contentType: VEHICLE_FRONT_VIEW_CAPTURE_CONTENT_TYPE,
    },
  };
}
