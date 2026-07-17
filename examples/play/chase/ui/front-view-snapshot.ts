import {
  createVehicleFrontViewCaptureRecord,
} from "../perception/vehicle/front-view-capture.ts";
import {
  renderVehicleFrontViewCaptureSvg,
} from "./rendering/front-view-capture-svg.ts";
import { CAR_BOUND_RADIUS } from "../config/constants.mjs";
import type {
  VehicleFrontViewCaptureRecord,
} from "../decision-model/memory/vehicle/front-view-captures.ts";
import {
  SIMULATION_RENDERING_PROFILE,
} from "../rendering/profiles.ts";
import type { ChaseRenderingProfile } from "../rendering/profile-contract.ts";
import {
  resolveChaseCamera,
  type ResolvedChaseCamera,
} from "../rendering/camera.ts";

type ActorId = "chaser" | "evader";
type RuntimeRecord = Record<string, any>;

export type ManualFrontViewSnapshotOptions = {
  actorId?: ActorId | string;
  width?: number;
  height?: number;
  renderedImage?: ManualFrontViewSnapshotImage | null;
};

export type ManualFrontViewSnapshotImage = {
  contentType: string;
  rendererId: string;
  width: number;
  height: number;
  svg?: string;
  dataUrl?: string;
};

export type ManualFrontViewSnapshot = {
  gameId: "chase";
  snapshotType: "manual-front-view";
  actorId: ActorId;
  frameIndex: number | null;
  renderingProfile: ChaseRenderingProfile;
  camera: ResolvedChaseCamera;
  referenceable: false;
  persistence: {
    storedInActorMemory: false;
    memoryPath: null;
  };
  record: VehicleFrontViewCaptureRecord;
  image: ManualFrontViewSnapshotImage;
};

function normalizeActorId(actorId: unknown): ActorId {
  return actorId === "evader" ? "evader" : "chaser";
}

function normalizeImageSize(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.round(numericValue)
    : fallback;
}

function normalizeRenderedImage(
  value: ManualFrontViewSnapshotImage | null | undefined,
  { width: fallbackWidth, height: fallbackHeight }: Readonly<{ width: number; height: number }>,
): ManualFrontViewSnapshotImage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const width = normalizeImageSize(value.width, fallbackWidth);
  const height = normalizeImageSize(value.height, fallbackHeight);
  return {
    contentType: typeof value.contentType === "string" && value.contentType
      ? value.contentType
      : "image/png",
    rendererId: typeof value.rendererId === "string" && value.rendererId
      ? value.rendererId
      : "unknown-renderer",
    width,
    height,
    ...(typeof value.svg === "string" ? { svg: value.svg } : {}),
    ...(typeof value.dataUrl === "string" ? { dataUrl: value.dataUrl } : {}),
  };
}

function getActorPose(state: RuntimeRecord, actorId: ActorId) {
  return actorId === "evader"
    ? {
      position: state.evaderPosition,
      direction: state.evaderDirection,
    }
    : {
      position: state.chaserPosition,
      direction: state.chaserLookDirection,
    };
}

function getVisibleSubjects(state: RuntimeRecord, actorId: ActorId) {
  if (actorId === "chaser") {
    return state.evaderExists === false
      ? []
      : [
        {
          actorId: "evader",
          position: state.evaderPosition,
          direction: state.evaderDirection,
          radius: CAR_BOUND_RADIUS,
        },
      ];
  }

  return [
    {
      actorId: "chaser",
      position: state.chaserPosition,
      direction: state.chaserLookDirection,
      radius: CAR_BOUND_RADIUS,
    },
  ];
}

/**
 * Builds a manual front-view snapshot without recording it into actor memory.
 */
export function buildManualFrontViewSnapshot(
  simulationState: RuntimeRecord,
  options: ManualFrontViewSnapshotOptions = {},
): ManualFrontViewSnapshot {
  const actorId = normalizeActorId(options.actorId);
  if (actorId === "evader" && simulationState.evaderExists === false) {
    throw new Error("Cannot snapshot evader front view because the evader does not exist.");
  }

  const renderingProfile = simulationState.renderingProfile ?? SIMULATION_RENDERING_PROFILE;
  const width = normalizeImageSize(options.width, renderingProfile.camera.projection.imageWidth);
  const height = normalizeImageSize(options.height, renderingProfile.camera.projection.imageHeight);
  const pose = getActorPose(simulationState, actorId);
  const record = createVehicleFrontViewCaptureRecord({
    actorId,
    frameIndex: Number.isFinite(simulationState.frameIndex)
      ? Number(simulationState.frameIndex)
      : null,
    actorPosition: pose.position,
    actorDirection: pose.direction,
    fieldOfViewAngleRadians: simulationState.vehicleSettings?.fieldOfViewAngleRadians,
    fieldOfViewDistance: simulationState.vehicleSettings?.fieldOfViewDistance,
    obstacles: simulationState.obstacles,
    columns: simulationState.columns,
    rows: simulationState.rows,
    visibleActors: getVisibleSubjects(simulationState, actorId),
  });
  if (!record) {
    throw new Error(`Cannot snapshot ${actorId} front view because the actor pose is unavailable.`);
  }

  const renderedImage = normalizeRenderedImage(options.renderedImage, { width, height });
  const fallbackSvg = renderedImage
    ? null
    : renderVehicleFrontViewCaptureSvg(record, { width, height });
  const image = renderedImage ?? {
    contentType: record.image.contentType,
    rendererId: record.image.rendererId,
    width,
    height,
    svg: fallbackSvg ?? "",
  };
  record.image = {
    ...record.image,
    contentType: image.contentType,
    rendererId: image.rendererId,
    width: image.width,
    height: image.height,
  };
  const camera = resolveChaseCamera(
    renderingProfile,
    {
      fieldOfViewAngleRadians: simulationState.vehicleSettings?.fieldOfViewAngleRadians,
      fieldOfViewDistance: simulationState.vehicleSettings?.fieldOfViewDistance,
    },
    { width: image.width, height: image.height },
  );

  return {
    gameId: "chase",
    snapshotType: "manual-front-view",
    actorId,
    frameIndex: record.frameIndex,
    renderingProfile,
    camera,
    referenceable: false,
    persistence: {
      storedInActorMemory: false,
      memoryPath: null,
    },
    record,
    image,
  };
}
