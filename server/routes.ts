import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import type { ControlCommand, ControlResponse } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

interface CaptureRecord {
  tick: number;
  entityId: string;
  componentId: string;
  value: Record<string, unknown>;
}

function parseJSONL(content: string): CaptureRecord[] {
  const lines = content.trim().split('\n');
  const records: CaptureRecord[] = [];
  
  for (const line of lines) {
    if (line.trim()) {
      try {
        const parsed = JSON.parse(line);
        records.push({
          tick: parsed.tick,
          entityId: parsed.entityId,
          componentId: parsed.componentId,
          value: parsed.value,
        });
      } catch (e) {
        console.error('Failed to parse line:', e);
      }
    }
  }
  
  return records;
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
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/control" });

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
            error: "Must register first with {type:'register', role:'frontend'|'agent'}" 
          } as ControlResponse));
          return;
        }

        const isFrontend = ws === frontendClient;
        
        if (isFrontend && message.type === "state_update") {
          broadcastToAgents(message as ControlResponse);
        } else if (!isFrontend) {
          if (frontendClient && frontendClient.readyState === WebSocket.OPEN) {
            frontendClient.send(JSON.stringify(message));
          } else {
            ws.send(JSON.stringify({ 
              type: "error", 
              error: "Frontend not connected" 
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
      const records = parseJSONL(content);
      
      if (records.length === 0) {
        return res.status(400).json({ error: 'No valid records found in file' });
      }

      const tickCount = records.length;
      const entityIds = [...new Set(records.map(r => r.entityId))];
      const componentIds = [...new Set(records.map(r => r.componentId))];

      res.json({
        success: true,
        filename: req.file.originalname,
        size: req.file.size,
        tickCount,
        records,
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
