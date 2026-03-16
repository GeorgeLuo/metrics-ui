import WebSocket from "ws";

const WS_URL = process.env.UI_WS || process.env.WS_URL || "ws://127.0.0.1:5050/ws/control";
const EPS = 1e-6;

function fail(message, context) {
  const payload = {
    status: "failed",
    ws: WS_URL,
    message,
    context: context ?? null,
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function approxEqual(a, b, epsilon = EPS) {
  return Math.abs(a - b) <= epsilon;
}

function assertApprox(label, actual, expected, failures, epsilon = EPS) {
  if (!approxEqual(actual, expected, epsilon)) {
    failures.push({
      type: "approx-mismatch",
      label,
      actual,
      expected,
      delta: actual - expected,
      epsilon,
    });
  }
}

function assertTrue(label, condition, failures, context) {
  if (!condition) {
    failures.push({
      type: "assertion-failed",
      label,
      context: context ?? null,
    });
  }
}

async function connectAgent() {
  const ws = new WebSocket(WS_URL);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out connecting to UI websocket."));
    }, 5000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", role: "agent" }));
    });

    ws.on("message", (data) => {
      let parsed;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      if (parsed?.type === "ack" && typeof parsed?.payload === "string" && parsed.payload.includes("registered")) {
        clearTimeout(timeout);
        resolve(ws);
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function requestUiDebug(ws) {
  const requestId = `framegrid-debug-${Date.now()}`;
  ws.send(JSON.stringify({ type: "get_ui_debug", request_id: requestId }));

  const deadline = Date.now() + 5000;
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      let parsed;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      if (parsed?.request_id !== requestId) {
        return;
      }
      if (parsed?.type === "ui_debug") {
        ws.off("message", onMessage);
        resolve(parsed.payload);
        return;
      }
      if (parsed?.type === "error") {
        ws.off("message", onMessage);
        reject(new Error(parsed.error || "UI returned an error."));
      }
    };

    ws.on("message", onMessage);

    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        ws.off("message", onMessage);
        reject(new Error("Timed out waiting for ui_debug response."));
      }
    }, 50);
  });
}

