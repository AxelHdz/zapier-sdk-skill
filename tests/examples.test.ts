import { describe, expect, it } from "vitest";
import duplicateLead from "../fixtures/lead-routing/duplicate-lead.json" with { type: "json" };
import newEnterpriseLead from "../fixtures/lead-routing/new-enterprise-lead.json" with { type: "json" };
import customerEscalation from "../fixtures/support-triage/customer-escalation.json" with { type: "json" };
import { runAutomationPlan } from "../src/engine.js";
import {
  planLeadRoutingWorkflow,
  type LeadInput,
} from "../src/examples/lead-routing.js";
import {
  planSupportTriageWorkflow,
  type SupportTicketInput,
} from "../src/examples/support-triage.js";
import { createMockExecutor } from "../src/mock-executor.js";
import type { AutomationRequest } from "../src/types.js";

const requestFor = (id: string, approvedWrites = false): AutomationRequest => ({
  id,
  goal: "Run the example workflow",
  mode: "workflow",
  input: {},
  approvedWrites,
  currentCycleUsage: 10,
  cycleLimit: 100,
});

describe("example workflows", () => {
  it("plans lead routing with an assigned owner and follow-up draft", async () => {
    const plan = planLeadRoutingWorkflow(newEnterpriseLead as LeadInput);
    const draftStep = plan.steps.find((step) => step.id === "draft-follow-up");

    expect(plan.steps.some((step) => step.id === "upsert-crm-record")).toBe(true);
    expect(draftStep?.summary).toContain("Alex Enterprise");

    const result = await runAutomationPlan(
      requestFor("lead-routing", true),
      plan,
      createMockExecutor(),
    );

    expect(result.status).toBe("completed");
    expect(result.stepResults.some((step) => step.stepId === "draft-follow-up")).toBe(true);
  });

  it("avoids duplicate downstream writes for duplicate leads", () => {
    const plan = planLeadRoutingWorkflow(duplicateLead as LeadInput);

    expect(plan.steps.every((step) => step.kind !== "write" && step.kind !== "notify")).toBe(true);
    expect(plan.warnings?.[0]).toContain("Duplicate lead detected");
  });

  it("runs a secondary workflow through the same engine", async () => {
    const plan = planSupportTriageWorkflow(customerEscalation as SupportTicketInput);
    const result = await runAutomationPlan(
      requestFor("support-triage", true),
      plan,
      createMockExecutor(),
    );

    expect(result.status).toBe("completed");
    expect(result.plan.name).toBe("Support inbox triage");
    expect(result.stepResults.length).toBeGreaterThan(0);
  });
});
