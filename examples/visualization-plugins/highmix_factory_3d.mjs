export default {
  id: "highmix_factory_3d",
  name: "HighMix Factory 3D",
  description: "Three.js factory floor scene driven by HighMix simulation summary metrics.",
  libraries: ["three", "three-gltf-loader"],
  renderScript: `
(() => {
  const root = document.getElementById("metrics-ui-visual-root");
  if (!root) {
    return;
  }
  root.innerHTML = "";
  root.style.background = "#0b1220";

  const THREE = window.THREE;
  if (!THREE) {
    root.textContent = "Three.js not available";
    return;
  }

  const report = (payload) => {
    if (window.MetricsUIBridge && typeof window.MetricsUIBridge.report === "function") {
      window.MetricsUIBridge.report(payload);
    }
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0f172a");

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
  camera.position.set(9, 7, 10);
  camera.lookAt(0, 1.8, 0);

  const keyLight = new THREE.DirectionalLight("#f8fafc", 1.25);
  keyLight.position.set(9, 14, 7);
  scene.add(keyLight);
  scene.add(new THREE.AmbientLight("#93c5fd", 0.55));

  const world = new THREE.Group();
  scene.add(world);

  const WORLD_BOUNDS = {
    minX: -10.5,
    maxX: 10.5,
    minY: 0,
    maxY: 6.2,
    minZ: -7.5,
    maxZ: 7.5,
  };
  const boundsSize = new THREE.Vector3(
    WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX,
    WORLD_BOUNDS.maxY - WORLD_BOUNDS.minY,
    WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ,
  );
  const boundsCenter = new THREE.Vector3(
    (WORLD_BOUNDS.minX + WORLD_BOUNDS.maxX) * 0.5,
    (WORLD_BOUNDS.minY + WORLD_BOUNDS.maxY) * 0.5,
    (WORLD_BOUNDS.minZ + WORLD_BOUNDS.maxZ) * 0.5,
  );
  const boundsGuide = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(boundsSize.x, boundsSize.y, boundsSize.z)),
    new THREE.LineBasicMaterial({ color: "#475569", transparent: true, opacity: 0.52 }),
  );
  boundsGuide.position.copy(boundsCenter);
  world.add(boundsGuide);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 16),
    new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.9, metalness: 0.15 }),
  );
  floor.rotation.x = -Math.PI / 2;
  world.add(floor);

  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.4),
    new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.86, metalness: 0.2 }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0.01, 3.1);
  world.add(lane);

  const grid = new THREE.GridHelper(20, 20, "#334155", "#1f2937");
  grid.position.y = 0.02;
  world.add(grid);

  const mkRack = (color, x) => {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.35, 2.2),
      new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.95, metalness: 0.1 }),
    );
    base.position.set(x, 0.18, -2.9);
    world.add(base);
    const load = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.0, 1.4),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35 }),
    );
    load.position.set(x, 0.85, -2.9);
    world.add(load);
    return load;
  };

  const pendingRack = mkRack("#ef4444", -4.6);
  const releasedRack = mkRack("#22c55e", 0);
  const completedRack = mkRack("#38bdf8", 4.6);

  const machineSlots = [];
  const machineFallbackApplied = [];
  const machineTemplateFallback = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 1.15, 1.15),
    new THREE.MeshStandardMaterial({ color: "#64748b", roughness: 0.5, metalness: 0.55 }),
  );
  for (let i = 0; i < 5; i += 1) {
    const slot = new THREE.Group();
    slot.position.set(-5.4 + i * 2.7, 0, 0.55);
    slot.add(machineTemplateFallback.clone());
    world.add(slot);
    machineSlots.push(slot);
    machineFallbackApplied.push(false);
  }

  const moverSlots = [];
  const moverFallbackApplied = [];
  const moverFallback = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 10),
    new THREE.MeshStandardMaterial({ color: "#f59e0b", roughness: 0.4, metalness: 0.15 }),
  );
  for (let i = 0; i < 28; i += 1) {
    const slot = new THREE.Group();
    slot.visible = false;
    slot.position.set(0, 0.2, 3.1);
    slot.add(moverFallback.clone());
    world.add(slot);
    moverSlots.push(slot);
    moverFallbackApplied.push(false);
  }

  const banner = document.createElement("div");
  banner.style.position = "absolute";
  banner.style.left = "10px";
  banner.style.top = "8px";
  banner.style.padding = "6px 8px";
  banner.style.background = "rgba(15,23,42,0.75)";
  banner.style.border = "1px solid rgba(148,163,184,0.35)";
  banner.style.color = "rgba(226,232,240,0.92)";
  banner.style.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  banner.style.pointerEvents = "none";
  banner.textContent = "HighMix Factory 3D";
  root.appendChild(banner);

  const asNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const state = {
    tick: 0,
    scenario: "unknown",
    total: 1,
    released: 0,
    pending: 0,
    completed: 0,
    reportAt: 0,
    loadedAssets: 0,
    outOfBoundsCount: 0,
    lastBoundsReportAt: 0,
    lastBoundsSignature: "",
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const boundsBox = new THREE.Box3();
  const clampSlotAnchor = (slot, nextPosition, label, violations) => {
    const clampedX = clamp(nextPosition.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    const clampedY = clamp(nextPosition.y, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);
    const clampedZ = clamp(nextPosition.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
    const changed =
      clampedX !== nextPosition.x ||
      clampedY !== nextPosition.y ||
      clampedZ !== nextPosition.z;
    slot.position.set(clampedX, clampedY, clampedZ);
    if (changed) {
      violations.push(label + ":anchor");
    }
  };
  const enforceObjectBounds = (slot, label, violations) => {
    boundsBox.setFromObject(slot);
    const axes = [];
    if (boundsBox.min.x < WORLD_BOUNDS.minX || boundsBox.max.x > WORLD_BOUNDS.maxX) axes.push("x");
    if (boundsBox.min.y < WORLD_BOUNDS.minY || boundsBox.max.y > WORLD_BOUNDS.maxY) axes.push("y");
    if (boundsBox.min.z < WORLD_BOUNDS.minZ || boundsBox.max.z > WORLD_BOUNDS.maxZ) axes.push("z");
    if (axes.length > 0) {
      violations.push(label + ":overflow[" + axes.join(",") + "]");
      return false;
    }
    return true;
  };

  const templates = {
    machine: null,
    mover: null,
  };

  let navigation = null;

  const resize = () => {
    const rect = root.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (navigation && navigation.controls && typeof navigation.controls.update === "function") {
      navigation.controls.update();
    }
  };

  const normalizeTemplate = (object, targetSize) => {
    const instance = object.clone(true);
    const box = new THREE.Box3().setFromObject(instance);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    instance.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const scale = targetSize / maxDim;
    instance.scale.setScalar(scale);
    const boxAfter = new THREE.Box3().setFromObject(instance);
    instance.position.y -= boxAfter.min.y;
    return instance;
  };

  const replaceSlotModel = (slot, template, yaw) => {
    while (slot.children.length > 0) {
      const child = slot.children.pop();
      if (child && typeof child.traverse === "function") {
        child.traverse((node) => {
          if (node && node.geometry && typeof node.geometry.dispose === "function") {
            node.geometry.dispose();
          }
        });
      }
    }
    const clone = template.clone(true);
    clone.rotation.y = yaw || 0;
    slot.add(clone);
  };

  const replaceWithFallbackIfNeeded = (slot, fallbackTemplate, yaw, fallbackAppliedFlags, index, label, violations) => {
    if (fallbackAppliedFlags[index]) {
      return;
    }
    fallbackAppliedFlags[index] = true;
    replaceSlotModel(slot, fallbackTemplate, yaw);
    violations.push(label + ":fallback");
    report({
      kind: "bounds",
      status: "fallback_applied",
      slot: label,
    });
  };

  const loadModels = async () => {
    try {
      const GLTFLoaderCtor = window.GLTFLoader || (window.__metricsUILibs && window.__metricsUILibs.gltfLoader && window.__metricsUILibs.gltfLoader.GLTFLoader);
      if (!GLTFLoaderCtor) {
        report({ kind: "model", status: "missing-loader" });
        return;
      }

      const loader = new GLTFLoaderCtor();
      const apiBase = window.MetricsUIBridge && typeof window.MetricsUIBridge.apiBase === "string"
        ? window.MetricsUIBridge.apiBase
        : "";
      const base = apiBase + "/api/visualization/assets/highmix";

      const [gearbox, milktruck, toycar] = await Promise.all([
        loader.loadAsync(base + "/gearbox.glb"),
        loader.loadAsync(base + "/milktruck.glb"),
        loader.loadAsync(base + "/toycar.glb"),
      ]);

      templates.machine = normalizeTemplate(gearbox.scene, 1.65);
      templates.mover = normalizeTemplate(milktruck.scene, 0.68);
      const altMover = normalizeTemplate(toycar.scene, 0.54);

      machineSlots.forEach((slot, index) => {
        replaceSlotModel(slot, templates.machine, index % 2 === 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
        machineFallbackApplied[index] = false;
      });

      moverSlots.forEach((slot, index) => {
        const useAlt = index % 4 === 0;
        replaceSlotModel(slot, useAlt ? altMover : templates.mover, Math.PI * 0.5);
        moverFallbackApplied[index] = false;
      });

      state.loadedAssets = 3;
      report({ kind: "model", status: "loaded", assets: ["GearboxAssy", "CesiumMilkTruck", "ToyCar"] });
    } catch (error) {
      report({
        kind: "model",
        status: "failed",
        error: error instanceof Error ? error.message : "Failed to load GLB assets",
      });
    }
  };

  const setupNavigation = () => {
    if (!window.MetricsUIBridge || typeof window.MetricsUIBridge.register3DScene !== "function") {
      return;
    }
    if (navigation && typeof navigation.dispose === "function") {
      try { navigation.dispose(); } catch (_error) {}
    }
    navigation = window.MetricsUIBridge.register3DScene({
      renderer,
      camera,
      sceneRoot: world,
    });
    if (navigation) {
      report({ kind: "navigation", mode: "turntable", target: navigation.target, distance: navigation.distance });
    }
  };

  const onFrame = (frame) => {
    const record = frame && frame.record && typeof frame.record === "object" ? frame.record : null;
    const entities = record && record.entities && typeof record.entities === "object" ? record.entities : null;
    const rootEntity = entities && entities["0"] && typeof entities["0"] === "object" ? entities["0"] : null;
    const summary = rootEntity && rootEntity.job_release_summary && typeof rootEntity.job_release_summary === "object"
      ? rootEntity.job_release_summary
      : null;
    state.tick = asNumber(frame && frame.tick, state.tick);
    state.scenario = rootEntity && typeof rootEntity.selected_scenario === "string"
      ? rootEntity.selected_scenario
      : state.scenario;
    state.total = Math.max(1, asNumber(summary && summary.total_jobs, state.total));
    state.released = Math.max(0, asNumber(summary && summary.released_jobs, state.released));
    state.pending = Math.max(0, asNumber(summary && summary.pending_jobs, state.pending));
    state.completed = Math.max(0, asNumber(summary && summary.completed_jobs, state.completed));
  };

  const setRackScale = (mesh, value, total) => {
    const ratio = Math.max(0, Math.min(1, value / Math.max(1, total)));
    const h = 0.2 + ratio * 4.0;
    mesh.scale.y = h;
    mesh.position.y = 0.35 + h * 0.5;
  };

  let animationHandle = 0;
  const render = () => {
    const t = state.tick;
    const total = Math.max(1, state.total);
    const releasedRatio = Math.max(0, Math.min(1, state.released / total));
    const pendingRatio = Math.max(0, Math.min(1, state.pending / total));
    const completedRatio = Math.max(0, Math.min(1, state.completed / total));
    const boundsViolations = [];

    setRackScale(pendingRack, state.pending, total);
    setRackScale(releasedRack, state.released, total);
    setRackScale(completedRack, state.completed, total);

    machineSlots.forEach((slot, index) => {
      const pulse = 0.45 + 0.55 * Math.sin(t * 0.055 + index * 0.75);
      const util = Math.min(1, releasedRatio * 0.72 + completedRatio * 0.28) * pulse;
      clampSlotAnchor(
        slot,
        { x: slot.position.x, y: util * 0.22, z: slot.position.z },
        "machine-" + String(index),
        boundsViolations,
      );
      const machineLabel = "machine-" + String(index);
      const inBounds = enforceObjectBounds(slot, machineLabel, boundsViolations);
      if (!inBounds) {
        replaceWithFallbackIfNeeded(
          slot,
          machineTemplateFallback,
          0,
          machineFallbackApplied,
          index,
          machineLabel,
          boundsViolations,
        );
      }
      slot.visible = enforceObjectBounds(slot, machineLabel, boundsViolations);
    });

    const activeJobs = Math.max(1, Math.min(moverSlots.length, Math.floor(3 + releasedRatio * 22)));
    const conveyorSpan = 13.8;
    moverSlots.forEach((slot, index) => {
      slot.visible = index < activeJobs;
      if (!slot.visible) {
        return;
      }
      const laneIndex = index % 4;
      const phase = (t * 0.03 + index * 0.13) % 1;
      clampSlotAnchor(
        slot,
        {
          x: -6.9 + phase * conveyorSpan,
          y: 0.03 + laneIndex * 0.04,
          z: 2.4 + laneIndex * 0.48,
        },
        "mover-" + String(index),
        boundsViolations,
      );
      slot.rotation.y = Math.PI * 0.5;
      const moverLabel = "mover-" + String(index);
      const inBounds = enforceObjectBounds(slot, moverLabel, boundsViolations);
      if (!inBounds) {
        replaceWithFallbackIfNeeded(
          slot,
          moverFallback,
          Math.PI * 0.5,
          moverFallbackApplied,
          index,
          moverLabel,
          boundsViolations,
        );
      }
      slot.visible = enforceObjectBounds(slot, moverLabel, boundsViolations);
    });

    const boundsIssueCount = boundsViolations.length;
    if (boundsIssueCount > 0) {
      banner.style.background = "rgba(127,29,29,0.76)";
      banner.style.border = "1px solid rgba(248,113,113,0.8)";
      banner.style.color = "rgba(254,226,226,0.96)";
    } else {
      banner.style.background = "rgba(15,23,42,0.75)";
      banner.style.border = "1px solid rgba(148,163,184,0.35)";
      banner.style.color = "rgba(226,232,240,0.92)";
    }

    banner.textContent =
      "HighMix Factory 3D | scenario=" + state.scenario
      + " | tick=" + String(t)
      + " | pending=" + String(state.pending)
      + " | released=" + String(state.released)
      + " | completed=" + String(state.completed)
      + " | oob=" + String(boundsIssueCount)
      + (state.loadedAssets > 0 ? " | models=loaded" : " | models=fallback");

    renderer.render(scene, camera);

    const now = Date.now();
    if (boundsIssueCount > 0) {
      const signature = boundsViolations.slice(0, 8).join("|");
      const shouldReportBounds =
        signature !== state.lastBoundsSignature ||
        now - state.lastBoundsReportAt > 2000;
      if (shouldReportBounds) {
        state.lastBoundsSignature = signature;
        state.lastBoundsReportAt = now;
        report({
          kind: "error",
          error: "Out-of-bounds objects detected in constrained world plane.",
          bounds: WORLD_BOUNDS,
          count: boundsIssueCount,
          sample: boundsViolations.slice(0, 8),
        });
      }
    } else if (state.outOfBoundsCount > 0) {
      report({
        kind: "bounds",
        status: "recovered",
        bounds: WORLD_BOUNDS,
      });
      state.lastBoundsSignature = "";
    }
    state.outOfBoundsCount = boundsIssueCount;
    if (now - state.reportAt > 1000) {
      state.reportAt = now;
      report({
        kind: "frame",
        status: boundsIssueCount > 0 ? "oob" : "ok",
        bounds: WORLD_BOUNDS,
        count: boundsIssueCount,
        sample: boundsViolations.slice(0, 8),
        hasVisualSignal: true,
        visualSignal: "canvas",
        canvasCount: 1,
        svgCount: 0,
        rootChildCount: 1,
        textLength: 0,
      });
    }
    animationHandle = window.requestAnimationFrame(render);
  };

  const unsubscribe = window.MetricsUIBridge && typeof window.MetricsUIBridge.onFrame === "function"
    ? window.MetricsUIBridge.onFrame(onFrame)
    : () => {};

  setupNavigation();
  window.addEventListener("resize", resize);
  resize();
  loadModels();
  report({ kind: "init", hasVisualSignal: true, visualSignal: "canvas" });
  animationHandle = window.requestAnimationFrame(render);

  window.addEventListener("beforeunload", () => {
    try { unsubscribe(); } catch (_error) {}
    if (navigation && typeof navigation.dispose === "function") {
      try { navigation.dispose(); } catch (_error) {}
    }
    try { window.cancelAnimationFrame(animationHandle); } catch (_error) {}
    try { renderer.dispose(); } catch (_error) {}
  });
})();
`,
};
