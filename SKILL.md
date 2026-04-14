---
name: zapier-sdk
description: >
  Gives agent skills a general-purpose operating model for using the Zapier SDK
  CLI and JavaScript SDK to discover connections, preview actions, execute
  safe automations, and log outcomes across connected apps.

  Use this skill whenever the user mentions Zapier, connected apps, inbox
  processing, lead routing, support triage, follow-up workflows, CRM hygiene,
  scheduling, internal notifications, spreadsheet work, or any request that
  benefits from acting across multiple tools.
---

# Zapier SDK Skill

Act on the user's behalf across Zapier-connected apps while keeping previews,
approval, dedupe, and task visibility first-class.

Track operational state in a persistent `.zapier-sdk-data/` directory.

For CLI command syntax, see [references/cli-reference.md](references/cli-reference.md).
For reusable automation patterns, see [references/sdk-automation-reference.md](references/sdk-automation-reference.md).

---

## Core Operating Model

Treat every request as the same reusable lifecycle:

1. discover available connections
2. discover or load cached actions
3. classify the request as a one-off task or reusable workflow
4. generate a preview of planned reads and writes
5. confirm write operations
6. execute approved steps
7. log results and task usage
8. return a structured run summary

### Supported workflow categories

The skill is intentionally broad. Example categories include:

- lead routing and follow-up
- support triage and escalation
- meeting prep and post-call follow-up
- CRM hygiene and enrichment
- internal notifications and handoffs
- calendar coordination
- spreadsheet and document workflows
- cross-app approvals and audit logging

Use one concrete workflow when it helps make the request easier to reason about,
but keep the execution model reusable.

---

## First Run

When the user first asks to do something involving Zapier, check whether
`.zapier-sdk-data/connections.md` exists in the project root.

### If `.zapier-sdk-data/connections.md` does not exist

1. **Check the CLI**
   ```bash
   npx zapier-sdk --version 2>/dev/null
   ```
   If it fails, run:
   ```bash
   npm install -D @zapier/zapier-sdk-cli
   ```

2. **Check auth and discover connections**
   ```bash
   npx zapier-sdk list-connections --owner me --json 2>/dev/null | head -n 1000
   ```
   If this fails with an auth error, tell the user and run:
   ```bash
   npx zapier-sdk login
   ```
   This opens the browser for Zapier OAuth.

   On success:
   - show the first 10 connections as a markdown table with `App`, `App Key`, `Connection ID`, and `Status`
   - state the total count
   - create `.zapier-sdk-data/connections.md` with the full table

3. **Check whether required apps are present**
   Read `AGENTS.md`, `CLAUDE.md`, or other local agent config to infer needed apps.
   For missing apps, run the installed connect script:

   ```bash
   SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/zapier-sdk"
   if [ ! -x "$SKILL_DIR/connect.sh" ]; then
     SKILL_DIR="${CLAUDE_HOME:-$HOME/.claude}/skills/zapier-sdk"
   fi
   "$SKILL_DIR/connect.sh" "<app name>"
   ```

   Examples:
   - `"$SKILL_DIR/connect.sh" notion`
   - `"$SKILL_DIR/connect.sh" "google calendar"`

4. **Create the remaining state files**
   - `.zapier-sdk-data/task-usage.md`
   - `.zapier-sdk-data/action-log.md`
   - `.zapier-sdk-data/actions.jsonl`
   - `.zapier-sdk-data/apps/`

5. **Confirm setup**
   Tell the user how many connected apps were found and that Zapier is ready.

6. **Offer a safe proof-of-life test**
   Prefer one of:
   - Slack DM to self
   - Gmail draft to self
   - Microsoft Teams message to self
   - Twilio SMS to the user's number

   Explain the exact steps and ask for a clear affirmative before running it.

### If `.zapier-sdk-data/connections.md` already exists

Read it silently and use cached connection IDs directly.

Do not re-run `list-connections` or `list-apps` unless a connection or auth error
suggests the cache is stale.

### Stale-data recovery

If a `run-action` call fails with a connection or auth error:

1. re-run `list-connections --owner me --json`
2. update `.zapier-sdk-data/connections.md`
3. retry once
4. if it still fails, tell the user the connection likely needs re-authorization

---

## Mode Selection

Decide the mode before doing anything else.

### One-off task

Use this when the user wants a single thing done now:

- check inboxes
- search a record
- create a draft
- create a calendar hold
- update a sheet row

