import test from "node:test";
import assert from "node:assert/strict";
import { joinExperimentEvidence } from "./play-chase-experiment-bundle.mjs";
test("offline bundle join preserves original host times and rejects mismatched epoch or missing clock provenance", () => {
  const browser = { schema: "chase_experiment_evidence_v1", state: { identity: { simulationEpoch: "e1" } } };
  const host = { simulationEpoch: "e1", clockDomain: "host-Date.now-milliseconds", records: [{ retained_at_ms: 123, captured_at_ms: 100, original: { request_id: "r" } }] };
  const raw = JSON.stringify(host);
  const joined = joinExperimentEvidence(browser, host, raw);
  assert.deepEqual(joined.externalHostEvidence.records, host.records);
  assert.equal(joined.externalHostEvidence.clockMappingVerified, false);
  assert.equal(joined.externalHostEvidence.rawSha256.length, 64);
  assert.throws(() => joinExperimentEvidence(browser, { ...host, simulationEpoch: "e2" }, raw));
  assert.throws(() => joinExperimentEvidence(browser, { ...host, clockDomain: "" }, raw));
});
