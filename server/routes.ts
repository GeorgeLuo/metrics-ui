import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";

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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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
