export default {
  id: "kuramoto_asymptotic_tilde_meaning",
  name: "Kuramoto Asymptotic Tilde Meaning",
  description:
    "Visual explainer for what asymptotic equivalence means near Kc by comparing the exact Lorentzian branch to its near-threshold square-root approximation.",
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
    ? bridge.createFactoryShell({ title: "What the asymptotic tilde means" })
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
  root.style.background = "linear-gradient(180deg, rgba(248,250,252,0.98), rgba(241,245,249,0.94))";
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
  title.textContent = "Why r ~ square-root near Kc";
  title.style.fontSize = "15px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "-0.01em";
  header.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent =
    "Blue is the exact Lorentzian branch. Orange is the asymptotic square-root law. Near K/Kc = 1, they are not equal, but their ratio tends to 1.";
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
    makeChip("exact: sqrt(1 - Kc/K)", "rgba(59,130,246,0.10)", "rgba(37,99,235,0.24)", "#1d4ed8"),
  );
  chipRow.appendChild(
    makeChip("asymptotic: sqrt((K-Kc)/Kc)", "rgba(245,158,11,0.10)", "rgba(217,119,6,0.24)", "#92400e"),
  );
  chipRow.appendChild(
    makeChip("tilde means ratio -> 1", "rgba(16,185,129,0.10)", "rgba(5,150,105,0.24)", "#065f46"),
  );

  const footer = document.createElement("div");
  footer.style.position = "absolute";
  footer.style.left = "14px";
  footer.style.right = "14px";
  footer.style.bottom = "10px";
  footer.style.display = "flex";
  footer.style.justifyContent = "space-between";
  footer.style.alignItems = "center";
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
    exact: "#2563eb",
    exactFill: "rgba(59,130,246,0.12)",
    asymptotic: "#d97706",
    asymptoticFill: "rgba(245,158,11,0.10)",
    near: "rgba(16,185,129,0.10)",
    nearStroke: "rgba(5,150,105,0.24)",
    ratio: "#0f766e",
    threshold: "#64748b",
  };

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    rafId: 0,
    lastReportAt: 0,
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const xMin = 1;
  const xMax = 2.2;

  const exact = (x) => Math.sqrt(Math.max(0, 1 - 1 / x));
  const asymptotic = (x) => Math.sqrt(Math.max(0, x - 1));
  const ratio = (x) => {
    const denom = asymptotic(x);
    return denom <= 0 ? 1 : exact(x) / denom;
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
    ctx.fillText(subtitleText, x + 12, y + 34);
    ctx.restore();
  };

  const plotX = (chart, x) => chart.x + 16 + ((x - xMin) / (xMax - xMin)) * (chart.w - 32);
  const plotY = (chart, y, yMax, yMin) => {
    const top = chart.y + 24;
    const bottom = chart.y + chart.h - 18;
    const t = (y - yMin) / (yMax - yMin);
    return bottom - t * (bottom - top);
  };

  const drawAxes = (chart, yMin, yMax, baselineValue) => {
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const t = i / 4;
      const x = chart.x + 16 + t * (chart.w - 32);
      ctx.beginPath();
      ctx.moveTo(x, chart.y + 22);
      ctx.lineTo(x, chart.y + chart.h - 16);
      ctx.stroke();
    }
    if (baselineValue !== null) {
      const y = plotY(chart, baselineValue, yMax, yMin);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = COLORS.threshold;
      ctx.beginPath();
      ctx.moveTo(chart.x + 12, y);
      ctx.lineTo(chart.x + chart.w - 12, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  };

  const drawCurve = (chart, fn, yMin, yMax, color, fillColor, dashed) => {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= 160; i += 1) {
      const t = i / 160;
      const x = xMin + (xMax - xMin) * t;
      const px = plotX(chart, x);
      const py = plotY(chart, fn(x), yMax, yMin);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    if (fillColor) {
      ctx.lineTo(plotX(chart, xMax), plotY(chart, yMin, yMax, yMin));
      ctx.lineTo(plotX(chart, xMin), plotY(chart, yMin, yMax, yMin));
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i <= 160; i += 1) {
        const t = i / 160;
        const x = xMin + (xMax - xMin) * t;
        const px = plotX(chart, x);
        const py = plotY(chart, fn(x), yMax, yMin);
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    if (dashed) {
      ctx.setLineDash([7, 6]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };

  const drawNearThresholdBand = (chart) => {
    const x0 = plotX(chart, 1);
    const x1 = plotX(chart, 1.2);
    ctx.save();
    ctx.fillStyle = COLORS.near;
    ctx.strokeStyle = COLORS.nearStroke;
    ctx.lineWidth = 1;
    ctx.fillRect(x0, chart.y + 22, x1 - x0, chart.h - 38);
    ctx.strokeRect(x0, chart.y + 22, x1 - x0, chart.h - 38);
    ctx.fillStyle = "#065f46";
    ctx.font = "600 10px IBM Plex Sans, Inter, sans-serif";
    ctx.fillText("near threshold", x0 + 6, chart.y + 34);
    ctx.restore();
  };

  const drawMarker = (chart, xValue, yValue, color, yMin, yMax) => {
    const x = plotX(chart, xValue);
    const y = plotY(chart, yValue, yMax, yMin);
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return { x, y };
  };

  const draw = (now) => {
    const width = state.width;
    const height = state.height;
    if (width <= 0 || height <= 0) {
      return;
    }

    const xValue = 1.03 + 0.32 * (0.5 + 0.5 * Math.sin(now / 1500));
    const exactValue = exact(xValue);
    const asymValue = asymptotic(xValue);
    const ratioValue = ratio(xValue);

    ctx.save();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const marginX = 16;
    const topPadding = 90;
    const footerPadding = 36;
    const contentWidth = width - marginX * 2;
    const contentHeight = height - topPadding - footerPadding;
    const upperHeight = Math.max(150, contentHeight * 0.62);
    const lowerHeight = Math.max(92, contentHeight - upperHeight - 12);

    const upper = { x: marginX, y: topPadding, w: contentWidth, h: upperHeight };
    const lower = { x: marginX, y: topPadding + upperHeight + 12, w: contentWidth, h: lowerHeight };

    drawCard(
      upper.x,
      upper.y,
      upper.w,
      upper.h,
      "Exact branch vs asymptotic branch",
      "They separate away from threshold, but hug each other as K/Kc approaches 1 from above.",
    );
    drawNearThresholdBand(upper);
    drawAxes(upper, 0, 1.15, 0);
    drawCurve(upper, exact, 0, 1.15, COLORS.exact, COLORS.exactFill, false);
    drawCurve(upper, asymptotic, 0, 1.15, COLORS.asymptotic, null, true);

    const exactPoint = drawMarker(upper, xValue, exactValue, COLORS.exact, 0, 1.15);
    const asymPoint = drawMarker(upper, xValue, asymValue, COLORS.asymptotic, 0, 1.15);
    ctx.save();
    ctx.strokeStyle = "rgba(100,116,139,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(exactPoint.x, exactPoint.y);
    ctx.lineTo(asymPoint.x, asymPoint.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    drawCard(
      lower.x,
      lower.y,
      lower.w,
      lower.h,
      "Ratio exact / asymptotic",
      "The tilde means this ratio tends to 1 near Kc.",
    );
    drawAxes(lower, 0.62, 1.03, 1);
    drawCurve(lower, ratio, 0.62, 1.03, COLORS.ratio, COLORS.asymptoticFill, false);
    drawMarker(lower, xValue, ratioValue, COLORS.ratio, 0.62, 1.03);

    ctx.save();
    ctx.fillStyle = COLORS.note;
    ctx.font = "11px IBM Plex Sans, Inter, sans-serif";
    ctx.fillText("K/Kc", upper.x + upper.w - 34, upper.y + upper.h - 4);
    ctx.fillText("K/Kc", lower.x + lower.w - 34, lower.y + lower.h - 4);
    ctx.restore();

    footerLeft.textContent =
      "Near Kc, the asymptotic square-root law preserves the dominant scaling even though it is not the exact branch.";
    footerRight.textContent =
      "K/Kc=" + xValue.toFixed(2)
      + "   exact=" + exactValue.toFixed(3)
      + "   asym=" + asymValue.toFixed(3)
      + "   ratio=" + ratioValue.toFixed(3);

    if (typeof bridge.reportFrameValues === "function" && now - state.lastReportAt > 300) {
      state.lastReportAt = now;
      bridge.reportFrameValues({
        normalizedK: xValue,
        exact: exactValue,
        asymptotic: asymValue,
        ratio: ratioValue,
      });
    }

    report({
      kind: "runtime",
      status: "ok",
      hasVisualSignal: true,
      visualSignal: "canvas",
      rootChildCount: root.childElementCount,
      canvasCount: root.querySelectorAll("canvas").length,
      svgCount: root.querySelectorAll("svg").length,
      textLength: root.textContent ? root.textContent.length : 0,
    });
    ctx.restore();
  };

  const animate = (now) => {
    draw(now);
    state.rafId = window.requestAnimationFrame(animate);
  };

  const handleResize = () => {
    resize();
    draw(performance.now());
  };

  const unsubscribeResize = typeof bridge.onResize === "function"
    ? bridge.onResize(handleResize)
    : (() => {
        resize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
      })();

  state.rafId = window.requestAnimationFrame(animate);

  report({
    kind: "runtime",
    status: "mounted",
    hasVisualSignal: true,
    visualSignal: "canvas",
    rootChildCount: root.childElementCount,
    canvasCount: 1,
    svgCount: 0,
    textLength: root.textContent ? root.textContent.length : 0,
  });

  bridge.onDispose(() => {
    try { unsubscribeResize(); } catch (_error) {}
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  });
})();
`,
};