Use CLI commands from [references/cli-reference.md](references/cli-reference.md).

### Reusable automation

Use this when the user wants code, a workflow, or a repeatable process:

- “build an automation”
- “create a workflow”
- “automate X with Zapier”
- “I need this to run repeatedly”
- “set up a pipeline”
- “use the Zapier SDK”
- any multi-step cross-app request

Before acting in this mode, read [references/sdk-automation-reference.md](references/sdk-automation-reference.md).

---

## Automation Rules

Apply these rules to any multi-step workflow.

### Preview and approval

- Always generate a preview before write-heavy workflows
- Show planned reads and writes as a structured list
- State the estimated task usage before approval
- Require explicit user approval before any write action

### Dry-run mode

For multi-step workflows, support a dry-run path:

- read and search steps may execute
- write and notify steps should remain preview-only
- return the full plan and projected task usage

### Idempotency and duplicates

For repeated or scheduled workflows:

- define a dedupe key before creating new records
- search for existing records before write actions
- prefer update/upsert over blind creation when possible
- if a duplicate is detected, return a safe no-op or manual-review outcome

### Partial failures

If one step fails:

- report which step failed
- keep successful earlier steps in the run summary
- retry stale connections once if that is the likely cause
- do not continue with risky downstream writes when earlier context is missing

### No-op outcomes

Return a clean no-op result when:

- no actionable records were found
- required fields are missing
- the workflow is already complete
- the dedupe check shows work has already been done

---

## Safety Rules

Non-negotiable:

1. **Never send emails, SMS, or messages without showing the draft and getting explicit approval.**
2. **Never delete records, emails, events, rows, or documents.**
3. **Always confirm before write actions.**
4. **Always produce a run summary that includes what was found, what was planned, what was executed, and what was skipped.**
5. **Track task usage defensively and warn at 75% and 90%.**

---

## Performance

Minimize CLI calls. Each `npx zapier-sdk` invocation has startup overhead.

- **Cache connections** in `.zapier-sdk-data/connections.md`
- **Cache discovered actions** in `.zapier-sdk-data/apps/<app-key>.md`
- **Reuse cached action keys** instead of re-discovering on every request
- **Batch reads when possible**
- **Keep bookkeeping lightweight**

If the agent environment supports background tasks, move logging and cache updates
there. Otherwise keep the logging concise and structured.

---

## Task Usage Tracking

After every successful `run-action`, update `.zapier-sdk-data/task-usage.md`:

```markdown
# Zapier Task Usage
Billing cycle start: [DATE]
Plan: Free (100 tasks/month)

## Current Cycle
Tasks used: 14
Estimated remaining: ~86
Last updated: [TIMESTAMP]

## Log
| Date | Action | App | Est. Tasks |
|------|--------|-----|------------|
| 04-09 14:30 | search message | gmail | 1 |
```

Warnings:

- At 75%: "Heads up -- projected task usage is crossing the 75% threshold."
- At 90%: "Projected usage is above 90%. Treat further writes as essential-only work."

---

## Action Log

After every Zapier interaction, append to `.zapier-sdk-data/action-log.md`:

```markdown
## 2026-04-09 08:15 -- "route inbound lead"
- hubspot.search.contact -> existing record not found
- hubspot.write.upsert-contact -> previewed
- gmail.write.draft_v2 -> previewed
- slack.notify.send-channel-message -> previewed
- Tasks used: 1
```

After every `run-action`, append one JSON line to `.zapier-sdk-data/actions.jsonl`:

```json
{"ts":"<ISO timestamp>","app":"<app slug>","type":"<actionType>","action":"<action>","connection_id":"<id>","ok":true}
```

---

## App Discovery Cache

After discovering actions for an app, save the result to
`.zapier-sdk-data/apps/<app-key>.md`:

```markdown
# gmail
Last discovered: 2026-04-09

| Type | Action Key | Label |
|------|------------|-------|
| read | email | Get Email |
| search | message | Find Email |
| write | send_email | Send Email |
| write | draft_v2 | Create Draft |
```

On subsequent requests, read this file instead of calling `list-actions` again.

---

## Example Workflow Framing

If the user needs a concrete pattern, use one of these examples:

- **Lead routing and follow-up**: search CRM, assign an owner, create or update the record, draft the follow-up, notify the internal team
- **Support triage**: search internal documentation, draft the response, notify the right queue

These are examples, not limits. The same pattern applies to any Zapier-connected workflow.
