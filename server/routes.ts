import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import type { ComponentNode, ControlCommand, ControlResponse } from "@shared/schema";
import { compactEntities, compactValue, DEFAULT_MAX_NUMERIC_DEPTH } from "@shared/compact";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

interface CaptureRecord {
  tick: number;
  entities: Record<string, Record<string, unknown>>;
}

function buildTree(
  obj: Record<string, unknown>,
  parentPath: string[],
  parentId: string,
): ComponentNode[] {
  const result: ComponentNode[] = [];

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const path = [...parentPath, key];
    const id = parentId ? `${parentId}.${key}` : key;

    let valueType: ComponentNode["valueType"] = "null";
    let children: ComponentNode[] = [];

    if (value === null || value === undefined) {
      valueType = "null";
    } else if (typeof value === "number") {
      valueType = "number";
    } else if (typeof value === "string") {
      valueType = "string";
    } else if (typeof value === "boolean") {
      valueType = "boolean";
    } else if (Array.isArray(value)) {
      valueType = "array";
      if (value.length > 0 && typeof value[0] === "object") {
        children = buildTree(value[0] as Record<string, unknown>, path, id);
      }
    } else if (typeof value === "object") {
      valueType = "object";
      children = buildTree(value as Record<string, unknown>, path, id);
    }

    result.push({
      id,
      label: key,
      path,
      children,
      isLeaf: children.length === 0,
      valueType,
    });
  }

  return result;
}

function buildComponentTreeFromEntities(
  entities: Record<string, unknown>,
): ComponentNode[] {
  const nodes: ComponentNode[] = [];

  Object.entries(entities).forEach(([entityId, components]) => {
    if (!components || typeof components !== "object" || Array.isArray(components)) {
      return;
    }
    const componentTree = buildTree(components as Record<string, unknown>, [entityId], entityId);
    nodes.push({
      id: entityId,
      label: entityId,
      path: [entityId],
      children: componentTree,
      isLeaf: false,
      valueType: "object",
    });
  });

  return nodes;
}

function mergeValueType(
  existing: ComponentNode["valueType"],
  incoming: ComponentNode["valueType"],
) {
  if (incoming === "null" && existing !== "null") {
    return existing;
  }
  return incoming;
}

function mergeComponentTrees(existing: ComponentNode[], incoming: ComponentNode[]): ComponentNode[] {
  const existingMap = new Map(existing.map((node) => [node.id, node]));
  const merged: ComponentNode[] = [];

  incoming.forEach((node) => {
    const current = existingMap.get(node.id);
    existingMap.delete(node.id);
    if (!current) {
      merged.push(node);
      return;
    }
    const mergedChildren = mergeComponentTrees(current.children, node.children);
    merged.push({
      ...current,
      ...node,
      valueType: mergeValueType(current.valueType, node.valueType),
      children: mergedChildren,
      isLeaf: mergedChildren.length === 0,
    });
  });

  existingMap.forEach((node) => merged.push(node));
  return merged;
}

function mergeEntities(
  target: Record<string, Record<string, unknown>>,
  source: Record<string, Record<string, unknown>>,
) {
  Object.entries(source).forEach(([entityId, components]) => {
    if (!target[entityId]) {
      target[entityId] = {};
    }
    Object.entries(components).forEach(([componentId, componentValue]) => {
      target[entityId][componentId] = componentValue;
    });
  });
}

function parseJSONL(content: string): { records: CaptureRecord[]; components: ComponentNode[] } {
  const lines = content.trim().split('\n');
  const frames = new Map<number, CaptureRecord>();
  let components: ComponentNode[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      if (
        Number.isFinite(parsed.tick) &&
        parsed.entities &&
        typeof parsed.entities === "object" &&
        !Array.isArray(parsed.entities)
      ) {
        const rawComponents = buildComponentTreeFromEntities(parsed.entities);
        components = mergeComponentTrees(components, rawComponents);
        const entities = compactEntities(parsed.entities, DEFAULT_MAX_NUMERIC_DEPTH);
        const frame = frames.get(parsed.tick) ?? { tick: parsed.tick, entities: {} };
        mergeEntities(frame.entities, entities);
        frames.set(parsed.tick, frame);
        continue;
      }

      if (
        Number.isFinite(parsed.tick) &&
        typeof parsed.entityId === "string" &&
        typeof parsed.componentId === "string"
      ) {
        const rawEntities: Record<string, Record<string, unknown>> = {
          [parsed.entityId]: {
            [parsed.componentId]: parsed.value,
          },
        };
        const rawComponents = buildComponentTreeFromEntities(rawEntities);
        components = mergeComponentTrees(components, rawComponents);
        const compactedValue = compactValue(parsed.value, 1, DEFAULT_MAX_NUMERIC_DEPTH);
        if (compactedValue === undefined) {
          continue;
        }
        const frame = frames.get(parsed.tick) ?? { tick: parsed.tick, entities: {} };
        if (!frame.entities[parsed.entityId]) {
          frame.entities[parsed.entityId] = {};
        }
        frame.entities[parsed.entityId][parsed.componentId] = compactedValue;
        frames.set(parsed.tick, frame);
      }
    } catch (e) {
      console.error("Failed to parse line:", e);
    }
  }

  return {
    records: Array.from(frames.values()).sort((a, b) => a.tick - b.tick),
    components,
  };
}

