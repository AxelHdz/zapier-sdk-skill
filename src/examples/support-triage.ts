import type { AutomationPlan, AutomationStep } from "../types.js";

export interface SupportTicketInput {
  ticketId: string;
  customerName: string;
  customerTier: "free" | "pro" | "enterprise";
  severity: "low" | "medium" | "high";
  issueSummary: string;
  existingTicketIds?: string[];
}

const draftQueue = (ticket: SupportTicketInput): string => {
  if (ticket.customerTier === "enterprise" || ticket.severity === "high") {
    return "priority-support";
  }

  return "general-support";
};

const buildSteps = (ticket: SupportTicketInput): AutomationStep[] => [
  {
    id: "search-knowledge-base",
    title: "Search the internal knowledge base",
    kind: "search",
    app: "notion",
    action: "search-page",
    summary: `Search for documented guidance related to "${ticket.issueSummary}".`,
    inputs: {
      query: ticket.issueSummary,
    },
  },
  {
    id: "draft-customer-response",
    title: "Draft the support response",
    kind: "write",
    app: "gmail",
    action: "draft_v2",
    summary: `Prepare a response draft for ${ticket.customerName}.`,
    requiresConfirmation: true,
    inputs: {
      subject: `Re: ${ticket.issueSummary}`,
      body: `Hi ${ticket.customerName},\n\nWe reviewed your ${ticket.severity} priority issue...`,
    },
  },
  {
    id: "notify-support-queue",
    title: "Notify the right support queue",
    kind: "notify",
    app: "slack",
    action: "send-channel-message",
    summary: `Notify the ${draftQueue(ticket)} queue with the triage summary.`,
    requiresConfirmation: true,
    inputs: {
      channel: `#${draftQueue(ticket)}`,
      severity: ticket.severity,
    },
  },
];

export const planSupportTriageWorkflow = (
  ticket: SupportTicketInput,
): AutomationPlan => {
  const warnings: string[] = [];

  if ((ticket.existingTicketIds ?? []).includes(ticket.ticketId)) {
    warnings.push(
      `Ticket ${ticket.ticketId} has already been triaged. Skip duplicate downstream actions.`,
    );

    return {
      id: "support-triage",
      name: "Support inbox triage",
      example: "Support triage",
      summary:
        "Preview how an inbound support issue would be classified, drafted, and routed across knowledge, email, and internal collaboration tools.",
      requiresApproval: true,
      steps: [],
      warnings,
      metadata: {
        outcome: "duplicate-detected",
      },
    };
  }

  return {
    id: "support-triage",
    name: "Support inbox triage",
    example: "Support triage",
    summary:
      "Preview how an inbound support issue would be classified, drafted, and routed across knowledge, email, and internal collaboration tools.",
    requiresApproval: true,
    steps: buildSteps(ticket),
    warnings,
    metadata: {
      queue: draftQueue(ticket),
    },
  };
};
