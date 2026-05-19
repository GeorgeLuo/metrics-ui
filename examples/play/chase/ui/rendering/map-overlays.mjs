import * as THREE from "three";

function clonePosition(position) {
  return position
    && Number.isFinite(position.x)
    && Number.isFinite(position.z)
    ? {
      x: position.x,
      z: position.z,
    }
    : null;
}

function createMapKnowledgeAreaMesh(material) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.renderOrder = -1;
  return mesh;
}

function syncMapKnowledgeAreaGeometry(mesh, vertices, y = 0.018) {
  mesh.geometry.dispose();
  const positions = vertices.flatMap((vertex) => [
    vertex.x,
    y,
    vertex.z,
  ]);
  const indices = [];
  for (let index = 1; index < vertices.length - 1; index += 1) {
    indices.push(0, index, index + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  mesh.geometry = geometry;
}

function normalizeKnownAreas(mapShapeMemory) {
  return (Array.isArray(mapShapeMemory?.knownAreas) ? mapShapeMemory.knownAreas : [])
    .map((area) => ({
      id: String(area?.id ?? ""),
      vertices: (Array.isArray(area?.vertices) ? area.vertices : [])
        .map(clonePosition)
        .filter(Boolean),
    }))
    .filter((area) => area.id && area.vertices.length >= 3);
}

function normalizeRecentlyObservedAreas(mapShapeMemory, currentFrame) {
  const maxAgeFrames = Math.max(1, Number(mapShapeMemory?.recentVisitationMaxAgeFrames) || 1);
  const resolvedCurrentFrame = Number.isFinite(currentFrame)
    ? currentFrame
    : Number(mapShapeMemory?.lastObservationFrame);
  return (Array.isArray(mapShapeMemory?.recentlyObservedAreas)
    ? mapShapeMemory.recentlyObservedAreas
    : [])
    .map((area) => {
      const lastObservedFrame = Number(area?.lastObservedFrame);
      const ageFrames = Number.isFinite(resolvedCurrentFrame) && Number.isFinite(lastObservedFrame)
        ? Math.max(0, resolvedCurrentFrame - lastObservedFrame)
        : maxAgeFrames;
      const recency = Math.max(0, 1 - ageFrames / maxAgeFrames);
      return {
        id: String(area?.id ?? ""),
        opacity: 0.08 + recency * 0.34,
        vertices: (Array.isArray(area?.vertices) ? area.vertices : [])
          .map(clonePosition)
          .filter(Boolean),
      };
    })
    .filter((area) => area.id && area.vertices.length >= 3);
}

function getKnownAreaRenderSignature(area) {
  return [
    area.id,
    ...area.vertices.map((vertex) =>
      `${Number(vertex.x).toFixed(3)},${Number(vertex.z).toFixed(3)}`),
  ].join("|");
}

export function createMapKnowledgeOverlayDisplayState() {
  return {
    material: new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.075,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    meshes: [],
  };
}

export function disposeMapKnowledgeOverlayDisplayState(group, state) {
  for (const mesh of state?.meshes ?? []) {
    group.remove(mesh);
    mesh.geometry.dispose();
  }
  state?.meshes?.splice?.(0);
  state?.material?.dispose?.();
}

export function updateMapKnowledgeOverlayDisplay(group, state, mapShapeMemory, {
  visible = false,
} = {}) {
  const areas = visible ? normalizeKnownAreas(mapShapeMemory) : [];

  while (state.meshes.length < areas.length) {
    const mesh = createMapKnowledgeAreaMesh(state.material);
    state.meshes.push(mesh);
    group.add(mesh);
  }
  while (state.meshes.length > areas.length) {
    const mesh = state.meshes.pop();
    group.remove(mesh);
    mesh.geometry.dispose();
  }

  areas.forEach((area, index) => {
    const mesh = state.meshes[index];
    const signature = getKnownAreaRenderSignature(area);
    if (mesh.userData.signature !== signature) {
      syncMapKnowledgeAreaGeometry(mesh, area.vertices);
      mesh.userData.signature = signature;
    }
  });

  group.visible = visible && areas.length > 0;
  return areas;
}

function createMapRecencyAreaMesh() {
  return createMapKnowledgeAreaMesh(new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
}

export function createMapRecencyOverlayDisplayState() {
  return {
    meshes: [],
  };
}

export function disposeMapRecencyOverlayDisplayState(group, state) {
  for (const mesh of state?.meshes ?? []) {
    group.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  state?.meshes?.splice?.(0);
}

export function updateMapRecencyOverlayDisplay(group, state, mapShapeMemory, {
  visible = false,
  currentFrame = null,
} = {}) {
  const areas = visible ? normalizeRecentlyObservedAreas(mapShapeMemory, currentFrame) : [];

  while (state.meshes.length < areas.length) {
    const mesh = createMapRecencyAreaMesh();
    state.meshes.push(mesh);
    group.add(mesh);
  }
  while (state.meshes.length > areas.length) {
    const mesh = state.meshes.pop();
    group.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  areas.forEach((area, index) => {
    const mesh = state.meshes[index];
    const signature = getKnownAreaRenderSignature(area);
    if (mesh.userData.signature !== signature) {
      syncMapKnowledgeAreaGeometry(mesh, area.vertices, 0.022);
      mesh.userData.signature = signature;
    }
    mesh.material.opacity = area.opacity;
  });

  group.visible = visible && areas.length > 0;
  return areas;
}
