// One-shot helper: returns SUPABASE_SERVICE_ROLE_KEY if x-cron-secret matches CRON_SECRET.
// DELETE this function immediately after copying the value to GitHub secrets.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const provided = req.headers.get("x-cron-secret") ?? "";
  const expected = Deno.env.get("CRON_SECRET") ?? "";

  if (!expected || provided.length !== expected.length) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return new Response(
    JSON.stringify({
      service_role_key: key,
      length: key.length,
      starts_with: key.slice(0, 12),
      warning: "DELETE THIS FUNCTION IMMEDIATELY AFTER USE",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
