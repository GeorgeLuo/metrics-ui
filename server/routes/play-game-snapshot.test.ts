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

async function customCatalogFixture(gameCount: number) {
  const { createServer } = await import("node:http");
  const { default: express } = await import("express");
  const { registerPlayGameRoutes } = await import("./play-game-routes.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "play-catalog-retention-"));
  const directory = path.join(root, "examples/play");
  const catalogFile = path.join(directory, "play-game-catalog.json");
  const games = Array.from({ length: gameCount }, (_, index) => ({ id: `game-${index}`, moduleFile: `game-${index}/entry.mjs` }));
  for (const game of games) {
    fs.mkdirSync(path.join(directory, game.id), { recursive: true });
    fs.writeFileSync(path.join(directory, game.moduleFile), 'export { value } from "./value.mjs";');
    fs.writeFileSync(path.join(directory, game.id, "value.mjs"), "export const value = 0;");
  }
  const writeCatalog = (entries = games) => fs.writeFileSync(catalogFile, JSON.stringify({ games: entries }));
  writeCatalog();
  const previousCatalog = process.env.METRICS_UI_PLAY_GAME_CATALOG_FILE;
  process.env.METRICS_UI_PLAY_GAME_CATALOG_FILE = catalogFile;
  const app = express();
  registerPlayGameRoutes({ app, projectRoot: root });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (url: string) => fetch(new URL(url, origin));
  return {
    games, writeCatalog, get,
    invalidateCatalog() { fs.writeFileSync(catalogFile, "{"); },
    writeValue(value: number) { fs.writeFileSync(path.join(directory, "game-0/value.mjs"), `export const value = ${value};`); },
    async catalog(): Promise<{ games: { id: string; moduleUrl: string }[] }> {
      const response = await get("/api/play/games");
      assert.equal(response.status, 200);
      return response.json();
    },
    async module(gameId = "game-0"): Promise<string> {
      const response = await fetch(`${origin}/api/play/games/${gameId}/module`, { redirect: "manual" });
      assert.equal(response.status, 307);
      return response.headers.get("location")!;
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousCatalog === undefined) delete process.env.METRICS_UI_PLAY_GAME_CATALOG_FILE;
      else process.env.METRICS_UI_PLAY_GAME_CATALOG_FILE = previousCatalog;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("all nine games advertised in repeated catalogs have immediately loadable entry and import URLs", async () => {
  const fixture = await customCatalogFixture(9);
  try {
    for (let request = 0; request < 2; request++) {
      const { games } = await fixture.catalog();
      assert.equal(games.length, 9);
      for (const game of games) {
        const response = await fixture.get(game.moduleUrl);
        assert.equal(response.status, 200, `${game.id} was evicted by its own catalog response`);
        assert.match(response.headers.get("content-type")!, /^application\/javascript/);
        const source = await response.text();
        for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
          const imported = await fixture.get(new URL(match[1], new URL(game.moduleUrl, "http://snapshot.invalid")).pathname);
          assert.equal(imported.status, 200);
          assert.equal(await imported.text(), "export const value = 0;");
        }
      }
    }
  } finally { await fixture.close(); }
});

test("revision retention is per game, refreshes reused snapshots, and prunes removed catalog games", async () => {
  const fixture = await customCatalogFixture(2);
  try {
    const initial = await fixture.catalog();
    const urls = [initial.games[0].moduleUrl];
    const otherGameUrl = initial.games[1].moduleUrl;
    for (let value = 1; value <= 7; value++) {
      fixture.writeValue(value);
      urls.push(await fixture.module());
    }
    for (const url of [...urls, otherGameUrl]) assert.equal((await fixture.get(url)).status, 200);
    fixture.writeValue(0);
    assert.equal(await fixture.module(), urls[0], "An existing digest should refresh its retention order");
    fixture.writeValue(8);
    const currentUrl = await fixture.module();
    assert.equal((await fixture.get(urls[1])).status, 410);
    for (const url of [urls[0], ...urls.slice(2), currentUrl, otherGameUrl]) assert.equal((await fixture.get(url)).status, 200);
    const valueUrl = (url: string) => url.replace(/entry\.mjs$/, "value.mjs");
    assert.equal(await (await fixture.get(valueUrl(urls[0]))).text(), "export const value = 0;");
    assert.equal(await (await fixture.get(valueUrl(currentUrl))).text(), "export const value = 8;");
    for (let request = 0; request < 3; request++) assert.equal(await fixture.module(), currentUrl);
    assert.equal((await fixture.get(urls[2])).status, 200, "Reusing one digest must not consume more retention slots");
    fixture.writeCatalog([fixture.games[0]]);
    await fixture.module();
    assert.equal((await fixture.get(otherGameUrl)).status, 410);
    assert.equal((await fixture.get(currentUrl)).status, 200);
  } finally { await fixture.close(); }
});


test("a failed catalog reload preserves retained snapshots; a successful reload prunes removed games", async (t) => {
  const fixture = await customCatalogFixture(2);
  t.mock.method(console, "error", () => {});
  try {
    const initial = await fixture.catalog();
    fixture.invalidateCatalog();
    assert.equal((await fixture.get("/api/play/games")).status, 500);
    for (const game of initial.games) assert.equal((await fixture.get(game.moduleUrl)).status, 200);
    fixture.writeCatalog([fixture.games[0]]);
    assert.equal((await fixture.catalog()).games.length, 1);
    assert.equal((await fixture.get(initial.games[1].moduleUrl)).status, 410);
    assert.equal((await fixture.get(initial.games[0].moduleUrl)).status, 200);
  } finally { await fixture.close(); }
});
