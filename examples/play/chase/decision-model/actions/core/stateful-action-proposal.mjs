export function createStatefulActionProposal({
  id,
  createState,
  createOutput,
  deriveOutput,
  getConfidence,
  isActionable,
} = {}) {
  const actionProposal = {
    id,
    state: typeof createState === "function" ? createState() : null,
    output: typeof createOutput === "function" ? createOutput() : null,
    update(context) {
      if (typeof deriveOutput === "function") {
        actionProposal.output = deriveOutput(actionProposal.state, context);
      }
      return actionProposal.output;
    },
    getOutput() {
      return actionProposal.output;
    },
    getConfidence() {
      if (typeof getConfidence === "function") {
        return Number(getConfidence(actionProposal.output, actionProposal.state)) || 0;
      }
      return 0;
    },
    isActionable() {
      if (typeof isActionable === "function") {
        return Boolean(isActionable(actionProposal.output, actionProposal.state));
      }
      return true;
    },
  };

  return actionProposal;
}

export function updateActionProposal(actionProposal, context) {
  if (!actionProposal || typeof actionProposal.update !== "function") {
    return null;
  }
  return actionProposal.update(context);
}

export function getActionProposalState(actionProposal) {
  return actionProposal?.state ?? null;
}

export function getActionProposalOutput(actionProposal) {
  if (!actionProposal) {
    return null;
  }
  if (typeof actionProposal.getOutput === "function") {
    return actionProposal.getOutput();
  }
  return actionProposal?.output ?? null;
}

export function getActionProposalConfidence(actionProposal) {
  if (!actionProposal) {
    return 0;
  }
  if (typeof actionProposal.getConfidence === "function") {
    return Number(actionProposal.getConfidence()) || 0;
  }
  return 0;
}

export function isActionProposalActionable(actionProposal) {
  if (!actionProposal) {
    return false;
  }
  if (typeof actionProposal.isActionable === "function") {
    return Boolean(actionProposal.isActionable());
  }
  return true;
}
