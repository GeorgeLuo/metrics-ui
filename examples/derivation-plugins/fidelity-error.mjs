import { System } from "@georgeluo/ecs";

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

class FidelityErrorSystem extends System {
  constructor(entity, baselineIn, candidateIn, outputs) {
    super();
    this.entity = entity;
    this.baselineIn = baselineIn;
    this.candidateIn = candidateIn;
    this.outputs = outputs;

    this.count = 0;
    this.sumAbs = 0;
    this.sumSq = 0;
  }

  update({ componentManager }) {
    const baseline = asFiniteNumber(
      componentManager.getComponent(this.entity, this.baselineIn)?.payload ?? null,
    );
    const candidate = asFiniteNumber(
      componentManager.getComponent(this.entity, this.candidateIn)?.payload ?? null,
    );

    let error = null;
    let absError = null;
    if (baseline !== null && candidate !== null) {
      error = candidate - baseline;
      absError = Math.abs(error);
      this.count += 1;
      this.sumAbs += absError;
      this.sumSq += error * error;
    }

    const mae = this.count > 0 ? this.sumAbs / this.count : null;
    const rmse = this.count > 0 ? Math.sqrt(this.sumSq / this.count) : null;

    componentManager.addComponent(this.entity, this.outputs.error, error);
    componentManager.addComponent(this.entity, this.outputs.abs_error, absError);
    componentManager.addComponent(this.entity, this.outputs.mae, mae);
    componentManager.addComponent(this.entity, this.outputs.rmse, rmse);
    componentManager.addComponent(this.entity, this.outputs.samples, this.count);
  }
}

export default function createDerivationPlugin() {
  return {
    id: "fidelity_error",
    name: "Fidelity Error",
    description:
      "Fidelity diagnostics between baseline and candidate metrics: point error, absolute error, running MAE, and RMSE.",
    minInputs: 2,
    maxInputs: 2,
    outputs: [
      { key: "error" },
      { key: "abs_error" },
      { key: "mae" },
      { key: "rmse" },
      { key: "samples" },
    ],
    createSystems({ entity, inputs, outputs }) {
      return [
        new FidelityErrorSystem(
          entity,
          inputs[0].component,
          inputs[1].component,
          outputs,
        ),
      ];
    },
  };
}

