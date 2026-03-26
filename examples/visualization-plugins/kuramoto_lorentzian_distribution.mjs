export default {
  id: "kuramoto_lorentzian_distribution",
  name: "Kuramoto Lorentzian Distribution",
  description:
    "Visual explainer for Eq. 13 showing the Lorentzian frequency distribution, its peak at zero, and why gamma sets both the width and critical coupling.",
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
    ? bridge.createFactoryShell({ title: "Eq. 13: Lorentzian Frequency Distribution" })
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
  root.style.background = "linear-gradient(180deg, rgba(248,250,252,0.98), rgba(226,232,240,0.92))";
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
  title.textContent = "What the Lorentzian g(omega) looks like";
  title.style.fontSize = "15px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "-0.01em";
  header.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent =
    "The curve is tallest at omega = 0, has half its peak at +/-gamma, and keeps heavier tails than a Gaussian.";
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
    makeChip("g(0) = 1/(pi gamma)", "rgba(59,130,246,0.10)", "rgba(37,99,235,0.24)", "#1d4ed8"),
  );
  chipRow.appendChild(
    makeChip("g(+/-gamma) = g(0)/2", "rgba(245,158,11,0.10)", "rgba(217,119,6,0.24)", "#92400e"),
  );
  chipRow.appendChild(
    makeChip("larger gamma = broader spread = larger Kc", "rgba(16,185,129,0.10)", "rgba(5,150,105,0.24)", "#065f46"),
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
    lorentzian: "#2563eb",
    lorentzianFill: "rgba(59,130,246,0.14)",
    gaussian: "rgba(100,116,139,0.82)",
    gamma: "#d97706",
    gammaFill: "rgba(245,158,11,0.18)",
    sample: "#0f766e",
    center: "#1d4ed8",
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    rafId: 0,
    lastReportAt: 0,
  };

  const sampleSeeds = Array.from({ length: 40 }, (_, index) => (index + 0.5) / 40);

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

  const lorentzian = (omega, gamma) => (gamma / Math.PI) / (gamma * gamma + omega * omega);

  const gaussianWithSamePeakAndHwhm = (omega, gamma) => {
    const peak = 1 / (Math.PI * gamma);
    const sigma = gamma / Math.sqrt(2 * Math.log(2));
    return peak * Math.exp(-(omega * omega) / (2 * sigma * sigma));
  };

  const mapX = (chart, omega, omegaLimit) =>
    chart.x + 18 + ((omega + omegaLimit) / (omegaLimit * 2)) * (chart.w - 36);

  const mapY = (chart, value, maxValue) => {
    const innerTop = chart.y + 24;
    const innerBottom = chart.y + chart.h - 18;
    const t = maxValue <= 0 ? 0 : value / maxValue;
    return innerBottom - t * (innerBottom - innerTop);
  };

  const drawCard = (x, y, width, height, titleText, subtitleText) => {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.strokeStyle = COLORS.panelStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const r = 14;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
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

  const drawDistributionChart = (chart, gamma, now) => {
    const omegaLimit = 4;
    const peak = lorentzian(0, gamma);
    const halfMax = peak / 2;
    const gammaLeft = -gamma;
    const gammaRight = gamma;
    const gammaY = lorentzian(gamma, gamma);
    const yMax = 0.82;

    drawCard(
      chart.x,
      chart.y,
      chart.w,
      chart.h,
      "Lorentzian g(omega)",
      "Blue: Lorentzian. Dashed gray: Gaussian with the same peak and half-width.",
    );

    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    const axisY = mapY(chart, 0, yMax);
    const centerX = mapX(chart, 0, omegaLimit);
    ctx.beginPath();
    ctx.moveTo(chart.x + 18, axisY);
    ctx.lineTo(chart.x + chart.w - 18, axisY);
    ctx.moveTo(centerX, chart.y + 48);
    ctx.lineTo(centerX, chart.y + chart.h - 20);
    ctx.stroke();

    const halfY = mapY(chart, halfMax, yMax);
    const gammaLeftX = mapX(chart, gammaLeft, omegaLimit);
    const gammaRightX = mapX(chart, gammaRight, omegaLimit);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(217,119,6,0.42)";
    ctx.beginPath();
    ctx.moveTo(gammaLeftX, chart.y + 48);
    ctx.lineTo(gammaLeftX, chart.y + chart.h - 20);
    ctx.moveTo(gammaRightX, chart.y + 48);
    ctx.lineTo(gammaRightX, chart.y + chart.h - 20);
    ctx.moveTo(gammaLeftX, halfY);
    ctx.lineTo(gammaRightX, halfY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    for (let step = 0; step <= 200; step += 1) {
      const omega = -omegaLimit + (step / 200) * (omegaLimit * 2);
      const x = mapX(chart, omega, omegaLimit);
      const y = mapY(chart, lorentzian(omega, gamma), yMax);
      if (step === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.lineTo(mapX(chart, omegaLimit, omegaLimit), axisY);
    ctx.lineTo(mapX(chart, -omegaLimit, omegaLimit), axisY);
    ctx.closePath();
    ctx.fillStyle = COLORS.lorentzianFill;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = COLORS.gaussian;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let step = 0; step <= 200; step += 1) {
      const omega = -omegaLimit + (step / 200) * (omegaLimit * 2);
      const x = mapX(chart, omega, omegaLimit);
      const y = mapY(chart, gaussianWithSamePeakAndHwhm(omega, gamma), yMax);
      if (step === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = COLORS.lorentzian;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    for (let step = 0; step <= 200; step += 1) {
      const omega = -omegaLimit + (step / 200) * (omegaLimit * 2);
      const x = mapX(chart, omega, omegaLimit);
      const y = mapY(chart, lorentzian(omega, gamma), yMax);
      if (step === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();

    const pulse = 1 + 0.08 * Math.sin(now * 0.0034);
    const centerY = mapY(chart, peak, yMax);

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, 6.5 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(37,99,235,0.14)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.center;
    ctx.fill();

    [gammaLeft, gammaRight].forEach((omega) => {
      const x = mapX(chart, omega, omegaLimit);
      const y = mapY(chart, gammaY, yMax);
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.gamma;
      ctx.fill();
    });

    ctx.fillStyle = COLORS.slate;
    ctx.font = "600 11px IBM Plex Sans, Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("0", centerX, chart.y + chart.h - 4);
    ctx.fillText("-gamma", gammaLeftX, chart.y + chart.h - 4);
    ctx.fillText("+gamma", gammaRightX, chart.y + chart.h - 4);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.note;
    ctx.fillText("g(0)", centerX + 8, Math.max(chart.y + 56, centerY - 4));
    ctx.fillText("g(0)/2", gammaRightX + 8, Math.max(chart.y + 56, halfY - 4));
    ctx.fillText("omega", chart.x + chart.w - 42, chart.y + chart.h - 4);
    ctx.restore();

    return { peak, halfMax };
  };

  const drawSampleStrip = (chart, gamma, now) => {
    drawCard(
      chart.x,
      chart.y,
      chart.w,
      chart.h,
      "Sample oscillator frequencies",
      "Most oscillators stay near zero detuning, but the Lorentzian still leaves noticeable far tails.",
    );

    const omegaLimit = 4;
    const baseY = chart.y + chart.h - 22;
    const axisY = chart.y + 52;

    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chart.x + 18, baseY);
    ctx.lineTo(chart.x + chart.w - 18, baseY);
    ctx.moveTo(mapX(chart, 0, omegaLimit), axisY);
    ctx.lineTo(mapX(chart, 0, omegaLimit), baseY);
    ctx.stroke();
    ctx.restore();

    sampleSeeds.forEach((seed, index) => {
      const omegaRaw = gamma * Math.tan(Math.PI * (seed - 0.5));
      const omega = clamp(omegaRaw, -omegaLimit, omegaLimit);
      const x = mapX(chart, omega, omegaLimit);
      const row = index % 5;
      const bounce = 2 * Math.sin(now * 0.0015 + index * 0.7);
      const y = baseY - 12 - row * 14 + bounce;
      const alpha = Math.abs(omegaRaw) > omegaLimit ? 0.28 : 0.78;
      const radius = Math.abs(omegaRaw) > omegaLimit ? 2.8 : 3.5;

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(15,118,110," + alpha.toFixed(2) + ")";
      ctx.fill();
      ctx.restore();
    });

    ctx.save();
    ctx.fillStyle = COLORS.note;
    ctx.font = "11px IBM Plex Sans, Inter, sans-serif";
    ctx.fillText("center cluster", mapX(chart, -0.55, omegaLimit), chart.y + 68);
    ctx.fillText("tail samples", mapX(chart, 2.4, omegaLimit), chart.y + 68);
    ctx.restore();
  };

  const draw = (now) => {
    const width = state.width;
    const height = state.height;
    if (width <= 1 || height <= 1) {
      return;
    }

    const gamma = 0.55 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.00075));
    const kc = 2 * gamma;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    const marginX = 16;
    const topPadding = 90;
    const footerPadding = 36;
    const contentWidth = width - marginX * 2;
    const contentHeight = height - topPadding - footerPadding;
    const chartHeight = Math.max(150, contentHeight * 0.64);
    const stripHeight = Math.max(96, contentHeight - chartHeight - 12);

    const chart = { x: marginX, y: topPadding, w: contentWidth, h: chartHeight };
    const strip = { x: marginX, y: topPadding + chartHeight + 12, w: contentWidth, h: stripHeight };

    const values = drawDistributionChart(chart, gamma, now);
    drawSampleStrip(strip, gamma, now);

    footerLeft.textContent =
      "gamma is the half-width at half-maximum: the curve falls to half its peak exactly at omega = +/-gamma.";
    footerRight.textContent =
      "gamma=" + gamma.toFixed(2)
      + "   g(0)=" + values.peak.toFixed(3)
      + "   Kc=2gamma~" + kc.toFixed(2);

    if (typeof bridge.reportFrameValues === "function" && now - state.lastReportAt > 300) {
      state.lastReportAt = now;
      bridge.reportFrameValues({
        gamma,
        g0: values.peak,
        halfMax: values.halfMax,
        kc,
        halfWidthAtHalfMaximum: gamma,
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

  if (typeof bridge.onData === "function") {
    bridge.onData(() => {
      // This explainer is conceptual and does not depend on live capture data.
    });
  }

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
