# Zapier SDK Skill

A general-purpose agent skill for safely discovering connections, previewing actions, executing automations, and logging outcomes across Zapier-powered workflows.

The repo is designed with two layers:

- **Core layer**: a reusable automation skill that can support one-off tasks and multi-step workflows across apps
- **Example layer**: concrete end-to-end examples that show how the pattern applies to real processes

The included flagship example is **lead routing and follow-up**, but the same framework supports support triage, meeting prep, CRM hygiene, internal notifications, calendar coordination, spreadsheet and document workflows, and other Zapier-connected processes.

The skill also covers **Product Integration Mode** — embedding Zapier inside an application backend (e.g. a Next.js API route) rather than driving it from an interactive agent session. See [references/product-integration-reference.md](references/product-integration-reference.md) and the worked [Next.js form → Sheets example](references/examples/nextjs-form-to-sheets/README.md).

## What it does

### Core automation model

The skill treats every request as a lifecycle:

1. discover available connections
2. discover or load cached actions
3. classify the request as a one-off task or reusable workflow
4. generate a preview of planned reads and writes
5. confirm write operations
6. execute approved steps
7. log outcomes and task usage
8. return a structured run summary

### Included workflow examples

- **Lead routing and follow-up**: qualify an inbound lead, assign an owner, create or update the CRM record, draft the follow-up, and notify the internal routing channel
- **Support inbox triage**: search documentation, draft the response, and notify the right support queue

### Automation categories this pattern supports

- lead routing and follow-up
- support triage and escalation
- meeting prep and post-call follow-up
- CRM hygiene and enrichment
- internal notifications and handoffs
- calendar coordination
- spreadsheet and document workflows
- cross-app approvals and audit logging

## Install

Clone the repo and symlink it into your agent's global skills directory.

```bash
git clone https://github.com/AxelHdz/zapier-sdk-skill.git /path/to/global/skills/zapier-sdk
```

Common locations:

```bash
ln -s /path/to/zapier-sdk-skill ~/.codex/skills/zapier-sdk
ln -s /path/to/zapier-sdk-skill ~/.claude/skills/zapier-sdk
```

## Local development

```bash
npm install
npm run typecheck
npm test
```

`npm run typecheck` covers `src/`, `tests/`, and the `references/examples/nextjs-form-to-sheets/` Product Integration example, so changes to canonical SDK field names (`app`, `action`, `connection`) are caught across all three.

Run the synthetic demo workflows:

```bash
npm run example:lead-routing
npm run example:support-triage
```

## Repo structure

```text
SKILL.md                              # Skill operating rules, setup flow, safety rails, and lifecycle
connect.sh                            # Opens direct auth URLs for connecting new apps
src/
  engine.ts                           # Generic preview/approval/execution runner
  types.ts                            # Shared automation interfaces
  examples/
    lead-routing.ts                   # Flagship GTM workflow example
    support-triage.ts                 # Secondary non-GTM workflow example
  demo.ts                             # Fixture-driven local demo runner
tests/                                # Framework and example coverage
fixtures/                             # Synthetic workflow inputs
docs/                                 # Architecture, transcripts, run summaries, example workflows
references/                           # CLI, SDK, Product Integration, and provider-lookup references
  examples/
    gmail-to-sheets.ts                # Minimal SDK automation example
    nextjs-form-to-sheets/            # Full Next.js Product Integration example (adapter + route handlers)
```

## Public interfaces

The typed framework exposes four main interfaces:

- `AutomationRequest`: trigger context, dry-run mode, approvals, and cycle usage
- `AutomationPlan`: previewable description of the automation and planned steps
- `AutomationStep`: app/action-level unit of work with confirmation and dedupe metadata
- `AutomationResult`: structured outcome with warnings, errors, and projected task usage

## Safety model

The skill is intentionally conservative:

- never auto-send messages without explicit approval
- never delete records
- preview write actions before execution
- support dry-run mode for multi-step workflows
- use dedupe keys for repeated or scheduled work
- retry stale connections once before surfacing the error
- keep task usage and run summaries visible

## Supporting artifacts

- [Architecture](docs/architecture.md)
- [Example workflows](docs/example-workflows.md)
- [One-off transcript](docs/transcripts/one-off-action.md)
- [Multi-step transcript](docs/transcripts/multi-step-automation.md)
- [Lead routing preview](docs/run-summaries/lead-routing-preview.md)
- [Support triage completed run](docs/run-summaries/support-triage-completed.md)
- [SDK automation reference](references/sdk-automation-reference.md)
- [CLI reference](references/cli-reference.md)
- [Product Integration reference](references/product-integration-reference.md)
- [Provider lookup guide](references/provider-lookup.md) (Calendar, Airtable, CRMs, direct providers)
- [Next.js form → Sheets example](references/examples/nextjs-form-to-sheets/README.md)

## Requirements

- An agent that supports filesystem-backed skills, such as [Codex](https://developers.openai.com/codex/) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- A [Zapier](https://zapier.com) account
- Node.js 20+

## License

MIT
