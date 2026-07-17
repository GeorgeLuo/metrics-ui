import * as THREE from "three";
import { SIMULATION_RENDERING_PROFILE } from "../../rendering/profiles.ts";

function getProfile(profile) {
  return profile ?? SIMULATION_RENDERING_PROFILE;
}

/** Creates the stable light objects whose values are supplied by a profile. */
export function createSceneLighting() {
  return {
    ambientLight: new THREE.AmbientLight(),
    keyLight: new THREE.DirectionalLight(),
  };
}

/** Applies resolved clear-color and light values without selecting a profile. */
export function applyRenderingEnvironment({ renderer, lighting } = {}, profile) {
  const resolvedProfile = getProfile(profile);
  const { clear, ambientLight, keyLight } = resolvedProfile.environment;
  renderer?.setClearColor?.(clear.color, clear.alpha);
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
  }
  return resolvedProfile;
}
