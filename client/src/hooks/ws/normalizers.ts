import type { CaptureAppendFrame, CaptureRecord, CaptureRecordLine } from "@shared/schema";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeCaptureAppendFrame(frame: CaptureAppendFrame): CaptureRecord | null {
  if (!frame || typeof frame !== "object") {
    return null;
  }

  const maybe = frame as CaptureRecord & CaptureRecordLine;
  if (!isFiniteNumber(maybe.tick)) {
    return null;
  }

  if (
    maybe.entities &&
    typeof maybe.entities === "object" &&
    !Array.isArray(maybe.entities)
  ) {
    return {
      tick: maybe.tick,
      entities: maybe.entities as Record<string, Record<string, unknown>>,
    };
  }

  if (typeof maybe.entityId === "string" && typeof maybe.componentId === "string") {
    return {
      tick: maybe.tick,
      entities: {
        [maybe.entityId]: {
          [maybe.componentId]: maybe.value,
        },
      },
    };
  }

  return null;
}

export function isBenignAbortErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "aborterror" ||
    normalized === "aborted" ||
    normalized.includes("aborterror") ||
    normalized.includes("operation was aborted") ||
    normalized.includes("request was aborted")
  );
}
