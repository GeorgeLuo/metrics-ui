import { System } from "@georgeluo/ecs";

class MovingAverageSystem extends System {
  constructor(entity, input, out, windowSize) {
    super();
    this.entity = entity;
    this.input = input;
    this.out = out;
    this.windowSize = Math.max(1, Number(windowSize) || 20);
    this.window = [];
    this.sum = 0;
  }

  update({ componentManager }) {
    const next = componentManager.getComponent(this.entity, this.input)?.payload ?? null;
    if (next === null) {
      componentManager.addComponent(this.entity, this.out, null);
      return;
    }

    this.window.push(next);
    this.sum += next;
    if (this.window.length > this.windowSize) {
      const removed = this.window.shift();
      if (typeof removed === "number") {
        this.sum -= removed;
      }
    }
    const denom = this.window.length || 1;
    componentManager.addComponent(this.entity, this.out, this.sum / denom);
  }
}

export default function createDerivationPlugin() {
  return {
    id: "moving_average",
    name: "Moving Average",
    description: "Simple moving average over a single metric (param: windowSize).",
    minInputs: 1,
    maxInputs: 1,
    outputs: [{ key: "moving_avg" }],
    createSystems({ entity, inputs, outputs, params }) {
      const windowSize =
        params && typeof params === "object" && typeof params.windowSize === "number"
          ? params.windowSize
          : 20;
      return [
        new MovingAverageSystem(entity, inputs[0].component, outputs.moving_avg, windowSize),
      ];
    },
  };
}

