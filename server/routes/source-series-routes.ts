import type { Express, RequestHandler } from "express";
import * as fs from "fs";
import * as path from "path";
import type { ComponentNode } from "@shared/schema";
import type { CaptureRecord } from "../stream-utils";

type UploadIndexEntry = {
  path: string;
  size: number;
  filename?: string;
  createdAt: string;
};

type UploadIndex = Record<string, UploadIndexEntry>;

type LoadedCapturePayload = {
  records: CaptureRecord[];
  components: ComponentNode[];
  sizeBytes: number;
};

type SeriesResult = {
  points: Array<{ tick: number; value: number | null }>;
  tickCount: number;
  numericCount: number;
  lastTick: number | null;
};

type RegisterSourceSeriesRoutesOptions = {
  app: Express;
  uploadMiddleware: RequestHandler;
  hashFile: (filePath: string) => Promise<string>;
  loadUploadIndex: () => UploadIndex;
  saveUploadIndex: (index: UploadIndex) => void;
  registerCaptureSource: (options: { source: string; captureId: string; filename?: string }) => void;
  streamCaptureFromSource: (captureId: string, source: string) => Promise<void>;
  parseJSONLFromSource: (source: string, signal: AbortSignal) => Promise<LoadedCapturePayload>;
  inferFilename: (source: string) => string;
  probeCaptureSource: (
    source: string,
    signal: AbortSignal,
  ) => Promise<{ ok: boolean; error?: string }>;
  normalizePathInput: (pathInput: unknown) => string[] | null;
  captureSources: Map<string, string>;
  liveStreamStates: Map<string, { source: string }>;
  getCachedFramesForSeries: (captureId: string) => CaptureRecord[];
  captureFrameCacheStats: Map<string, { sampleEvery: number }>;
  extractSeriesFromFrames: (frames: CaptureRecord[], path: string[]) => SeriesResult;
  extractSeriesFromSource: (options: {
    source: string;
    path: string[];
    signal: AbortSignal;
  }) => Promise<SeriesResult>;
  extractSeriesFromFramesBatch: (frames: CaptureRecord[], paths: string[][]) => SeriesResult[];
  extractSeriesBatchFromSource: (options: {
    source: string;
    paths: string[][];
    signal: AbortSignal;
  }) => Promise<SeriesResult[]>;
};

