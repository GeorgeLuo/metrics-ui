const clone = (value) => structuredClone(value);
const clock = "browser-performance.now-microseconds";
async function hashBytes(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Evaluator-only retention. Original capture payloads are never sent into policy. */
export function createExperimentEvidence({ getState, trace, maxCameraRecords = 64, maxCameraBytes = 32 * 1024 * 1024 }) {
  let cameras = [], receipts = [], dropped = 0, droppedReceipts = 0, cameraBytes = 0;
  return {
    beginRun() { cameras = []; receipts = []; dropped = 0; droppedReceipts = 0; cameraBytes = 0; },
    recordReceipt(receipt) {
      if (receipts.length >= 4096) { droppedReceipts++; return; }
      receipts.push(clone(receipt));
    },
    recordCamera(response, timing) {
      const size = JSON.stringify(response).length;
      if (cameras.length >= maxCameraRecords || cameraBytes + size > maxCameraBytes) { dropped++; return; }
      cameraBytes += size;
      cameras.push({ identity: getState().identity, response: clone(response), timing: { ...timing, clockDomain: clock } });
    },
    async export(options = {}) {
      // Freeze all state before asynchronous hashing; no mixed endpoint snapshot.
      const state = getState(), native = trace.snapshot({ expectedSimulationEpoch: options.expectedSimulationEpoch });
      const retained = clone(cameras), droppedCameraRecords = dropped;
      const commandReceipts = clone(receipts), droppedCommandReceipts = droppedReceipts;
      if (options.expectedSimulationEpoch && options.expectedSimulationEpoch !== state.identity.simulationEpoch) throw new Error("Evidence epoch mismatch");
      const start = options.startFrame ?? 1;
      if (!Number.isInteger(start) || start < 1 || start > native.currentFrameIndex + 1) throw new Error("Invalid committed suffix start");
      const cameraRecords = await Promise.all(retained.map(async (record) => {
        const image = record.response.sensor?.image;
        let bytes = null;
        if (image?.dataUrl) {
          const [header, data] = image.dataUrl.split(",");
          if (!header.endsWith(";base64") || !data) throw new Error("Unsupported retained image encoding");
          bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        } else if (image?.svg) bytes = new TextEncoder().encode(image.svg);
        return { ...record, imageSha256: bytes ? await hashBytes(bytes) : null };
      }));
      return { schema: "chase_experiment_evidence_v1", classification: "non-sensor", state,
        trace: native, baseline: native.frames.find((f) => f.frameIndex === 0) ?? null,
        suffix: { startFrame: start, endFrame: native.currentFrameIndex, frames: native.frames.filter((f) => f.frameIndex >= start) },
        cameraRecords, droppedCameraRecords, commandReceipts, droppedCommandReceipts,
        clockDomains: { cameraRetention: clock, committedFrames: native.committedAtClock,
          hostRetention: "external-host-clock-not-collected", hostDelivery: "external-host-clock-not-collected", mappingVerified: false },
        coverage: "sampled-atomic-captures", authenticity: "self-reported-not-attested" };
    },
  };
}
