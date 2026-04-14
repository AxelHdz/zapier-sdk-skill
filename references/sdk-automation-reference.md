# Zapier SDK Automation Reference

Use this file only for reusable automations. For one-off tasks, stay in [cli-reference.md](cli-reference.md).

## 1. Build around a typed automation plan

This repo exposes a reusable TypeScript framework under `src/` with four public interfaces:

- `AutomationRequest`
- `AutomationPlan`
- `AutomationStep`
- `AutomationResult`

Use those interfaces to model:

- the incoming trigger or user request
- the previewable execution plan
- per-app units of work
- the final structured outcome

Keep workflow-specific logic in example planners such as:

- `src/examples/lead-routing.ts`
- `src/examples/support-triage.ts`

## 2. Bootstrap the Zapier SDK

Install the JavaScript SDK first:

```bash
npm install @zapier/zapier-sdk
```

Initialize:

```ts
import { createZapierSdk } from "@zapier/zapier-sdk";

const zapier = createZapierSdk();
```

Important distinction:

- CLI commands use slugs like `gmail` and `google-sheets`
- SDK calls use implementation IDs like `GoogleMailV2CLIAPI` and `GoogleSheetsV2CLIAPI`

To discover the right SDK ID, run:

```bash
npx zapier-sdk list-apps --search "gmail" --json
```

Read the `key` field and pass that value to `findFirstConnection()` and `runAction()`.

## 3. Core SDK primitives

The main primitives are:

- `zapier.findFirstConnection({ app, owner: "me", isExpired: false })`
- `zapier.runAction({ app, actionType, action, connection, inputs })`
- `zapier.fetch(url, { connection, method, headers, body })`

Minimal example:

```ts
import { createZapierSdk } from "@zapier/zapier-sdk";

const zapier = createZapierSdk();
const GMAIL_APP = "GoogleMailV2CLIAPI";

const { data } = await zapier.findFirstConnection({
  app: GMAIL_APP,
  owner: "me",
  isExpired: false,
});

const connection = Number((data as { id?: unknown } | undefined)?.id);

const response = await zapier.runAction({
  app: GMAIL_APP,
  actionType: "search",
  action: "message",
  connection,
  inputs: { query: "newer_than:1d" },
});

const messages = Array.isArray(response.data) ? response.data : [];
```

Use `fetch()` when you need a direct API call, such as app-specific endpoints that are easier to call directly once the connection is established.

## 4. Keep adapters and planners separate

Wrap SDK calls behind typed service adapters so the workflow planner and workflow runner stay testable.

```ts
type GmailMessage = { id: string; subject: string };

interface GmailService {
  searchRecentMessages(query: string): Promise<GmailMessage[]>;
}

const createGmailService = (
  zapier: ReturnType<typeof createZapierSdk>,
  connection: number,
): GmailService => ({
  async searchRecentMessages(query) {
    const response = await zapier.runAction({
      app: "GoogleMailV2CLIAPI",
      actionType: "search",
      action: "message",
      connection,
      inputs: { query },
    });

    const data = Array.isArray(response.data) ? response.data : [];
    return data.map((item) => {
      const record = item as Record<string, unknown>;
      return { id: String(record.id ?? ""), subject: String(record.subject ?? "") };
    });
  },
});
```

Planner responsibilities:

- choose the workflow shape
- assign dedupe keys
- decide whether the outcome is preview, no-op, or manual review
- generate the `AutomationPlan`

Adapter responsibilities:

- talk to Zapier
- return typed data
- keep external API details out of the planner

## 5. Preferred execution model

Think in stages:

1. search or read
2. transform
3. preview writes
4. execute approved writes
5. log the run summary

Prefer small `AutomationStep` units over one large function with mixed concerns.

## 6. Safety rules for SDK mode

SDK mode follows the same rules as CLI mode:

- never auto-send; prefer drafts and approval gates
- never delete records, emails, events, or rows
- always show the write payload or a precise preview before execution
- use dry-run mode for multi-step workflows
- use dedupe keys for repeated or scheduled work
- retry stale connections once before surfacing the error
- after every `run-action`, update `.zapier-sdk-data/action-log.md`, `.zapier-sdk-data/task-usage.md`, and append to `.zapier-sdk-data/actions.jsonl`

## 7. Included examples

- `src/examples/lead-routing.ts`: flagship multi-step workflow with CRM, follow-up drafting, and internal notification
- `src/examples/support-triage.ts`: secondary workflow that proves the same engine can support a different process
- `references/examples/gmail-to-sheets.ts`: lower-level SDK adapter example using Gmail plus Sheets
