import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type GameSnapshot = {
  digest: string;
  identity: { schema: string; digest: string; scope: string; modules: { path: string; sha256: string }[] };
  files: Map<string, string>;
};
const sha = (source: string) => createHash("sha256").update(source).digest("hex");

/** Materialize before import. Every relative game import stays in this immutable URL tree. */
export function createGameSnapshot(directory: string, entry: string, transform: (file: string, source: string) => string): GameSnapshot {
  const files = new Map<string, string>();
  const collect = (dir: string) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) collect(file);
      else if (/\.(mjs|ts)$/.test(name) && !name.includes(".test.")) {
        files.set(path.relative(directory, file).split(path.sep).join("/"), transform(file, fs.readFileSync(file, "utf8")));
      }
    }
  };
  collect(directory);
  const modules = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, source]) => ({ path: name, sha256: sha(source) }));
  const digest = sha(JSON.stringify(modules));
  const identity = { schema: "play_game_snapshot_v1", digest, scope: "served-game-modules-excludes-shell-and-three", modules };
  const entryName = path.relative(directory, entry).split(path.sep).join("/");
  if (!files.has(entryName)) throw new Error("Snapshot entry is missing");
  files.set(entryName, `${files.get(entryName)}\nexport const experimentBuildIdentity = ${JSON.stringify(identity)};\n`);
  return { digest, identity, files };
}
