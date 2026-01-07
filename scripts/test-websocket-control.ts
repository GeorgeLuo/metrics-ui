import WebSocket from "ws";

const WS_URL = process.env.WS_URL || "ws://localhost:5000/ws/control";

interface ControlCommand {
  type: string;
  [key: string]: unknown;
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

class WebSocketTestClient {
  private ws: WebSocket | null = null;
  private messageQueue: unknown[] = [];
  private messageResolvers: Array<(value: unknown) => void> = [];
  private role: "frontend" | "agent";

  constructor(role: "frontend" | "agent" = "agent") {
    this.role = role;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);

      this.ws.on("open", () => {
        console.log(`  Connected as ${this.role}`);
        this.send({ type: "register", role: this.role });
      });

      this.ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "ack" && message.payload?.includes("registered")) {
          console.log(`  Registration confirmed: ${message.payload}`);
          resolve();
          return;
        }
        if (this.messageResolvers.length > 0) {
          const resolver = this.messageResolvers.shift()!;
          resolver(message);
        } else {
          this.messageQueue.push(message);
        }
      });

      this.ws.on("error", (err) => {
        reject(err);
      });

      this.ws.on("close", () => {
        console.log(`  Disconnected (${this.role})`);
      });
    });
  }

  send(command: ControlCommand): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(command));
    } else {
      throw new Error("WebSocket not connected");
    }
  }

  async waitForMessage(timeoutMs = 5000): Promise<unknown> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for message"));
      }, timeoutMs);

      this.messageResolvers.push((value) => {
        clearTimeout(timeout);
        resolve(value);
      });
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<TestResult> {
  const start = Date.now();

  try {
    await testFn();
    return {
      name,
      passed: true,
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    };
  }
}

async function testAgentRegistration(): Promise<void> {
  console.log("  Testing agent registration...");
  const agent = new WebSocketTestClient("agent");
  try {
    await agent.connect();
    console.log("  Agent registered successfully");
  } finally {
    agent.close();
  }
}

async function testFrontendRegistration(): Promise<void> {
  console.log("  Testing frontend registration...");
  const frontend = new WebSocketTestClient("frontend");
  try {
    await frontend.connect();
    console.log("  Frontend registered successfully");
  } finally {
    frontend.close();
  }
}

async function testAgentToFrontendCommand(): Promise<void> {
  console.log("  Testing agent -> frontend command flow...");
  
  const frontend = new WebSocketTestClient("frontend");
  const agent = new WebSocketTestClient("agent");
  
  try {
    await frontend.connect();
    await agent.connect();
    
    console.log("  Agent sending play command...");
    agent.send({ type: "play" });
    
    const received = await frontend.waitForMessage(2000) as { type: string };
    console.log("  Frontend received:", JSON.stringify(received));
    
    if (received.type !== "play") {
      throw new Error(`Expected 'play' command, got '${received.type}'`);
    }
    console.log("  Command successfully routed to frontend");
  } finally {
    agent.close();
    frontend.close();
  }
}

async function testStateUpdate(): Promise<void> {
  console.log("  Testing frontend -> agent state broadcast...");
  
  const frontend = new WebSocketTestClient("frontend");
  const agent = new WebSocketTestClient("agent");
  
  try {
    await frontend.connect();
    await agent.connect();
    
    console.log("  Frontend broadcasting state update...");
    frontend.send({ 
      type: "state_update", 
      payload: { 
        captures: [], 
        selectedMetrics: [], 
        playback: { isPlaying: false, currentTick: 1, speed: 1, totalTicks: 0 } 
      } 
    });
    
    const received = await agent.waitForMessage(2000) as { type: string };
    console.log("  Agent received:", JSON.stringify(received));
    
    if (received.type !== "state_update") {
      throw new Error(`Expected 'state_update', got '${received.type}'`);
    }
    console.log("  State update successfully broadcast to agent");
  } finally {
    agent.close();
    frontend.close();
  }
}

async function testMultipleAgents(): Promise<void> {
  console.log("  Testing multiple agents receive broadcasts...");
  
  const frontend = new WebSocketTestClient("frontend");
  const agent1 = new WebSocketTestClient("agent");
  const agent2 = new WebSocketTestClient("agent");
  
  try {
    await frontend.connect();
    await agent1.connect();
    await agent2.connect();
    
    console.log("  Frontend broadcasting state update...");
    frontend.send({ type: "state_update", payload: { test: true } });
    
    const [r1, r2] = await Promise.all([
      agent1.waitForMessage(2000),
      agent2.waitForMessage(2000),
    ]) as [{ type: string }, { type: string }];
    
    if (r1.type !== "state_update" || r2.type !== "state_update") {
      throw new Error("Both agents should receive state_update");
    }
    console.log("  Both agents received state update");
  } finally {
    agent1.close();
    agent2.close();
    frontend.close();
  }
}

async function main() {
  console.log("\n========================================");
  console.log("WebSocket Control API Test Suite");
  console.log("========================================\n");
  console.log(`Connecting to: ${WS_URL}\n`);

  const results: TestResult[] = [];

  results.push(await runTest("Agent Registration", testAgentRegistration));
  results.push(await runTest("Frontend Registration", testFrontendRegistration));
  results.push(await runTest("Agent to Frontend Command", testAgentToFrontendCommand));
  results.push(await runTest("State Update Broadcast", testStateUpdate));
  results.push(await runTest("Multiple Agents Broadcast", testMultipleAgents));

  console.log("\n========================================");
  console.log("Test Results");
  console.log("========================================\n");

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    const statusColor = result.passed ? "\x1b[32m" : "\x1b[31m";
    console.log(`${statusColor}[${status}]\x1b[0m ${result.name} (${result.duration}ms)`);
    if (result.error) {
      console.log(`       Error: ${result.error}`);
    }
    if (result.passed) passed++;
    else failed++;
  }

  console.log("\n----------------------------------------");
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log("----------------------------------------\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
