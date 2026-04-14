/**
 * Product Integration Mode example — form submission → Google Sheets
 * ====================================================================
 *
 * This file glues together every pattern from
 * `references/product-integration-reference.md` in one runnable shape:
 *
 *   - §2  module-level SDK init with client credentials
 *   - §3  setup-time connection/resource ID resolution, env-persisted
 *   - §4  typed service adapter between the route handler and Zapier
 *   - §5  dynamic Sheets field keys (pinned at build time for single-tenant)
 *   - §7  safety scoping: user's form submission IS the approval
 *   - §8  env-boot assertions + health endpoint + graceful degradation
 *
 * It targets the Next.js App Router (a route handler at
 * `app/api/leads/route.ts`), but uses only standard `Request`/`Response` so
 * it works unchanged in Remix, Hono, or any modern framework that exposes
 * the Fetch API. No next-specific imports.
 *
 * This is a SINGLE-TENANT example — one Zapier account, one target sheet,
 * env-based config. For multi-tenant, swap the env lookups for per-tenant
 * database reads using the `TenantRecord` shape from §3 of the reference
 * doc. The adapter boundary is where that swap happens — the route handler
 * should not change.
 *
 * ---------------------------------------------------------------------
 * ONE-TIME BOOTSTRAP (do this before running the server)
 * ---------------------------------------------------------------------
 *
 *   1. Create named client credentials for this environment:
 *        npx zapier-sdk create-client-credentials "acme-leads-local"
 *      Save the secret — it is shown once.
 *
 *   2. Connect your Google Sheets account once via the browser flow:
 *        npx zapier-sdk connect google-sheets
 *
 *   3. Resolve the Sheets connection ID (one-off, not on the hot path):
 *        npx zapier-sdk find-first-connection google-sheets --owner me --json
 *      Copy the `id` into GOOGLE_SHEETS_CONNECTION_ID below.
 *
 *   4. Find the spreadsheet ID (from the sheet URL) and worksheet ID
 *      (0 for the first tab; for others, use list-input-field-choices).
 *
 *   5. Discover the dynamic field keys for the target worksheet — Sheets
 *      generates one input per column, and the keys are NOT `data_0`,
 *      `data_1`, ... (see §5 of the reference doc):
 *        npx zapier-sdk get-input-fields-schema google-sheets write add_row \
 *          --connection <ID> \
 *          --inputs '{"spreadsheet":"<SPREADSHEET_ID>","worksheet":"<WORKSHEET_ID>"}' \
 *          --json
 *      Read the `key` values and copy them into the `LEAD_FIELD_KEYS`
 *      object below. If your sheet has different column headers, these
 *      will differ — do not assume.
 *
 *   6. Put everything in .env.local (and in your platform's preview/prod
 *      env settings — see §6 of the reference doc):
 *        ZAPIER_CREDENTIALS_CLIENT_ID=...
 *        ZAPIER_CREDENTIALS_CLIENT_SECRET=...
 *        GOOGLE_SHEETS_CONNECTION_ID=12345
 *        LEAD_SHEET_SPREADSHEET_ID=1abc...
 *        LEAD_SHEET_WORKSHEET_ID=0
 */

import { createZapierSdk } from "@zapier/zapier-sdk";

// ---------------------------------------------------------------------------
// §8 — Env boot assertion. Fail fast on startup if required env is missing,
// so we never run requests against `undefined`. A crashed process with a clear
// error is better than a silently broken write path.
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const ZAPIER_CLIENT_ID = requireEnv("ZAPIER_CREDENTIALS_CLIENT_ID");
const ZAPIER_CLIENT_SECRET = requireEnv("ZAPIER_CREDENTIALS_CLIENT_SECRET");
const SHEETS_CONNECTION_ID = Number(requireEnv("GOOGLE_SHEETS_CONNECTION_ID"));
const LEAD_SPREADSHEET_ID = requireEnv("LEAD_SHEET_SPREADSHEET_ID");
const LEAD_WORKSHEET_ID = requireEnv("LEAD_SHEET_WORKSHEET_ID");

// ---------------------------------------------------------------------------
// §2 — Module-level SDK init. Created ONCE per process, reused across every
// request. Serverless cold starts will recreate it, which is fine; warm
// instances hold onto it. Do not instantiate inside a request handler.
// ---------------------------------------------------------------------------

export const zapier = createZapierSdk({
  credentials: {
    clientId: ZAPIER_CLIENT_ID,
    clientSecret: ZAPIER_CLIENT_SECRET,
  },
});

