# Example Workflows

The framework is intentionally broad. The included examples are concrete, but the same execution model can support many other Zapier-connected workflows.

## Included flagship examples

- **Lead routing and follow-up**: qualify an inbound lead, assign an owner, create or update the CRM record, draft the follow-up, and notify the internal team
- **Support inbox triage**: search internal documentation, prepare the response draft, and notify the correct support queue

## Additional workflow categories this pattern supports

- Support triage and escalation
- Meeting prep and post-call follow-up
- CRM hygiene and enrichment
- Internal notifications and handoffs
- Calendar coordination
- Spreadsheet and document workflows
- Cross-app approvals and audit logging

## How to adapt the examples

- Swap the `app` and `action` pairs in `AutomationStep`
- Keep the same preview/approval flow for write steps
- Preserve dedupe keys for scheduled or repeated workflows
- Keep the result summary and task usage tracking even when the underlying apps change