function evaluateFrameGrid(debugPayload) {
  const refs = debugPayload?.refs ?? {};
  const equationsFrame = refs.equationsFrame ?? null;
  if (!equationsFrame) {
    fail(
      "Equations FrameGrid debug is unavailable. Ensure the frontend is open and Equations sub-app is active.",
      { hasRefs: Boolean(debugPayload?.refs) },
    );
  }

  const {
    spec,
    container,
    expectedCellCount,
    renderedCellCount,
    layout,
    checks,
    showCellGrid,
    showOuterFrame,
    showContentFrame,
  } = equationsFrame;

  if (!layout) {
    fail("FrameGrid layout is null (container likely has zero size).", {
      container,
      spec,
    });
  }

  const [frameBorderDivX, frameBorderDivY] = spec.frameBorderDiv;
  const [gridCols, gridRows] = spec.grid;
  const [cellBorderDivX, cellBorderDivY] = spec.cellBorderDiv;

  const expectedFrameBorderX = frameBorderDivX === 0 ? 0 : layout.frame.width / frameBorderDivX;
  const expectedFrameBorderY = frameBorderDivY === 0 ? 0 : layout.frame.height / frameBorderDivY;
  const expectedContentWidth = layout.frame.width - 2 * layout.frameBorderX;
  const expectedContentHeight = layout.frame.height - 2 * layout.frameBorderY;
  const expectedCellWidth = layout.content.width / gridCols;
  const expectedCellHeight = layout.content.height / gridRows;
  const expectedCellBorderX = cellBorderDivX === 0 ? 0 : layout.cellWidth / cellBorderDivX;
  const expectedCellBorderY = cellBorderDivY === 0 ? 0 : layout.cellHeight / cellBorderDivY;
  const expectedCount = gridCols * gridRows;
  const centerDeltaX =
    layout.frame.x + layout.frame.width / 2 - container.width / 2;
  const centerDeltaY =
    layout.frame.y + layout.frame.height / 2 - container.height / 2;

  const failures = [];
  assertTrue("container.width > 0", container.width > 0, failures, { container });
  assertTrue("container.height > 0", container.height > 0, failures, { container });
  assertApprox("frameBorderX", layout.frameBorderX, expectedFrameBorderX, failures);
  assertApprox("frameBorderY", layout.frameBorderY, expectedFrameBorderY, failures);
  assertApprox("contentWidth", layout.content.width, expectedContentWidth, failures);
  assertApprox("contentHeight", layout.content.height, expectedContentHeight, failures);
  assertApprox("cellWidth", layout.cellWidth, expectedCellWidth, failures);
  assertApprox("cellHeight", layout.cellHeight, expectedCellHeight, failures);
  assertApprox("cellBorderX", layout.cellBorderX, expectedCellBorderX, failures);
  assertApprox("cellBorderY", layout.cellBorderY, expectedCellBorderY, failures);
  assertTrue(
    "cellCount === gridCols * gridRows",
    layout.cellCount === expectedCount && expectedCellCount === expectedCount,
    failures,
    { layoutCellCount: layout.cellCount, expectedCellCount, expectedCount },
  );
  if (showCellGrid) {
    assertTrue(
      "renderedCellCount === expectedCount",
      renderedCellCount === expectedCount,
      failures,
      { renderedCellCount, expectedCount },
    );
  }
  assertApprox("frame center X", centerDeltaX, 0, failures, 1e-3);
  assertApprox("frame center Y", centerDeltaY, 0, failures, 1e-3);

  if (spec.fitMode === "contain") {
    assertTrue(
      "contain fit inside container",
      layout.frame.width <= container.width + EPS && layout.frame.height <= container.height + EPS,
      failures,
      { frame: layout.frame, container },
    );
  }

  if (checks) {
    if (checks.frameBorderXDelta !== null) {
      assertApprox("checks.frameBorderXDelta", checks.frameBorderXDelta, 0, failures);
    }
    if (checks.frameBorderYDelta !== null) {
      assertApprox("checks.frameBorderYDelta", checks.frameBorderYDelta, 0, failures);
    }
    if (checks.contentWidthDelta !== null) {
      assertApprox("checks.contentWidthDelta", checks.contentWidthDelta, 0, failures);
    }
    if (checks.contentHeightDelta !== null) {
      assertApprox("checks.contentHeightDelta", checks.contentHeightDelta, 0, failures);
    }
    if (checks.cellWidthDelta !== null) {
      assertApprox("checks.cellWidthDelta", checks.cellWidthDelta, 0, failures);
    }
    if (checks.cellHeightDelta !== null) {
      assertApprox("checks.cellHeightDelta", checks.cellHeightDelta, 0, failures);
    }
    if (checks.cellBorderXDelta !== null) {
      assertApprox("checks.cellBorderXDelta", checks.cellBorderXDelta, 0, failures);
    }
    if (checks.cellBorderYDelta !== null) {
      assertApprox("checks.cellBorderYDelta", checks.cellBorderYDelta, 0, failures);
    }
  }

  const summary = {
    status: failures.length === 0 ? "ok" : "failed",
    ws: WS_URL,
    spec,
    container,
    flags: {
      showCellGrid,
      showOuterFrame,
      showContentFrame,
    },
    extracted: {
      frame: layout.frame,
      content: layout.content,
      frameBorderX: layout.frameBorderX,
      frameBorderY: layout.frameBorderY,
      cellWidth: layout.cellWidth,
      cellHeight: layout.cellHeight,
      cellBorderX: layout.cellBorderX,
      cellBorderY: layout.cellBorderY,
      expectedCellCount,
      renderedCellCount,
      layoutCellCount: layout.cellCount,
    },
    calculated: {
      expectedFrameBorderX,
      expectedFrameBorderY,
      expectedContentWidth,
      expectedContentHeight,
      expectedCellWidth,
      expectedCellHeight,
      expectedCellBorderX,
      expectedCellBorderY,
      expectedCount,
      centerDeltaX,
      centerDeltaY,
    },
    failures,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) {
    process.exit(1);
  }
}

async function main() {
  const ws = await connectAgent();
  try {
    const uiDebug = await requestUiDebug(ws);
    evaluateFrameGrid(uiDebug);
  } finally {
    ws.close();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
