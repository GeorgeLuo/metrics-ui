let fallbackEpochSequence = 0;

function createSimulationEpoch() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (typeof randomUuid === "string" && randomUuid) {
    return `chase-run:${randomUuid}`;
  }

  fallbackEpochSequence += 1;
  return [
    "chase-run",
    Date.now().toString(36),
    fallbackEpochSequence.toString(36),
    Math.random().toString(36).slice(2),
  ].join(":");
}

function requireEpoch(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Chase simulation epoch generation returned an empty identity.");
  }
  return value.trim();
}

/** Owns the opaque identity for the current Chase simulation run. */
export function createChaseSimulationEpochOwner({
  generateEpoch = createSimulationEpoch,
} = {}) {
  let currentEpoch = requireEpoch(generateEpoch());

  return Object.freeze({
    current() {
      return currentEpoch;
    },
    beginRun() {
      const nextEpoch = requireEpoch(generateEpoch());
      if (nextEpoch === currentEpoch) {
        throw new Error("A new Chase simulation run requires a distinct epoch.");
      }
      currentEpoch = nextEpoch;
      return currentEpoch;
    },
  });
}
