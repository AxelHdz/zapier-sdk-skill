import { createZapierSdk } from "@zapier/zapier-sdk";

const GMAIL_APP = "GoogleMailV2CLIAPI";
const SHEETS_APP = "GoogleSheetsV2CLIAPI";

type GmailMessage = { id: string; threadId: string; subject: string; from: string };

interface GmailService {
  searchRecentMessages(query: string): Promise<GmailMessage[]>;
}

interface SheetsService {
  appendRows(rows: string[][]): Promise<void>;
}

const zapier = createZapierSdk();

const findConnectionId = async (app: string): Promise<number> => {
  const { data } = await zapier.findFirstConnection({ app, owner: "me", isExpired: false });
  const connectionId = Number((data as { id?: unknown } | undefined)?.id);
  if (!Number.isFinite(connectionId)) throw new Error(`No usable Zapier connection found for ${app}.`);
  return connectionId;
};

const createGmailService = (connection: number): GmailService => ({
  async searchRecentMessages(query) {
    const response = await zapier.runAction({
      app: GMAIL_APP,
      actionType: "search",
      action: "message",
      connection,
      inputs: { query },
    });
    const data = Array.isArray(response.data) ? response.data : [];
    return data.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: String(record.id ?? ""),
        threadId: String(record.thread_id ?? record.threadId ?? ""),
        subject: String(record.subject ?? ""),
        from: String(record.from ?? ""),
      };
    });
  },
});

const createSheetsService = (connection: number, sheetId: string, tabName: string): SheetsService => ({
  async appendRows(rows) {
    await zapier.fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${tabName}!A:D`)}:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        connection,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: rows }),
      },
    );
  },
});

const main = async (): Promise<void> => {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error("Set SHEET_ID before running this example.");

  const gmail = createGmailService(await findConnectionId(GMAIL_APP));
  const sheets = createSheetsService(await findConnectionId(SHEETS_APP), sheetId, process.env.SHEET_TAB ?? "Inbox");
  const messages = await gmail.searchRecentMessages("newer_than:7d category:primary");
  const rows = messages.map((message) => [new Date().toISOString(), message.subject, message.from, message.threadId]);
  await sheets.appendRows(rows);
};

void main();
