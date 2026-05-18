import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  vectorToAngle,
} from "./math.mjs";

function normalizeOscillator(input, index) {
  if (!input || typeof input !== "object") {
    return null;
  }

  let phase = null;
  if (Number.isFinite(input.phase)) {
    phase = Number(input.phase);
  } else if (input.direction) {
    phase = vectorToAngle(input.direction);
  }

  if (!Number.isFinite(phase)) {
    return null;
  }

  const weight = Number(input.weight);
  const confidence = Number(input.confidence);
  const naturalFrequency = Number(input.naturalFrequency);
  return {
    id: input.id ?? `oscillator-${index}`,
    phase,
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    confidence: Number.isFinite(confidence)
      ? Math.min(1, Math.max(0, confidence))
      : null,
    naturalFrequency: Number.isFinite(naturalFrequency) ? naturalFrequency : 0,
  };
}

export function calculateCircularMean(oscillators) {
  let x = 0;
  let z = 0;
  let totalWeight = 0;

  oscillators.forEach((oscillator) => {
    const direction = angleToVector(oscillator.phase);
    x += direction.x * oscillator.weight;
    z += direction.z * oscillator.weight;
    totalWeight += oscillator.weight;
  });

  if (totalWeight <= 0) {
    return {
      phase: 0,
      direction: { x: 0, z: 0 },
      order: 0,
    };
  }

  const averaged = { x: x / totalWeight, z: z / totalWeight };
  const order = Math.min(1, Math.hypot(averaged.x, averaged.z));
  const direction = normalizeVector(averaged.x, averaged.z);
  return {
    phase: direction.x === 0 && direction.z === 0 ? 0 : vectorToAngle(direction),
    direction,
    order,
  };
}

export function runKuramotoConsensus(inputs, options = {}) {
  const oscillators = inputs
    .map(normalizeOscillator)
    .filter(Boolean);
  if (oscillators.length === 0) {
    return {
      direction: { x: 0, z: 0 },
      phase: 0,
      order: 0,
      oscillators: [],
      converged: false,
    };
  }

  const coupling = Number.isFinite(options.coupling) ? Number(options.coupling) : 1.2;
  const timeStep = Number.isFinite(options.timeStep) ? Number(options.timeStep) : 0.12;
  const iterations = Number.isInteger(options.iterations) && options.iterations >= 0
    ? options.iterations
    : 12;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const nextPhases = oscillators.map((oscillator) => {
      let interaction = 0;
      let totalPeerWeight = 0;
      oscillators.forEach((peer) => {
        if (peer === oscillator) {
          return;
        }
        interaction += peer.weight * Math.sin(peer.phase - oscillator.phase);
        totalPeerWeight += peer.weight;
      });
      const normalizedInteraction = totalPeerWeight > 0 ? interaction / totalPeerWeight : 0;
      return normalizeAngleDelta(
        oscillator.phase
          + timeStep * (oscillator.naturalFrequency + coupling * normalizedInteraction),
      );
    });

    nextPhases.forEach((phase, index) => {
      oscillators[index].phase = phase;
    });
  }

  const mean = calculateCircularMean(oscillators);
  return {
    direction: mean.direction,
    phase: mean.phase,
    order: mean.order,
    oscillators,
    converged: mean.order >= (Number.isFinite(options.threshold) ? Number(options.threshold) : 0),
  };
}
