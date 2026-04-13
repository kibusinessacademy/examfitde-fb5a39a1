import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;

  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "Method not allowed" }, origin);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" }, origin);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message.slice(0, 500) : "Unknown error";
    const stack = typeof body.stack === "string" ? body.stack.slice(0, 2000) : null;
    const url = typeof body.url === "string" ? body.url.slice(0, 500) : null;
    const pathname = typeof body.pathname === "string" ? body.pathname.slice(0, 300) : null;
    const isChunkError = body.isChunkError === true;
    const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
    const buildVersion = typeof body.buildVersion === "string" ? body.buildVersion.slice(0, 50) : null;
    const timestamp = typeof body.timestamp === "string" ? body.timestamp.slice(0, 40) : null;

    const severity = isChunkError ? "low" : "high";
    const category = isChunkError ? "chunk_error" : "runtime_error";

    const { error } = await supabase.from("admin_notifications").insert({
      title: `[Frontend] ${message.slice(0, 120)}`,
      body: [
        pathname ? `Route: ${pathname}` : null,
        url ? `URL: ${url}` : null,
        stack ? `Stack: ${stack.slice(0, 500)}` : null,
        userAgent ? `UA: ${userAgent.slice(0, 100)}` : null,
        buildVersion ? `Build: ${buildVersion}` : null,
      ].filter(Boolean).join("\n"),
      severity,
      category,
      entity_type: "frontend_error",
      metadata: {
        message,
        stack,
        url,
        pathname,
        isChunkError,
        userAgent,
        buildVersion,
        ts: timestamp ?? new Date().toISOString(),
      },
    });

    if (error) return json(500, { error: "insert_failed", details: error.message }, origin);
    return json(200, { ok: true }, origin);
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) }, origin);
  }
});
