export default {
  id: "kuramoto_eq18_normalization_constraint",
  name: "Kuramoto Eq. 18 Normalization Constraint",
  description:
    "Visual explainer for Eq. 18 showing that an admissible perturbation redistributes probability around theta without changing the total mass.",
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
    ? bridge.createFactoryShell({ title: "Eq. 18: Normalization constraint" })
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
  root.style.background = "linear-gradient(180deg, rgba(248,250,252,0.98), rgba(240,249,255,0.94))";
  root.style.color = "#0f172a";
  root.style.fontFamily = "'IBM Plex Sans', 'Inter', sans-serif";

  const wrap = document.createElement("div");
  wrap.style.position = "absolute";
  wrap.style.inset = "0";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.padding = "14px";
  wrap.style.boxSizing = "border-box";
  wrap.style.gap = "10px";
  root.appendChild(wrap);

  const header = document.createElement("div");
  header.style.flex = "0 0 auto";
  wrap.appendChild(header);

  const title = document.createElement("div");
  title.textContent = "Eq. 18: zero signed area";
  title.style.fontSize = "15px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "-0.01em";
  header.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.textContent =
    "For each fixed omega, the perturbation mu(theta, omega) may move probability around theta, but its total signed area must be zero.";
  subtitle.style.marginTop = "4px";
  subtitle.style.maxWidth = "760px";
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
    return chip;
  };

  chipRow.appendChild(
    makeChip("blue area: add density here", "rgba(37,99,235,0.10)", "rgba(37,99,235,0.24)", "#1d4ed8"),
  );
  chipRow.appendChild(
    makeChip("orange area: remove density there", "rgba(234,88,12,0.10)", "rgba(234,88,12,0.24)", "#9a3412"),
  );
  chipRow.appendChild(
    makeChip("net mass change must be zero", "rgba(15,118,110,0.10)", "rgba(15,118,110,0.24)", "#0f766e"),
  );

  const panels = document.createElement("div");
  panels.style.flex = "1 1 auto";
  panels.style.minHeight = "0";
  panels.style.display = "grid";
  panels.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  panels.style.gap = "12px";
  wrap.appendChild(panels);

  const footer = document.createElement("div");
  footer.textContent = "Eq. 18 filters Eq. 17: only perturbation shapes with zero theta-average are admissible.";
  footer.style.flex = "0 0 auto";
  footer.style.fontSize = "11px";
  footer.style.fontWeight = "600";
  footer.style.color = "rgba(15,23,42,0.72)";
  footer.style.paddingTop = "2px";
  wrap.appendChild(footer);

  const NS = "http://www.w3.org/2000/svg";

  const createSvg = (tag) => document.createElementNS(NS, tag);

  const setAttrs = (el, attrs) => {
    Object.entries(attrs).forEach(([key, value]) => {
      el.setAttribute(key, String(value));
    });
    return el;
  };

  const makeText = (parent, text, x, y, size, weight, fill, anchor) => {
    const node = createSvg("text");
    node.textContent = text;
    setAttrs(node, {
      x,
      y,
      "font-size": size,
      "font-weight": weight,
      fill,
      "text-anchor": anchor || "start",
    });
    parent.appendChild(node);
    return node;
  };

  const curvePoints = (kind, width, baseY, amplitude) => {
    const points = [];
    for (let i = 0; i <= 120; i += 1) {
      const t = i / 120;
      const x = 34 + t * (width - 68);
      const value = kind === "allowed"
        ? Math.sin(2 * Math.PI * t)
        : 0.52 + 0.18 * Math.sin(2 * Math.PI * t - 0.45);
      const y = baseY - value * amplitude;
      points.push({ x, y, value });
    }
    return points;
  };

  const linePath = (points) => points
    .map((point, index) => (index === 0 ? "M " : " L ") + point.x.toFixed(1) + " " + point.y.toFixed(1))
    .join("");

  const areaPath = (points, predicate, baseY) => {
    const segments = [];
    let current = [];
    points.forEach((point) => {
      if (predicate(point.value)) {
        current.push(point);
        return;
      }
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    });
    if (current.length > 0) {
      segments.push(current);
    }
    return segments.map((segment) => {
      const first = segment[0];
      const last = segment[segment.length - 1];
      return "M " + first.x.toFixed(1) + " " + baseY.toFixed(1)
        + " L " + segment.map((point) => point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" L ")
        + " L " + last.x.toFixed(1) + " " + baseY.toFixed(1)
        + " Z";
    });
  };

  const drawPanel = ({ titleText, statusText, statusColor, kind, equationText, noteText }) => {
    const panel = document.createElement("div");
    panel.style.minWidth = "0";
    panel.style.minHeight = "0";
    panel.style.border = "1px solid rgba(148,163,184,0.34)";
    panel.style.borderRadius = "16px";
    panel.style.background = "rgba(255,255,255,0.70)";
    panel.style.boxShadow = "0 18px 44px rgba(15,23,42,0.08)";
    panel.style.overflow = "hidden";
    panel.style.position = "relative";

    const svg = createSvg("svg");
    setAttrs(svg, {
      viewBox: "0 0 420 280",
      width: "100%",
      height: "100%",
      preserveAspectRatio: "xMidYMid meet",
    });
    panel.appendChild(svg);

    makeText(svg, titleText, 22, 28, 15, 700, "#0f172a");
    makeText(svg, statusText, 398, 28, 12, 700, statusColor, "end");
    makeText(svg, equationText, 22, 52, 11, 600, "rgba(15,23,42,0.68)");

    const chart = setAttrs(createSvg("g"), { transform: "translate(0, 8)" });
    svg.appendChild(chart);

    const baseY = 150;
    const width = 420;
    const amplitude = 54;
    const points = curvePoints(kind, width, baseY, amplitude);

    setAttrs(chart.appendChild(createSvg("line")), {
      x1: 34,
      y1: baseY,
      x2: width - 34,
      y2: baseY,
      stroke: "rgba(100,116,139,0.62)",
      "stroke-width": 1.2,
    });
    setAttrs(chart.appendChild(createSvg("line")), {
      x1: 34,
      y1: baseY - 72,
      x2: 34,
      y2: baseY + 72,
      stroke: "rgba(100,116,139,0.34)",
      "stroke-width": 1,
    });

    makeText(chart, "-pi", 34, baseY + 92, 11, 600, "rgba(15,23,42,0.62)", "middle");
    makeText(chart, "theta", width / 2, baseY + 92, 11, 700, "rgba(15,23,42,0.72)", "middle");
    makeText(chart, "pi", width - 34, baseY + 92, 11, 600, "rgba(15,23,42,0.62)", "middle");
    makeText(chart, "0", 24, baseY + 4, 10, 600, "rgba(15,23,42,0.48)", "end");

    areaPath(points, (value) => value > 0, baseY).forEach((pathData) => {
      setAttrs(chart.appendChild(createSvg("path")), {
        d: pathData,
        fill: "rgba(37,99,235,0.18)",
        stroke: "none",
      });
    });
    areaPath(points, (value) => value < 0, baseY).forEach((pathData) => {
      setAttrs(chart.appendChild(createSvg("path")), {
        d: pathData,
        fill: "rgba(234,88,12,0.18)",
        stroke: "none",
      });
    });

    setAttrs(chart.appendChild(createSvg("path")), {
      d: linePath(points),
      fill: "none",
      stroke: kind === "allowed" ? "#0f766e" : "#dc2626",
      "stroke-width": 3,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });

    if (kind === "allowed") {
      makeText(chart, "+ area", 112, baseY - 36, 12, 700, "#1d4ed8", "middle");
      makeText(chart, "- area", 306, baseY + 50, 12, 700, "#c2410c", "middle");
      makeText(chart, "same size, opposite sign", 210, 236, 12, 700, "#0f766e", "middle");
    } else {
      makeText(chart, "mostly positive area", 210, baseY - 44, 12, 700, "#dc2626", "middle");
      makeText(chart, "adds total mass", 210, 236, 12, 700, "#dc2626", "middle");
    }

    makeText(svg, noteText, 22, 262, 11, 600, "rgba(15,23,42,0.70)");

    return panel;
  };

  panels.appendChild(drawPanel({
    titleText: "Allowed perturbation",
    statusText: "integral = 0",
    statusColor: "#0f766e",
    kind: "allowed",
    equationText: "redistributes density around the circle",
    noteText: "Positive and negative signed areas cancel.",
  }));

  panels.appendChild(drawPanel({
    titleText: "Forbidden perturbation",
    statusText: "integral != 0",
    statusColor: "#dc2626",
    kind: "forbidden",
    equationText: "changes total probability mass",
    noteText: "This violates Eq. 18 for that fixed omega.",
  }));

  const layout = () => {
    const rect = root.getBoundingClientRect();
    panels.style.gridTemplateColumns = rect.width < 640
      ? "minmax(0, 1fr)"
      : "repeat(2, minmax(0, 1fr))";
  };

  const resizeObserver = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(layout)
    : null;
  if (resizeObserver) {
    resizeObserver.observe(root);
  }
  window.addEventListener("resize", layout);
  layout();

  report({ kind: "init", message: "Eq. 18 normalization visual ready." });

  return () => {
    window.removeEventListener("resize", layout);
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  };
})();
`,
};
