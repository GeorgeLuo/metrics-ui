import * as THREE from "three";

import type { ChaseRenderingProfile } from "./profile-contract.ts";

type SensorRenderer = Pick<THREE.WebGLRenderer, "render" | "setRenderTarget">;

/** Numeric image-processing values retained with one rendered front-view image. */
export type ResolvedChaseSensor = Readonly<{
  imageProcessing: "none" | "radial-vignette";
  barrelDistortion: number;
  vignette: number;
}>;

/** Resolves bounded profile values into one camera-image sensor configuration. */
export function resolveChaseSensor(profile: ChaseRenderingProfile): ResolvedChaseSensor {
  const sensor = profile.sensor;
  const barrelDistortion = Math.max(0, Math.min(0.35, Number(sensor.barrelDistortion) || 0));
  const vignette = Math.max(0, Math.min(0.5, Number(sensor.vignette) || 0));
  const imageProcessing = sensor.imageProcessing === "radial-vignette"
    && (barrelDistortion > 0 || vignette > 0)
    ? "radial-vignette"
    : "none";
  return { imageProcessing, barrelDistortion, vignette };
}

/** Returns whether a front view needs the sensor postprocessing path. */
export function hasChaseSensorProcessing(sensor: ResolvedChaseSensor): boolean {
  return sensor.imageProcessing !== "none";
}

const SENSOR_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const SENSOR_FRAGMENT_SHADER = `
  uniform sampler2D colorBuffer;
  uniform float barrelDistortion;
  uniform float vignette;
  varying vec2 vUv;

  void main() {
    vec2 centeredUv = vUv - 0.5;
    float radiusSquared = dot(centeredUv, centeredUv) * 4.0;
    vec2 sampleUv = 0.5 + centeredUv * (1.0 + barrelDistortion * radiusSquared);
    vec4 color = texture2D(colorBuffer, sampleUv);
    float vignetteWeight = smoothstep(0.18, 1.0, radiusSquared);
    color.rgb *= 1.0 - vignette * vignetteWeight;
    gl_FragColor = color;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Reuses one render target and fullscreen pass for an actor-view renderer.
 *
 * It owns no WebGL context; callers dispose it with the renderer that created
 * it. The pass is skipped entirely for the deterministic simulation profile.
 */
export function createChaseSensorPipeline(renderer: SensorRenderer) {
  let width = 1;
  let height = 1;
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  const material = new THREE.ShaderMaterial({
    uniforms: {
      colorBuffer: { value: renderTarget.texture },
      barrelDistortion: { value: 0 },
      vignette: { value: 0 },
    },
    vertexShader: SENSOR_VERTEX_SHADER,
    fragmentShader: SENSOR_FRAGMENT_SHADER,
    depthWrite: false,
    depthTest: false,
  });
  const passScene = new THREE.Scene();
  const passCamera = new THREE.Camera();
  const passMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  passScene.add(passMesh);

  const setSize = (nextWidth: number, nextHeight: number) => {
    const safeWidth = Math.max(1, Math.round(nextWidth));
    const safeHeight = Math.max(1, Math.round(nextHeight));
    if (safeWidth === width && safeHeight === height) {
      return;
    }
    width = safeWidth;
    height = safeHeight;
    renderTarget.setSize(width, height);
  };

  return {
    render(scene: THREE.Scene, camera: THREE.Camera, sensor: ResolvedChaseSensor, nextWidth: number, nextHeight: number) {
      setSize(nextWidth, nextHeight);
      material.uniforms.barrelDistortion.value = sensor.barrelDistortion;
      material.uniforms.vignette.value = sensor.vignette;
      renderer.setRenderTarget(renderTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(passScene, passCamera);
    },
    dispose() {
      passMesh.geometry.dispose();
      material.dispose();
      renderTarget.dispose();
    },
  };
}
