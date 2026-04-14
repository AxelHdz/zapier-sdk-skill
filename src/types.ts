export type AutomationMode = "one-off" | "workflow";

export type AutomationStepKind =
  | "discover"
  | "read"
  | "search"
  | "write"
  | "notify"
  | "log";

export type AutomationStepStatus = "pending" | "executed" | "skipped" | "failed";

export type TaskUsageThreshold = 75 | 90;

export interface AutomationRequest {
  id: string;
  goal: string;
  mode: AutomationMode;
  input: Record<string, unknown>;
  dryRun?: boolean;
  approvedWrites?: boolean;
  currentCycleUsage?: number;
  cycleLimit?: number;
  metadata?: Record<string, unknown>;
}

export interface AutomationStep {
  id: string;
  title: string;
  kind: AutomationStepKind;
  app: string;
  action: string;
  summary: string;
  inputs?: Record<string, unknown>;
  requiresConfirmation?: boolean;
  estimatedTasks?: number;
  dedupeKey?: string;
}

export interface AutomationPlan {
  id: string;
  name: string;
  summary: string;
  example?: string;
  requiresApproval: boolean;
  steps: AutomationStep[];
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface StepExecutionResult {
  output?: Record<string, unknown> | null;
  estimatedTasks?: number;
  warning?: string;
}

export interface AutomationStepResult {
  stepId: string;
  title: string;
  kind: AutomationStepKind;
  app: string;
  action: string;
  status: AutomationStepStatus;
  summary: string;
  output?: Record<string, unknown> | null;
  error?: string;
  warning?: string;
  skippedReason?: "dry-run" | "awaiting-approval";
  retriedAfterRefresh?: boolean;
  estimatedTasks: number;
}

export interface TaskUsageSummary {
  cycleLimit: number;
  startingUsed: number;
  estimatedTasks: number;
  projectedUsed: number;
  warningThresholdsTriggered: TaskUsageThreshold[];
}

export interface AutomationResult {
  requestId: string;
  status: "preview" | "completed" | "partial" | "failed" | "no-op";
  plan: AutomationPlan;
  stepResults: AutomationStepResult[];
  warnings: string[];
  errors: string[];
  executedWrites: boolean;
  requiresApproval: boolean;
  taskUsage: TaskUsageSummary;
  summary: string;
}

export interface AutomationExecutor {
  execute(step: AutomationStep, request: AutomationRequest): Promise<StepExecutionResult>;
  refreshConnection?(
    step: AutomationStep,
    error: unknown,
    request: AutomationRequest,
  ): Promise<boolean>;
}

export interface AutomationEngineOptions {
  warningThresholds?: TaskUsageThreshold[];
}
