# Zapier SDK CLI Reference

All commands use `npx zapier-sdk`. Always add `--json` for parseable output.

Recommended operating pattern:

1. discover or reuse a connection
2. discover the action key if the app is unfamiliar
3. preview the intended write action
4. confirm before any write
5. log task usage and the run summary

## Connections

```bash
# List all connections
npx zapier-sdk list-connections --owner me --json

# Find a specific app's connection
npx zapier-sdk find-first-connection <app-key> --owner me --json
```

App keys use hyphens in CLI (`google-calendar`) and underscores in SDK code
(`google_calendar`). Both work in most contexts.

## Discovery

**Always discover action keys and input fields before using an unfamiliar app. Do not guess.**

```bash
# Search for apps by name
npx zapier-sdk list-apps --search "gmail" --json

# List all actions for an app
npx zapier-sdk list-actions <app-key> --json

# Get details on a specific action
npx zapier-sdk get-action <app-key> <action-type> <action-key> --json

# Get input field schema (required/optional inputs)
npx zapier-sdk get-input-fields-schema <app-key> <action-type> <action-key> --json

# Get dropdown choices for a field (e.g., which calendars exist)
npx zapier-sdk list-input-field-choices <app-key> <action-type> <action-key> <field-key> \
  --connection-id <ID> --json
```

### Dynamic fields

For some apps the input schema is not static — the field keys depend on the specific
resource the action is targeting. The most common offenders:

- **Google Sheets** — `add_row`, `update_row`, and `lookup_row` expose one field per column
  in the target worksheet. Field keys are generated per worksheet and can look like
  `COL$A`, `name`, or a hashed token. **Never assume `data_0`, `data_1`, etc.**
- **Airtable / Notion databases** — field keys and types depend on the base or database
  schema.
- **CRMs with custom properties** — HubSpot, Salesforce, Pipedrive all expose custom
  fields per account.

For these, pass `--connection-id` and (where applicable) the resource identifier when
fetching the schema so the CLI returns the actual dynamic fields:

```bash
npx zapier-sdk get-input-fields-schema google-sheets write add_row \
  --connection-id <ID> \
  --inputs '{"spreadsheet":"<SPREADSHEET_ID>","worksheet":"<SHEET_ID>"}' \
  --json
```

Read the returned `key` values from the schema and use those exact keys when constructing
the `--inputs` payload for `run-action`.

## Running Actions

```bash
npx zapier-sdk run-action <app-key> <action-type> <action-key> \
  --connection-id <ID> \
  --inputs '<JSON string>' \
  --json
```

## Action Types

- **read** — list/fetch data (recent emails, calendar events)
- **search** — find specific records (email by query, event by date)
- **write** — create or update (send email, create event, add row)

## Verify before write

Before executing a write action, confirm **both** the approval flow and the schema.

**Approval:**

- show the user what will be created or updated
- confirm the exact target app and action
- prefer drafts over sends when messaging is involved
- search first if duplicate records are possible
- use a dedupe key for repeated workflows

**Schema:**

- run `get-input-fields-schema` with the target `--connection-id` (and resource identifier
  when relevant) and use the exact `key` values returned by the CLI
- do not assume field names like `data_0`, `data_1`, `lookup_column`, or `row_id` —
  these vary per app and sometimes per resource
- for update/upsert actions, verify the key field (row id, record id, lookup column)
  from the schema rather than guessing its name
- if a write fails with "unknown field" or a silently-mismapped column, re-fetch the
  schema before retrying — the resource may have changed

## Common Examples

```bash
# Search Gmail
npx zapier-sdk run-action gmail search message \
  --connection-id <ID> --inputs '{"query":"newer_than:1d"}' --json

# Search calendar for events on a date
npx zapier-sdk run-action google-calendar search event \
  --connection-id <ID> \
  --inputs '{"calendarid":"primary","start_min":"2026-06-14T00:00:00Z","start_max":"2026-06-14T23:59:59Z"}' --json

# Create a calendar event
npx zapier-sdk run-action google-calendar write event \
  --connection-id <ID> \
  --inputs '{"calendarid":"primary","summary":"Event Name","start__dateTime":"2026-06-14T16:00:00-07:00","end__dateTime":"2026-06-14T20:00:00-07:00","location":"123 Main St","description":"Details here"}' --json

# Create a Gmail draft (preferred over sending directly)
npx zapier-sdk run-action gmail write draft_v2 \
  --connection-id <ID> \
  --inputs '{"to":"client@example.com","subject":"Subject","body":"Body text","body_type":"html"}' --json

# Send an email (ONLY with explicit user approval)
npx zapier-sdk run-action gmail write send_email \
  --connection-id <ID> \
  --inputs '{"to":"client@example.com","subject":"Subject","body":"Body text","body_type":"html"}' --json

# Send SMS via Twilio
npx zapier-sdk run-action twilio write sms \
  --connection-id <ID> \
  --inputs '{"to":"+13105551234","body":"Your reminder text"}' --json

# Add a row to Google Sheets
#
# Google Sheets uses DYNAMIC field keys — one per column in the target worksheet.
# Step 1: fetch the schema for this specific worksheet to learn the real field keys.
npx zapier-sdk get-input-fields-schema google-sheets write add_row \
  --connection-id <ID> \
  --inputs '{"spreadsheet":"<SPREADSHEET_ID>","worksheet":"<SHEET_ID>"}' --json

# Step 2: run the action using the field keys returned by the schema above.
# The keys below ("name", "email") are illustrative — yours will match your column headers.
npx zapier-sdk run-action google-sheets write add_row \
  --connection-id <ID> \
  --inputs '{"spreadsheet":"<SPREADSHEET_ID>","worksheet":"<SHEET_ID>","name":"Ada Lovelace","email":"ada@example.com"}' --json
```
