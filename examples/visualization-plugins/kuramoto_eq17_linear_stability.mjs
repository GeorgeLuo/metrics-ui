export default {
  id: "kuramoto_eq17_linear_stability",
  name: "Kuramoto Eq. 17 Linear Stability",
  description:
    "Conceptual visual for Eq. 17 showing a small perturbation of incoherence, advection by omega, and decay versus growth depending on the sign of the perturbation growth rate lambda.",
  renderScript: `
(() => {
  const bridge = window.MetricsUIBridge;
  if (!bridge || typeof bridge !== "object") {
    return;
  }

  const report = (payload) => {
    if (typeof bridge.report === "function") {
      bridge.report(payload);
    }
  };

  const shell = typeof bridge.createFactoryShell === "function"
    ? bridge.createFactoryShell({ title: "Eq. 17: Linear stability of incoherence" })
    : null;
  const root = shell && shell.root
    ? shell.root
    : document.getElementById("metrics-ui-visual-root");
  if (!root) {
    return;
  }

  root.innerHTML = "";
  root.style.position = "relative";
  root.style.overflow = "hidden";
  root.style.background = "linear-gradient(180deg, rgba(248,250,252,0.98), rgba(226,232,240,0.94))";
  root.style.color = "#0f172a";
  root.style.fontFamily = "'IBM Plex Sans', 'Inter', sans-serif";

  const header = document.createElement("div");
  header.style.position = "absolute";
  header.style.left = "0";
  header.style.top = "0";
  header.style.right = "0";
  header.style.padding = "12px 14px 8px 14px";
  header.style.pointerEvents = "none";
  header.style.zIndex = "2";

  const title = document.createElement("div");
  title.textContent = "What Eq. 17 is asking";
  title.style.fontSize = "15px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "-0.01em";
  header.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent =
    "Start from a nearly uniform phase density, add a tiny perturbation mu, then ask whether the perturbation decays or grows under transport by omega plus mean-field feedback.";
  subtitle.style.marginTop = "4px";
  subtitle.style.fontSize = "11px";
  subtitle.style.lineHeight = "1.35";
  subtitle.style.color = "rgba(15,23,42,0.76)";
  header.appendChild(subtitle);

  const chipRow = document.createElement("div");
  chipRow.style.display = "flex";
  chipRow.style.flexWrap = "wrap";
  chipRow.style.gap = "6px";
  chipRow.style.marginTop = "8px";
  header.appendChild(chipRow);

  const makeChip = (text, background, border, color) => {
    const chip = document.createElement("div");
    chip.textContent = text;
    chip.style.padding = "4px 7px";
    chip.style.borderRadius = "999px";
    chip.style.background = background;
    chip.style.border = "1px solid " + border;
    chip.style.color = color;
    chip.style.fontSize = "10px";
    chip.style.fontWeight = "600";
    chip.style.letterSpacing = "0.01em";
    chip.style.backdropFilter = "blur(8px)";
    return chip;
  };

  chipRow.appendChild(
    makeChip("baseline: incoherent ring", "rgba(59,130,246,0.10)", "rgba(37,99,235,0.24)", "#1d4ed8"),
  );
  chipRow.appendChild(
    makeChip("term 1: transport by omega", "rgba(245,158,11,0.10)", "rgba(217,119,6,0.24)", "#92400e"),
  );
  chipRow.appendChild(
    makeChip("term 2: mean-field feedback", "rgba(16,185,129,0.10)", "rgba(5,150,105,0.24)", "#065f46"),
  );

  const footer = document.createElement("div");
  footer.style.position = "absolute";
  footer.style.left = "14px";
  footer.style.right = "14px";
  footer.style.bottom = "10px";
  footer.style.display = "flex";
  footer.style.justifyContent = "space-between";
  footer.style.alignItems = "center";
  footer.style.flexWrap = "wrap";
  footer.style.gap = "10px";
  footer.style.pointerEvents = "none";
  footer.style.zIndex = "2";

  const footerLeft = document.createElement("div");
  footerLeft.style.fontSize = "11px";
  footerLeft.style.fontWeight = "600";
  footerLeft.style.color = "rgba(15,23,42,0.72)";
  footer.appendChild(footerLeft);

  const footerRight = document.createElement("div");
  footerRight.style.fontSize = "11px";
  footerRight.style.fontFamily = "'IBM Plex Mono', 'Fira Code', monospace";
  footerRight.style.color = "rgba(15,23,42,0.76)";
  footer.appendChild(footerRight);

  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.zIndex = "1";
  root.appendChild(canvas);
  root.appendChild(header);
  root.appendChild(footer);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    root.textContent = "Canvas unavailable";
    report({ kind: "error", error: "Canvas unavailable." });
    return;
  }

  const COLORS = {
    slate: "#334155",
    note: "rgba(15,23,42,0.72)",
    grid: "rgba(148,163,184,0.18)",
    panelStroke: "rgba(148,163,184,0.32)",
    ring: "rgba(100,116,139,0.34)",
    stable: "#2563eb",
    stableFill: "rgba(59,130,246,0.12)",
    unstable: "#dc2626",
    unstableFill: "rgba(248,113,113,0.12)",
    transport: "#d97706",
    meanField: "#059669",
    accent: "#0f766e",
  };

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    rafId: 0,
    startedAt: performance.now(),
    lastReportAt: 0,
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const wrapText = (text, maxWidth) => {
    const words = String(text).split(/\\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (const word of words) {
      const next = current ? current + " " + word : word;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) {
      lines.push(current);
    }
    return lines;
  };

  const resize = () => {
    const rect = root.getBoundingClientRect();
    state.width = Math.max(1, Math.round(rect.width));
    state.height = Math.max(1, Math.round(rect.height));
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(state.width * state.dpr));
    canvas.height = Math.max(1, Math.round(state.height * state.dpr));
    canvas.style.width = state.width + "px";
    canvas.style.height = state.height + "px";
  };

  const drawCard = (x, y, w, h, titleText, subtitleText) => {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.strokeStyle = COLORS.panelStroke;
    ctx.lineWidth = 1;
    const r = 14;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLORS.slate;
    ctx.font = "700 12px IBM Plex Sans, Inter, sans-serif";
    ctx.fillText(titleText, x + 12, y + 18);
    ctx.font = "11px IBM Plex Sans, Inter, sans-serif";
    ctx.fillStyle = COLORS.note;
    const subtitleLines = wrapText(subtitleText, Math.max(90, w - 24));
    subtitleLines.slice(0, 3).forEach((line, index) => {
      ctx.fillText(line, x + 12, y + 34 + index * 13);
    });
    ctx.restore();
  };

  const drawArrowHead = (x, y, angle, color) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-8, -4);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-8, 4);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  };

  const drawModeCircle = (cx, cy, radius, phase, amplitude, color, fill, label, transportSide) => {
    ctx.save();
    ctx.translate(cx, cy);

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.ring;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i <= 220; i += 1) {
      const theta = (i / 220) * Math.PI * 2;
      const perturb = amplitude * Math.cos(theta - phase);
      const r = radius * (1 + perturb);
      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(phase) * radius * 1.12, Math.sin(phase) * radius * 1.12);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(Math.cos(phase) * radius * 1.12, Math.sin(phase) * radius * 1.12, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    const transportRadius = radius * 1.32;
    const transportStart = transportSide === "left" ? Math.PI - 0.8 : -0.8;
    const transportEnd = transportSide === "left" ? Math.PI + 0.8 : 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, transportRadius, transportStart, transportEnd);
    ctx.strokeStyle = COLORS.transport;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    drawArrowHead(
      Math.cos(transportEnd) * transportRadius,
      Math.sin(transportEnd) * transportRadius,
      transportEnd + Math.PI / 2,
      COLORS.transport,
    );

    ctx.fillStyle = COLORS.slate;
    ctx.font = "600 11px IBM Plex Sans, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, 0, radius + 28);

    ctx.font = "11px IBM Plex Sans, Inter, sans-serif";
    ctx.fillStyle = COLORS.note;
    ctx.fillText("transport by omega", 0, radius + 43);
    ctx.restore();
  };

  const drawAmplitudeChart = (chart, timeValue, stableAmp, unstableAmp) => {
    const x0 = chart.x + 24;
    const y0 = chart.y + chart.h - 26;
    const x1 = chart.x + chart.w - 18;
    const y1 = chart.y + 56;
    const width = x1 - x0;
    const height = y0 - y1;

    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.stroke();

    const mapX = (t) => x0 + clamp(t / 6, 0, 1) * width;
    const mapY = (a) => y0 - clamp(a / 1.15, 0, 1) * height;

    const drawCurve = (color, fn) => {
      ctx.beginPath();
      for (let i = 0; i <= 120; i += 1) {
        const t = (i / 120) * 6;
        const x = mapX(t);
        const y = mapY(fn(t));
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    drawCurve(COLORS.stable, (t) => 0.8 * Math.exp(-0.45 * t));
    drawCurve(COLORS.unstable, (t) => Math.min(1.15, 0.14 * Math.exp(0.38 * t)));

    const stableX = mapX(timeValue);
    const stableY = mapY(stableAmp);
    const unstableX = mapX(timeValue);
    const unstableY = mapY(unstableAmp);
    ctx.beginPath();
    ctx.arc(stableX, stableY, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.stable;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(unstableX, unstableY, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.unstable;
    ctx.fill();

    ctx.font = "11px IBM Plex Sans, Inter, sans-serif";
    ctx.fillStyle = COLORS.note;
    ctx.fillText("blue: Re(lambda) < 0", chart.x + 12, chart.y + 32);
    ctx.fillText("red: Re(lambda) > 0", chart.x + 12, chart.y + 46);
    ctx.restore();
  };

  const draw = () => {
    if (!state.width || !state.height) {
      return;
    }

    const now = performance.now();
    const t = (now - state.startedAt) / 1000;
    const loopT = t % 6;
    const stableAmp = 0.26 * Math.exp(-0.45 * loopT);
    const unstableAmp = clamp(0.05 * Math.exp(0.38 * loopT), 0.05, 0.32);
    const phase = 0.85 * t;

    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);

    const margin = 18;
    const headerHeight = Math.ceil(header.getBoundingClientRect().height);
    const footerHeight = Math.ceil(footer.getBoundingClientRect().height);
    const topOffset = headerHeight + 14;
    const bottomOffset = footerHeight + 18;
    const contentY = topOffset;
    const contentH = Math.max(180, state.height - topOffset - bottomOffset);
    const panelGap = 14;
    const compact = state.width < 760;

    let leftPanel;
    let rightPanel;
    let chart;
    if (compact) {
      const panelH = Math.max(122, contentH * 0.29);
      const chartY = contentY + panelH * 2 + panelGap * 2;
      leftPanel = { x: margin, y: contentY, w: state.width - margin * 2, h: panelH };
      rightPanel = { x: margin, y: contentY + panelH + panelGap, w: state.width - margin * 2, h: panelH };
      chart = {
        x: margin,
        y: chartY,
        w: state.width - margin * 2,
        h: Math.max(88, state.height - chartY - bottomOffset),
      };
    } else {
      const topRowH = Math.max(148, contentH * 0.62);
      const bottomRowY = contentY + topRowH + 12;
      const bottomRowH = Math.max(88, contentH - topRowH - 12);
      const panelW = (state.width - margin * 2 - panelGap) / 2;
      leftPanel = { x: margin, y: contentY, w: panelW, h: topRowH };
      rightPanel = { x: margin + panelW + panelGap, y: contentY, w: panelW, h: topRowH };
      chart = { x: margin, y: bottomRowY, w: state.width - margin * 2, h: bottomRowH };
    }

    drawCard(leftPanel.x, leftPanel.y, leftPanel.w, leftPanel.h, "Stable perturbation", "negative Re(lambda) means the bump washes out");
    drawCard(rightPanel.x, rightPanel.y, rightPanel.w, rightPanel.h, "Unstable perturbation", "positive Re(lambda) means mean-field feedback amplifies it");

    const leftCx = leftPanel.x + leftPanel.w / 2;
    const rightCx = rightPanel.x + rightPanel.w / 2;
    const cy = leftPanel.y + leftPanel.h * (compact ? 0.6 : 0.58);
    const radius = Math.min(leftPanel.w, leftPanel.h) * (compact ? 0.17 : 0.22);

    drawModeCircle(leftCx, cy, radius, phase, stableAmp, COLORS.stable, COLORS.stableFill, "mu decays", "right");
    drawModeCircle(
      rightCx,
      compact ? rightPanel.y + rightPanel.h * 0.6 : cy,
      radius,
      phase,
      unstableAmp,
      COLORS.unstable,
      COLORS.unstableFill,
      "mu grows",
      "left",
    );

    ctx.save();
    ctx.strokeStyle = COLORS.meanField;
    ctx.lineWidth = 2;
    if (!compact) {
      ctx.beginPath();
      ctx.moveTo(leftCx + radius * 1.55, cy);
      ctx.lineTo(leftCx + radius * 2.1, cy);
      ctx.stroke();
      drawArrowHead(leftCx + radius * 2.1, cy, 0, COLORS.meanField);
      ctx.beginPath();
      ctx.moveTo(rightCx - radius * 1.55, cy);
      ctx.lineTo(rightCx - radius * 2.1, cy);
      ctx.stroke();
      drawArrowHead(rightCx - radius * 2.1, cy, Math.PI, COLORS.meanField);
    }
    ctx.fillStyle = COLORS.meanField;
    ctx.font = "600 11px IBM Plex Sans, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      "mean-field projection",
      compact ? state.width / 2 : state.width / 2,
      compact ? rightPanel.y - 6 : cy - radius * 1.65,
    );
    ctx.restore();

    drawCard(chart.x, chart.y, chart.w, chart.h, "Growth-rate view", "");
    drawAmplitudeChart(chart, loopT, 0.8 * Math.exp(-0.45 * loopT), Math.min(1.15, 0.14 * Math.exp(0.38 * loopT)));

    footerLeft.textContent = "Equation 17 asks whether a tiny mode mu is damped or amplified.";
    footerRight.textContent = "mu~ = e^(lambda t) mu";

    if (now - state.lastReportAt > 1200) {
      state.lastReportAt = now;
      report({
        kind: "status",
        stage: "animating",
        stableAmplitude: Number(stableAmp.toFixed(3)),
        unstableAmplitude: Number(unstableAmp.toFixed(3)),
        phase: Number(phase.toFixed(2)),
      });
    }
  };

  const frame = () => {
    draw();
    state.rafId = window.requestAnimationFrame(frame);
  };

  const handleResize = () => {
    resize();
    draw();
  };

  handleResize();
  state.rafId = window.requestAnimationFrame(frame);

  const unsubscribeResize = typeof bridge.onResize === "function"
    ? bridge.onResize(handleResize)
    : (() => {
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
      })();

  bridge.onDispose(() => {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    unsubscribeResize?.();
  });

  report({ kind: "init", message: "Eq. 17 stability visual ready." });
})();
`,
};
