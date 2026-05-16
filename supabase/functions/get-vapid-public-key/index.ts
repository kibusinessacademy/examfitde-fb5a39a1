// Returns only the VAPID PUBLIC key — never the private key.
// Public key is, by design, safe to expose to the browser (used to encrypt
// the push channel registration with the push service).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? null;
  return new Response(
    JSON.stringify({ publicKey, configured: Boolean(publicKey) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
