import { z } from "zod";

export const captureRecordSchema = z.object({
  tick: z.number(),
  entityId: z.string(),
  componentId: z.string(),
  value: z.record(z.unknown()),
});

export type CaptureRecord = z.infer<typeof captureRecordSchema>;

export interface CaptureSession {
  id: string;
  filename: string;
  fileSize: number;
  tickCount: number;
  records: CaptureRecord[];
  components: ComponentNode[];
  isActive: boolean;
}

export interface ParsedCapture {
  records: CaptureRecord[];
  tickCount: number;
  components: ComponentNode[];
  entityIds: string[];
  componentIds: string[];
}

export interface ComponentNode {
  id: string;
  label: string;
  path: string[];
  children: ComponentNode[];
  isLeaf: boolean;
  valueType: "number" | "string" | "object" | "array" | "boolean" | "null";
}

export interface SelectedMetric {
  captureId: string;
  path: string[];
  fullPath: string;
  label: string;
  color: string;
}

export interface DataPoint {
  tick: number;
  [key: string]: number | string | null;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTick: number;
  speed: number;
  totalTicks: number;
}

export const uploadResponseSchema = z.object({
  success: z.boolean(),
  tickCount: z.number(),
  components: z.array(z.unknown()),
  entityIds: z.array(z.string()),
  componentIds: z.array(z.string()),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;