const agentClients = new Set<WebSocket>();
let frontendClient: WebSocket | null = null;
const pendingClients = new Map<WebSocket, boolean>();

function broadcastToAgents(message: ControlResponse) {
  const data = JSON.stringify(message);
  agentClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws/control")) {
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    pendingClients.set(ws, true);
    console.log("[ws] New connection, awaiting registration");

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === "register") {
          pendingClients.delete(ws);
          if (message.role === "frontend") {
            frontendClient = ws;
            console.log("[ws] Frontend registered");
            ws.send(JSON.stringify({ type: "ack", payload: "registered as frontend" }));
          } else {
            agentClients.add(ws);
            console.log("[ws] Agent registered, total agents:", agentClients.size);
            ws.send(JSON.stringify({ type: "ack", payload: "registered as agent" }));
          }
          return;
        }

        if (pendingClients.has(ws)) {
          ws.send(JSON.stringify({ 
            type: "error", 
            error: "Must register first with {type:'register', role:'frontend'|'agent'}",
            request_id: message.request_id,
          } as ControlResponse));
          return;
        }

        const isFrontend = ws === frontendClient;
        
        if (isFrontend) {
          broadcastToAgents(message as ControlResponse);
        } else if (!isFrontend) {
          if (frontendClient && frontendClient.readyState === WebSocket.OPEN) {
            frontendClient.send(JSON.stringify(message));
          } else {
            ws.send(JSON.stringify({ 
              type: "error", 
              error: "Frontend not connected",
              request_id: message.request_id,
            } as ControlResponse));
          }
        }
      } catch (e) {
        ws.send(JSON.stringify({ 
          type: "error", 
          error: "Invalid message format" 
        } as ControlResponse));
      }
    });

    ws.on("close", () => {
      pendingClients.delete(ws);
      if (ws === frontendClient) {
        frontendClient = null;
        console.log("[ws] Frontend disconnected");
      } else {
        agentClients.delete(ws);
        console.log("[ws] Agent disconnected, remaining:", agentClients.size);
      }
    });

    ws.on("error", (err) => {
      console.error("[ws] Error:", err);
    });
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  function findUsageMd(): string | null {
    const possiblePaths = [
      path.resolve(__dirname, 'USAGE.md'),
      path.resolve(__dirname, '..', 'USAGE.md'),
      path.join(process.cwd(), 'USAGE.md'),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  app.get('/api/docs', (_req, res) => {
    try {
      const usageMdPath = findUsageMd();
      if (usageMdPath) {
        const content = fs.readFileSync(usageMdPath, 'utf-8');
        res.json({ content });
      } else {
        res.status(404).json({ error: 'Documentation file not found' });
      }
    } catch (error) {
      console.error('Failed to read USAGE.md:', error);
      res.status(500).json({ error: 'Documentation not available' });
    }
  });

  app.get('/USAGE.md', (_req, res) => {
    try {
      const usageMdPath = findUsageMd();
      if (usageMdPath) {
        const content = fs.readFileSync(usageMdPath, 'utf-8');
        res.type('text/markdown').send(content);
      } else {
        res.status(404).send('Documentation file not found');
      }
    } catch (error) {
      console.error('Failed to read USAGE.md:', error);
      res.status(500).send('Documentation not available');
    }
  });

  app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const content = req.file.buffer.toString('utf-8');
      const { records, components } = parseJSONL(content);
      
      if (records.length === 0) {
        return res.status(400).json({ error: 'No valid records found in file' });
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
        filename: req.file.originalname,
        size: req.file.size,
        tickCount,
        records,
        components,
        entityIds,
        componentIds,
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to process file' });
    }
  });

  return httpServer;
}
