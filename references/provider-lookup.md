# Provider Lookup Guide

Provider-specific notes for **Product Integration Mode**. This file is a
companion to [product-integration-reference.md](product-integration-reference.md),
not a replacement — the general patterns (ID resolution, typed adapters,
dynamic-field discovery, safety scoping) live there. Consult this file only
for provider-specific lookup details that don't fit the general model.

For a concrete end-to-end shape, see
[examples/nextjs-form-to-sheets.ts](examples/nextjs-form-to-sheets.ts).

Each section assumes you have already read **§3 Connection and resource ID
resolution** and **§5 Dynamic fields** of the reference doc. They just
answer "how does this specifically apply to <provider>?"

---

## Google Calendar

- **appKey**: `"google-calendar"` (hyphen in strings, underscore in app-proxy
  accessors: `zapier.apps.google_calendar`)
- **Resource ID to resolve**: the calendar's `calendarid`. Use the literal
  string `"primary"` for the signed-in account's default calendar; use a
  Google-provided email-like ID (e.g. `team@company.com`) for shared
  calendars.
- **Persist** the calendar ID the same way as any other resource ID —
  single-tenant env var (`BOOKING_CALENDAR_ID=primary`), or multi-tenant DB
  field on the tenant record (§3).
- **Common input field names** (verified against live docs):
  - `search.event_v2` — `{ calendarid, search_term }`
  - `write.create_event` — `{ calendarid, summary, start, end }` or
    `{ calendarid, summary, start__dateTime, end__dateTime, location, description }`
  - `write.update_event` — `{ calendarid, eventid, start__dateTime, end__dateTime }`
- **Double-dated fields**: Calendar exposes `start`/`end` and also
  `start__dateTime`/`end__dateTime` as separate input keys for different
  granularity (all-day vs. timed). Use `get-input-fields-schema` to confirm
  which your target action expects — don't guess.
- **Duplicate-event footgun**: `search.event_v2` returns an array. If your
  flow creates events, always search first by a stable idempotency key
  (external event ID in the event description, or a custom property) and
  short-circuit on a match. Otherwise a retry produces a duplicate hold.

---

## Airtable

- **appKey**: `"airtable"` (proxy: `zapier.apps.airtable`)
- **Resource IDs to resolve**: the `base` ID (Airtable "base" = workspace)
  **and** the `table` ID or name. Both are required for every read/write
  action — neither is optional.
- **Persist both** on the tenant record, not just the base:
  ```ts
  zapier: {
    airtableConnectionId: number;
    airtableBaseId: string;
    airtableTableId: string; // or table name, depending on what list-input-field-choices returns
  }
  ```
- **Dynamic field keys are the norm**, not the exception. Airtable's field
  keys match the column names in that specific table. A write to "Leads"
  exposes different input keys than a write to "Tasks". Follow the
  multi-tenant pattern in §5 of the reference doc: resolve field keys at
  onboarding time, persist them alongside the table ID, re-sync on explicit
  admin action.
- **Field type mismatches** are a silent data-corruption footgun: Airtable
  validates types per column (number, single-select, linked-record, etc.)
  and will silently coerce or reject mismatches depending on the action.
  Your onboarding-time validation should confirm that each persisted field
  key maps to a column of the expected type, not just that the key exists.

---

## CRMs with custom fields (HubSpot, Salesforce, Pipedrive)

- **appKeys**: `"hubspot"`, `"salesforce"`, `"pipedrive"` (and others).
- **Resource IDs to resolve**: none at the "connection" level — CRM
  connections typically represent the whole account. What varies per tenant
  is the **custom-property schema**.
- **Standard fields** (e.g. HubSpot's `email`, `firstname`, `lastname`,
  `company`) are stable across accounts. You can pin those in the adapter.
- **Custom properties are dynamic**. HubSpot "Deal Stage," Salesforce
  "Industry Vertical," Pipedrive custom organization fields — every account
  creates its own. Never assume a custom field exists, and never assume its
  label matches its API key. Discover them per connection:

  ```bash
  npx zapier-sdk get-input-fields-schema hubspot write create_contact \
    --connection <HUBSPOT_CONNECTION_ID> --json
  ```

  or in TypeScript:

  ```ts
  const { data: fields } = await zapier.listInputFields({
    appKey: "hubspot",
    actionType: "write",
    actionKey: "create_contact",
    connectionId: tenant.zapier.hubspotConnectionId,
  });
  ```

- **Persist** the discovered custom-property keys on the tenant record the
  same way you persist Sheets field keys — onboarding-time resolution,
  explicit re-sync, never on the hot path.
- **CRM-specific footgun**: some CRMs expose both "internal name" and
  "label" for each property, and the label changes without breaking the
  internal name. Always persist the internal name (the `key` returned by
  `listInputFields`), never the human-facing label.

---

## When to reach for direct providers instead of Zapier

Zapier's breadth is its strength — one credential, 8,000+ apps. But some
concerns are a poor fit for Zapier actions, and direct provider APIs remain
a valid option in Product Integration Mode. This is a decision, not a
reflex — use Zapier when you can, reach direct only when you hit one of
these:

- **Branded transactional email from a custom domain** — Resend, Postmark,
  SendGrid, AWS SES. Reasons: DKIM/SPF setup on your own sending domain,
  templating (MJML, React Email), per-message deliverability controls,
  webhook-based bounce/complaint handling, per-message rate limits, and
  log-level analytics that Zapier email actions don't expose.
- **Low-latency event streams** — direct WebSockets, SSE, webhooks, or
  platform SDKs (Pusher, Ably, Supabase Realtime). Zapier actions are
  request/response and add tens-to-hundreds of milliseconds of round-trip
  overhead; they are not a fit for anything sub-second.
- **Authentication and identity** — OAuth providers, session management,
  magic-link flows belong in your auth layer (NextAuth, Clerk, Auth.js,
  custom), not behind a Zapier action.
- **High-volume logging or analytics** — direct to your observability
  pipeline, not to a Zapier action that writes rows one at a time.
- **Anything the user's Zapier task budget makes painful** — Zapier charges
  per successful task. If a feature fires >1 Zapier action per request at
  scale, the monthly task usage math gets loud fast; a direct provider is
  usually cheaper.

The decision criterion is always "does the task budget, latency envelope,
or feature shape make Zapier the wrong layer?" — not "Zapier is for small
things, direct is for serious things." Both can be production-grade.
