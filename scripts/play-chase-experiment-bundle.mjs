import fs from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

/** Join retained host evidence without replacing its timestamps or original bytes. */
export function joinExperimentEvidence(browser, host, hostRaw) {
  if (browser.schema !== "chase_experiment_evidence_v1") throw new Error("Expected native experiment evidence");
  if (host.simulationEpoch !== browser.state.identity.simulationEpoch) throw new Error("Host evidence epoch mismatch");
  if (typeof host.clockDomain !== "string" || !host.clockDomain.trim() || !Array.isArray(host.records)) throw new Error("Host evidence needs explicit clockDomain and original records");
  return { ...browser, externalHostEvidence: { ...host,
    rawSha256: createHash("sha256").update(hostRaw).digest("hex"),
    provenance: "caller-supplied-unverified", clockMappingVerified: false } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [browserPath, hostPath] = process.argv.slice(2);
  if (!browserPath || !hostPath || process.argv.length !== 4) {
    console.error("Usage: node scripts/play-chase-experiment-bundle.mjs browser-export.json host-evidence.json > bundle.json");
    process.exitCode = 1;
  } else {
    const raw = fs.readFileSync(hostPath);
    const result = joinExperimentEvidence(JSON.parse(fs.readFileSync(browserPath, "utf8")), JSON.parse(raw.toString()), raw);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
}
