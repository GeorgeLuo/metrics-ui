import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CaptureRecord, CaptureSession } from "@shared/schema";

interface HighMixVisualizationProps {
  capture: CaptureSession | null;
  currentTick: number;
  onDebugChange?: (debug: HighMixVisualizationDebug) => void;
}

type HighMixSnapshot = {
  tick: number;
  scenario: string;
  total: number;
  released: number;
  pending: number;
  completed: number;
};

type SceneRefs = {
  pendingRack: THREE.Mesh | null;
  releasedRack: THREE.Mesh | null;
  throughputBeacon: THREE.Mesh | null;
  machineModels: THREE.Mesh[];
  movingJobs: THREE.Mesh[];
  spinModel: THREE.Mesh | null;
};

type ViewState = {
  dragging: boolean;
  lastX: number;
  lastY: number;
  zoomScale: number;
};

type VisualDebugState = {
  width: number;
  height: number;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  rotX: number;
  rotY: number;
  zoom: number;
};

export type HighMixVisualizationDebug = VisualDebugState & {
  captureId: string | null;
  tick: number | null;
};

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function extractSummarySnapshots(records: CaptureRecord[]): HighMixSnapshot[] {
  const snapshots: HighMixSnapshot[] = [];
  for (const record of records) {
    const root = record.entities?.["0"] as Record<string, unknown> | undefined;
    if (!root || typeof root !== "object") {
      continue;
    }
    const summary = root.job_release_summary as Record<string, unknown> | undefined;
    if (!summary || typeof summary !== "object") {
      continue;
    }
    const total = toNumber(summary.total_jobs);
    const released = toNumber(summary.released_jobs);
    const pending = toNumber(summary.pending_jobs);
    const completed = toNumber(summary.completed_jobs) ?? 0;
    if (total === null || released === null || pending === null) {
      continue;
    }
    snapshots.push({
      tick: record.tick,
      scenario:
        typeof root.selected_scenario === "string" && root.selected_scenario.trim()
          ? root.selected_scenario
          : "unknown",
      total,
      released,
      pending,
      completed,
    });
  }
  snapshots.sort((a, b) => a.tick - b.tick);
  return snapshots;
}

