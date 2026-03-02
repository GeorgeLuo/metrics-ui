import type { Express, RequestHandler } from "express";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import type { ControlCommand, ControlResponse } from "@shared/schema";

type DerivationPluginOutput = { key: string; label?: string };

export type DerivationPluginRouteRecord = {
  id: string;
  name: string;
  description?: string;
  minInputs: number;
  maxInputs: number | null;
  outputs: DerivationPluginOutput[];
  filePath: string;
  hash: string;
  uploadedAt: string;
  valid: boolean;
  error: string | null;
};

export type VisualizationPluginRouteRecord = {
  id: string;
  name: string;
  description?: string;
  libraries: string[];
  filePath: string;
  hash: string;
  uploadedAt: string;
  valid: boolean;
  error: string | null;
};

type LoadedDerivationPlugin = {
  record: Omit<DerivationPluginRouteRecord, "filePath" | "hash" | "uploadedAt">;
  manifest: unknown | null;
};

type LoadedVisualizationPlugin = {
  record: Omit<VisualizationPluginRouteRecord, "filePath" | "hash" | "uploadedAt">;
  manifest: unknown | null;
  runtimeScript?: string;
};

type VisualizationLibraryAsset = {
  filePath: string;
  contentType: string;
};

type VisualizationAssetFile = {
  filePath: string;
  contentType: string;
};

type RegisterDocsDerivationRoutesOptions = {
  app: Express;
  resolvedDirname: string;
  derivationPluginRoot: string;
  derivationPlugins: Map<string, DerivationPluginRouteRecord>;
  derivationPluginUpload: RequestHandler;
  loadDerivationPluginFromFile: (filePath: string) => Promise<LoadedDerivationPlugin>;
  saveDerivationPluginIndex: (records: DerivationPluginRouteRecord[]) => void;
  visualizationPluginRoot: string;
  visualizationPlugins: Map<string, VisualizationPluginRouteRecord>;
  visualizationPluginUpload: RequestHandler;
  loadVisualizationPluginFromFile: (filePath: string) => Promise<LoadedVisualizationPlugin>;
  saveVisualizationPluginIndex: (records: VisualizationPluginRouteRecord[]) => void;
  resolveVisualizationLibraryAsset: (libraryId: string) => VisualizationLibraryAsset | null;
  resolveVisualizationAddonAsset: (addonPath: string) => VisualizationLibraryAsset | null;
  resolveVisualizationAssetFile: (assetPath: string) => VisualizationAssetFile | null;
  visualizationAssetRoot: string;
  visualizationAssetManifestFile: string;
  sendToFrontend: (command: ControlCommand | ControlResponse) => boolean;
};

function sortPlugins(
  derivationPlugins: Map<string, DerivationPluginRouteRecord>,
): DerivationPluginRouteRecord[] {
  return Array.from(derivationPlugins.values()).sort((a, b) =>
    b.uploadedAt.localeCompare(a.uploadedAt),
  );
}

function sortVisualizationPlugins(
  visualizationPlugins: Map<string, VisualizationPluginRouteRecord>,
): VisualizationPluginRouteRecord[] {
  return Array.from(visualizationPlugins.values()).sort((a, b) =>
    b.uploadedAt.localeCompare(a.uploadedAt),
  );
}