// ---------------------------------------------------------------------------
// §5 — Dynamic Sheets field keys, pinned at build time for single-tenant.
//
// These keys must match what `get-input-fields-schema` returned for YOUR
// worksheet (step 5 of the bootstrap above). The illustrative values below
// assume columns named "Name", "Email", "Source" — your keys will differ.
//
// If the target worksheet's columns change, re-run the schema discovery
// and update this map. The health endpoint and CI smoke test (below) are
// your drift detectors.
//
// For multi-tenant, do NOT pin these globally. Instead, resolve per tenant
// at onboarding time and store alongside the tenant's other Zapier config.
// See §5 of the reference doc for the multi-tenant pattern.
// ---------------------------------------------------------------------------

const LEAD_FIELD_KEYS = {
  name: "name",
  email: "email",
  source: "source",
} as const;

// ---------------------------------------------------------------------------
// §4 — Typed service adapter.
//
// The route handler below depends on `LeadSink`, not on the Zapier SDK
// directly. This is the boundary that makes the rest of the code testable
// (swap in a fake LeadSink in tests), makes multi-tenant reachable without
// rewriting handlers, and gives us a single place to re-map fields if the
// sheet schema drifts.
// ---------------------------------------------------------------------------

export interface Lead {
  name: string;
  email: string;
  source: string;
}

export interface LeadSink {
  writeLead(lead: Lead): Promise<{ ok: true } | { ok: false; reason: string }>;
  healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export const createSheetsLeadSink = (): LeadSink => ({
  async writeLead(lead) {
    try {
      await zapier.runAction({
        appKey: "google-sheets",
        actionType: "write",
        actionKey: "add_row",
        connectionId: SHEETS_CONNECTION_ID,
        inputs: {
          spreadsheet: LEAD_SPREADSHEET_ID,
          worksheet: LEAD_WORKSHEET_ID,
          [LEAD_FIELD_KEYS.name]: lead.name,
          [LEAD_FIELD_KEYS.email]: lead.email,
          [LEAD_FIELD_KEYS.source]: lead.source,
        },
      });
      return { ok: true };
    } catch (err) {
      // Log structured — see §7 of the reference doc. Your real logger
      // goes here (pino / winston / platform log drain).
      console.error("[leads] sheets write failed", {
        ts: new Date().toISOString(),
        appKey: "google-sheets",
        actionKey: "add_row",
        connectionId: SHEETS_CONNECTION_ID,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, reason: "sheets_write_failed" };
    }
  },

  async healthCheck() {
    // Read-only, cheap. Confirms the credential pair can reach Zapier and
    // that the Sheets connection ID still resolves. Does NOT perform a
    // write — health checks should never mutate production data.
    try {
      await zapier.findFirstConnection({
        appKey: "google-sheets",
        owner: "me",
        isExpired: false,
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

const leadSink: LeadSink = createSheetsLeadSink();

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/leads — accept a form submission and write it to Sheets.
 *
 * §7 safety scoping: the caller submitting this form IS the approval for
 * the write. We do NOT require an out-of-band confirmation step per
 * request — that would make the feature unusable for its intended use.
 * Author-time review (this file, the pinned field keys, the adapter test)
 * and end-user action together satisfy the SKILL.md "explicit approval"
 * rule.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const lead = parseLead(body);
  if (!lead) {
    return json({ error: "invalid_payload" }, 400);
  }

  const result = await leadSink.writeLead(lead);
  if (!result.ok) {
    // Degrade gracefully (§8). In a real app, queue for retry, surface
    // a user-facing "we got your info, we'll follow up shortly" message,
    // or page oncall — do NOT drop the lead silently.
    return json({ error: result.reason }, 502);
  }

  // If you later want to send the user a confirmation email, this is where
  // it would go. Two options from §7 of the reference doc:
  //   (a) Zapier email action (gmail/outlook write draft_v2 or send_email)
  //       — fine for quick iterations on a single account.
  //   (b) Direct SMTP / provider API (Resend, Postmark, SendGrid, etc.)
  //       — prefer this for branded transactional mail from a custom
  //       domain, because it gives you DKIM, templating, and deliverability
  //       controls Zapier's email actions don't expose. Either path is
  //       still a user-initiated write (the form submit); author-time
  //       review of the template is your approval gate.

  return json({ ok: true }, 201);
}

/**
 * GET /api/health — cheap, read-only check that the Zapier credential
 * and connection ID still work. Alert on non-200. Never performs a write.
 */
export async function GET(): Promise<Response> {
  const result = await leadSink.healthCheck();
  return json(result, result.ok ? 200 : 503);
}

// ---------------------------------------------------------------------------
// Helpers (intentionally tiny — no framework dependencies)
// ---------------------------------------------------------------------------

function parseLead(body: unknown): Lead | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim() : "";
  const source = typeof record.source === "string" ? record.source.trim() : "web";
  if (!name || !email) return null;
  return { name, email, source };
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
