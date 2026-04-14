import type {
  AutomationEngineOptions,
  AutomationExecutor,
  AutomationPlan,
  AutomationRequest,
  AutomationResult,
  AutomationStep,
  AutomationStepResult,
  StepExecutionResult,
  TaskUsageThreshold,
} from "./types.js";

const DEFAULT_WARNING_THRESHOLDS: TaskUsageThreshold[] = [75, 90];

const isWriteStep = (step: AutomationStep): boolean =>
  step.kind === "write" || step.kind === "notify";

const defaultEstimatedTasks = (step: AutomationStep): number => {
  if (step.estimatedTasks !== undefined) return step.estimatedTasks;
  if (step.kind === "discover" || step.kind === "log") return 0;
  return 1;
};

const buildSummary = (
  plan: AutomationPlan,
  stepResults: AutomationStepResult[],
  errors: string[],
  executedWrites: boolean,
): string => {
  if (plan.steps.length === 0) {
    return `No action was needed for "${plan.name}".`;
  }

  const executed = stepResults.filter((step) => step.status === "executed").length;
  const skipped = stepResults.filter((step) => step.status === "skipped").length;
  const failed = stepResults.filter((step) => step.status === "failed").length;

  if (failed > 0 && executed > 0) {
    return `Executed ${executed} steps for "${plan.name}" with ${failed} failure(s).`;
  }

  if (failed > 0) {
    return `Unable to complete "${plan.name}" because ${failed} step(s) failed.`;
  }

  if (!executedWrites && skipped > 0) {
    return `Prepared ${plan.steps.length} planned step(s) for "${plan.name}" and skipped ${skipped} write step(s) pending preview or approval.`;
  }

  if (errors.length === 0) {
    return `Completed ${executed} step(s) for "${plan.name}".`;
  }

  return `Completed "${plan.name}" with warnings.`;
};

export const renderAutomationResult = (result: AutomationResult): string => {
  const lines: string[] = [
    `# ${result.plan.name}`,
    "",
    `Status: ${result.status}`,
    `Summary: ${result.summary}`,
    `Projected task usage: ${result.taskUsage.projectedUsed}/${result.taskUsage.cycleLimit}`,
  ];

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push("", "Steps:");
  for (const step of result.stepResults) {
    const detail =
      step.status === "skipped"
        ? `${step.status} (${step.skippedReason})`
        : step.status;
    lines.push(`- [${detail}] ${step.title} -> ${step.app}.${step.action}`);
  }

  return lines.join("\n");
};

export const runAutomationPlan = async (
  request: AutomationRequest,
  plan: AutomationPlan,
  executor: AutomationExecutor,
  options: AutomationEngineOptions = {},
): Promise<AutomationResult> => {
  const warnings = [...(plan.warnings ?? [])];
  const errors: string[] = [];
  const stepResults: AutomationStepResult[] = [];
  const thresholds = options.warningThresholds ?? DEFAULT_WARNING_THRESHOLDS;
  const startingUsed = request.currentCycleUsage ?? 0;
  const cycleLimit = request.cycleLimit ?? 100;
  let estimatedTasks = 0;
  let executedWrites = false;

  if (plan.steps.length === 0) {
    return {
      requestId: request.id,
      status: "no-op",
      plan,
      stepResults,
      warnings,
      errors,
      executedWrites: false,
      requiresApproval: plan.requiresApproval,
      taskUsage: {
        cycleLimit,
        startingUsed,
        estimatedTasks,
        projectedUsed: startingUsed,
        warningThresholdsTriggered: [],
      },
      summary: `No action was needed for "${plan.name}".`,
    };
  }

  for (const step of plan.steps) {
    if (isWriteStep(step) && request.dryRun) {
      stepResults.push({
        stepId: step.id,
        title: step.title,
        kind: step.kind,
        app: step.app,
        action: step.action,
        status: "skipped",
        summary: step.summary,
        skippedReason: "dry-run",
        estimatedTasks: 0,
      });
      continue;
    }

    if (step.requiresConfirmation && !request.approvedWrites) {
      stepResults.push({
        stepId: step.id,
        title: step.title,
        kind: step.kind,
        app: step.app,
        action: step.action,
        status: "skipped",
        summary: step.summary,
        skippedReason: "awaiting-approval",
        estimatedTasks: 0,
      });
      continue;
    }

    let execution: StepExecutionResult | undefined;
    let retriedAfterRefresh = false;

    try {
      execution = await executor.execute(step, request);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";

      if (code === "STALE_CONNECTION" && executor.refreshConnection) {
        const refreshed = await executor.refreshConnection(step, error, request);
        if (refreshed) {
          retriedAfterRefresh = true;
          execution = await executor.execute(step, request);
        } else {
          throw error;
        }
      } else {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${step.title}: ${message}`);
        stepResults.push({
          stepId: step.id,
          title: step.title,
          kind: step.kind,
          app: step.app,
          action: step.action,
          status: "failed",
          summary: step.summary,
          error: message,
          estimatedTasks: 0,
        });
        continue;
      }
    }

    const spent = execution?.estimatedTasks ?? defaultEstimatedTasks(step);
    estimatedTasks += spent;
    if (isWriteStep(step)) executedWrites = true;

    if (execution?.warning) warnings.push(execution.warning);

    stepResults.push({
      stepId: step.id,
      title: step.title,
      kind: step.kind,
      app: step.app,
      action: step.action,
      status: "executed",
      summary: step.summary,
      output: execution?.output ?? null,
      warning: execution?.warning,
      retriedAfterRefresh,
      estimatedTasks: spent,
    });
  }

  const projectedUsed = startingUsed + estimatedTasks;
  const warningThresholdsTriggered = thresholds.filter(
    (threshold) => projectedUsed >= threshold,
  );

  for (const threshold of warningThresholdsTriggered) {
    if (threshold === 75) {
      warnings.push(
        `Heads up: projected task usage is ${projectedUsed}/${cycleLimit}, which crosses the 75% threshold.`,
      );
    }

    if (threshold === 90) {
      warnings.push(
        `Projected task usage is ${projectedUsed}/${cycleLimit}. Treat further writes as essential-only work.`,
      );
    }
  }

  const anyExecuted = stepResults.some((step) => step.status === "executed");
  const anyFailed = stepResults.some((step) => step.status === "failed");
  const anySkipped = stepResults.some((step) => step.status === "skipped");

  const pendingPreview = stepResults.some(
    (step) =>
      step.status === "skipped" &&
      (step.skippedReason === "dry-run" || step.skippedReason === "awaiting-approval"),
  );

  let status: AutomationResult["status"] = "completed";
  if ((!anyExecuted && anySkipped) || (!executedWrites && pendingPreview)) {
    status = "preview";
  } else if (anyFailed && anyExecuted) {
    status = "partial";
  } else if (anyFailed) {
    status = "failed";
  }

  return {
    requestId: request.id,
    status,
    plan,
    stepResults,
    warnings,
    errors,
    executedWrites,
    requiresApproval: plan.requiresApproval,
    taskUsage: {
      cycleLimit,
      startingUsed,
      estimatedTasks,
      projectedUsed,
      warningThresholdsTriggered,
    },
    summary: buildSummary(plan, stepResults, errors, executedWrites),
  };
};
