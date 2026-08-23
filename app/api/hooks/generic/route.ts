import { secret } from "@/lib/secrets";
import { handleAlert, verifySignature, type AlertState } from "@/lib/status/ingest";

/**
 * POST /api/hooks/generic
 *
 * Body: { "key": "checkout-api", "state": "triggered" | "resolved",
 *         "title": "...", "detail": "...", "id": "dedupe-key" }
 *
 * Signed with INGEST_SECRET:
 *   X-Cloudstatus-Signature: sha256=<hmac of "<timestamp>.<body>" or of the body>
 *   X-Cloudstatus-Timestamp: <unix seconds>   (optional)
 */
export async function POST(request: Request) {
  const ingestSecret = await secret("INGEST_SECRET");
  if (!ingestSecret) {
    return Response.json(
      { error: "not_configured", message: "INGEST_SECRET is not set on this deployment." },
      { status: 503 },
    );
  }

  const raw = await request.text();

  const valid = await verifySignature(
    ingestSecret,
    raw,
    request.headers.get("x-cloudstatus-signature"),
    request.headers.get("x-cloudstatus-timestamp"),
  );
  if (!valid) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: { key?: string; state?: string; title?: string; detail?: string; id?: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad_request", message: "Body must be JSON." }, { status: 400 });
  }

  if (!payload.key) {
    return Response.json(
      { error: "bad_request", message: '"key" is required and is matched against your rules.' },
      { status: 400 },
    );
  }

  const state: AlertState = payload.state === "resolved" ? "resolved" : "triggered";

  const result = await handleAlert("generic", {
    key: payload.key,
    state,
    title: payload.title,
    detail: payload.detail,
    externalId: payload.id,
  });

  return Response.json(result);
}
