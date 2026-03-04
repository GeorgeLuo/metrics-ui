import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, "..", "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

export function runCommand(cmd, args, options = {}) {
  const {
    cwd = repoRoot,
    env = process.env,
    label = `${cmd} ${args.join(" ")}`,
    stdio = "pipe",
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio });
    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        stdout += text;
        process.stdout.write(text);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        process.stderr.write(text);
      });
    }

    child.on("error", (error) => {
      reject(new Error(`[regress-harness] ${label} failed to start: ${formatError(error)}`));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `[regress-harness] ${label} exited with code=${code ?? "null"} signal=${signal ?? "none"}`,
        ),
      );
    });
  });
}

async function waitForHttpReady(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = formatError(error);
    }
    await sleep(250);
  }

  throw new Error(`[regress-harness] timed out waiting for ${url}: ${lastError}`);
}

async function stopServer(child, label) {
  if (!child || child.killed) {
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore hard kill failures
      }
      done();
    }, 3000);
    child.once("close", () => {
      clearTimeout(timer);
      done();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timer);
      done();
    }
  });
  process.stdout.write(`[regress-harness] stopped ${label}\n`);
}

export async function withIsolatedServer(options, run) {
  const {
    port = 5075,
    host = "127.0.0.1",
    build = true,
  } = options ?? {};

  if (build) {
    await runCommand("npm", ["run", "build"], {
      cwd: repoRoot,
      label: "npm run build",
      stdio: "pipe",
    });
  }

  const env = {
    ...process.env,
    NODE_ENV: "production",
    HOST: String(host),
    PORT: String(port),
    REUSE_PORT: "false",
  };
  const label = `ui-server:${host}:${port}`;
  const server = spawn("node", ["dist/index.cjs"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (server.stdout) {
    server.stdout.on("data", (chunk) => process.stdout.write(String(chunk)));
  }
  if (server.stderr) {
    server.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
  }

  try {
    await waitForHttpReady(`http://${host}:${port}/api/live/status`);
    const context = {
      host,
      port,
      uiHttp: `http://${host}:${port}`,
      uiWs: `ws://${host}:${port}/ws/control`,
    };
    return await run(context);
  } finally {
    await stopServer(server, label);
  }
}

