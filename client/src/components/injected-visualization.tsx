import { useEffect, useMemo, useRef, useState } from "react";
import type { CaptureRecord, CaptureSession, VisualizationFrameState } from "@shared/schema";

interface InjectedVisualizationProps {
  frame: VisualizationFrameState;
  capture: CaptureSession | null;
  currentTick: number;
  onDebugChange?: (debug: InjectedVisualizationDebug) => void;
}

export type InjectedVisualizationDebug = {
  mode: "builtin" | "plugin";
  captureId: string | null;
  tick: number;
  pluginId: string | null;
  pluginName: string | null;
  width: number;
  height: number;
  iframeReady: boolean;
  runtimeLoaded: boolean;
  runtimeBytes: number;
  hasRecord: boolean;
  reportCount: number;
  lastReportAt: string | null;
  rootChildCount: number | null;
  canvasCount: number | null;
  svgCount: number | null;
  textLength: number | null;
  hasVisualSignal: boolean | null;
  visualSignal: "canvas" | "svg" | "dom" | "none" | null;
  pluginReportKind: string | null;
  pluginReportStatus: string | null;
  oobCount: number | null;
  oobSample: string[] | null;
  oobBounds:
    | {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
        maxZ: number;
      }
    | null;
  pluginReportError: string | null;
  error: string | null;
};

type PluginRuntimeResponse = {
  pluginId: string;
  name?: string;
  libraries?: string[];
  runtimeScript: string;
};

type PluginRenderReport = {
  at: string | null;
  kind: string | null;
  status: string | null;
  rootChildCount: number | null;
  canvasCount: number | null;
  svgCount: number | null;
  textLength: number | null;
  hasVisualSignal: boolean | null;
  visualSignal: "canvas" | "svg" | "dom" | "none" | null;
  oobCount: number | null;
  oobSample: string[] | null;
  oobBounds:
    | {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
        maxZ: number;
      }
    | null;
  error: string | null;
};

function findRecordForTick(records: CaptureRecord[], tick: number): CaptureRecord | null {
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }
  let low = 0;
  let high = records.length - 1;
  let best = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const value = Number(records[mid]?.tick ?? 0);
    if (value <= tick) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (best < 0) {
    return records[0] ?? null;
  }
  return records[best] ?? null;
}

