import { System } from "@georgeluo/ecs";

class CorrelationSystem extends System {
  constructor(entity, left, right, outCorrelation, outSamples, windowSize) {
    super();
    this.entity = entity;
    this.left = left;
    this.right = right;
    this.outCorrelation = outCorrelation;
    this.outSamples = outSamples;
    this.windowSize = Number.isInteger(windowSize) && windowSize > 0 ? windowSize : 0;
    this.window = [];
    this.sumX = 0;
    this.sumY = 0;
    this.sumXX = 0;
    this.sumYY = 0;
    this.sumXY = 0;
    this.count = 0;
  }

  addSample(x, y) {
    this.sumX += x;
    this.sumY += y;
    this.sumXX += x * x;
    this.sumYY += y * y;
    this.sumXY += x * y;
    this.count += 1;
    this.window.push([x, y]);
  }

  removeSample(x, y) {
    this.sumX -= x;
    this.sumY -= y;
    this.sumXX -= x * x;
    this.sumYY -= y * y;
    this.sumXY -= x * y;
    this.count = Math.max(0, this.count - 1);
  }

  computeCorrelation() {
    if (this.count < 2) {
      return null;
    }
    const n = this.count;
    const numerator = n * this.sumXY - this.sumX * this.sumY;
    const left = n * this.sumXX - this.sumX * this.sumX;
    const right = n * this.sumYY - this.sumY * this.sumY;
    const denom = Math.sqrt(left * right);
    if (!Number.isFinite(denom) || denom <= 1e-12) {
      return null;
    }
    const value = numerator / denom;
    if (!Number.isFinite(value)) {
      return null;
    }
    // Clamp small numeric drift outside [-1, 1].
    return Math.max(-1, Math.min(1, value));
  }

  update({ componentManager }) {
    const left = componentManager.getComponent(this.entity, this.left)?.payload ?? null;
    const right = componentManager.getComponent(this.entity, this.right)?.payload ?? null;

    if (typeof left === "number" && Number.isFinite(left) &&
        typeof right === "number" && Number.isFinite(right)) {
      this.addSample(left, right);
      if (this.windowSize > 0) {
        while (this.window.length > this.windowSize) {
          const oldest = this.window.shift();
          if (oldest) {
            this.removeSample(oldest[0], oldest[1]);
          }
        }
      }
    }

    componentManager.addComponent(this.entity, this.outCorrelation, this.computeCorrelation());
    componentManager.addComponent(this.entity, this.outSamples, this.count);
  }
}

export default function createDerivationPlugin() {
  return {
    id: "correlation",
    name: "Correlation",
    description:
      "Pearson correlation between two input metrics. Optional param: { windowSize } for rolling correlation.",
    minInputs: 2,
    maxInputs: 2,
    outputs: [{ key: "correlation" }, { key: "samples" }],
    createSystems({ entity, inputs, outputs, params }) {
      const windowSizeRaw =
        params && typeof params === "object" ? params.windowSize : undefined;
      const windowSize =
        Number.isInteger(windowSizeRaw) && windowSizeRaw > 0 ? windowSizeRaw : 0;
      return [
        new CorrelationSystem(
          entity,
          inputs[0].component,
          inputs[1].component,
          outputs.correlation,
          outputs.samples,
          windowSize,
        ),
      ];
    },
  };
}
