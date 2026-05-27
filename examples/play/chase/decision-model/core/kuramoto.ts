import {
  angleToVector,
  normalizeAngleDelta,
  normalizeVector,
  type VectorXZ,
  vectorToAngle,
} from "./math.ts";

/**
 * Raw direction proposal accepted by the consensus helper.
 *
 * Callers can provide either a phase in radians or a 2D direction vector. Weight
 * affects the consensus dynamics directly. Confidence is carried through on the
 * normalized oscillator for consumers that need to inspect how trusted a source
 * was, but the current Kuramoto coupling calculation does not use confidence.
 */
export type KuramotoInput = {
  id?: string;
  phase?: number;
  direction?: VectorXZ | null;
  weight?: number;
  confidence?: number;
  naturalFrequency?: number;
};

/**
 * Valid oscillator used internally by the consensus loop.
 *
 * `phase` is the current angle in radians. `naturalFrequency` lets a proposal
 * drift independently during iteration, while peer coupling pulls phases toward
 * the other weighted oscillators.
 */
export type KuramotoOscillator = {
  id: string;
  phase: number;
  weight: number;
  confidence: number | null;
  naturalFrequency: number;
};

/**
 * Weighted circular average of oscillator phases.
 *
 * `order` is the normalized agreement strength. It approaches 1 when proposals
 * point in the same direction and approaches 0 when they cancel each other out.
 */
export type KuramotoMean = {
  phase: number;
  direction: VectorXZ;
  order: number;
};

/**
 * Parameters for the discrete Kuramoto update.
 *
 * `coupling` controls how strongly oscillators pull toward peers, `timeStep`
 * controls each integration step, `iterations` controls how long the consensus
 * is allowed to settle, and `threshold` is only used to set the returned
 * `converged` flag.
 */
export type KuramotoOptions = {
  coupling?: number;
  timeStep?: number;
  iterations?: number;
  threshold?: number;
};

/**
 * Result of running the consensus loop.
 *
 * The returned `oscillators` include their final phases after iteration, which
 * is useful for diagnostics when consensus order is low or convergence fails.
 */
export type KuramotoConsensus = KuramotoMean & {
  oscillators: KuramotoOscillator[];
  converged: boolean;
};

/**
 * Converts loose caller input into a valid oscillator or drops invalid input.
 *
 * Invalid proposals are ignored instead of throwing so strategy collections can
 * include optional or inactive entries without pre-filtering every call site.
 */
function normalizeOscillator(input: KuramotoInput | null | undefined, index: number): KuramotoOscillator | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  let phase = Number.NaN;
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

/**
 * Type guard used after normalization to remove dropped oscillator inputs.
 */
function isKuramotoOscillator(value: KuramotoOscillator | null): value is KuramotoOscillator {
  return value !== null;
}

/**
 * Calculates the weighted circular mean for a set of oscillator phases.
 *
 * Direction vectors are averaged instead of raw angles so wraparound at
 * `-pi`/`pi` is handled correctly.
 */
export function calculateCircularMean(oscillators: KuramotoOscillator[]): KuramotoMean {
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

/**
 * Runs a small discrete Kuramoto consensus over directional proposals.
 *
 * This is used when multiple strategies or prediction signals propose competing
 * directions. Each iteration updates every oscillator phase from the weighted
 * sine of peer phase differences, then the final circular mean becomes the
 * selected consensus direction.
 */
export function runKuramotoConsensus(
  inputs: KuramotoInput[],
  options: KuramotoOptions = {},
): KuramotoConsensus {
  const oscillators = inputs
    .map(normalizeOscillator)
    .filter(isKuramotoOscillator);
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
  const iterations = Number.isInteger(options.iterations) && Number(options.iterations) >= 0
    ? Number(options.iterations)
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
