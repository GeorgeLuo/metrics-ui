import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CHASE_TRACE_SINKS,
  createChaseTraceRecorder,
} from "./trace-recorder.mjs";

export function createNodeJsonlTraceRecorder(config = {}) {
  const filePath = typeof config?.filePath === "string" && config.filePath.trim()
    ? path.resolve(config.filePath)
    : null;

  return createChaseTraceRecorder(config, {
    appendLine: filePath
      ? (line) => appendFileSync(filePath, line, "utf8")
      : null,
    resetSink: filePath
      ? () => {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, "", "utf8");
      }
      : null,
    fallbackSink: CHASE_TRACE_SINKS.MEMORY,
  });
}
