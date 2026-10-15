import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGameSnapshot } from "./play-game-snapshot";

test("module snapshot identity is content-based and retained bytes survive source changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "play-snapshot-"));
  try {
    fs.writeFileSync(path.join(dir, "game.mjs"), 'export { value } from "./value.mjs";');
    fs.writeFileSync(path.join(dir, "value.mjs"), 'export const value = 1;');
    const build = () => createGameSnapshot(dir, path.join(dir, "game.mjs"), (_p, s) => s);
    const first = build();
    assert.equal(first.digest, build().digest);
    assert.match(first.files.get("game.mjs")!, /experimentBuildIdentity/);
    fs.writeFileSync(path.join(dir, "value.mjs"), 'export const value = 2;');
    assert.notEqual(first.digest, build().digest);
    assert.equal(first.files.get("value.mjs"), 'export const value = 1;');
    assert.equal(first.identity.scope, "served-game-modules-excludes-shell-and-three");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("catalog and snapshot routes serve one immutable browser-loadable graph without a listener", async () => {
  const { registerPlayGameRoutes } = await import("./play-game-routes.ts");
  const routes = new Map<string, Function>();
  const app = { get(route: string, handler: Function) { routes.set(route, handler); } };
  registerPlayGameRoutes({ app: app as never, projectRoot: process.cwd() });
  let catalog: { games: { moduleUrl: string }[] } | undefined;
  routes.get("/api/play/games")!({}, { json(value: typeof catalog) { catalog = value; } });
  const entry = new URL(catalog!.games[0].moduleUrl, "http://snapshot.invalid");
  assert.match(entry.pathname, /\/snapshots\/[a-f0-9]{64}\/files\//);
  const prefix = entry.pathname.split("/files/")[0] + "/files/";
  const digest = entry.pathname.split("/snapshots/")[1].split("/")[0];
  const handler = routes.get("/api/play/games/:gameId/snapshots/:digest/files/*")!;
  const pending = [entry], visited = new Set<string>();
  while (pending.length) {
    const url = pending.pop()!;
    if (visited.has(url.pathname)) continue;
    visited.add(url.pathname);
    let source = "";
    const response = { set() { return this; }, type() { return this; }, send(value: string) { source = value; return this; }, status() { throw new Error("snapshot route failed"); } };
    handler({ params: { gameId: "chase", digest, 0: url.pathname.slice(prefix.length) } }, response);
    assert.ok(source.length > 0);
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) {
      if (match[1].startsWith("/api/visualization/")) continue;
      assert.ok(match[1].startsWith("."), `Unresolved import: ${match[1]}`);
      const next = new URL(match[1], url);
      assert.ok(next.pathname.startsWith(prefix), `Import escaped snapshot: ${next}`);
      pending.push(next);
    }
  }
  assert.ok(visited.size > 100);
});
