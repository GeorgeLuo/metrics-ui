import WebSocket from "ws";

const UI_WS = process.env.UI_WS ?? "ws://127.0.0.1:5050/ws/control";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectFrontend({ instanceId, takeover }) {
  const ws = new WebSocket(UI_WS);
  const events = { acks: [], errors: [], closes: [] };

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(String(data));
      if (msg.type === "ack") events.acks.push(msg);
      if (msg.type === "error") events.errors.push(msg);
    } catch {
      // ignore non-json
    }
  });

  ws.on("close", (code, reason) => {
    events.closes.push({ code, reason: String(reason ?? "") });
  });

  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  ws.send(JSON.stringify({ type: "register", role: "frontend", instanceId, takeover }));

  return { ws, events };
}

async function main() {
  console.log(`[single-frontend-regress] ws=${UI_WS}`);

  // Use takeover for the first connection so the test is robust even if a stale UI tab is open.
  const first = await connectFrontend({ instanceId: "first", takeover: true });
  await wait(500);
  if (first.events.acks.length === 0) {
    throw new Error(
      `First frontend did not receive ack. closes=${JSON.stringify(first.events.closes)} errors=${JSON.stringify(first.events.errors)}`,
    );
  }

  const second = await connectFrontend({ instanceId: "second", takeover: false });
  await wait(500);
  const secondClosedBusy = second.events.closes.some((c) => c.code === 4000);
  if (!secondClosedBusy) {
    throw new Error(
      `Second frontend expected close code 4000 (busy). closes=${JSON.stringify(second.events.closes)}`,
    );
  }

  const third = await connectFrontend({ instanceId: "third", takeover: true });
  await wait(300);
  if (third.events.acks.length === 0) {
    throw new Error("Third frontend (takeover) did not receive ack.");
  }

  // The first connection should be forcibly closed by takeover.
  const firstReplaced = first.events.closes.some((c) => c.code === 4001);
  if (!firstReplaced) {
    throw new Error(
      `First frontend expected close code 4001 (replaced). closes=${JSON.stringify(first.events.closes)}`,
    );
  }

  try {
    second.ws.close();
  } catch {}
  try {
    third.ws.close();
  } catch {}

  console.log("[single-frontend-regress] PASS");
}

main().catch((err) => {
  console.error("[single-frontend-regress] FAIL:", err?.stack || String(err));
  process.exitCode = 1;
});
