export default {
  id: "highmix_canvas_view",
  name: "HighMix Canvas View",
  description: "Canvas-based visualization of HighMix summary metrics.",
  renderScript: `
(() => {
  const root = document.getElementById("metrics-ui-visual-root");
  if (!root) {
    return;
  }

  root.innerHTML = "";
  root.style.background = "#0f172a";

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  root.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    root.textContent = "Canvas unavailable";
    return;
  }

  const state = {
    frame: null,
    dpr: 1,
    width: 0,
    height: 0,
    lastReportAt: 0,
  };

  const num = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const extractSummary = (frame) => {
    const entities = frame && frame.record && frame.record.entities && typeof frame.record.entities === "object"
      ? frame.record.entities
      : null;
    const rootEntity = entities && entities["0"] && typeof entities["0"] === "object"
      ? entities["0"]
      : null;
    const summary = rootEntity && rootEntity.job_release_summary && typeof rootEntity.job_release_summary === "object"
      ? rootEntity.job_release_summary
      : null;
    const total = Math.max(0, num(summary && summary.total_jobs, 1));
    const released = Math.max(0, num(summary && summary.released_jobs, 0));
    const pending = Math.max(0, num(summary && summary.pending_jobs, 0));
    const completed = Math.max(0, num(summary && summary.completed_jobs, 0));
    const scenario = rootEntity && typeof rootEntity.selected_scenario === "string"
      ? rootEntity.selected_scenario
      : "unknown";
    return { total, released, pending, completed, scenario };
  };

  const resize = () => {
    const rect = root.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    state.dpr = dpr;
    state.width = width;
    state.height = height;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    draw();
  };

  const drawLabel = (x, y, label, value, color) => {
    ctx.fillStyle = "rgba(226,232,240,0.95)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(label, x, y);
    ctx.fillStyle = color;
    ctx.font = "bold 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(String(value), x, y + 14);
  };

  const draw = () => {
    const frame = state.frame;
    const summary = extractSummary(frame);
    const w = state.width;
    const h = state.height;
    const dpr = state.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#0b1220");
    gradient.addColorStop(1, "#111827");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const margin = 16;
    const panelW = Math.max(120, Math.floor(w * 0.38));
    const panelH = h - margin * 2;
    const panelX = w - panelW - margin;
    const panelY = margin;

    ctx.fillStyle = "rgba(15,23,42,0.7)";
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);

    const total = Math.max(1, summary.total);
    const releasedRatio = Math.max(0, Math.min(1, summary.released / total));
    const pendingRatio = Math.max(0, Math.min(1, summary.pending / total));
    const completedRatio = Math.max(0, Math.min(1, summary.completed / total));

    const lineY = Math.floor(h * 0.62);
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margin, lineY);
    ctx.lineTo(panelX - margin, lineY);
    ctx.stroke();

    const barBaseY = lineY - 14;
    const barW = Math.max(14, Math.floor((panelX - margin * 3) / 6));
    const gap = barW * 0.7;

    const bars = [
      { label: "Released", ratio: releasedRatio, color: "#22c55e", value: summary.released },
      { label: "Pending", ratio: pendingRatio, color: "#ef4444", value: summary.pending },
      { label: "Completed", ratio: completedRatio, color: "#38bdf8", value: summary.completed },
    ];

    bars.forEach((bar, index) => {
      const x = margin + index * (barW + gap) + 10;
      const hMax = Math.floor(h * 0.45);
      const barH = Math.max(2, Math.floor(hMax * bar.ratio));
      ctx.fillStyle = "rgba(30,41,59,0.6)";
      ctx.fillRect(x, barBaseY - hMax, barW, hMax);
      ctx.fillStyle = bar.color;
      ctx.fillRect(x, barBaseY - barH, barW, barH);
      drawLabel(x, barBaseY + 14, bar.label, bar.value, bar.color);
    });

    const jobs = Math.max(1, Math.min(48, Math.floor(8 + releasedRatio * 40)));
    const dotAreaX = margin;
    const dotAreaY = margin + 20;
    const dotAreaW = Math.max(120, panelX - margin * 2);
    const dotAreaH = Math.max(70, Math.floor(h * 0.3));

    for (let i = 0; i < jobs; i += 1) {
      const col = i % 12;
      const row = Math.floor(i / 12);
      const x = dotAreaX + 10 + col * ((dotAreaW - 20) / 11);
      const y = dotAreaY + 12 + row * 16;
      const phase = num(frame && frame.tick, 0) * 0.1 + i * 0.27;
      const pulse = 0.5 + 0.5 * Math.sin(phase);
      ctx.fillStyle = pulse > 0.5 ? "#22c55e" : "#f59e0b";
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 14px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("HighMix Factory View", margin, margin + 2);
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(203,213,225,0.9)";
    ctx.fillText("Scenario: " + summary.scenario, margin, margin + 20);
    ctx.fillText("Tick: " + String(frame && frame.tick ? frame.tick : "-"), panelX + 12, panelY + panelH - 12);

    if (window.MetricsUIBridge && typeof window.MetricsUIBridge.report === "function") {
      const now = Date.now();
      if (now - state.lastReportAt > 1000) {
        state.lastReportAt = now;
        window.MetricsUIBridge.report({
          kind: "frame",
          hasVisualSignal: true,
          visualSignal: "canvas",
          rootChildCount: 1,
          canvasCount: 1,
          svgCount: 0,
          textLength: 0,
        });
      }
    }
  };

  const onFrame = (frame) => {
    state.frame = frame;
    draw();
  };

  const unsubscribe = window.MetricsUIBridge.onFrame(onFrame);
  window.addEventListener("resize", resize);
  resize();

  if (window.MetricsUIBridge && typeof window.MetricsUIBridge.report === "function") {
    window.MetricsUIBridge.report({ kind: "init", hasVisualSignal: true, visualSignal: "canvas" });
  }

  window.addEventListener("beforeunload", () => {
    try { unsubscribe(); } catch (_error) {}
  });
})();
`,
};