export function registerSourceSeriesRoutes({
  app,
  uploadMiddleware,
  hashFile,
  loadUploadIndex,
  saveUploadIndex,
  registerCaptureSource,
  streamCaptureFromSource,
  parseJSONLFromSource,
  inferFilename,
  probeCaptureSource,
  normalizePathInput,
  captureSources,
  liveStreamStates,
  getCachedFramesForSeries,
  captureFrameCacheStats,
  extractSeriesFromFrames,
  extractSeriesFromSource,
  extractSeriesFromFramesBatch,
  extractSeriesBatchFromSource,
}: RegisterSourceSeriesRoutesOptions) {
  app.post("/api/upload", uploadMiddleware, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const captureId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const filename = req.file.originalname || path.basename(req.file.path);
      const filePath = req.file.path;
      const size = req.file.size;

      let sourcePath = filePath;
      let deduped = false;
      try {
        const hash = await hashFile(filePath);
        const index = loadUploadIndex();
        const existing = index[hash];
        if (
          existing?.path &&
          fs.existsSync(existing.path) &&
          path.resolve(existing.path) !== path.resolve(filePath)
        ) {
          if (existing.path !== filePath) {
            // best effort cleanup of duplicate upload
            try {
              fs.unlinkSync(filePath);
            } catch (error) {
              console.warn("[upload] Failed to remove duplicate temp upload:", error);
            }
          }
          sourcePath = existing.path;
          deduped = true;
        } else {
          index[hash] = {
            path: filePath,
            size,
            filename,
            createdAt: new Date().toISOString(),
          };
          saveUploadIndex(index);
        }
      } catch (error) {
        console.warn("[upload] Failed to hash file for dedupe:", error);
      }

      registerCaptureSource({
        source: sourcePath,
        captureId,
        filename,
      });
      streamCaptureFromSource(captureId, sourcePath).catch((error) => {
        console.error("[upload] stream error:", error);
      });

      res.json({
        success: true,
        streaming: true,
        captureId,
        filename,
        size,
        deduped,
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to process file" });
    }
  });

  app.post("/api/source/check", async (req, res) => {
    const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
    if (!source) {
      return res.status(400).json({ ok: false, error: "Capture file source is required." });
    }

    const result = await probeCaptureSource(source, new AbortController().signal);
    return res.json({ ...result, source });
  });

  app.post("/api/source/load", async (req, res) => {
    try {
      const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
      if (!source) {
        return res.status(400).json({ error: "Capture file source is required." });
      }

      const parsed = await parseJSONLFromSource(source, new AbortController().signal);
      const { records, components } = parsed;

      if (records.length === 0) {
        return res.status(400).json({ error: "No valid records found in file" });
      }

      const tickCount = records.length;
      const entityIdSet = new Set<string>();
      const componentIdSet = new Set<string>();
      records.forEach((record) => {
        Object.entries(record.entities).forEach(([entityId, components]) => {
          entityIdSet.add(entityId);
          if (components && typeof components === "object") {
            Object.keys(components).forEach((componentId) => {
              componentIdSet.add(componentId);
            });
          }
        });
      });
      const entityIds = [...entityIdSet];
      const componentIds = [...componentIdSet];

      res.json({
        success: true,
        filename: inferFilename(source),
        size: parsed.sizeBytes,
        tickCount,
        records,
        components,
        entityIds,
        componentIds,
      });
    } catch (error) {
      console.error("Source load error:", error);
      res.status(500).json({ error: "Failed to load capture source." });
    }
  });

  app.post("/api/series", async (req, res) => {
    try {
      const captureId = typeof req.body?.captureId === "string" ? req.body.captureId : "";
      if (!captureId.trim()) {
        return res.status(400).json({ error: "captureId is required." });
      }
      const path = normalizePathInput(req.body?.path);
      if (!path) {
        return res.status(400).json({ error: "path must be a JSON array of strings." });
      }

      const source = captureSources.get(captureId) ?? liveStreamStates.get(captureId)?.source ?? "";
      if (!source) {
        return res.status(404).json({ error: "Capture source not found for captureId." });
      }

      const cachedFrames = getCachedFramesForSeries(captureId);
      const cacheStats = captureFrameCacheStats.get(captureId);
      const isSampled = cacheStats ? cacheStats.sampleEvery > 1 : false;
      const preferCache = req.body?.preferCache !== false;
      const isLiveActive = liveStreamStates.has(captureId);
      const usedCache = preferCache && (cachedFrames.length > 0 || isLiveActive);
      const result = usedCache
        ? extractSeriesFromFrames(cachedFrames, path)
        : await extractSeriesFromSource({
            source,
            path,
            signal: new AbortController().signal,
          });

      return res.json({
        success: true,
        captureId,
        path,
        fullPath: path.join("."),
        points: result.points,
        tickCount: result.tickCount,
        numericCount: result.numericCount,
        lastTick: result.lastTick,
        partial: usedCache && (isSampled || isLiveActive || cachedFrames.length === 0),
      });
    } catch (error) {
      console.error("Series load error:", error);
      return res.status(500).json({ error: "Failed to load series." });
    }
  });

  app.post("/api/series/batch", async (req, res) => {
    try {
      const captureId = typeof req.body?.captureId === "string" ? req.body.captureId : "";
      if (!captureId.trim()) {
        return res.status(400).json({ error: "captureId is required." });
      }
      const rawPaths = Array.isArray(req.body?.paths) ? req.body.paths : [];
      const paths = rawPaths
        .map((path: unknown) => normalizePathInput(path))
        .filter((path: string[] | null): path is string[] => Array.isArray(path));
      if (paths.length === 0) {
        return res.status(400).json({ error: "paths must be an array of JSON string arrays." });
      }

      const source = captureSources.get(captureId) ?? liveStreamStates.get(captureId)?.source ?? "";
      if (!source) {
        return res.status(404).json({ error: "Capture source not found for captureId." });
      }

      const cachedFrames = getCachedFramesForSeries(captureId);
      const cacheStats = captureFrameCacheStats.get(captureId);
      const isSampled = cacheStats ? cacheStats.sampleEvery > 1 : false;
      const preferCache = req.body?.preferCache !== false;
      const isLiveActive = liveStreamStates.has(captureId);
      const usedCache = preferCache && (cachedFrames.length > 0 || isLiveActive);
      const results = usedCache
        ? extractSeriesFromFramesBatch(cachedFrames, paths)
        : await extractSeriesBatchFromSource({
            source,
            paths,
            signal: new AbortController().signal,
          });

      const series = paths.map((path: string[], index: number) => {
        const result = results[index] ?? { points: [], numericCount: 0, lastTick: null, tickCount: 0 };
        return {
          path,
          fullPath: path.join("."),
          points: result.points,
          tickCount: result.tickCount,
          numericCount: result.numericCount,
          lastTick: result.lastTick,
          partial: usedCache && (isSampled || isLiveActive || cachedFrames.length === 0),
        };
      });

      return res.json({ success: true, captureId, series });
    } catch (error) {
      console.error("Series batch load error:", error);
      return res.status(500).json({ error: "Failed to load series batch." });
    }
  });
}