function findSnapshotIndex(snapshots: HighMixSnapshot[], tick: number): number {
  if (snapshots.length === 0) {
    return -1;
  }
  let low = 0;
  let high = snapshots.length - 1;
  let best = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (snapshots[mid].tick <= tick) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

export function HighMixVisualization({
  capture,
  currentTick,
  onDebugChange,
}: HighMixVisualizationProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const scenePivotRef = useRef<THREE.Group | null>(null);
  const sceneContentGroupRef = useRef<THREE.Group | null>(null);
  const viewStateRef = useRef<ViewState>({
    dragging: false,
    lastX: 0,
    lastY: 0,
    zoomScale: 1,
  });
  const debugStateRef = useRef<VisualDebugState>({
    width: 0,
    height: 0,
    cameraX: 0,
    cameraY: 0,
    cameraZ: 0,
    rotX: 0,
    rotY: 0,
    zoom: 1,
  });
  const sceneObjectsRef = useRef<SceneRefs>({
    pendingRack: null,
    releasedRack: null,
    throughputBeacon: null,
    machineModels: [],
    movingJobs: [],
    spinModel: null,
  });
  const snapshots = useMemo(() => extractSummarySnapshots(capture?.records ?? []), [capture?.records]);

  const resolved = useMemo(() => {
    if (snapshots.length === 0) {
      return null;
    }
    const index = findSnapshotIndex(snapshots, currentTick);
    if (index < 0) {
      return null;
    }
    const current = snapshots[index];
    const previous = snapshots[Math.max(0, index - 1)];
    return {
      snapshot: current,
      releaseDelta: Math.max(0, current.released - previous.released),
      pendingDelta: previous.pending - current.pending,
    };
  }, [snapshots, currentTick]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e2e8f0");
    sceneRef.current = scene;

    const scenePivot = new THREE.Group();
    scenePivot.rotation.set(-0.24, 0.52, 0);
    scene.add(scenePivot);
    scenePivotRef.current = scenePivot;

    const originMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 16),
      new THREE.MeshBasicMaterial({ color: "#e11d48" }),
    );
    originMarker.position.set(0, 0, 0);
    scenePivot.add(originMarker);

    const axesHelper = new THREE.AxesHelper(1.2);
    scenePivot.add(axesHelper);

    const sceneContent = new THREE.Group();
    scenePivot.add(sceneContent);
    sceneContentGroupRef.current = sceneContent;

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    camera.position.set(0, 2.6, 12);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const hemi = new THREE.HemisphereLight("#ffffff", "#d1d5db", 0.95);
    hemi.position.set(0, 12, 0);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight("#ffffff", 0.9);
    keyLight.position.set(5, 9, 6);
    scene.add(keyLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 8),
      new THREE.MeshStandardMaterial({ color: "#cbd5e1", roughness: 0.92, metalness: 0.04 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    sceneContent.add(floor);

    const grid = new THREE.GridHelper(14, 28, "#94a3b8", "#cbd5e1");
    grid.position.y = -0.009;
    sceneContent.add(grid);

    const conveyor = new THREE.Mesh(
      new THREE.BoxGeometry(9.4, 0.24, 1.4),
      new THREE.MeshStandardMaterial({ color: "#64748b", roughness: 0.6, metalness: 0.3 }),
    );
    conveyor.position.set(0, 0.12, 0);
    sceneContent.add(conveyor);

    const pendingRack = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#ef4444", roughness: 0.45, metalness: 0.12 }),
    );
    pendingRack.position.set(-5.35, 0.55, 0);
    sceneContent.add(pendingRack);

    const releasedRack = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#22c55e", roughness: 0.45, metalness: 0.12 }),
    );
    releasedRack.position.set(5.35, 0.55, 0);
    sceneContent.add(releasedRack);

    const throughputBeacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 24, 24),
      new THREE.MeshStandardMaterial({
        color: "#f97316",
        emissive: "#7c2d12",
        emissiveIntensity: 0.7,
        roughness: 0.28,
        metalness: 0.1,
      }),
    );
    throughputBeacon.position.set(0, 1.75, -1.35);
    sceneContent.add(throughputBeacon);

    const spinModel = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.08, 16, 28),
      new THREE.MeshStandardMaterial({
        color: "#334155",
        roughness: 0.36,
        metalness: 0.75,
      }),
    );
    spinModel.rotation.x = Math.PI / 2;
    spinModel.position.set(0, 1.1, -1.35);
    sceneContent.add(spinModel);

    const machineModels: THREE.Mesh[] = [];
    const machineOffsets = [-3.6, -2.1, -0.6, 0.9, 2.4, 3.9];
    machineOffsets.forEach((x, index) => {
      const machine = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 1.15 + (index % 2) * 0.18, 0.9),
        new THREE.MeshStandardMaterial({
          color: "#60a5fa",
          roughness: 0.42,
          metalness: 0.24,
        }),
      );
      machine.position.set(x, machine.scale.y * 0.58, -1.15);
      sceneContent.add(machine);
      machineModels.push(machine);
    });

    const movingJobs: THREE.Mesh[] = [];
    for (let i = 0; i < 16; i += 1) {
      const job = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.16, 0.2),
        new THREE.MeshStandardMaterial({
          color: "#0f172a",
          roughness: 0.32,
          metalness: 0.2,
        }),
      );
      job.position.set(-4 + i * 0.55, 0.3, 0);
      sceneContent.add(job);
      movingJobs.push(job);
    }

    // Normalize scene content around origin once so rotation stays centered.
    const initialBox = new THREE.Box3().setFromObject(sceneContent);
    const initialCenter = initialBox.getCenter(new THREE.Vector3());
    sceneContent.position.sub(initialCenter);

    sceneObjectsRef.current = {
      pendingRack,
      releasedRack,
      throughputBeacon,
      machineModels,
      movingJobs,
      spinModel,
    };

    const renderScene = () => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current) {
        return;
      }
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };

    const WORLD_CENTER = new THREE.Vector3(0, 0.7, 0);
    const BASE_CAMERA_Y_OFFSET = 3.2;
    const BASE_CAMERA_DISTANCE = 18;
    const MIN_ZOOM = 0.6;
    const MAX_ZOOM = 2.4;

    const updateDebugState = () => {
      const pivot = scenePivotRef.current;
      const canvas = rendererRef.current?.domElement;
      debugStateRef.current = {
        width: canvas?.clientWidth ?? mount.clientWidth ?? 0,
        height: canvas?.clientHeight ?? mount.clientHeight ?? 0,
        cameraX: camera.position.x,
        cameraY: camera.position.y,
        cameraZ: camera.position.z,
        rotX: pivot?.rotation.x ?? 0,
        rotY: pivot?.rotation.y ?? 0,
        zoom: viewStateRef.current.zoomScale,
      };
      onDebugChange?.({
        ...debugStateRef.current,
        captureId: capture?.id ?? null,
        tick: currentTick,
      });
    };

    const applyCameraDistance = () => {
      const zoomScale = viewStateRef.current.zoomScale;
      const distance = BASE_CAMERA_DISTANCE * zoomScale;
      camera.position.set(WORLD_CENTER.x, WORLD_CENTER.y + BASE_CAMERA_Y_OFFSET, WORLD_CENTER.z + distance);
      camera.near = 0.05;
      camera.far = 240;
      camera.lookAt(WORLD_CENTER);
      camera.updateProjectionMatrix();
      updateDebugState();
    };

    const resize = () => {
      const width = Math.max(1, mount.clientWidth || 0);
      const height = Math.max(1, mount.clientHeight || 0);
      renderer.setSize(width, height, true);
      renderer.setViewport(0, 0, width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      applyCameraDistance();
      renderScene();
    };

    const canvas = renderer.domElement;
    canvas.style.touchAction = "none";
    canvas.tabIndex = 0;
    canvas.style.outline = "none";
    const resetView = () => {
      const pivot = scenePivotRef.current;
      if (pivot) {
        pivot.rotation.set(-0.24, 0.52, 0);
      }
      viewStateRef.current.zoomScale = 1;
      applyCameraDistance();
      renderScene();
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const handlePointerDown = (event: PointerEvent) => {
      canvas.focus();
      if (event.button !== 0) {
        return;
      }
      const state = viewStateRef.current;
      state.dragging = true;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // ignore pointer-capture failures
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const state = viewStateRef.current;
      if (!state.dragging) {
        return;
      }
      const pivot = scenePivotRef.current;
      if (!pivot) {
        return;
      }
      const dx = event.clientX - state.lastX;
      const dy = event.clientY - state.lastY;
      state.lastX = event.clientX;
      state.lastY = event.clientY;

      pivot.rotation.y += dx * 0.008;
      pivot.rotation.x = Math.max(-1.1, Math.min(0.8, pivot.rotation.x + dy * 0.006));
      updateDebugState();
      renderScene();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const state = viewStateRef.current;
      state.dragging = false;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // ignore pointer-capture failures
      }
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = viewStateRef.current;
      const zoomFactor = Math.exp(event.deltaY * 0.0012);
      state.zoomScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoomScale * zoomFactor));
      applyCameraDistance();
      renderScene();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (event.code === "KeyF") {
        event.preventDefault();
        viewStateRef.current.zoomScale = 1;
        applyCameraDistance();
        renderScene();
        return;
      }
      if (event.code === "KeyR") {
        event.preventDefault();
        resetView();
      }
    };

    const handleDoubleClick = () => {
      resetView();
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("dblclick", handleDoubleClick);
    canvas.addEventListener("contextmenu", handleContextMenu);
    canvas.addEventListener("keydown", handleKeyDown);

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(mount);
    resetView();
    const postLayoutResize = window.setTimeout(() => resize(), 0);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("keydown", handleKeyDown);
      observer.disconnect();
      window.clearTimeout(postLayoutResize);
      renderer.dispose();
      mount.innerHTML = "";
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      scenePivotRef.current = null;
      sceneContentGroupRef.current = null;
      sceneObjectsRef.current = {
        pendingRack: null,
        releasedRack: null,
        throughputBeacon: null,
        machineModels: [],
        movingJobs: [],
        spinModel: null,
      };
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const objects = sceneObjectsRef.current;
    if (!renderer || !scene || !camera || !resolved) {
      return;
    }

    const { snapshot, releaseDelta } = resolved;
    const total = Math.max(1, snapshot.total);
    const releasedRatio = clamp01(snapshot.released / total);
    const pendingRatio = clamp01(snapshot.pending / total);
    const throughputRatio = clamp01(releaseDelta / 18);
    const machineHeat = clamp01(0.2 + pendingRatio * 0.55 + throughputRatio * 0.45);

    if (objects.pendingRack) {
      const pendingHeight = 0.34 + pendingRatio * 2.65;
      objects.pendingRack.scale.y = pendingHeight;
      objects.pendingRack.position.y = pendingHeight * 0.5;
    }

    if (objects.releasedRack) {
      const releasedHeight = 0.24 + releasedRatio * 2.65;
      objects.releasedRack.scale.y = releasedHeight;
      objects.releasedRack.position.y = releasedHeight * 0.5;
    }

    if (objects.throughputBeacon) {
      const beaconMaterial = objects.throughputBeacon.material as THREE.MeshStandardMaterial;
      const color = new THREE.Color("#f97316").lerp(new THREE.Color("#22c55e"), throughputRatio);
      beaconMaterial.color.copy(color);
      beaconMaterial.emissive.copy(color).multiplyScalar(0.45);
      beaconMaterial.emissiveIntensity = 0.55 + throughputRatio * 0.95;
    }

    if (objects.spinModel) {
      objects.spinModel.rotation.z = snapshot.tick * (0.05 + throughputRatio * 0.18);
    }

    objects.machineModels.forEach((machine, index, list) => {
      const phase = list.length > 1 ? index / (list.length - 1) : 0;
      const hotness = clamp01(machineHeat * (0.75 + phase * 0.55));
      const mat = machine.material as THREE.MeshStandardMaterial;
      mat.color.setHSL(0.58 - hotness * 0.5, 0.72, 0.52);
      machine.scale.y = 0.86 + hotness * 0.62;
      machine.position.y = machine.scale.y * 0.56;
    });

    const visibleJobs = Math.max(2, Math.round(2 + throughputRatio * 10 + releasedRatio * 4));
    const speed = 0.003 + throughputRatio * 0.03;
    const laneLength = 8.6;
    objects.movingJobs.forEach((job, index) => {
      const t = (snapshot.tick * speed + index * 0.082) % 1;
      const x = -4.25 + t * laneLength;
      job.visible = index < visibleJobs;
      job.position.set(
        x,
        0.24 + (index % 3) * 0.015,
        -0.08 + Math.sin((snapshot.tick + index) * 0.22) * 0.09,
      );
    });

    renderer.render(scene, camera);
  }, [resolved]);

  const info = resolved?.snapshot ?? null;

  useEffect(() => {
    if (!capture) {
      onDebugChange?.({
        width: 0,
        height: 0,
        cameraX: 0,
        cameraY: 0,
        cameraZ: 0,
        rotX: 0,
        rotY: 0,
        zoom: 1,
        captureId: null,
        tick: null,
      });
      return;
    }

    onDebugChange?.({
      ...debugStateRef.current,
      captureId: capture.id,
      tick: info?.tick ?? null,
    });
  }, [capture, info?.tick, onDebugChange]);

  return (
    <div className="relative h-full min-h-[220px] w-full rounded-sm border border-slate-400/60 bg-slate-100/80 overflow-hidden">
      <div ref={mountRef} className="h-full w-full" />
      {!capture ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-black/70">
          Add a capture to render a synchronized scene.
        </div>
      ) : null}
      {capture && !info ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-black/70">
          Waiting for causal summary fields in {capture.id}.
        </div>
      ) : null}
      {capture && info ? (
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white">
          <div>{capture.id} · {info.scenario}</div>
          <div>
            tick {info.tick} · released {Math.round(info.released)} · pending {Math.round(info.pending)}
          </div>
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] text-white/90">
        <div>
          {Math.round(debugStateRef.current.width)}x{Math.round(debugStateRef.current.height)} · zoom{" "}
          {debugStateRef.current.zoom.toFixed(2)}
        </div>
        <div>
          cam {debugStateRef.current.cameraX.toFixed(1)}, {debugStateRef.current.cameraY.toFixed(1)},{" "}
          {debugStateRef.current.cameraZ.toFixed(1)}
        </div>
        <div>
          rot {debugStateRef.current.rotX.toFixed(2)}, {debugStateRef.current.rotY.toFixed(2)}
        </div>
      </div>
      <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/65 px-2 py-1 text-[10px] text-white/90">
        drag to rotate scene · wheel zoom · double-click reset · F fit · R reset
      </div>
    </div>
  );
}
