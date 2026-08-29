import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { registerPlayGameRoutes } from "./play-game-routes.ts";

const JAVASCRIPT_CONTENT_TYPE = /^application\/javascript(?:;|$)/u;
const GAME_FILE_PREFIX = "/api/play/games/chase/files/";

function getModuleSpecifiers(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/[^\r\n]*/gu, "");
  const specifiers = new Set<string>();
  for (const pattern of [
    /\bimport\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/gu,
    /\bexport\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ]) {
    for (const match of withoutComments.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

async function startPlayGameServer() {
  const app = express();
  registerPlayGameRoutes({ app, projectRoot: process.cwd() });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Play game route test server did not expose a TCP address.");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("served Chase modules form a browser-loadable JavaScript graph", async () => {
  const { server, baseUrl } = await startPlayGameServer();
  try {
    const pending = [new URL(`${GAME_FILE_PREFIX}chase-game.mjs?test=module-graph`, baseUrl)];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const moduleUrl = pending.shift();
      assert.ok(moduleUrl);
      const moduleKey = `${moduleUrl.pathname}${moduleUrl.search}`;
      if (visited.has(moduleKey)) {
        continue;
      }
      visited.add(moduleKey);

      const response = await fetch(moduleUrl);
      const contentType = response.headers.get("content-type") ?? "";
      assert.equal(response.status, 200, `${moduleUrl} returned ${response.status}`);
      assert.match(contentType, JAVASCRIPT_CONTENT_TYPE, `${moduleUrl} returned ${contentType}`);
      const source = await response.text();

      for (const specifier of getModuleSpecifiers(source)) {
        if (specifier.startsWith("/api/visualization/")) {
          continue;
        }
        assert.ok(
          specifier.startsWith(".") || specifier.startsWith("/"),
          `${moduleUrl} contains an unresolved bare import: ${specifier}`,
        );
        const resolved = new URL(specifier, moduleUrl);
        assert.equal(resolved.origin, baseUrl, `${moduleUrl} imports another origin`);
        assert.ok(
          resolved.pathname.startsWith(GAME_FILE_PREFIX),
          `${moduleUrl} resolves ${specifier} outside the served game route: ${resolved}`,
        );
        pending.push(resolved);
      }
    }

    assert.ok(visited.size > 100, `Expected the full Chase graph, visited ${visited.size} modules.`);
    assert.ok(
      [...visited].some((moduleKey) => moduleKey.endsWith("/chase/evaluation/camera-stream.ts")),
      "Expected the camera-stream module to be part of the served graph.",
    );
  } finally {
    await stopServer(server);
  }
});
