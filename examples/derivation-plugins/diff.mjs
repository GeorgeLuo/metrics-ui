import { System } from "@georgeluo/ecs";

class DiffSystem extends System {
  constructor(entity, left, right, out) {
    super();
    this.entity = entity;
    this.left = left;
    this.right = right;
    this.out = out;
  }

  update({ componentManager }) {
    const left = componentManager.getComponent(this.entity, this.left)?.payload ?? null;
    const right = componentManager.getComponent(this.entity, this.right)?.payload ?? null;
    const value = left === null || right === null ? null : right - left;
    componentManager.addComponent(this.entity, this.out, value);
  }
}

export default function createDerivationPlugin() {
  return {
    id: "diff",
    name: "Diff",
    description: "Outputs right - left for two input metrics.",
    minInputs: 2,
    maxInputs: 2,
    outputs: [{ key: "diff" }],
    createSystems({ entity, inputs, outputs }) {
      return [
        new DiffSystem(entity, inputs[0].component, inputs[1].component, outputs.diff),
      ];
    },
  };
}

