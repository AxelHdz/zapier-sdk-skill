import { describe, expect, it, vi } from "vitest";
import { runAutomationPlan } from "../src/engine.js";
import type {
  AutomationExecutor,
  AutomationPlan,
  AutomationRequest,
  AutomationStep,
} from "../src/types.js";

const baseRequest: AutomationRequest = {
  id: "req-1",
  goal: "Run a test automation",
  mode: "workflow",
  input: {},
  currentCycleUsage: 0,
  cycleLimit: 100,
};

const makePlan = (steps: AutomationStep[]): AutomationPlan => ({
  id: "plan-1",
  name: "Test plan",
  summary: "A test plan",
  requiresApproval: steps.some((step) => step.requiresConfirmation),
  steps,
});

describe("runAutomationPlan", () => {
  it("executes a read-only one-off without write approval", async () => {
    const execute = vi.fn(async () => ({
      output: { items: 3 },
      estimatedTasks: 1,
    }));
    const executor: AutomationExecutor = { execute };
    const result = await runAutomationPlan(
      { ...baseRequest, mode: "one-off" },
      makePlan([
        {
          id: "search",
          title: "Read data",
          kind: "read",
          app: "gmail",
          action: "list-messages",
          summary: "List recent emails.",
        },
      ]),
      executor,
    );

    expect(result.status).toBe("completed");
    expect(result.stepResults[0]?.status).toBe("executed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("requires approval for write steps", async () => {
    const execute = vi.fn();
    const executor: AutomationExecutor = { execute };
    const result = await runAutomationPlan(
      { ...baseRequest, approvedWrites: false },
      makePlan([
        {
          id: "write",
          title: "Create record",
          kind: "write",
          app: "hubspot",
          action: "upsert-contact",
          summary: "Create a CRM record.",
          requiresConfirmation: true,
        },
      ]),
      executor,
    );

    expect(result.status).toBe("preview");
    expect(result.stepResults[0]?.skippedReason).toBe("awaiting-approval");
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns a dry-run preview without executing write steps", async () => {
    const execute = vi.fn();
    const executor: AutomationExecutor = { execute };
    const result = await runAutomationPlan(
      { ...baseRequest, dryRun: true, approvedWrites: true },
      makePlan([
        {
          id: "search",
          title: "Read data",
          kind: "search",
          app: "gmail",
          action: "message",
          summary: "Read records first.",
        },
        {
          id: "draft",
          title: "Draft follow-up",
          kind: "write",
          app: "gmail",
          action: "draft_v2",
          summary: "Draft an email.",
          requiresConfirmation: true,
        },
      ]),
      executor,
    );

    expect(result.status).toBe("preview");
    expect(result.stepResults[0]?.status).toBe("executed");
    expect(result.stepResults[1]?.skippedReason).toBe("dry-run");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refreshes a stale connection and retries once", async () => {
    let attempts = 0;
    const execute = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("Connection expired");
        (error as Error & { code: string }).code = "STALE_CONNECTION";
        throw error;
      }

      return {
        output: { ok: true },
        estimatedTasks: 1,
      };
    });
    const refreshConnection = vi.fn(async () => true);
    const executor: AutomationExecutor = { execute, refreshConnection };
    const result = await runAutomationPlan(
      baseRequest,
      makePlan([
        {
          id: "search",
          title: "Read data",
          kind: "search",
          app: "gmail",
          action: "message",
          summary: "Find records.",
        },
      ]),
      executor,
    );

    expect(result.status).toBe("completed");
    expect(result.stepResults[0]?.retriedAfterRefresh).toBe(true);
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("surfaces partial failures in the run summary", async () => {
    const execute = vi.fn(async (step: AutomationStep) => {
      if (step.id === "fail") {
        throw new Error("Simulated failure");
      }

      return {
        output: { ok: true },
        estimatedTasks: 1,
      };
    });
    const executor: AutomationExecutor = { execute };
    const result = await runAutomationPlan(
      { ...baseRequest, approvedWrites: true },
      makePlan([
        {
          id: "read",
          title: "Read data",
          kind: "read",
          app: "gmail",
          action: "message",
          summary: "Read records.",
        },
        {
          id: "fail",
          title: "Send notification",
          kind: "notify",
          app: "slack",
          action: "send-channel-message",
          summary: "Notify the team.",
          requiresConfirmation: true,
        },
      ]),
      executor,
    );

    expect(result.status).toBe("partial");
    expect(result.errors[0]).toContain("Simulated failure");
  });

  it("warns when projected usage crosses task thresholds", async () => {
    const execute = vi.fn(async () => ({
      output: { ok: true },
      estimatedTasks: 2,
    }));
    const executor: AutomationExecutor = { execute };
    const result = await runAutomationPlan(
      { ...baseRequest, currentCycleUsage: 74 },
      makePlan([
        {
          id: "search",
          title: "Read data",
          kind: "search",
          app: "gmail",
          action: "message",
          summary: "Read records.",
        },
      ]),
      executor,
    );

    expect(result.taskUsage.warningThresholdsTriggered).toContain(75);
    expect(result.warnings.some((warning) => warning.includes("75%"))).toBe(true);
  });

  it("returns a no-op result when no steps are planned", async () => {
    const executor: AutomationExecutor = {
      execute: vi.fn(),
    };
    const result = await runAutomationPlan(baseRequest, makePlan([]), executor);

    expect(result.status).toBe("no-op");
    expect(result.summary).toContain("No action was needed");
  });
});
