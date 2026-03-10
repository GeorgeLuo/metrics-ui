import { runCommand, withIsolatedServer, repoRoot } from "./lib/regress-harness.mjs";

async function run() {
  console.log("[refactor-regress] running shell contract regression");
  await runCommand("node", ["scripts/subapp-shell-regress.mjs"], {
    cwd: repoRoot,
    label: "subapp-shell-regress",
  });

  console.log("[refactor-regress] running ws/protocol regressions on isolated server");
  await withIsolatedServer({ port: 5075, host: "127.0.0.1", build: true }, async ({ uiHttp, uiWs }) => {
    const env = {
      ...process.env,
      UI_HTTP: uiHttp,
      UI_WS: uiWs,
    };

    await runCommand("node", ["scripts/single-frontend-regress.mjs"], {
      cwd: repoRoot,
      env,
      label: "single-frontend-regress",
    });
    await runCommand("node", ["scripts/derivation-plugin-regress.mjs"], {
      cwd: repoRoot,
      env,
      label: "derivation-plugin-regress",
    });
    await runCommand("node", ["scripts/derivation-chain-regress.mjs"], {
      cwd: repoRoot,
      env,
      label: "derivation-chain-regress",
    });
  });

  console.log("[refactor-regress] PASS");
}

run().catch((error) => {
  console.error("[refactor-regress] FAIL:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
