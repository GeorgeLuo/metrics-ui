import * as THREE from "three";
import { SIMULATION_RENDERING_PROFILE } from "../../rendering/profiles.ts";

function getProfile(profile) {
  return profile ?? SIMULATION_RENDERING_PROFILE;
}

function applyRendererSettings(renderer, environment) {
  if (!renderer) {
    return;
  }
  const { shadows, toneMapping, exposure } = environment.renderer;
  renderer.setClearColor?.(environment.clear.color, environment.clear.alpha);
  renderer.toneMapping = toneMapping === "aces-filmic"
    ? THREE.ACESFilmicToneMapping
    : THREE.NoToneMapping;
  renderer.toneMappingExposure = exposure;
  if (renderer.shadowMap) {
    const changed = renderer.shadowMap.enabled !== shadows.enabled
      || renderer.shadowMap.type !== THREE.PCFSoftShadowMap;
    renderer.shadowMap.enabled = shadows.enabled;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (changed) {
      renderer.shadowMap.needsUpdate = true;
    }
  }
}

function applyDirectionalShadow(keyLight, shadows, columns, rows) {
  keyLight.castShadow = shadows.enabled;
  const shadow = keyLight.shadow;
  if (!shadow) {
    return;
  }
  shadow.mapSize.set(shadows.mapSize, shadows.mapSize);
  shadow.bias = shadows.bias;
  shadow.normalBias = shadows.normalBias;
  shadow.radius = shadows.radius;
  const mapSpan = Math.max(1, Number(columns) || 1, Number(rows) || 1);
  const halfExtent = mapSpan / 2 + shadows.cameraPadding;
  shadow.camera.left = -halfExtent;
  shadow.camera.right = halfExtent;
  shadow.camera.top = halfExtent;
  shadow.camera.bottom = -halfExtent;
  shadow.camera.near = 0.1;
  shadow.camera.far = shadows.cameraFar;
  shadow.camera.updateProjectionMatrix();
  shadow.needsUpdate = true;
}

/** Creates the stable light objects whose values are supplied by a profile. */
export function createSceneLighting() {
  const keyLightTarget = new THREE.Object3D();
  keyLightTarget.name = "chase-key-light-target";
  const keyLight = new THREE.DirectionalLight();
  keyLight.target = keyLightTarget;
  return {
    ambientLight: new THREE.AmbientLight(),
    keyLight,
    keyLightTarget,
  };
}

/** Applies resolved clear-color and light values without selecting a profile. */
export function applyRenderingEnvironment({
  renderer,
  lighting,
  columns,
  rows,
} = {}, profile) {
  const resolvedProfile = getProfile(profile);
  const { ambientLight, keyLight, renderer: rendererSettings } = resolvedProfile.environment;
  applyRendererSettings(renderer, resolvedProfile.environment);
  if (lighting?.ambientLight) {
    lighting.ambientLight.color.setHex(ambientLight.color);
    lighting.ambientLight.intensity = ambientLight.intensity;
  }
  if (lighting?.keyLight) {
    lighting.keyLight.color.setHex(keyLight.color);
    lighting.keyLight.intensity = keyLight.intensity;
    lighting.keyLight.position.set(
      keyLight.position.x,
      keyLight.position.y,
      keyLight.position.z,
    );
    lighting.keyLightTarget?.position.set(
      keyLight.target.x,
      keyLight.target.y,
      keyLight.target.z,
    );
    applyDirectionalShadow(lighting.keyLight, rendererSettings.shadows, columns, rows);
  }
  return resolvedProfile;
}
