// Owner-Digest Open/Click Tracking — Track M5
// GET /owner-digest-track?t=<token>&r=<recipient>&type=open
// GET /owner-digest-track?t=<token>&r=<recipient>&type=click&u=<url>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const recipient = url.searchParams.get("r") ?? "";
  const type = (url.searchParams.get("type") ?? "open").toLowerCase();
  const linkUrl = url.searchParams.get("u");
  const ua = req.headers.get("user-agent") ?? null;
  const ipRaw = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  const ipHash = await hashIp(ipRaw);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  if (token && recipient && (type === "open" || type === "click")) {
    try {
      await supabase.rpc("admin_record_owner_digest_event", {
        p_token: token,
        p_recipient: recipient,
        p_event_type: type,
        p_link_url: linkUrl,
        p_user_agent: ua,
        p_ip_hash: ipHash,
      });
    } catch (e) {
      console.error("record event failed", e);
    }
  }

  if (type === "click" && linkUrl) {
    try {
      const target = new URL(linkUrl);
      if (target.protocol === "https:" || target.protocol === "http:") {
        return new Response(null, { status: 302, headers: { ...corsHeaders, Location: target.toString() } });
      }
    } catch (_) { /* fallthrough to pixel */ }
  }

  return new Response(PIXEL, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" },
  });
});
