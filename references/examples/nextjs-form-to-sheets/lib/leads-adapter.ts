import { createZapierSdk } from "@zapier/zapier-sdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const ZAPIER_CLIENT_ID = requireEnv("ZAPIER_CREDENTIALS_CLIENT_ID");
const ZAPIER_CLIENT_SECRET = requireEnv("ZAPIER_CREDENTIALS_CLIENT_SECRET");
const SHEETS_CONNECTION_ID = Number(requireEnv("GOOGLE_SHEETS_CONNECTION_ID"));
const LEAD_SPREADSHEET_ID = requireEnv("LEAD_SHEET_SPREADSHEET_ID");
const LEAD_WORKSHEET_ID = requireEnv("LEAD_SHEET_WORKSHEET_ID");

if (Number.isNaN(SHEETS_CONNECTION_ID)) {
  throw new Error(
    "GOOGLE_SHEETS_CONNECTION_ID must be a number",
  );
}

const zapier = createZapierSdk({
  credentials: {
    clientId: ZAPIER_CLIENT_ID,
    clientSecret: ZAPIER_CLIENT_SECRET,
  },
});

// Single-tenant example: pin these build-time keys from `get-input-fields-schema`.
// For multi-tenant storage and rotation, see §5 of the reference doc.
const LEAD_FIELD_KEYS = {
  name: "name",
  email: "email",
  source: "source",
} as const;

export type Lead = {
  name: string;
  email: string;
  source: string;
};

interface LeadSink {
  writeLead(lead: Lead): Promise<{ ok: true } | { ok: false; reason: string }>;
  healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

function createSheetsLeadSink(): LeadSink {
  return {
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

    // This checks the exact pinned connection, not just "any Sheets connection."
    // It catches a stale GOOGLE_SHEETS_CONNECTION_ID, a deleted connection in
    // Zapier, or a credential pair that no longer has access.
    async healthCheck() {
      try {
        const { data } = await zapier.listConnections({
          appKey: "google-sheets",
          owner: "me",
          connectionIds: [String(SHEETS_CONNECTION_ID)],
          isExpired: false,
        });
        const found =
          Array.isArray(data) &&
          data.some(
            (connection) =>
              Number((connection as { id?: unknown })?.id) === SHEETS_CONNECTION_ID,
          );
        if (!found) {
          return {
            ok: false as const,
            reason: "configured_sheets_connection_not_found_or_expired",
          };
        }
        return { ok: true as const };
      } catch (err) {
        return {
          ok: false as const,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export function parseLead(body: unknown): Lead | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim() : "";
  const source = typeof record.source === "string" ? record.source.trim() : "web";

  if (!name || !email) {
    return null;
  }

  return { name, email, source };
}

export const leadSink = createSheetsLeadSink();