function buildSrcDoc(runtimeScript: string, libraries: string[] = [], apiBase: string = ""): string {
  const trimmed = runtimeScript.trim();
  const importMap = {
    imports: {
      three: `${apiBase}/api/visualization/libs/three`,
      "three/": `${apiBase}/api/visualization/libs/three/`,
      "three/addons/": `${apiBase}/api/visualization/libs/three/addons/`,
    },
  };
  if (!trimmed) {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: #e2e8f0; color: #0f172a; }
      body { display: grid; place-items: center; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    </style>
  </head>
  <body>No visualization runtime script loaded.</body>
</html>`;
  }
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: #e2e8f0; color: #0f172a; }
      body { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; }
      #metrics-ui-visual-root { width: 100%; height: 100%; }
    </style>
    <script type="importmap">
${JSON.stringify(importMap, null, 2)}
    </script>
    <script>
      (() => {
        const listeners = new Set();
        let currentFrame = null;
        let probeTimer = null;
        const metricsUiApiBase = ${JSON.stringify(apiBase)};

        const safePost = (payload) => {
          try {
            window.parent.postMessage(
              {
                type: "metrics-ui:plugin-report",
                payload: {
                  ...payload,
                  at: new Date().toISOString(),
                },
              },
              "*",
            );
          } catch (_error) {}
        };

        const toTextLength = (value) => {
          if (typeof value !== "string") {
            return 0;
          }
          return value.trim().length;
        };

        const probeDom = () => {
          const root = document.getElementById("metrics-ui-visual-root");
          if (!root) {
            safePost({
              kind: "probe",
              hasRoot: false,
              rootChildCount: 0,
              canvasCount: 0,
              svgCount: 0,
              textLength: 0,
              hasVisualSignal: false,
              visualSignal: "none",
            });
            return;
          }
          const canvasCount = root.getElementsByTagName("canvas").length;
          const svgCount = root.getElementsByTagName("svg").length;
          const rootChildCount = root.childElementCount;
          const textLength = toTextLength(root.textContent || "");
          const hasVisualSignal = canvasCount > 0 || svgCount > 0 || rootChildCount > 0;
          let visualSignal = "none";
          if (canvasCount > 0) {
            visualSignal = "canvas";
          } else if (svgCount > 0) {
            visualSignal = "svg";
          } else if (rootChildCount > 0 || textLength > 0) {
            visualSignal = "dom";
          }
          safePost({
            kind: "probe",
            hasRoot: true,
            rootChildCount,
            canvasCount,
            svgCount,
            textLength,
            hasVisualSignal,
            visualSignal,
          });
        };

        const createTurntableControls = (options) => {
          const element = options && options.element ? options.element : null;
          const camera = options && options.camera ? options.camera : null;
          const initialTarget = Array.isArray(options && options.target) ? options.target : [0, 0, 0];
          const state = {
            active: false,
            pointerId: -1,
            x: 0,
            y: 0,
            theta: Number(options && options.theta) || Math.PI * 0.25,
            phi: Number(options && options.phi) || Math.PI * 0.33,
            distance: Math.max(0.1, Number(options && options.distance) || 12),
            target: {
              x: Number(initialTarget[0]) || 0,
              y: Number(initialTarget[1]) || 0,
              z: Number(initialTarget[2]) || 0,
            },
            minDistance: Math.max(0.05, Number(options && options.minDistance) || 2),
            maxDistance: Math.max(1, Number(options && options.maxDistance) || 80),
            minPhi: Math.max(0.05, Number(options && options.minPhi) || 0.12),
            maxPhi: Math.min(Math.PI - 0.05, Number(options && options.maxPhi) || Math.PI * 0.48),
            rotateSpeed: Math.max(0.0001, Number(options && options.rotateSpeed) || 0.006),
            zoomSpeed: Math.max(0.00001, Number(options && options.zoomSpeed) || 0.0018),
          };

          if (!element || !camera) {
            return {
              update: () => {},
              dispose: () => {},
              setTarget: () => {},
              getState: () => ({
                theta: state.theta,
                phi: state.phi,
                distance: state.distance,
                target: { ...state.target },
              }),
            };
          }

          const updateCamera = () => {
            const sinPhi = Math.sin(state.phi);
            const x = state.target.x + state.distance * Math.cos(state.theta) * sinPhi;
            const y = state.target.y + state.distance * Math.cos(state.phi);
            const z = state.target.z + state.distance * Math.sin(state.theta) * sinPhi;
            camera.position.set(x, y, z);
            camera.lookAt(state.target.x, state.target.y, state.target.z);
          };

          const onPointerDown = (event) => {
            state.active = true;
            state.pointerId = event.pointerId;
            state.x = event.clientX;
            state.y = event.clientY;
            if (typeof element.setPointerCapture === "function") {
              try {
                element.setPointerCapture(event.pointerId);
              } catch (_error) {}
            }
            element.style.cursor = "grabbing";
          };

          const onPointerMove = (event) => {
            if (!state.active || event.pointerId !== state.pointerId) {
              return;
            }
            const dx = event.clientX - state.x;
            const dy = event.clientY - state.y;
            state.x = event.clientX;
            state.y = event.clientY;
            state.theta += dx * state.rotateSpeed;
            state.phi = Math.min(state.maxPhi, Math.max(state.minPhi, state.phi - dy * state.rotateSpeed));
            updateCamera();
          };

          const endDrag = (event) => {
            if (event && state.active && event.pointerId === state.pointerId) {
              if (typeof element.releasePointerCapture === "function") {
                try {
                  element.releasePointerCapture(event.pointerId);
                } catch (_error) {}
              }
            }
            state.active = false;
            state.pointerId = -1;
            element.style.cursor = "grab";
          };

          const onWheel = (event) => {
            event.preventDefault();
            const next = state.distance * (1 + event.deltaY * state.zoomSpeed);
            state.distance = Math.min(state.maxDistance, Math.max(state.minDistance, next));
            updateCamera();
          };

          element.style.touchAction = "none";
          element.style.cursor = "grab";
          element.addEventListener("pointerdown", onPointerDown);
          element.addEventListener("pointermove", onPointerMove);
          element.addEventListener("pointerup", endDrag);
          element.addEventListener("pointercancel", endDrag);
          element.addEventListener("wheel", onWheel, { passive: false });
          updateCamera();

          return {
            update: updateCamera,
            setTarget: (target, distance) => {
              if (Array.isArray(target)) {
                state.target.x = Number(target[0]) || 0;
                state.target.y = Number(target[1]) || 0;
                state.target.z = Number(target[2]) || 0;
              }
              if (Number.isFinite(Number(distance))) {
                const nextDistance = Number(distance);
                state.distance = Math.min(
                  state.maxDistance,
                  Math.max(state.minDistance, nextDistance),
                );
              }
              updateCamera();
            },
            getState: () => ({
              theta: state.theta,
              phi: state.phi,
              distance: state.distance,
              target: { ...state.target },
            }),
            dispose: () => {
              element.removeEventListener("pointerdown", onPointerDown);
              element.removeEventListener("pointermove", onPointerMove);
              element.removeEventListener("pointerup", endDrag);
              element.removeEventListener("pointercancel", endDrag);
              element.removeEventListener("wheel", onWheel);
              element.style.cursor = "default";
            },
          };
        };

        const register3DScene = (options) => {
          try {
            const renderer = options && options.renderer ? options.renderer : null;
            const camera = options && options.camera ? options.camera : null;
            const sceneRoot = options && options.sceneRoot ? options.sceneRoot : null;
            const THREE = window.THREE || (window.__metricsUILibs && window.__metricsUILibs.three);
            if (!renderer || !camera || !sceneRoot || !THREE || !THREE.Box3 || !THREE.Vector3) {
              return null;
            }

            const box = new THREE.Box3().setFromObject(sceneRoot);
            const center = new THREE.Vector3();
            box.getCenter(center);
            const size = new THREE.Vector3();
            box.getSize(size);
            const radius = Math.max(size.length() * 0.5, 1);

            const fovDeg =
              camera && typeof camera.fov === "number" && Number.isFinite(camera.fov)
                ? camera.fov
                : 45;
            const fov = (fovDeg * Math.PI) / 180;
            const fitDistance = Math.max(radius / Math.sin(Math.max(0.2, fov * 0.5)) * 0.95, 3.5);

            const controls = createTurntableControls({
              element: renderer.domElement,
              camera,
              target: [center.x, center.y + size.y * 0.18, center.z],
              distance: fitDistance * 1.15,
              minDistance: Math.max(1.5, fitDistance * 0.2),
              maxDistance: Math.max(25, fitDistance * 6),
              theta: Math.PI * 0.25,
              phi: Math.PI * 0.34,
            });

            return {
              controls,
              target: [center.x, center.y, center.z],
              distance: fitDistance,
              dispose: () => {
                try {
                  controls.dispose();
                } catch (_error) {}
              },
            };
          } catch (error) {
            safePost({
              kind: "error",
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to initialize standard 3D navigation.",
            });
            return null;
          }
        };

        window.MetricsUIBridge = {
          apiBase: metricsUiApiBase,
          getFrame: () => currentFrame,
          onFrame: (handler) => {
            if (typeof handler !== "function") {
              return () => {};
            }
            listeners.add(handler);
            if (currentFrame) {
              try { handler(currentFrame); } catch (_error) {}
            }
            return () => listeners.delete(handler);
          },
          report: (payload) => {
            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
              safePost({ kind: "plugin", ...payload });
            } else {
              safePost({ kind: "plugin", value: payload ?? null });
            }
          },
          probe: () => {
            probeDom();
          },
          register3DScene,
          createTurntableControls,
        };

        window.addEventListener("message", (event) => {
          if (!event || !event.data || event.data.type !== "metrics-ui:frame") {
            return;
          }
          currentFrame = event.data.payload ?? null;
          listeners.forEach((handler) => {
            try {
              handler(currentFrame);
            } catch (_error) {}
          });
        });

        window.addEventListener("error", (event) => {
          safePost({
            kind: "error",
            error:
              (event && typeof event.message === "string" && event.message.trim().length > 0)
                ? event.message
                : "Visualization runtime error",
          });
        });

        window.addEventListener("unhandledrejection", (event) => {
          const reason = event && "reason" in event ? event.reason : null;
          const message =
            reason instanceof Error
              ? reason.message
              : (typeof reason === "string" ? reason : "Unhandled promise rejection");
          safePost({
            kind: "error",
            error: message,
          });
        });

        const startProbe = () => {
          probeDom();
          if (probeTimer !== null) {
            window.clearInterval(probeTimer);
          }
          probeTimer = window.setInterval(probeDom, 1000);
        };

        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", startProbe, { once: true });
        } else {
          startProbe();
        }
      })();
    </script>
  </head>
  <body>
    <div id="metrics-ui-visual-root"></div>
    <script>
      (() => {
        const requestedLibraries = ${JSON.stringify(libraries)};
        const apiBase = ${JSON.stringify(apiBase)};
        const runtimeScript = ${JSON.stringify(trimmed)};

        const report = (payload) => {
          try {
            if (
              window.MetricsUIBridge
              && typeof window.MetricsUIBridge.report === "function"
            ) {
              window.MetricsUIBridge.report(payload);
            }
          } catch (_error) {}
        };

        const loadLibrary = async (libraryId) => {
          if (libraryId === "three") {
            const mod = await import(apiBase + "/api/visualization/libs/three");
            window.__metricsUILibs = window.__metricsUILibs || {};
            window.__metricsUILibs.three = mod;
            window.THREE = mod;
            report({ kind: "library", libraryId, status: "loaded" });
            return;
          }
          if (libraryId === "three-gltf-loader") {
            const mod = await import("three/addons/loaders/GLTFLoader.js");
            window.__metricsUILibs = window.__metricsUILibs || {};
            window.__metricsUILibs.gltfLoader = mod;
            window.GLTFLoader = mod && mod.GLTFLoader ? mod.GLTFLoader : undefined;
            report({ kind: "library", libraryId, status: "loaded" });
            return;
          }
          throw new Error("Unsupported visualization library: " + libraryId);
        };

        const runRuntime = () => {
          try {
            const fn = new Function(runtimeScript);
            fn();
            report({ kind: "runtime", status: "started" });
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Failed to execute visualization runtime.";
            report({ kind: "error", error: message });
          }
        };

        const normalizedLibraries = Array.isArray(requestedLibraries)
          ? Array.from(new Set(requestedLibraries
            .filter((entry) => typeof entry === "string")
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => entry.length > 0)))
          : [];

        if (normalizedLibraries.length === 0) {
          runRuntime();
          return;
        }

        Promise.all(normalizedLibraries.map((libraryId) => loadLibrary(libraryId)))
          .then(() => runRuntime())
          .catch((error) => {
            const message =
              error instanceof Error
                ? error.message
                : "Failed to load visualization libraries.";
            report({ kind: "error", error: message });
          });
      })();
    </script>
  </body>
</html>`;
}

export function InjectedVisualization({
  frame,
  capture,
  currentTick,
  onDebugChange,
}: InjectedVisualizationProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isIframeReady, setIsIframeReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [runtime, setRuntime] = useState<PluginRuntimeResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [renderReport, setRenderReport] = useState<PluginRenderReport | null>(null);
  const [renderReportCount, setRenderReportCount] = useState(0);

  const pluginId =
    typeof frame.pluginId === "string" && frame.pluginId.trim().length > 0
      ? frame.pluginId.trim()
      : "";
  const isPluginMode = frame.mode === "plugin";

  useEffect(() => {
    setRenderReport(null);
    setRenderReportCount(0);
  }, [isPluginMode, pluginId]);

  useEffect(() => {
    let cancelled = false;
    if (!isPluginMode) {
      setRuntime(null);
      setRuntimeError(null);
      return;
    }
    if (!pluginId) {
      setRuntime(null);
      setRuntimeError("Visualization plugin mode is active, but no plugin is selected.");
      return;
    }

    setRuntime(null);
    setRuntimeError(null);
    const url = `/api/visualization/plugins/${encodeURIComponent(pluginId)}/runtime`;
    fetch(url)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            payload && typeof payload.error === "string"
              ? payload.error
              : `Failed to load visualization plugin (${response.status})`;
          throw new Error(message);
        }
        return payload as PluginRuntimeResponse;
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setRuntime(payload);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setRuntimeError(error instanceof Error ? error.message : "Failed to load visualization plugin.");
      });

    return () => {
      cancelled = true;
    };
  }, [pluginId, isPluginMode, frame.updatedAt]);

  const activeRecord = useMemo(
    () => findRecordForTick(capture?.records ?? [], currentTick),
    [capture?.records, currentTick],
  );

  const srcDoc = useMemo(
    () => buildSrcDoc(
      runtime?.runtimeScript ?? "",
      runtime?.libraries ?? [],
      typeof window !== "undefined" ? window.location.origin : "",
    ),
    [runtime?.runtimeScript, runtime?.libraries],
  );

  const messagePayload = useMemo(
    () => ({
      type: "metrics-ui:frame",
      payload: {
        tick: currentTick,
        captureId: capture?.id ?? null,
        captureFilename: capture?.filename ?? null,
        captureTickCount: capture?.tickCount ?? 0,
        record: activeRecord,
        at: new Date().toISOString(),
      },
    }),
    [activeRecord, capture?.filename, capture?.id, capture?.tickCount, currentTick],
  );

  useEffect(() => {
    const target = containerRef.current;
    if (!target) {
      return;
    }
    const updateSize = () => {
      const width = Math.max(0, Math.round(target.clientWidth));
      const height = Math.max(0, Math.round(target.clientHeight));
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) {
        return;
      }
      const data = event.data as { type?: unknown; payload?: unknown } | null;
      if (!data || data.type !== "metrics-ui:plugin-report") {
        return;
      }
      const payload = data.payload;
      if (!payload || typeof payload !== "object") {
        return;
      }
      const record = payload as Record<string, unknown>;
      const boundsRaw =
        record.bounds && typeof record.bounds === "object"
          ? (record.bounds as Record<string, unknown>)
          : null;
      const bounds =
        boundsRaw
        && Number.isFinite(Number(boundsRaw.minX))
        && Number.isFinite(Number(boundsRaw.maxX))
        && Number.isFinite(Number(boundsRaw.minY))
        && Number.isFinite(Number(boundsRaw.maxY))
        && Number.isFinite(Number(boundsRaw.minZ))
        && Number.isFinite(Number(boundsRaw.maxZ))
          ? {
              minX: Number(boundsRaw.minX),
              maxX: Number(boundsRaw.maxX),
              minY: Number(boundsRaw.minY),
              maxY: Number(boundsRaw.maxY),
              minZ: Number(boundsRaw.minZ),
              maxZ: Number(boundsRaw.maxZ),
            }
          : null;
      setRenderReport((prev) => {
        const next: PluginRenderReport = {
          at: typeof record.at === "string" ? record.at : new Date().toISOString(),
          kind: typeof record.kind === "string" ? record.kind : prev?.kind ?? null,
          status: typeof record.status === "string" ? record.status : prev?.status ?? null,
          rootChildCount:
            Number.isFinite(Number(record.rootChildCount))
              ? Number(record.rootChildCount)
              : prev?.rootChildCount ?? null,
          canvasCount:
            Number.isFinite(Number(record.canvasCount))
              ? Number(record.canvasCount)
              : prev?.canvasCount ?? null,
          svgCount:
            Number.isFinite(Number(record.svgCount))
              ? Number(record.svgCount)
              : prev?.svgCount ?? null,
          textLength:
            Number.isFinite(Number(record.textLength))
              ? Number(record.textLength)
              : prev?.textLength ?? null,
          hasVisualSignal:
            typeof record.hasVisualSignal === "boolean"
              ? record.hasVisualSignal
              : prev?.hasVisualSignal ?? null,
          visualSignal:
            record.visualSignal === "canvas"
            || record.visualSignal === "svg"
            || record.visualSignal === "dom"
            || record.visualSignal === "none"
              ? record.visualSignal
              : prev?.visualSignal ?? null,
          oobCount:
            Number.isFinite(Number(record.count))
              ? Number(record.count)
              : prev?.oobCount ?? null,
          oobSample:
            Array.isArray(record.sample)
              ? record.sample
                  .filter((entry): entry is string => typeof entry === "string")
                  .slice(0, 24)
              : prev?.oobSample ?? null,
          oobBounds: bounds ?? prev?.oobBounds ?? null,
          error:
            typeof record.error === "string" && record.error.trim().length > 0
              ? record.error
              : prev?.error ?? null,
        };
        return next;
      });
      setRenderReportCount((prev) => prev + 1);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow || !isIframeReady || !runtime) {
      return;
    }
    frameWindow.postMessage(messagePayload, "*");
  }, [isIframeReady, messagePayload, runtime]);

  useEffect(() => {
    onDebugChange?.({
      mode: isPluginMode ? "plugin" : "builtin",
      captureId: capture?.id ?? null,
      tick: currentTick,
      pluginId: pluginId || null,
      pluginName: runtime?.name ?? null,
      width: size.width,
      height: size.height,
      iframeReady: isIframeReady,
      runtimeLoaded: Boolean(runtime),
      runtimeBytes: typeof runtime?.runtimeScript === "string" ? runtime.runtimeScript.length : 0,
      hasRecord: Boolean(activeRecord),
      reportCount: renderReportCount,
      lastReportAt: renderReport?.at ?? null,
      rootChildCount: renderReport?.rootChildCount ?? null,
      canvasCount: renderReport?.canvasCount ?? null,
      svgCount: renderReport?.svgCount ?? null,
      textLength: renderReport?.textLength ?? null,
      hasVisualSignal: renderReport?.hasVisualSignal ?? null,
      visualSignal: renderReport?.visualSignal ?? null,
      pluginReportKind: renderReport?.kind ?? null,
      pluginReportStatus: renderReport?.status ?? null,
      oobCount: renderReport?.oobCount ?? null,
      oobSample: renderReport?.oobSample ?? null,
      oobBounds: renderReport?.oobBounds ?? null,
      pluginReportError: renderReport?.error ?? null,
      error: runtimeError,
    });
  }, [
    activeRecord,
    capture?.id,
    currentTick,
    isIframeReady,
    onDebugChange,
    pluginId,
    isPluginMode,
    renderReport,
    renderReportCount,
    runtime,
    runtimeError,
    size.height,
    size.width,
  ]);

  return (
    <div ref={containerRef} className="relative h-full min-h-[220px] w-full rounded-sm border border-slate-400/60 bg-slate-100/80 overflow-hidden">
      <iframe
        ref={iframeRef}
        title={frame.name?.trim() || runtime?.name || "Injected Visualization Plugin"}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        className="h-full w-full border-0 bg-transparent"
        onLoad={() => {
          setIsIframeReady(true);
          const frameWindow = iframeRef.current?.contentWindow;
          if (frameWindow && runtime) {
            frameWindow.postMessage(messagePayload, "*");
          }
        }}
      />
      {!runtime ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] text-black/70">
          {runtimeError ?? (isPluginMode ? "Loading visualization plugin..." : "No visualization plugin active.")}
        </div>
      ) : null}
    </div>
  );
}
