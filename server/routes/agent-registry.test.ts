import test from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry } from "./agent-registry.ts";

test("lists every other agent with its description, oldest first", () => {
  const registry = new AgentRegistry<object>();
  const host = {};
  const probe = {};
  const requester = {};
  registry.add(host, { kind: "vehicle-host", vehicle_id: "chase-sim-chaser" }, new Date(1_000));
  registry.add(probe, undefined, new Date(2_000));
  registry.add(requester, { kind: "status-probe" }, new Date(3_000));

  assert.deepEqual(registry.list(requester), [
    {
      client: { kind: "vehicle-host", vehicle_id: "chase-sim-chaser" },
      connectedAt: "1970-01-01T00:00:01.000Z",
    },
    { client: null, connectedAt: "1970-01-01T00:00:02.000Z" },
  ]);
  assert.equal(registry.size, 3);
});

test("a description that is not an object is recorded as none", () => {
  const registry = new AgentRegistry<object>();
  const agent = {};
  registry.add(agent, ["vehicle-host"]);

  assert.equal(registry.describe(agent), null);
});

test("a disconnected agent leaves the list", () => {
  const registry = new AgentRegistry<object>();
  const host = {};
  registry.add(host, { kind: "vehicle-host" });

  assert.equal(registry.delete(host), true);
  assert.deepEqual(registry.list({}), []);
  assert.equal(registry.size, 0);
});
