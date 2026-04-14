import type { AutomationPlan, AutomationStep } from "../types.js";

export interface LeadInput {
  leadId: string;
  source: string;
  fullName: string;
  email?: string;
  company?: string;
  region?: "amer" | "emea" | "apac";
  segment?: "smb" | "mid-market" | "enterprise";
  interestArea?: string;
  existingLeadKeys?: string[];
}

const routeOwner = (lead: LeadInput): string => {
  if (lead.segment === "enterprise") return "Alex Enterprise";
  if (lead.region === "emea") return "Jordan EMEA";
  if (lead.region === "apac") return "Taylor APAC";
  return "Riley Growth";
};

const dedupeKeyFor = (lead: LeadInput): string =>
  lead.leadId || lead.email || `${lead.company ?? "unknown"}:${lead.source}`;

const buildSteps = (lead: LeadInput, owner: string): AutomationStep[] => [
  {
    id: "search-existing-lead",
    title: "Check for an existing lead",
    kind: "search",
    app: "hubspot",
    action: "find-contact",
    summary: `Search for an existing CRM record for ${lead.email ?? lead.company ?? lead.fullName}.`,
    inputs: {
      email: lead.email,
      company: lead.company,
    },
  },
  {
    id: "upsert-crm-record",
    title: "Create or update the CRM record",
    kind: "write",
    app: "hubspot",
    action: "upsert-contact",
    summary: `Create or update the lead record and assign ${owner}.`,
    requiresConfirmation: true,
    dedupeKey: dedupeKeyFor(lead),
    inputs: {
      owner,
      company: lead.company,
      email: lead.email,
      source: lead.source,
      segment: lead.segment,
    },
  },
  {
    id: "draft-follow-up",
    title: "Draft the follow-up email",
    kind: "write",
    app: "gmail",
    action: "draft_v2",
    summary: `Create a draft follow-up email from ${owner} for ${lead.fullName}.`,
    requiresConfirmation: true,
    inputs: {
      to: lead.email,
      subject: `${lead.company ?? "Your team"} x Zapier next steps`,
      body: `Hi ${lead.fullName},\n\nThanks for your interest in Zapier for ${lead.interestArea ?? "your workflow"}...`,
    },
  },
  {
    id: "notify-sales-channel",
    title: "Notify the internal routing channel",
    kind: "notify",
    app: "slack",
    action: "send-channel-message",
    summary: `Post the routing decision for ${lead.fullName} to #sales-routing.`,
    requiresConfirmation: true,
    inputs: {
      channel: "#sales-routing",
      message: `${lead.fullName} from ${lead.company ?? "Unknown company"} routed to ${owner}.`,
    },
  },
];

export const planLeadRoutingWorkflow = (lead: LeadInput): AutomationPlan => {
  const warnings: string[] = [];

  if (!lead.email || !lead.company) {
    warnings.push(
      "Lead data is incomplete. Hold this item for manual review instead of creating downstream records.",
    );

    return {
      id: "lead-routing-follow-up",
      name: "Lead routing and follow-up",
      example: "Inbound lead routing",
      summary:
        "Preview how an inbound lead would be qualified, routed, and followed up on across CRM, email, and internal notification tools.",
      requiresApproval: true,
      steps: [],
      warnings,
      metadata: {
        outcome: "manual-review",
      },
    };
  }

  const dedupeKey = dedupeKeyFor(lead);
  if ((lead.existingLeadKeys ?? []).includes(dedupeKey)) {
    warnings.push(
      `Duplicate lead detected for ${dedupeKey}. Skip write actions to avoid duplicate routing or follow-up.`,
    );

    return {
      id: "lead-routing-follow-up",
      name: "Lead routing and follow-up",
      example: "Inbound lead routing",
      summary:
        "Preview how an inbound lead would be qualified, routed, and followed up on across CRM, email, and internal notification tools.",
      requiresApproval: true,
      steps: [
        {
          id: "search-existing-lead",
          title: "Check for an existing lead",
          kind: "search",
          app: "hubspot",
          action: "find-contact",
          summary: `Confirm the existing CRM record for ${lead.email}.`,
          inputs: {
            email: lead.email,
          },
        },
      ],
      warnings,
      metadata: {
        outcome: "duplicate-detected",
      },
    };
  }

  const owner = routeOwner(lead);
  warnings.push(
    `Primary owner selected: ${owner}. Review the plan before creating records or sending internal notifications.`,
  );

  return {
    id: "lead-routing-follow-up",
    name: "Lead routing and follow-up",
    example: "Inbound lead routing",
    summary:
      "Preview how an inbound lead would be qualified, routed, and followed up on across CRM, email, and internal notification tools.",
    requiresApproval: true,
    steps: buildSteps(lead, owner),
    warnings,
    metadata: {
      owner,
      dedupeKey,
    },
  };
};
