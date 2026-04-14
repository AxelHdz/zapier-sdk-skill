import type {
  AutomationExecutor,
  AutomationRequest,
  AutomationStep,
  StepExecutionResult,
} from "./types.js";

const outputFor = (
  step: AutomationStep,
  request: AutomationRequest,
): Record<string, unknown> => {
  if (step.app === "hubspot" && step.action === "find-contact") {
    return {
      matched: false,
      requestId: request.id,
    };
  }

  if (step.app === "hubspot" && step.action === "upsert-contact") {
    return {
      recordId: `hubspot-${request.id}`,
      owner: step.inputs?.owner,
    };
  }

  if (step.app === "gmail" && step.action === "draft_v2") {
    return {
      draftId: `draft-${request.id}-${step.id}`,
      previewSubject: step.inputs?.subject,
    };
  }

  if (step.app === "slack") {
    return {
      channel: step.inputs?.channel,
      notified: true,
    };
  }

  if (step.app === "notion") {
    return {
      hits: 2,
      query: step.inputs?.query,
    };
  }

  return {
    ok: true,
  };
};

export const createMockExecutor = (): AutomationExecutor => ({
  async execute(step: AutomationStep, request: AutomationRequest): Promise<StepExecutionResult> {
    return {
      output: outputFor(step, request),
      estimatedTasks: step.kind === "discover" || step.kind === "log" ? 0 : 1,
    };
  },
  async refreshConnection() {
    return true;
  },
});
