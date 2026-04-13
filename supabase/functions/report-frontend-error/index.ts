import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message.slice(0, 500) : "Unknown error";
    const stack = typeof body.stack === "string" ? body.stack.slice(0, 2000) : null;
    const url = typeof body.url === "string" ? body.url.slice(0, 500) : null;
    const isChunkError = body.isChunkError === true;
    const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;

    const severity = isChunkError ? "low" : "high";
    const category = isChunkError ? "chunk_error" : "runtime_error";

    const { error } = await supabase.from("admin_notifications").insert({
      title: `[Frontend] ${message.slice(0, 120)}`,
      body: [
        url ? `URL: ${url}` : null,
        stack ? `Stack: ${stack.slice(0, 500)}` : null,
        userAgent ? `UA: ${userAgent.slice(0, 100)}` : null,
      ].filter(Boolean).join("\n"),
      severity,
      category,
      entity_type: "frontend_error",
      metadata: { message, stack, url, isChunkError, userAgent, ts: new Date().toISOString() },
    });

    if (error) return json(500, { error: "insert_failed", details: error.message });
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
