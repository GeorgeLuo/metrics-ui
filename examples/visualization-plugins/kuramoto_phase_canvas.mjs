export default {
  id: "kuramoto_phase_canvas",
  name: "Kuramoto Phase Canvas",
  description: "Canvas visualization of oscillator phases as a spinner grid with order-parameter overlay.",
  renderScript: `
(() => {
  const bridge = window.MetricsUIBridge;
  if (!bridge || typeof bridge !== "object") {
    return;
  }

  const shell = typeof bridge.createFactoryShell === "function"
    ? bridge.createFactoryShell({ title: "Kuramoto Phase Canvas" })
    : null;
  const root = shell && shell.root
    ? shell.root
    : document.getElementById("metrics-ui-visual-root");
  if (!root) {
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.zIndex = "3";
  root.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    root.textContent = "Canvas unavailable";
    return;
  }

  const state = {
    frame: null,
    width: 0,
    height: 0,
    dpr: 1,
    lastReportAt: 0,
    lastValuesAt: 0,
  };

  const PALETTE = [
    "#22c55e",
    "#3b82f6",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#14b8a6",
    "#eab308",
    "#f97316",
    "#06b6d4",
    "#84cc16",
    "#6366f1",
    "#ec4899",
  ];

  const asNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const toNumeric = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    if (Array.isArray(value) && value.length > 0) {
      for (let i = 0; i < value.length; i += 1) {
        const inner = toNumeric(value[i]);
        if (Number.isFinite(inner)) {
          return inner;
        }
      }
      return NaN;
    }
    if (!value || typeof value !== "object") {
      return NaN;
    }
    const obj = value;
    const directCandidates = [
      "value",
      "current",
      "scalar",
      "number",
      "n",
      "x",
    ];
    for (let i = 0; i < directCandidates.length; i += 1) {
      const key = directCandidates[i];
      if (key in obj) {
        const inner = toNumeric(obj[key]);
        if (Number.isFinite(inner)) {
          return inner;
        }
      }
    }
    const entries = Object.entries(obj);
    for (let i = 0; i < entries.length; i += 1) {
      const inner = toNumeric(entries[i][1]);
      if (Number.isFinite(inner)) {
        return inner;
      }
    }
    return NaN;
  };

  const describeValue = (value) => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value.length > 96 ? value.slice(0, 96) + "…" : value;
    }
    if (Array.isArray(value)) {
      return "array(" + String(value.length) + ")";
    }
    if (typeof value === "object") {
      const keys = Object.keys(value);
      return "object(" + keys.slice(0, 8).join(",") + (keys.length > 8 ? ",…" : "") + ")";
    }
    return String(value);
  };

  const getRecordEntities = (frame) => {
    if (!frame || !frame.record || typeof frame.record !== "object") return null;
    const entities = frame.record.entities;
    if (!entities || typeof entities !== "object") return null;
    return entities;
  };

  const extractData = (frame) => {
    const entities = getRecordEntities(frame);
    if (!entities) {
      return {
        oscillators: [],
        orderR: 0,
        tick: 0,
        sampleEntityId: null,
        sampleEntityKeys: [],
        sampleOscIdRaw: null,
        sampleOscPhaseRaw: null,
      };
    }

    const oscillators = [];
    let orderR = 0;
    let sampleEntityId = null;
    let sampleEntityKeys = [];
    let sampleOscIdRaw = null;
    let sampleOscPhaseRaw = null;
    for (const [entityId, value] of Object.entries(entities)) {
      if (!value || typeof value !== "object") continue;
      if (!sampleEntityId) {
        sampleEntityId = entityId;
        sampleEntityKeys = Object.keys(value).slice(0, 16);
      }
      if (!/^\\d+$/.test(entityId)) continue;
      const oscIdRaw =
        value.osc_id
        ?? value.oscillator_id
        ?? value.id
        ?? null;
      const phaseRaw =
        value.osc_phase
        ?? value.phase
        ?? value.oscillator_phase
        ?? value.series_phase
        ?? null;
      if (sampleEntityId === entityId) {
        sampleOscIdRaw = oscIdRaw;
        sampleOscPhaseRaw = phaseRaw;
      }
      const oscIdCandidate = toNumeric(oscIdRaw);
      const oscId = Number.isFinite(oscIdCandidate) ? oscIdCandidate : toNumeric(entityId);
      const phase = toNumeric(phaseRaw);
      if (Number.isFinite(oscId) && Number.isFinite(phase)) {
        oscillators.push({
          id: oscId,
          phase,
        });
      }
      const orderRaw =
        value.series_order_parameter_r
        ?? value.order_parameter_r
        ?? value.r
        ?? null;
      const maybeOrder = toNumeric(orderRaw);
      if (Number.isFinite(maybeOrder)) {
        orderR = maybeOrder;
      }
    }
    oscillators.sort((a, b) => a.id - b.id);
    const tick = asNumber(frame.tick, 0);
    return {
      oscillators,
      orderR,
      tick,
      sampleEntityId,
      sampleEntityKeys,
      sampleOscIdRaw,
      sampleOscPhaseRaw,
    };
  };

  const drawSpinner = (cx, cy, radius, theta, color, label) => {
    ctx.save();
    ctx.translate(cx, cy);

    ctx.strokeStyle = "rgba(100,116,139,0.38)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(148,163,184,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-radius, 0);
    ctx.lineTo(radius, 0);
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, radius);
    ctx.stroke();

    const x = Math.cos(theta) * radius;
    const y = Math.sin(theta) * radius;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(x, y);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2.6, radius * 0.12), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(15,23,42,0.9)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, 0, radius + 6);

    ctx.restore();
  };

  const resize = () => {
    const rect = root.getBoundingClientRect();
    state.width = Math.max(1, Math.floor(rect.width));
    state.height = Math.max(1, Math.floor(rect.height));
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    canvas.style.width = state.width + "px";
    canvas.style.height = state.height + "px";
    draw();
  };

    const draw = () => {
    const w = state.width;
    const h = state.height;
    const dpr = state.dpr;
    const {
      oscillators,
      orderR,
      tick,
      sampleEntityId,
      sampleEntityKeys,
      sampleOscIdRaw,
      sampleOscPhaseRaw,
    } = extractData(state.frame);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "rgba(15,23,42,0.88)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Tick " + String(tick), 16, 24);
    ctx.fillText("Order r " + orderR.toFixed(3), 16, 42);
    ctx.fillText("Oscillators " + String(oscillators.length), 16, 60);

    const cols = Math.max(1, Math.min(4, oscillators.length || 1));
    const rows = Math.max(1, Math.ceil((oscillators.length || 1) / cols));
    const topPad = 92;
    const bottomPad = 28;
    const sidePad = 26;

    const usableW = Math.max(1, w - sidePad * 2);
    const usableH = Math.max(1, h - topPad - bottomPad);
    const cellW = usableW / cols;
    const cellH = usableH / rows;
    const radius = Math.max(10, Math.min(cellW, cellH) * 0.28);

    for (let i = 0; i < oscillators.length; i += 1) {
      const osc = oscillators[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = sidePad + col * cellW + cellW * 0.5;
      const cy = topPad + row * cellH + cellH * 0.42;
      const color = PALETTE[i % PALETTE.length];
      drawSpinner(cx, cy, radius, osc.phase, color, "Osc " + String(osc.id));
    }

    const barX = 150;
    const barY = 46;
    const barW = Math.max(120, Math.min(240, w * 0.25));
    const barH = 9;

    ctx.fillStyle = "rgba(100,116,139,0.22)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = "rgba(15,23,42,0.75)";
    ctx.fillRect(barX, barY, barW * Math.max(0, Math.min(1, orderR)), barH);

    ctx.strokeStyle = "rgba(15,23,42,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(barX, barY, barW, barH);
    ctx.stroke();
  };

  const onFrame = (frame) => {
    state.frame = frame;
    const {
      oscillators,
      orderR,
      tick,
      sampleEntityId,
      sampleEntityKeys,
      sampleOscIdRaw,
      sampleOscPhaseRaw,
    } = extractData(state.frame);
    draw();
    const now = Date.now();
    if (now - state.lastValuesAt > 200) {
      state.lastValuesAt = now;
      const entities = getRecordEntities(frame);
      const valuesPayload = {
        tick,
        hasRecord: Boolean(frame && frame.record && typeof frame.record === "object"),
        entityCount: entities ? Object.keys(entities).length : 0,
        oscillatorCount: oscillators.length,
        oscillatorIds: oscillators.slice(0, 16).map((osc) => osc.id),
        phaseCount: oscillators.length,
        orderR,
        sampleEntityId,
        sampleEntityKeys,
        sampleOscIdRaw: describeValue(sampleOscIdRaw),
        sampleOscPhaseRaw: describeValue(sampleOscPhaseRaw),
      };
      if (typeof bridge.reportFrameValues === "function") {
        bridge.reportFrameValues(valuesPayload);
      } else if (typeof bridge.report === "function") {
        bridge.report({
          kind: "frame_values",
          status: JSON.stringify(valuesPayload),
        });
      }
    }
    if (typeof bridge.report === "function" && now - state.lastReportAt > 1000) {
      state.lastReportAt = now;
      bridge.report({
        kind: "frame",
        hasVisualSignal: true,
        visualSignal: "canvas",
        canvasCount: 1,
        svgCount: 0,
        rootChildCount: root.childElementCount,
      });
    }
  };

  const unsubscribe = bridge.onFrame(onFrame);
  const unsubscribeResize = typeof bridge.onResize === "function"
    ? bridge.onResize(resize)
    : (() => {
        window.addEventListener("resize", resize);
        resize();
        return () => window.removeEventListener("resize", resize);
      })();
  if (typeof bridge.report === "function") {
    bridge.report({ kind: "init", hasVisualSignal: true, visualSignal: "canvas" });
  }

  window.addEventListener("beforeunload", () => {
    try { unsubscribe(); } catch (_error) {}
    try { unsubscribeResize(); } catch (_error) {}
    try { if (shell && typeof shell.dispose === "function") shell.dispose(); } catch (_error) {}
  });
})();
`,
};
