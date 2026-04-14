# Next.js Form to Sheets Example

This example glues together the Product Integration Mode guidance from
`references/product-integration-reference.md`:

- §2 module-level SDK initialization with client credentials
- §3 setup-time resolution of connection and resource IDs, then env-based reuse
- §4 a typed adapter boundary between route handlers and Zapier
- §5 pinned dynamic Google Sheets field keys
- §6 env propagation into local / preview / production environments
- §7 safety scoping for user-initiated writes
- §8 env-boot assertions, health checks, and graceful degradation

It is intentionally a SINGLE-TENANT example: one Zapier account, one Google
Sheets target, and env-based configuration. For a multi-tenant version, keep
the same adapter boundary but replace env lookups with per-tenant database
reads as described in §3 and §5 of the reference doc.

## One-time bootstrap

1. Create named client credentials for this environment:
   `npx zapier-sdk create-client-credentials "acme-leads-local"`
2. Connect Google Sheets once:
   `npx zapier-sdk connect google-sheets`
3. Resolve the pinned connection ID:
   `npx zapier-sdk find-first-connection google-sheets --owner me --json`
   Copy the returned `id` into `GOOGLE_SHEETS_CONNECTION_ID`.
4. Find the spreadsheet ID from the sheet URL and the worksheet ID for the
   target tab.
5. Discover the worksheet's dynamic field keys:
   `npx zapier-sdk get-input-fields-schema google-sheets write add_row --connection <ID> --inputs '{"spreadsheet":"<SPREADSHEET_ID>","worksheet":"<WORKSHEET_ID>"}' --json`
   Copy the returned `key` values into `LEAD_FIELD_KEYS` in
   `lib/leads-adapter.ts`.
6. Populate `.env.local` (and your preview / production env settings) with:

```bash
ZAPIER_CREDENTIALS_CLIENT_ID=...
ZAPIER_CREDENTIALS_CLIENT_SECRET=...
GOOGLE_SHEETS_CONNECTION_ID=12345
LEAD_SHEET_SPREADSHEET_ID=1abc...
LEAD_SHEET_WORKSHEET_ID=0
```

## File responsibilities

- `lib/leads-adapter.ts` is the framework-portable piece. It depends only on
  `@zapier/zapier-sdk` and Node's `process.env`, and owns env assertions, SDK
  initialization, lead parsing, typed adapter logic, and the Sheets-backed
  health check.
- `app/api/leads/route.ts` is a thin Next.js App Router `POST` wrapper that
  parses the request body, validates it through `parseLead`, and delegates the
  write to `leadSink`.
- `app/api/health/route.ts` is a thin Next.js App Router `GET` wrapper that
  surfaces `leadSink.healthCheck()` for uptime probes.

The adapter is portable, but the route wrappers are not. The files under
`app/api/.../route.ts` use Next.js App Router's file-system routing shape.
Users on Remix, Hono, Express, or other frameworks would need to write their
own thin wrappers in that framework's idiom around the same adapter.
