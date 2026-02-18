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

type LoadedDerivationPlugin = {
  record: Omit<DerivationPluginRouteRecord, "filePath" | "hash" | "uploadedAt">;
  manifest: unknown | null;
};

type RegisterDocsDerivationRoutesOptions = {
  app: Express;
  resolvedDirname: string;
  derivationPluginRoot: string;
  derivationPlugins: Map<string, DerivationPluginRouteRecord>;
  derivationPluginUpload: RequestHandler;
  loadDerivationPluginFromFile: (filePath: string) => Promise<LoadedDerivationPlugin>;
  saveDerivationPluginIndex: (records: DerivationPluginRouteRecord[]) => void;
  sendToFrontend: (command: ControlCommand | ControlResponse) => boolean;
};

function sortPlugins(
  derivationPlugins: Map<string, DerivationPluginRouteRecord>,
): DerivationPluginRouteRecord[] {
  return Array.from(derivationPlugins.values()).sort((a, b) =>
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
}