function findUsageMd(resolvedDirname: string): string | null {
  const possiblePaths = [
    path.resolve(resolvedDirname, "USAGE.md"),
    path.resolve(resolvedDirname, "..", "USAGE.md"),
    path.join(process.cwd(), "USAGE.md"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

export function registerDocsAndDerivationRoutes({
  app,
  resolvedDirname,
  derivationPluginRoot,
  derivationPlugins,
  derivationPluginUpload,
  loadDerivationPluginFromFile,
  saveDerivationPluginIndex,
  visualizationPluginRoot,
  visualizationPlugins,
  visualizationPluginUpload,
  loadVisualizationPluginFromFile,
  saveVisualizationPluginIndex,
  resolveVisualizationLibraryAsset,
  resolveVisualizationAddonAsset,
  resolveVisualizationAssetFile,
  visualizationAssetRoot,
  visualizationAssetManifestFile,
  sendToFrontend,
}: RegisterDocsDerivationRoutesOptions) {
  app.get("/api/docs", (_req, res) => {
    try {
      const usageMdPath = findUsageMd(resolvedDirname);
      if (usageMdPath) {
        const content = fs.readFileSync(usageMdPath, "utf-8");
        res.json({ content });
      } else {
        res.status(404).json({ error: "Documentation file not found" });
      }
    } catch (error) {
      console.error("Failed to read USAGE.md:", error);
      res.status(500).json({ error: "Documentation not available" });
    }
  });

  app.get("/USAGE.md", (_req, res) => {
    try {
      const usageMdPath = findUsageMd(resolvedDirname);
      if (usageMdPath) {
        const content = fs.readFileSync(usageMdPath, "utf-8");
        res.type("text/markdown").send(content);
      } else {
        res.status(404).send("Documentation file not found");
      }
    } catch (error) {
      console.error("Failed to read USAGE.md:", error);
      res.status(500).send("Documentation not available");
    }
  });

  app.get("/api/derivations/plugins", (_req, res) => {
    const plugins = sortPlugins(derivationPlugins);
    return res.json({ plugins });
  });

  app.get("/api/derivations/plugins/:pluginId/source", (req, res) => {
    const pluginId = typeof req.params?.pluginId === "string" ? req.params.pluginId : "";
    if (!pluginId) {
      return res.status(400).json({ error: "pluginId is required." });
    }

    const record = derivationPlugins.get(pluginId);
    if (!record) {
      return res.status(404).json({ error: "Plugin not found." });
    }

    const resolvedRoot = path.resolve(derivationPluginRoot);
    const resolvedPath = path.resolve(record.filePath);
    if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
      return res.status(400).json({ error: "Invalid plugin path." });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "Plugin source file missing." });
    }

    const MAX_SOURCE_BYTES = 512 * 1024;
    const buffer = fs.readFileSync(resolvedPath);
    const truncated = buffer.length > MAX_SOURCE_BYTES;
    const source = truncated
      ? buffer.subarray(0, MAX_SOURCE_BYTES).toString("utf-8")
      : buffer.toString("utf-8");

    return res.json({
      pluginId: record.id,
      name: record.name,
      filename: path.basename(record.filePath),
      bytes: buffer.length,
      truncated,
      source,
    });
  });

  app.post(
    "/api/derivations/plugins/upload",
    derivationPluginUpload,
    async (req, res) => {
      try {
        const fileBuffer =
          req.file && "buffer" in req.file && Buffer.isBuffer(req.file.buffer)
            ? (req.file.buffer as Buffer)
            : null;
        if (!fileBuffer) {
          return res.status(400).json({ error: "No plugin file uploaded." });
        }
        const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        fs.mkdirSync(derivationPluginRoot, { recursive: true });
        const filePath = path.join(derivationPluginRoot, `${hash}.mjs`);
        const existed = fs.existsSync(filePath);
        if (!existed) {
          fs.writeFileSync(filePath, fileBuffer);
        }

        const loaded = await loadDerivationPluginFromFile(filePath);
        const uploadedAt = new Date().toISOString();
        if (!loaded.record.valid || !loaded.manifest) {
          if (!existed) {
            try {
              fs.unlinkSync(filePath);
            } catch (error) {
              console.warn("[derivations] Failed to cleanup invalid plugin file:", error);
            }
          }
          return res.status(400).json({
            error: loaded.record.error ?? "Derivation plugin failed validation.",
            plugin: {
              ...loaded.record,
              filePath,
              hash,
              uploadedAt,
            },
          });
        }
        const record: DerivationPluginRouteRecord = {
          ...loaded.record,
          filePath,
          hash,
          uploadedAt,
        };
        derivationPlugins.set(record.id, record);
        saveDerivationPluginIndex(Array.from(derivationPlugins.values()));

        const plugins = sortPlugins(derivationPlugins);
        sendToFrontend({ type: "derivation_plugins", payload: { plugins } } as ControlResponse);
        return res.json({ success: true, plugin: record, plugins });
      } catch (error) {
        console.error("[derivations] Plugin upload error:", error);
        return res.status(500).json({ error: "Failed to upload derivation plugin." });
      }
    },
  );

  app.delete("/api/derivations/plugins/:pluginId", (req, res) => {
    const pluginId = typeof req.params?.pluginId === "string" ? req.params.pluginId : "";
    if (!pluginId) {
      return res.status(400).json({ error: "pluginId is required." });
    }
    const record = derivationPlugins.get(pluginId);
    if (!record) {
      return res.status(404).json({ error: "Plugin not found." });
    }
    derivationPlugins.delete(pluginId);
    saveDerivationPluginIndex(Array.from(derivationPlugins.values()));

    const stillReferenced = Array.from(derivationPlugins.values()).some(
      (entry) => entry.filePath === record.filePath,
    );
    if (!stillReferenced) {
      try {
        if (fs.existsSync(record.filePath)) {
          fs.unlinkSync(record.filePath);
        }
      } catch (error) {
        console.warn("[derivations] Failed to delete plugin file:", error);
      }
    }

    const plugins = sortPlugins(derivationPlugins);
    sendToFrontend({ type: "derivation_plugins", payload: { plugins } } as ControlResponse);
    return res.json({ success: true, pluginId });
  });

  app.get("/api/visualization/plugins", (_req, res) => {
    const plugins = sortVisualizationPlugins(visualizationPlugins);
    return res.json({ plugins });
  });

  app.get("/api/visualization/assets-manifest", (_req, res) => {
    if (!fs.existsSync(visualizationAssetManifestFile)) {
      return res.json({
        root: visualizationAssetRoot,
        manifestFile: visualizationAssetManifestFile,
        available: false,
      });
    }
    try {
      const raw = fs.readFileSync(visualizationAssetManifestFile, "utf-8");
      const parsed = JSON.parse(raw);
      return res.json({
        root: visualizationAssetRoot,
        manifestFile: visualizationAssetManifestFile,
        available: true,
        manifest: parsed,
      });
    } catch (error) {
      return res.status(500).json({
        root: visualizationAssetRoot,
        manifestFile: visualizationAssetManifestFile,
        available: false,
        error:
          error instanceof Error ? error.message : "Failed to read visualization asset manifest.",
      });
    }
  });

  app.get("/api/visualization/libs/:libraryId", (req, res) => {
    const libraryId = typeof req.params?.libraryId === "string" ? req.params.libraryId : "";
    if (!libraryId) {
      return res.status(400).json({ error: "libraryId is required." });
    }
    const asset = resolveVisualizationLibraryAsset(libraryId);
    if (!asset) {
      return res.status(404).json({ error: "Visualization library not found." });
    }
    if (!fs.existsSync(asset.filePath)) {
      return res.status(404).json({ error: "Visualization library file missing." });
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.type(asset.contentType);
    return res.sendFile(asset.filePath);
  });

  app.get(/^\/api\/visualization\/libs\/three\/addons\/(.+)$/, (req, res) => {
    const addonPath = typeof req.params?.[0] === "string" ? req.params[0] : "";
    if (!addonPath.trim()) {
      return res.status(400).json({ error: "addon path is required." });
    }
    const asset = resolveVisualizationAddonAsset(addonPath);
    if (!asset) {
      return res.status(404).json({ error: "Visualization addon library not found." });
    }
    if (!fs.existsSync(asset.filePath)) {
      return res.status(404).json({ error: "Visualization addon file missing." });
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (asset.contentType.startsWith("application/javascript")) {
      try {
        const source = fs.readFileSync(asset.filePath, "utf-8");
        const rewritten = source
          .replace(/from\\s+'three'/g, "from '/api/visualization/libs/three'")
          .replace(/from\\s+\"three\"/g, "from '/api/visualization/libs/three'");
        res.type(asset.contentType);
        return res.send(rewritten);
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : "Failed to read visualization addon file.",
        });
      }
    }
    res.type(asset.contentType);
    return res.sendFile(asset.filePath);
  });

  app.get(/^\/api\/visualization\/assets\/(.+)$/, (req, res) => {
    const assetPath = typeof req.params?.[0] === "string" ? req.params[0] : "";
    if (!assetPath.trim()) {
      return res.status(400).json({ error: "asset path is required." });
    }
    const asset = resolveVisualizationAssetFile(assetPath);
    if (!asset) {
      return res.status(404).json({ error: "Visualization asset not found." });
    }
    if (!fs.existsSync(asset.filePath)) {
      return res.status(404).json({ error: "Visualization asset file missing." });
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.type(asset.contentType);
    return res.sendFile(asset.filePath);
  });

  app.get("/api/visualization/plugins/:pluginId/source", (req, res) => {
    const pluginId = typeof req.params?.pluginId === "string" ? req.params.pluginId : "";
    if (!pluginId) {
      return res.status(400).json({ error: "pluginId is required." });
    }

    const record = visualizationPlugins.get(pluginId);
    if (!record) {
      return res.status(404).json({ error: "Plugin not found." });
    }

    const resolvedRoot = path.resolve(visualizationPluginRoot);
    const resolvedPath = path.resolve(record.filePath);
    if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
      return res.status(400).json({ error: "Invalid plugin path." });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "Plugin source file missing." });
    }

    const MAX_SOURCE_BYTES = 512 * 1024;
    const buffer = fs.readFileSync(resolvedPath);
    const truncated = buffer.length > MAX_SOURCE_BYTES;
    const source = truncated
      ? buffer.subarray(0, MAX_SOURCE_BYTES).toString("utf-8")
      : buffer.toString("utf-8");

    return res.json({
      pluginId: record.id,
      name: record.name,
      filename: path.basename(record.filePath),
      bytes: buffer.length,
      truncated,
      source,
    });
  });

  app.get("/api/visualization/plugins/:pluginId/runtime", async (req, res) => {
    const pluginId = typeof req.params?.pluginId === "string" ? req.params.pluginId : "";
    if (!pluginId) {
      return res.status(400).json({ error: "pluginId is required." });
    }

    const record = visualizationPlugins.get(pluginId);
    if (!record) {
      return res.status(404).json({ error: "Plugin not found." });
    }
    if (!record.valid) {
      return res.status(400).json({ error: record.error ?? "Visualization plugin is invalid." });
    }

    const loaded = await loadVisualizationPluginFromFile(record.filePath);
    if (!loaded.record.valid || !loaded.manifest || typeof loaded.runtimeScript !== "string") {
      return res.status(400).json({
        error: loaded.record.error ?? "Visualization plugin failed runtime validation.",
      });
    }

    return res.json({
      pluginId: record.id,
      name: record.name,
      description: record.description,
      runtimeScript: loaded.runtimeScript,
      libraries: loaded.record.libraries,
    });
  });

  app.post(
    "/api/visualization/plugins/upload",
    visualizationPluginUpload,
    async (req, res) => {
      try {
        const fileBuffer =
          req.file && "buffer" in req.file && Buffer.isBuffer(req.file.buffer)
            ? (req.file.buffer as Buffer)
            : null;
        if (!fileBuffer) {
          return res.status(400).json({ error: "No plugin file uploaded." });
        }
        const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        fs.mkdirSync(visualizationPluginRoot, { recursive: true });
        const filePath = path.join(visualizationPluginRoot, `${hash}.mjs`);
        const existed = fs.existsSync(filePath);
        if (!existed) {
          fs.writeFileSync(filePath, fileBuffer);
        }

        const loaded = await loadVisualizationPluginFromFile(filePath);
        const uploadedAt = new Date().toISOString();
        if (!loaded.record.valid || !loaded.manifest || typeof loaded.runtimeScript !== "string") {
          if (!existed) {
            try {
              fs.unlinkSync(filePath);
            } catch (error) {
              console.warn("[visualization] Failed to cleanup invalid plugin file:", error);
            }
          }
          return res.status(400).json({
            error: loaded.record.error ?? "Visualization plugin failed validation.",
            plugin: {
              ...loaded.record,
              filePath,
              hash,
              uploadedAt,
            },
          });
        }

        const record: VisualizationPluginRouteRecord = {
          ...loaded.record,
          filePath,
          hash,
          uploadedAt,
        };
        visualizationPlugins.set(record.id, record);
        saveVisualizationPluginIndex(Array.from(visualizationPlugins.values()));

        const plugins = sortVisualizationPlugins(visualizationPlugins);
        return res.json({ success: true, plugin: record, plugins });
      } catch (error) {
        console.error("[visualization] Plugin upload error:", error);
        return res.status(500).json({ error: "Failed to upload visualization plugin." });
      }
    },
  );

  app.delete("/api/visualization/plugins/:pluginId", (req, res) => {
    const pluginId = typeof req.params?.pluginId === "string" ? req.params.pluginId : "";
    if (!pluginId) {
      return res.status(400).json({ error: "pluginId is required." });
    }
    const record = visualizationPlugins.get(pluginId);
    if (!record) {
      return res.status(404).json({ error: "Plugin not found." });
    }
    visualizationPlugins.delete(pluginId);
    saveVisualizationPluginIndex(Array.from(visualizationPlugins.values()));

    const stillReferenced = Array.from(visualizationPlugins.values()).some(
      (entry) => entry.filePath === record.filePath,
    );
    if (!stillReferenced) {
      try {
        if (fs.existsSync(record.filePath)) {
          fs.unlinkSync(record.filePath);
        }
      } catch (error) {
        console.warn("[visualization] Failed to delete plugin file:", error);
      }
    }

    const plugins = sortVisualizationPlugins(visualizationPlugins);
    return res.json({ success: true, pluginId, plugins });
  });
}
