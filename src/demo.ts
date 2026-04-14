import { readFile } from "node:fs/promises";
import { runAutomationPlan, renderAutomationResult } from "./engine.js";
import { planLeadRoutingWorkflow, type LeadInput } from "./examples/lead-routing.js";
import {
  planSupportTriageWorkflow,
  type SupportTicketInput,
} from "./examples/support-triage.js";
import { createMockExecutor } from "./mock-executor.js";
import type { AutomationPlan, AutomationRequest } from "./types.js";

const usage = `Usage: tsx src/demo.ts <lead-routing|support-triage> <fixture.json> [--dry-run] [--approve-writes]`;

const parseArgs = (): {
  workflow: string;
  fixturePath: string;
  dryRun: boolean;
  approvedWrites: boolean;
} => {
  const [, , workflow, fixturePath, ...flags] = process.argv;
  if (!workflow || !fixturePath) {
    throw new Error(usage);
  }

  return {
    workflow,
    fixturePath,
    dryRun: flags.includes("--dry-run"),
    approvedWrites: flags.includes("--approve-writes"),
  };
};

const planFor = (
  workflow: string,
  payload: Record<string, unknown>,
): AutomationPlan => {
  if (workflow === "lead-routing") {
    return planLeadRoutingWorkflow(payload as unknown as LeadInput);
  }

  if (workflow === "support-triage") {
    return planSupportTriageWorkflow(payload as unknown as SupportTicketInput);
  }

  throw new Error(`Unknown workflow "${workflow}".`);
};

const requestFor = (
  workflow: string,
  payload: Record<string, unknown>,
  dryRun: boolean,
  approvedWrites: boolean,
): AutomationRequest => ({
  id: `${workflow}-demo`,
  goal: `Run the ${workflow} example.`,
  mode: "workflow",
  input: payload,
  dryRun,
  approvedWrites,
  currentCycleUsage: 12,
  cycleLimit: 100,
});

const main = async (): Promise<void> => {
  const { workflow, fixturePath, dryRun, approvedWrites } = parseArgs();
  const raw = await readFile(fixturePath, "utf8");
  const payload = JSON.parse(raw) as Record<string, unknown>;
  const plan = planFor(workflow, payload);
  const request = requestFor(workflow, payload, dryRun, approvedWrites);
  const result = await runAutomationPlan(request, plan, createMockExecutor());
  console.log(renderAutomationResult(result));
};

void main();
