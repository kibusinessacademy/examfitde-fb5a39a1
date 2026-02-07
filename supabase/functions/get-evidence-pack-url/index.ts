import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  packId: string;
}

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse(401, { error: "Missing Authorization Bearer token" });
    }

    const body = (await req.json()) as RequestBody;
    const packId = body.packId?.trim();
    
    if (!packId) {
      return jsonResponse(400, { error: "packId is required" });
    }

    // User client for auth and RPC
    const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get pack storage info via RPC (includes admin check)
    const { data: packInfo, error: packErr } = await sbUser.rpc("get_evidence_pack_storage_info", {
      p_pack_id: packId,
    });

    if (packErr) {
      return jsonResponse(500, { error: packErr.message });
    }
    if (!packInfo) {
      return jsonResponse(404, { error: "Evidence pack not found" });
    }

    const info = packInfo as any;

    // If pack has inline data, we can't generate signed URL
    if (info.has_inline_pack && !info.storage_path) {
      return jsonResponse(400, { 
        error: "Pack stored inline, use get_evidence_pack RPC instead",
        has_inline_pack: true
      });
    }

    if (!info.storage_bucket || !info.storage_path) {
      return jsonResponse(400, { error: "Pack has no storage path" });
    }

    // Service client to generate signed URL
    const sbService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Generate signed URL (24 hours validity)
    const { data: signed, error: signedErr } = await sbService.storage
      .from(info.storage_bucket)
      .createSignedUrl(info.storage_path, 60 * 60 * 24);

    if (signedErr) {
      return jsonResponse(500, { error: `Signed URL failed: ${signedErr.message}` });
    }

    return jsonResponse(200, {
      ok: true,
      pack_id: info.pack_id,
      fingerprint: info.fingerprint,
      generated_at: info.generated_at,
      size_bytes: info.size_bytes,
      signed_url: signed?.signedUrl,
      expires_in_seconds: 60 * 60 * 24,
    });
  } catch (e) {
    console.error("get-evidence-pack-url error:", e);
    return jsonResponse(500, { error: String((e as Error)?.message ?? e) });
  }
});
