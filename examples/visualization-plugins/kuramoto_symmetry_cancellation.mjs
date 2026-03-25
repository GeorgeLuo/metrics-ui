export default {
  id: "kuramoto_symmetry_cancellation",
  name: "Kuramoto Symmetry Cancellation",
  description:
    "Animated explainer for why symmetric g(omega) and the odd omega/(Kr) factor make the imaginary term cancel over symmetric bounds.",
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
    ? bridge.createFactoryShell({ title: "Kuramoto Symmetry Cancellation" })
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
  root.style.background = "linear-gradient(180deg, rgba(248,250,252,0.96), rgba(226,232,240,0.9))";
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
  title.textContent = "Why the imaginary term cancels";
  title.style.fontSize = "15px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "-0.01em";
  header.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent =
    "Equal density from g(omega) at +/-omega, opposite sign from omega/(Kr), so the pair sum is zero.";
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
    makeChip("g(-omega) = g(omega)   even", "rgba(148,163,184,0.14)", "rgba(100,116,139,0.28)", "#0f172a"),
  );
  chipRow.appendChild(
    makeChip("(-omega)/(Kr) = -(omega/Kr)   odd", "rgba(251,191,36,0.12)", "rgba(217,119,6,0.28)", "#92400e"),
  );
  chipRow.appendChild(
    makeChip("odd x even = odd", "rgba(16,185,129,0.12)", "rgba(5,150,105,0.28)", "#065f46"),
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

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    rafId: 0,
    liveOrderR: null,
    lastTick: 0,
    lastReportAt: 0,
  };

  const COLORS = {
    slate: "#475569",
    axis: "rgba(15,23,42,0.42)",
    grid: "rgba(148,163,184,0.18)",
    density: "#334155",
    odd: "#d97706",
    neg: "#0f766e",
    posFill: "rgba(217,119,6,0.18)",
    negFill: "rgba(15,118,110,0.18)",
    chip: "#0f172a",
    accent: "#1d4ed8",
    note: "rgba(15,23,42,0.72)",
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const evenDensity = (omega) => {
    const sigma = 0.45;
    return Math.exp(-(omega * omega) / (2 * sigma * sigma));
  };

  const oddFactor = (omega) => omega;

  const oddProduct = (omega) => oddFactor(omega) * evenDensity(omega);

  const fmt = (value) => {
    const rounded = Math.round(value * 100) / 100;
    return rounded >= 0 ? "+" + rounded.toFixed(2) : rounded.toFixed(2);
  };

  const extractOrderR = (frame) => {
    if (!frame || !frame.record || typeof frame.record !== "object") {
      return null;
    }
    const entities = frame.record.entities;
    if (!entities || typeof entities !== "object") {
      return null;
    }
    for (const value of Object.values(entities)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const candidate =
        value.series_order_parameter_r
        ?? value.order_parameter_r
        ?? value.r
        ?? null;
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
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

  const drawFrame = (now) => {
    const w = state.width;
    const h = state.height;
    if (w <= 1 || h <= 1) {
      return;
    }

    const dpr = state.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const marginX = 18;
    const marginTop = 88;
    const marginBottom = 48;
    const gutter = 14;
    const bottomHeight = Math.max(132, h - marginTop - marginBottom - 114);
    const topHeight = 102;
    const halfWidth = (w - marginX * 2 - gutter) / 2;

    const chartEven = { x: marginX, y: marginTop, w: halfWidth, h: topHeight };
    const chartOdd = { x: marginX + halfWidth + gutter, y: marginTop, w: halfWidth, h: topHeight };
    const chartProduct = { x: marginX, y: marginTop + topHeight + 18, w: w - marginX * 2, h: bottomHeight };

    const sampleOmega = 0.16 + 0.76 * (0.5 + 0.5 * Math.sin(now * 0.0011));
    const negativeOmega = -sampleOmega;
    const gPos = evenDensity(sampleOmega);
    const gNeg = evenDensity(negativeOmega);
    const oddPos = oddFactor(sampleOmega);
    const oddNeg = oddFactor(negativeOmega);
    const productPos = oddProduct(sampleOmega);
    const productNeg = oddProduct(negativeOmega);
    const pairSum = productPos + productNeg;

    const drawCard = (chart, titleText, subtitleText) => {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.68)";
      ctx.strokeStyle = "rgba(148,163,184,0.28)";
      ctx.lineWidth = 1;
      const r = 12;
      ctx.beginPath();
      ctx.moveTo(chart.x + r, chart.y);
      ctx.lineTo(chart.x + chart.w - r, chart.y);
      ctx.quadraticCurveTo(chart.x + chart.w, chart.y, chart.x + chart.w, chart.y + r);
      ctx.lineTo(chart.x + chart.w, chart.y + chart.h - r);
      ctx.quadraticCurveTo(chart.x + chart.w, chart.y + chart.h, chart.x + chart.w - r, chart.y + chart.h);
      ctx.lineTo(chart.x + r, chart.y + chart.h);
      ctx.quadraticCurveTo(chart.x, chart.y + chart.h, chart.x, chart.y + chart.h - r);
      ctx.lineTo(chart.x, chart.y + r);
      ctx.quadraticCurveTo(chart.x, chart.y, chart.x + r, chart.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = COLORS.chip;
      ctx.font = "600 11px 'IBM Plex Sans', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(titleText, chart.x + 12, chart.y + 10);

      ctx.fillStyle = COLORS.note;
      ctx.font = "10px 'IBM Plex Sans', sans-serif";
      ctx.fillText(subtitleText, chart.x + 12, chart.y + 26);
      ctx.restore();
    };

    const mapX = (chart, omega) => chart.x + 18 + ((omega + 1) / 2) * (chart.w - 36);
    const mapY = (chart, value, minValue, maxValue) => {
      const innerTop = chart.y + 42;
      const innerHeight = chart.h - 56;
      const t = (value - minValue) / (maxValue - minValue);
      return innerTop + (1 - t) * innerHeight;
    };

    const drawAxes = (chart, minValue, maxValue, labelLeft, labelRight) => {
      const axisY = mapY(chart, 0, minValue, maxValue);
      ctx.save();
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chart.x + 18, axisY);
      ctx.lineTo(chart.x + chart.w - 18, axisY);
      ctx.moveTo(mapX(chart, 0), chart.y + 42);
      ctx.lineTo(mapX(chart, 0), chart.y + chart.h - 14);
      ctx.stroke();

      ctx.fillStyle = COLORS.note;
      ctx.font = "10px 'IBM Plex Mono', monospace";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(labelLeft, chart.x + 18, chart.y + chart.h - 4);
      ctx.textAlign = "right";
      ctx.fillText(labelRight, chart.x + chart.w - 18, chart.y + chart.h - 4);
      ctx.textAlign = "left";
      ctx.restore();
      return axisY;
    };

    const drawCurve = (chart, fn, minValue, maxValue, strokeStyle) => {
      ctx.save();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let step = 0; step <= 160; step += 1) {
        const omega = -1 + (step / 160) * 2;
        const x = mapX(chart, omega);
        const y = mapY(chart, fn(omega), minValue, maxValue);
        if (step === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    const fillProductArea = (chart) => {
      const axisY = mapY(chart, 0, -0.5, 0.5);
      const drawHalf = (sign, fillStyle) => {
        ctx.save();
        ctx.fillStyle = fillStyle;
        ctx.beginPath();
        const startOmega = sign < 0 ? -1 : 0;
        const endOmega = sign < 0 ? 0 : 1;
        ctx.moveTo(mapX(chart, startOmega), axisY);
        for (let step = 0; step <= 120; step += 1) {
          const t = step / 120;
          const omega = startOmega + (endOmega - startOmega) * t;
          ctx.lineTo(mapX(chart, omega), mapY(chart, oddProduct(omega), -0.5, 0.5));
        }
        ctx.lineTo(mapX(chart, endOmega), axisY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      drawHalf(-1, COLORS.negFill);
      drawHalf(1, COLORS.posFill);
    };

    const drawMarkerPair = (chart, values, minValue, maxValue, colorA, colorB, joinAcrossAxis) => {
      const axisY = mapY(chart, 0, minValue, maxValue);
      const [leftOmega, leftValue, rightOmega, rightValue] = values;
      const leftX = mapX(chart, leftOmega);
      const rightX = mapX(chart, rightOmega);
      const leftY = mapY(chart, leftValue, minValue, maxValue);
      const rightY = mapY(chart, rightValue, minValue, maxValue);

      ctx.save();
      ctx.lineWidth = 2;

      ctx.strokeStyle = colorA;
      ctx.beginPath();
      ctx.moveTo(leftX, axisY);
      ctx.lineTo(leftX, leftY);
      ctx.stroke();

      ctx.strokeStyle = colorB;
      ctx.beginPath();
      ctx.moveTo(rightX, axisY);
      ctx.lineTo(rightX, rightY);
      ctx.stroke();

      if (joinAcrossAxis) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "rgba(15,23,42,0.36)";
        ctx.beginPath();
        ctx.moveTo(leftX, leftY);
        ctx.lineTo(rightX, rightY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = colorA;
      ctx.beginPath();
      ctx.arc(leftX, leftY, 4.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = colorB;
      ctx.beginPath();
      ctx.arc(rightX, rightY, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    drawCard(chartEven, "1. Symmetric density g(omega)", "The left and right sides match at +/-omega.");
    drawAxes(chartEven, 0, 1.1, "-Kr", "+Kr");
    drawCurve(chartEven, evenDensity, 0, 1.1, COLORS.density);
    drawMarkerPair(
      chartEven,
      [negativeOmega, gNeg, sampleOmega, gPos],
      0,
      1.1,
      COLORS.neg,
      COLORS.odd,
      true,
    );

    drawCard(chartOdd, "2. Odd factor omega/(Kr)", "The sign flips when omega changes sign.");
    drawAxes(chartOdd, -1.1, 1.1, "-Kr", "+Kr");
    drawCurve(chartOdd, oddFactor, -1.1, 1.1, COLORS.accent);
    drawMarkerPair(
      chartOdd,
      [negativeOmega, oddNeg, sampleOmega, oddPos],
      -1.1,
      1.1,
      COLORS.neg,
      COLORS.odd,
      false,
    );

    drawCard(chartProduct, "3. Product (omega/Kr) g(omega)", "Equal magnitude, opposite sign, so the pair cancels inside the symmetric integral.");
    fillProductArea(chartProduct);
    drawAxes(chartProduct, -0.5, 0.5, "-Kr", "+Kr");
    drawCurve(chartProduct, oddProduct, -0.5, 0.5, "#0f172a");
    drawMarkerPair(
      chartProduct,
      [negativeOmega, productNeg, sampleOmega, productPos],
      -0.5,
      0.5,
      COLORS.neg,
      COLORS.odd,
      true,
    );

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.strokeStyle = "rgba(148,163,184,0.24)";
    ctx.lineWidth = 1;
    const boxX = chartProduct.x + chartProduct.w - 202;
    const boxY = chartProduct.y + 18;
    const boxW = 184;
    const boxH = 84;
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(boxX + r, boxY);
    ctx.lineTo(boxX + boxW - r, boxY);
    ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r);
    ctx.lineTo(boxX + boxW, boxY + boxH - r);
    ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH);
    ctx.lineTo(boxX + r, boxY + boxH);
    ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
    ctx.lineTo(boxX, boxY + r);
    ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLORS.chip;
    ctx.font = "600 11px 'IBM Plex Sans', sans-serif";
    ctx.fillText("Animated pair check", boxX + 12, boxY + 12);
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillText("g(+w) = " + gPos.toFixed(2), boxX + 12, boxY + 34);
    ctx.fillText("g(-w) = " + gNeg.toFixed(2), boxX + 12, boxY + 50);
    ctx.fillText("pair sum = " + pairSum.toFixed(3), boxX + 12, boxY + 66);
    ctx.restore();

    footerLeft.textContent =
      "At +/-omega, g stays the same but omega/(Kr) flips sign, so the imaginary contributions cancel pairwise.";
    footerRight.textContent =
      "h(+w)=" + fmt(productPos) + "   h(-w)=" + fmt(productNeg) + "   sum=" + pairSum.toFixed(3);

    if (state.liveOrderR !== null) {
      footerRight.textContent += "   live r~" + state.liveOrderR.toFixed(3);
    }

    if (typeof bridge.reportFrameValues === "function" && now - state.lastReportAt > 300) {
      state.lastReportAt = now;
      bridge.reportFrameValues({
        sampleOmega,
        gPositive: gPos,
        gNegative: gNeg,
        oddPositive: oddPos,
        oddNegative: oddNeg,
        productPositive: productPos,
        productNegative: productNeg,
        pairSum,
        liveOrderR: state.liveOrderR,
        tick: state.lastTick,
      });
    }

    report({
      kind: "frame",
      status: "odd-even-cancellation",
      hasVisualSignal: true,
      visualSignal: "canvas",
      canvasCount: 1,
      svgCount: 0,
      rootChildCount: root.childElementCount,
    });
  };

  const animate = (now) => {
    drawFrame(now);
    state.rafId = window.requestAnimationFrame(animate);
  };

  const onFrame = (frame) => {
    state.lastTick = Number(frame && frame.tick) || 0;
    const maybeOrderR = extractOrderR(frame);
    if (Number.isFinite(maybeOrderR)) {
      state.liveOrderR = maybeOrderR;
    }
  };

  const unsubscribe = typeof bridge.onFrame === "function" ? bridge.onFrame(onFrame) : () => {};

  resize();
  state.rafId = window.requestAnimationFrame(animate);
  window.addEventListener("resize", resize);

  report({
    kind: "init",
    status: "ready",
    hasVisualSignal: true,
    visualSignal: "canvas",
  });

  window.addEventListener("beforeunload", () => {
    try {
      window.removeEventListener("resize", resize);
    } catch (_error) {}
    try {
      if (state.rafId) {
        window.cancelAnimationFrame(state.rafId);
      }
    } catch (_error) {}
    try {
      unsubscribe();
    } catch (_error) {}
    try {
      if (shell && typeof shell.dispose === "function") {
        shell.dispose();
      }
    } catch (_error) {}
  });
})();
`,
};
