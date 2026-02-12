import { System } from "@georgeluo/ecs";

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

class OpsHealthSystem extends System {
  constructor(entity, releasedIn, pendingIn, completedIn, outputs, params) {
    super();
    this.entity = entity;
    this.releasedIn = releasedIn;
    this.pendingIn = pendingIn;
    this.completedIn = completedIn;
    this.outputs = outputs;

    const rawWindow = params && typeof params.windowSize === "number" ? params.windowSize : 30;
    this.windowSize = Math.max(2, Math.floor(rawWindow));
    const rawFloor = params && typeof params.pressureFloor === "number" ? params.pressureFloor : 1;
    this.pressureFloor = Math.max(1e-9, rawFloor);

    this.prevReleased = null;
    this.prevPending = null;
    this.prevCompleted = null;

    this.throughputWindow = [];
    this.throughputSum = 0;
    this.throughputSumSq = 0;
  }

  pushThroughput(value) {
    this.throughputWindow.push(value);
    this.throughputSum += value;
    this.throughputSumSq += value * value;
    if (this.throughputWindow.length > this.windowSize) {
      const removed = this.throughputWindow.shift();
      if (typeof removed === "number") {
        this.throughputSum -= removed;
        this.throughputSumSq -= removed * removed;
      }
    }
  }

  computeVolatility() {
    const n = this.throughputWindow.length;
    if (n < 2) {
      return null;
    }
    const mean = this.throughputSum / n;
    const variance = Math.max(0, this.throughputSumSq / n - mean * mean);
    return Math.sqrt(variance);
  }

  update({ componentManager }) {
    const released = asFiniteNumber(
      componentManager.getComponent(this.entity, this.releasedIn)?.payload ?? null,
    );
    const pending = asFiniteNumber(
      componentManager.getComponent(this.entity, this.pendingIn)?.payload ?? null,
    );
    const completed = asFiniteNumber(
      componentManager.getComponent(this.entity, this.completedIn)?.payload ?? null,
    );

    let throughput = null;
    let backlogGrowth = null;
    let releaseEfficiency = null;
    let backlogPressure = null;

    if (released !== null && this.prevReleased !== null) {
      throughput = released - this.prevReleased;
      this.pushThroughput(throughput);
    }
    if (pending !== null && this.prevPending !== null) {
      backlogGrowth = pending - this.prevPending;
    }
    if (
      released !== null &&
      this.prevReleased !== null &&
      completed !== null &&
      this.prevCompleted !== null
    ) {
      const deltaReleased = released - this.prevReleased;
      const deltaCompleted = completed - this.prevCompleted;
      releaseEfficiency = deltaReleased > 0 ? deltaCompleted / deltaReleased : null;
    }
    if (pending !== null && released !== null) {
      backlogPressure = pending / Math.max(this.pressureFloor, released);
    }

    const throughputVolatility = this.computeVolatility();

    componentManager.addComponent(this.entity, this.outputs.throughput, throughput);
    componentManager.addComponent(this.entity, this.outputs.backlog_growth, backlogGrowth);
    componentManager.addComponent(this.entity, this.outputs.backlog_pressure, backlogPressure);
    componentManager.addComponent(this.entity, this.outputs.release_efficiency, releaseEfficiency);
    componentManager.addComponent(
      this.entity,
      this.outputs.throughput_volatility,
      throughputVolatility,
    );
    componentManager.addComponent(
      this.entity,
      this.outputs.volatility_samples,
      this.throughputWindow.length,
    );

    this.prevReleased = released;
    this.prevPending = pending;
    this.prevCompleted = completed;
  }
}

export default function createDerivationPlugin() {
  return {
    id: "ops_health",
    name: "Ops Health",
    description:
      "High-value operational derivations: throughput, backlog growth/pressure, release efficiency, and throughput volatility.",
    minInputs: 3,
    maxInputs: 3,
    outputs: [
      { key: "throughput" },
      { key: "backlog_growth" },
      { key: "backlog_pressure" },
      { key: "release_efficiency" },
      { key: "throughput_volatility" },
      { key: "volatility_samples" },
    ],
    createSystems({ entity, inputs, outputs, params }) {
      return [
        new OpsHealthSystem(
          entity,
          inputs[0].component,
          inputs[1].component,
          inputs[2].component,
          outputs,
          params && typeof params === "object" ? params : {},
        ),
      ];
    },
  };
}

