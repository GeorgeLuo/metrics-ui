export default {
  id: "kuramoto_phase_canvas",
  name: "Kuramoto Phase Canvas",
  description: "Canvas visualization of oscillator phases and order-parameter magnitude.",
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
  };

  const asNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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
      return { phases: [], orderR: 0, tick: 0 };
    }

    const phases = [];
    for (const [entityId, value] of Object.entries(entities)) {
      if (!value || typeof value !== "object") continue;
      if (!/^\\d+$/.test(entityId)) continue;
      if (entityId === "0" || entityId === "13") continue;
      const phase = asNumber(value.osc_phase, NaN);
      if (Number.isFinite(phase)) {
        phases.push(phase);
      }
    }

    const summary = entities["13"] && typeof entities["13"] === "object" ? entities["13"] : null;
    const orderR = asNumber(summary && summary.series_order_parameter_r, 0);
    const tick = asNumber(frame.tick, 0);
    return { phases, orderR, tick };
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
    const { phases, orderR, tick } = extractData(state.frame);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = w * 0.5;
    const cy = h * 0.52;
    const radius = Math.min(w, h) * 0.26;

    ctx.strokeStyle = "rgba(100,116,139,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(15,23,42,0.88)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("Tick " + String(tick), 16, 24);
    ctx.fillText("Order r " + orderR.toFixed(3), 16, 42);
    ctx.fillText("Oscillators " + String(phases.length), 16, 60);

    const colors = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"];
    for (let i = 0; i < phases.length; i += 1) {
      const theta = phases[i];
      const x = cx + Math.cos(theta) * radius;
      const y = cy + Math.sin(theta) * radius;
      const c = colors[i % colors.length];
      ctx.strokeStyle = "rgba(148,163,184,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    const vecLen = radius * Math.max(0, Math.min(1, orderR));
    const vx = cx + vecLen;
    const vy = cy;
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(vx, vy);
    ctx.stroke();
  };

  const onFrame = (frame) => {
    state.frame = frame;
    draw();
    const now = Date.now();
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
  window.addEventListener("resize", resize);
  resize();
  if (typeof bridge.report === "function") {
    bridge.report({ kind: "init", hasVisualSignal: true, visualSignal: "canvas" });
  }

  window.addEventListener("beforeunload", () => {
    try { unsubscribe(); } catch (_error) {}
    try { if (shell && typeof shell.dispose === "function") shell.dispose(); } catch (_error) {}
  });
})();
`,
};
