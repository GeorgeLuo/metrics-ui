export default {
  id: "kuramoto_critical_coupling_states",
  name: "Kuramoto Critical Coupling States",
  description:
    "Visual explainer for Eq. 12 showing incoherent, threshold, and partially synchronized states, and why g(0) controls K_c.",
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
    ? bridge.createFactoryShell({ title: "Eq. 12: Critical Coupling" })
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
  title.textContent = "Eq. 12: what Kc means physically";
  title.style.fontSize = "15px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "-0.01em";
  header.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent =
    "Below Kc the phase vectors cancel, at Kc the synchronized branch appears, above Kc a locked cluster gives r > 0.";
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
    makeChip("g(0): center density", "rgba(59,130,246,0.10)", "rgba(37,99,235,0.24)", "#1d4ed8"),
  );
  chipRow.appendChild(
    makeChip("larger g(0) => smaller Kc", "rgba(16,185,129,0.10)", "rgba(5,150,105,0.24)", "#065f46"),
  );
  chipRow.appendChild(
    makeChip("r = 0 incoherent, r > 0 synchronized", "rgba(148,163,184,0.12)", "rgba(100,116,139,0.24)", "#334155"),
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
    grid: "rgba(148,163,184,0.18)",
    panelStroke: "rgba(148,163,184,0.34)",
    density: "#2563eb",
    densityFill: "rgba(59,130,246,0.12)",
    threshold: "#b45309",
    sync: "#0f766e",
    incoherent: "#64748b",
    vector: "#1d4ed8",
    note: "rgba(15,23,42,0.72)",
  };

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    rafId: 0,
    lastReportAt: 0,
  };

  const oscillatorCount = 24;
  const seeds = Array.from({ length: oscillatorCount }, (_, index) => ({
    phase: (index / oscillatorCount) * Math.PI * 2,
    wobble: 0.35 + (index % 5) * 0.07,
    offset: (index * 0.73) % (Math.PI * 2),
  }));

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

  const gaussian = (x) => {
    const sigma = 0.42;
    return Math.exp(-(x * x) / (2 * sigma * sigma));
  };

  const drawDensityPlot = (x, y, width, height, now) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width, height);
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i <= 80; i += 1) {
      const t = i / 80;
      const omega = -1.2 + 2.4 * t;
      const px = t * width;
      const py = height - gaussian(omega) * (height * 0.8);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = COLORS.densityFill;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i <= 80; i += 1) {
      const t = i / 80;
      const omega = -1.2 + 2.4 * t;
      const px = t * width;
      const py = height - gaussian(omega) * (height * 0.8);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = COLORS.density;
    ctx.lineWidth = 2;
    ctx.stroke();

    const pulse = 1 + 0.08 * Math.sin(now * 0.0032);
    const peakX = width / 2;
    const peakY = height - gaussian(0) * (height * 0.8);
    ctx.beginPath();
    ctx.arc(peakX, peakY, 5 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(37,99,235,0.14)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(peakX, peakY, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.density;
    ctx.fill();

    ctx.fillStyle = COLORS.slate;
    ctx.font = "600 11px IBM Plex Sans, Inter, sans-serif";
    ctx.fillText("g(ω)", 6, 12);
    ctx.textAlign = "center";
    ctx.fillText("0", peakX, height + 14);
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.note;
    ctx.fillText("g(0)", peakX + 8, Math.max(14, peakY - 4));
    ctx.restore();
  };

  const phaseForSeed = (seed, strength, now) => {
    const clusterCenter = 0.2 * Math.sin(now * 0.0012 + seed.offset);
    const wobble = 0.12 * Math.sin(now * 0.0016 * seed.wobble + seed.offset);
    return (1 - strength) * seed.phase + strength * clusterCenter + wobble;
  };

  const drawStatePanel = (panel, now) => {
    const { x, y, width, height, title, subtitle, strength, accent, fill } = panel;
    const cx = x + width * 0.5;
    const cy = y + height * 0.53;
    const radius = Math.min(width, height) * 0.26;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 16);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fill();
    ctx.strokeStyle = COLORS.panelStroke;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = COLORS.slate;
    ctx.font = "700 12px IBM Plex Sans, Inter, sans-serif";
    ctx.fillText(title, x + 12, y + 18);
    ctx.font = "11px IBM Plex Sans, Inter, sans-serif";
    ctx.fillStyle = COLORS.note;
    ctx.fillText(subtitle, x + 12, y + 34);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    let sumX = 0;
    let sumY = 0;
    seeds.forEach((seed, index) => {
      const angle = phaseForSeed(seed, strength, now + index * 13);
      const px = cx + Math.cos(angle) * radius;
      const py = cy - Math.sin(angle) * radius;
      sumX += Math.cos(angle);
      sumY += Math.sin(angle);

      ctx.beginPath();
      ctx.arc(px, py, 4.4, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    const resultant = Math.sqrt(sumX * sumX + sumY * sumY) / seeds.length;
    const vx = sumX / seeds.length;
    const vy = sumY / seeds.length;
    const vectorLength = radius * 0.88 * Math.min(1, resultant * 1.7);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + vx * vectorLength, cy - vy * vectorLength);
    ctx.strokeStyle = COLORS.vector;
    ctx.lineWidth = 3;
    ctx.stroke();

    const arrowX = cx + vx * vectorLength;
    const arrowY = cy - vy * vectorLength;
    const angle = Math.atan2(-vy, vx);
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(arrowX - 8 * Math.cos(angle - Math.PI / 6), arrowY - 8 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(arrowX - 8 * Math.cos(angle + Math.PI / 6), arrowY - 8 * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = COLORS.vector;
    ctx.fill();

    ctx.fillStyle = COLORS.note;
    ctx.font = "600 11px IBM Plex Mono, Fira Code, monospace";
    ctx.fillText("r ≈ " + resultant.toFixed(2), x + 12, y + height - 12);
    ctx.restore();

    return resultant;
  };

  const draw = (now) => {
    const width = state.width;
    const height = state.height;
    if (width <= 1 || height <= 1) {
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    const topPadding = 78;
    const footerPadding = 32;
    const contentX = 14;
    const contentY = topPadding;
    const contentWidth = width - 28;
    const contentHeight = height - topPadding - footerPadding;
    const densityHeight = Math.min(78, contentHeight * 0.24);
    drawDensityPlot(contentX, contentY, contentWidth, densityHeight, now);

    const panelGap = 10;
    const panelsY = contentY + densityHeight + 12;
    const panelsHeight = Math.max(110, contentHeight - densityHeight - 12);
    const panelWidth = (contentWidth - panelGap * 2) / 3;
    const panels = [
      {
        x: contentX,
        y: panelsY,
        width: panelWidth,
        height: panelsHeight,
        title: "K < Kc",
        subtitle: "incoherent",
        strength: 0.02,
        accent: COLORS.incoherent,
        fill: "rgba(100,116,139,0.20)",
      },
      {
        x: contentX + panelWidth + panelGap,
        y: panelsY,
        width: panelWidth,
        height: panelsHeight,
        title: "K = Kc",
        subtitle: "onset",
        strength: 0.22,
        accent: COLORS.threshold,
        fill: "rgba(180,83,9,0.18)",
      },
      {
        x: contentX + (panelWidth + panelGap) * 2,
        y: panelsY,
        width: panelWidth,
        height: panelsHeight,
        title: "K > Kc",
        subtitle: "partial sync",
        strength: 0.72,
        accent: COLORS.sync,
        fill: "rgba(15,118,110,0.18)",
      },
    ];

    const resultants = panels.map((panel) => drawStatePanel(panel, now));
    footerLeft.textContent = "g(0) sets the onset threshold because Eq. 12 is evaluated at r = 0.";
    footerRight.textContent = "r: " + resultants.map((value) => value.toFixed(2)).join("  ");

    if (now - state.lastReportAt > 1200) {
      state.lastReportAt = now;
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
    }
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

  bridge.onData(() => {
    // This explainer is intentionally conceptual and does not depend on live capture data.
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
