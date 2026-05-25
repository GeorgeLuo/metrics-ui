import * as THREE from "three";
import {
  CAR_HEIGHT,
  CAR_LENGTH,
  CAR_WIDTH,
  EVADER_PROJECTION_COLOR,
} from "../../config/constants.mjs";
import { vectorToAngle } from "../../decision-model/core/math.mjs";

export function setProjectionFrame(frame, centerPosition, direction) {
  frame.position.set(centerPosition.x, CAR_HEIGHT / 2, centerPosition.z);
  frame.rotation.y = vectorToAngle(direction);
}

function createProjectionFrame(opacity, color = EVADER_PROJECTION_COLOR) {
  const boxGeometry = new THREE.BoxGeometry(CAR_WIDTH, CAR_HEIGHT, CAR_LENGTH);
  const geometry = new THREE.EdgesGeometry(boxGeometry);
  boxGeometry.dispose();
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}

export function syncProjectionFrames(group, frames, count, {
  color = EVADER_PROJECTION_COLOR,
  maxOpacity = 0.42,
  minOpacity = 0.08,
  scale = 1,
} = {}) {
  while (frames.length < count) {
    const index = frames.length;
    const opacity = Math.max(minOpacity, maxOpacity * (1 - index / Math.max(count, 1)));
    const frame = createProjectionFrame(opacity, color);
    frames.push(frame);
    group.add(frame);
  }

  while (frames.length > count) {
    const frame = frames.pop();
    if (frame) {
      group.remove(frame);
      frame.geometry.dispose();
      frame.material.dispose();
    }
  }

  frames.forEach((frame, index) => {
    frame.material.opacity = Math.max(minOpacity, maxOpacity * (1 - index / Math.max(count, 1)));
    frame.material.color.setHex(color);
    frame.scale.setScalar(scale);
  });
}
