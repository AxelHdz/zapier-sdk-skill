# Zapier Product Integration Reference

Guidance for **Product Integration Mode** — embedding Zapier inside an
application backend (Next.js route handler, serverless function, long-running
Node service, etc.) so end users interact with Zapier-powered features through
your product, not through Zapier itself.

This is a separate operating model from the CLI ([cli-reference.md](cli-reference.md))
and the reusable automation framework ([sdk-automation-reference.md](sdk-automation-reference.md)).
Use those for local and user-directed work.

All API shapes below are grounded against the live Zapier SDK docs
(<https://docs.zapier.com/sdk/quickstart>, <https://docs.zapier.com/sdk/reference>).
If they disagree with your installed `@zapier/zapier-sdk` version, trust the docs
and the TypeScript types over this file.

---

## 1. When this reference applies

You are in Product Integration Mode if **all three** of these are true:

1. The Zapier SDK runs inside an app you are shipping — not a script you run
   locally.
2. Credentials must survive beyond an interactive `npx zapier-sdk login`
   session — i.e. the code runs in CI, preview, or production.
3. Users (or system events) trigger Zapier actions through your app's own API
   surface, not by invoking the Zapier CLI directly.

If any of those are false, prefer the Operator or Automation mode described in
[SKILL.md](../SKILL.md).

---

## 2. Bootstrap — install and create client credentials

Zapier's server-side auth uses **client credentials** (clientId + clientSecret),
not the browser-based login flow. These are long-lived and suitable for
CI/CD and serverless runtimes. The secret is shown **once** at creation time.

### Install

```bash
npm install @zapier/zapier-sdk
npm install -D @zapier/zapier-sdk-cli @types/node typescript
```

- `@zapier/zapier-sdk` is the runtime package the app imports.
- `@zapier/zapier-sdk-cli` is a dev dependency used only for local discovery
  and credential generation; it does not need to be in production.

### Create named client credentials

```bash
npx zapier-sdk create-client-credentials "<name>"
```

Pick a name that identifies the environment or service — e.g.
`"acme-app-local"`, `"acme-app-preview"`, `"acme-app-prod"`. One set per
environment makes rotation and audit safer.

The command prints a clientId and clientSecret. **Save the secret immediately**
— it is not recoverable. If it's lost, delete the credential pair and create a
new one.

### Store as env vars

Use these exact names (they match the quickstart example and the TypeScript
types):

```
ZAPIER_CREDENTIALS_CLIENT_ID=...
ZAPIER_CREDENTIALS_CLIENT_SECRET=...
```

Populate them in:

- `.env.local` — for local development
- your platform's preview env — Vercel preview, Render preview service, etc.
- your platform's production env — separate credentials recommended per
  environment
- CI secrets — only if CI runs integration tests against Zapier

Add `.env.local` (and siblings) to `.gitignore` if they aren't already. For
platform CLIs that upload local config, also exclude env files from the
deploy bundle (`.vercelignore`, `.dockerignore`, etc.) so local secrets don't
leak into the preview/prod build context.

### Initialize the SDK

```ts
import { createZapierSdk } from "@zapier/zapier-sdk";

export const zapier = createZapierSdk({
  credentials: {
    clientId: process.env.ZAPIER_CREDENTIALS_CLIENT_ID!,
    clientSecret: process.env.ZAPIER_CREDENTIALS_CLIENT_SECRET!,
  },
});
```

Create the SDK instance **once per runtime** (module-level in Node; per-request
in a stateless function environment if you can't hold state, but cache within a
single warm instance). Do not create a new client for every action call.

---

## 3. Connection and resource ID resolution

Every action call requires a `connectionId`. Connection IDs are **stable** — a
given Zapier connection keeps its ID across requests. That means:

- Resolve each app's connection ID **once**, at setup time.
- Persist it in env (for single-tenant apps) or your app database (for
  multi-tenant).
- **Do not** call `findFirstConnection` on the hot path of every request.

### Setup-time resolution

```ts
const { data: slackConnection } = await zapier.findFirstConnection({
  appKey: "slack",
  owner: "me",
  isExpired: false,
});

if (!slackConnection) {
  throw new Error(
    "No Slack connection for this credential. Connect Slack at " +
      "https://zapier.com/app/assets/connections",
  );
}

console.log("SLACK_CONNECTION_ID=", slackConnection.id);
```

Run that once (e.g. in a `scripts/bootstrap-connections.ts`) and paste the
resulting IDs into env:

```
SLACK_CONNECTION_ID=12345
GOOGLE_SHEETS_CONNECTION_ID=67890
GMAIL_CONNECTION_ID=54321
```

### Resource IDs

Resources nested inside a connection — spreadsheet IDs, worksheet IDs,
calendar IDs, Airtable base IDs — are also stable. Resolve them once per
tenant, persist them, and reuse them on every request. The difference between
single-tenant and multi-tenant apps is **where** they live, not **how often**
they change.

#### Single-tenant

For a single-tenant app, resource IDs belong in env, not hardcoded strings
buried in route handlers:

```
LEAD_SHEET_SPREADSHEET_ID=1abc...
LEAD_SHEET_WORKSHEET_ID=0
BOOKING_CALENDAR_ID=primary
```

Resolve these via a one-time bootstrap script (often using
`list-input-field-choices` in the CLI) and document them in a README or ADR so
the next person who touches the code knows where they came from.

#### Multi-tenant

For a multi-tenant app, keep the same "resolve once, persist, reuse" rule, but
store each tenant's connection ID and resource IDs together in your app
database:

```ts
type TenantRecord = {
  tenantId: string;
  zapier: {
    sheetsConnectionId: number;
    spreadsheetId: string;
    worksheetId: string;
    // Per-tenant field keys come into play in §5.
  };
};

async function getTenantRecord(tenantId: string): Promise<TenantRecord> {
  const tenant = await loadTenantConfigFromDb(tenantId); // pseudo-DB fetch
  if (!tenant?.zapier) {
    throw new Error(`Missing Zapier config for tenant ${tenantId}`);
  }
  return tenant;
}
```

That tenant row becomes the runtime source of truth. Do not re-discover the
spreadsheet, worksheet, or calendar on each request; resolve them once during
tenant setup, persist them, and reuse them until an operator intentionally
changes the tenant's integration config.

### Hot path — runtime action call

```ts
export async function writeLeadRow(lead: Lead) {
  const { data } = await zapier.runAction({
    appKey: "google-sheets",
    actionType: "write",
    actionKey: "add_row",
    connectionId: Number(process.env.GOOGLE_SHEETS_CONNECTION_ID),
    inputs: {
      spreadsheet: process.env.LEAD_SHEET_SPREADSHEET_ID!,
      worksheet: process.env.LEAD_SHEET_WORKSHEET_ID!,
      // Field keys must match the dynamic schema for your worksheet — see §5.
      name: lead.name,
      email: lead.email,
      source: lead.source,
    },
  });
  return data;
}
```

Note the exact parameter names: **`appKey`**, **`actionType`**, **`actionKey`**,
**`connectionId`**, **`inputs`**. These are the current SDK field names.

---

## 4. Typed service adapters

Wrap SDK calls behind small typed adapters so your route handlers and business
logic don't depend on Zapier's shape directly. This keeps tests sane and makes
it possible to stub Zapier out for local dev.

```ts
import { zapier } from "./zapier";

export interface LeadSink {
  writeLeadRow(lead: Lead): Promise<{ rowId: string }>;
}

export const createSheetsLeadSink = (): LeadSink => ({
  async writeLeadRow(lead) {
    const { data } = await zapier.runAction({
      appKey: "google-sheets",
      actionType: "write",
      actionKey: "add_row",
      connectionId: Number(process.env.GOOGLE_SHEETS_CONNECTION_ID),
      inputs: {
        spreadsheet: process.env.LEAD_SHEET_SPREADSHEET_ID!,
        worksheet: process.env.LEAD_SHEET_WORKSHEET_ID!,
        name: lead.name,
        email: lead.email,
        source: lead.source,
      },
    });
    return { rowId: String((data as { id?: unknown })?.id ?? "") };
  },
});
```

Your route handler only sees `LeadSink`. The Zapier call is one replaceable
edge.

---

## 5. Dynamic fields — inspect, don't guess

The highest-impact Product Integration footgun: **Google Sheets, Airtable,
Notion databases, and CRMs with custom properties do not have static field
schemas.** Field keys are generated per resource and can look like column
header slugs, hashed tokens, or provider-specific identifiers. `data_0`,
`data_1`, `lookup_column`, `row_id` are **all wrong** assumptions.

Before coding any write against these apps:

```bash
npx zapier-sdk get-input-fields-schema google-sheets write add_row \
  --connection <SHEETS_CONNECTION_ID> \
  --inputs '{"spreadsheet":"<SPREADSHEET_ID>","worksheet":"<WORKSHEET_ID>"}' \
  --json
```

Read the `key` values from the returned schema and use those exact strings in
your adapter's `inputs` object. If the target worksheet's columns change, the
schema changes — re-run the discovery command and update your adapter.

### Single-tenant — resolve once at build/bootstrap time

Treat this as a build-time concern for single-tenant apps, not a runtime
concern: do not try to resolve field keys dynamically on every request.
Instead, resolve the schema once at build/bootstrap time, pin the field keys in
the adapter, and add a smoke test (see §8) that fails loudly when the schema
drifts.

### Multi-tenant — resolve at tenant onboarding time

In a multi-tenant app, each tenant's worksheet, base, or CRM can expose a
different schema. Resolve the field keys at **tenant onboarding time** using
that tenant's own connection ID and resource IDs, then persist the resulting
map alongside the rest of the tenant's Zapier config from §3.

```ts
type TenantRecord = {
  tenantId: string;
  zapier: {
    sheetsConnectionId: number;
    spreadsheetId: string;
    worksheetId: string;
    fieldKeys: {
      name: string;
      email: string;
      source: string;
    };
  };
};

const tenant = await getTenantRecord(tenantId); // pseudo-DB fetch
```

Re-resolve those keys only on an explicit tenant re-sync action — an admin
button, support tool, or scheduled validation job — never on the hot request
path.

Schema drift detection applies in both cases: use CI smoke tests for
single-tenant integrations, and use a background job for multi-tenant
integrations that re-fetches schema and flags tenants whose stored field-key
map has diverged.

---

## 6. Deployment — env sync and platform notes

The single biggest source of preview/prod breakage in Product Integration Mode
is missing or stale env vars. Before every deploy, verify that:

- `ZAPIER_CREDENTIALS_CLIENT_ID` and `ZAPIER_CREDENTIALS_CLIENT_SECRET` are set
  in the target environment
- Each `<APP>_CONNECTION_ID` the app calls is populated
- Each resource ID (`*_SPREADSHEET_ID`, `*_CALENDAR_ID`, etc.) is populated
- The credential pair in the target environment corresponds to an account that
  actually has the connections — client credentials are per-account; the prod
  credential does not see the local account's connections

If a platform CLI uploads local files on deploy (Vercel, some Docker flows),
add env files to the platform's ignore list (`.vercelignore`, `.dockerignore`)
so local secrets don't leak into the build context.

### Platform notes

These are examples, not an exhaustive list. The pattern — **resolve IDs once,
persist in env, verify before deploy** — applies to every platform.

- **Vercel**: Set env vars per environment (Development, Preview, Production)
  in the project settings. If you use scheduled Zapier-backed work via Vercel
  Cron, check the plan-tier limits (Hobby restricts cron frequency and count)
  before designing around them.
- **Render / Railway / Fly.io**: Use their secret management; avoid committing
  env files. Preview environments usually need their own credential set if
  they point at a separate Zapier account.
- **Serverless / Lambda**: Cold starts recreate the SDK client. Module-level
  init is fine, but don't put `findFirstConnection` in the cold path — keep
  resolved connection IDs in env.

---

## 7. Safety rules in Product Integration Mode

Product Integration Mode keeps the safety intent from [SKILL.md](../SKILL.md),
but it maps those rules onto runtime product traffic differently than an
interactive CLI session.

- **"Explicit user approval before any write"**: satisfy this at author time
  with code review of write shapes, field mappings, dedupe keys, adapter tests,
  and preview-env smoke tests, and at end-user action time when the user's form
  submission, button click, or API call is the approval for the write it
  triggers. Per-request out-of-band confirmation is not required for
  user-initiated writes.
- **"Never send messages without showing the draft and getting approval"**:
  for user-initiated transactional messages such as confirmation emails,
  receipts, and password resets, the triggering user action is the approval.
  For unattended, bulk, or broadcast sends such as marketing blasts, scheduled
  digests, or admin-initiated notifications to other users, keep a stronger
  gate such as manual admin review, a preview or dry-run toggle, or a rate
  limiter.
- **"Never delete records"**: this still applies verbatim. Product Integration
  Mode does not relax it.
- **"Always produce a run summary"**: implement this as structured logging at
  runtime. Each action call should emit a log line with timestamp, tenant,
  appKey, actionType, actionKey, connection ID, dedupe key, and outcome.
- **"Track task usage defensively and warn at 75%/90%"**: make this a
  monitoring concern. Export task usage to your metrics system and alert on
  those thresholds there; interactive warnings do not apply when the request is
  an HTTP call from an end user.

High-risk operations still need extra guards. "User action = approval" does
not hold for:

- writes that affect users other than the one who triggered the request
- bulk writes beyond an explicit threshold
- writes to destructive or hard-to-reverse endpoints
- anything a product-security review would flag

Use a stronger gate there: manual review, preview/dry-run, rate limits,
approval workflows, or other controls appropriate to the blast radius.

---

## 8. Verification — health and smoke checks

Ship these alongside the feature. They catch 90% of Product Integration Mode
regressions before they become production incidents.

### Env checklist at boot

On server startup, assert that required env vars are present and fail fast if
not. A missing connection ID should crash the process with a clear error, not
silently fall back to running requests against `undefined`.

```ts
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

requireEnv("ZAPIER_CREDENTIALS_CLIENT_ID");
requireEnv("ZAPIER_CREDENTIALS_CLIENT_SECRET");
requireEnv("GOOGLE_SHEETS_CONNECTION_ID");
requireEnv("LEAD_SHEET_SPREADSHEET_ID");
requireEnv("LEAD_SHEET_WORKSHEET_ID");
```

### Health endpoint

Expose a cheap, read-only health endpoint that confirms the credentials and
connection IDs actually work. Example: call `findFirstConnection` or a
trivial read action. Alert on failure. Do not perform write actions in the
health check.

### Smoke test against preview

Before promoting a build to production, run a smoke test against the preview
environment that exercises one representative write action end-to-end — ideally
against a throwaway resource (a "smoke-test" row in the target sheet,
a test channel in the target Slack workspace). This is the fastest way to
catch schema drift after a dynamic-field change.

### Degrade gracefully

If an optional integration fails at runtime (e.g. the lead sink is down), the
feature should degrade gracefully — queue the work, retry safely, return a
warning, or surface a manual fallback path — instead of crashing the request or
silently dropping the work.

---

## 9. Known footguns

Short list of mistakes this mode tends to produce. Check your implementation
against each one before shipping.

- Assuming Google Sheets inputs follow `data_0`, `data_1`, ... — they don't;
  inspect the schema (§5).
- Assuming update / lookup fields are named `lookup_column` or `row_id` — they
  vary per app and per resource; always pull from the schema.
- Calling `findFirstConnection` on every request — slow, flaky, and hides
  misconfiguration. Resolve once, persist in env (§3).
- Committing resolved IDs or any part of the credential pair into source
  control.
- Shipping local env files via platform CLI deploy. Add `.vercelignore` / etc.
- Running preview and prod against the same credential pair. Rotation and
  debugging get harder; per-environment credentials are cheap.
- Skipping the schema re-check after a worksheet column change, an Airtable
  field rename, or a CRM custom-property edit. Symptom: writes silently land in
  the wrong column.
- Using `.zapier-sdk-data/` as a runtime dependency. It is a local discovery
  cache, not a production artifact. See the Runtime Boundary table in
  [SKILL.md](../SKILL.md).
