import { leadSink, parseLead } from "../../../lib/leads-adapter.js";

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

  // §7 safety scoping: the user's form submission IS the approval,
  // no out-of-band confirmation required.
  const result = await leadSink.writeLead(lead);
  if (!result.ok) {
    // §8 graceful degradation: return a clear failure so callers can retry,
    // queue, or surface a fallback success message instead of silently dropping it.
    return json({ error: result.reason }, 502);
  }

  // If you add a confirmation email later, direct SMTP/provider code would live
  // here as the alternative to a Zapier-backed mail action.
  return json({ ok: true }, 201);
}
