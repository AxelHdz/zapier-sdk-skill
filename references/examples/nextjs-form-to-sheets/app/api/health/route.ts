import { leadSink } from "../../../lib/leads-adapter";

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(): Promise<Response> {
  const result = await leadSink.healthCheck();
  return json(result, result.ok ? 200 : 503);
}
