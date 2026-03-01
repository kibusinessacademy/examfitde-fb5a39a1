import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[WORK-DOWNLOAD-GATE] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { productId, mode, token } = await req.json();

    if (!productId || !token || !mode) {
      return json(400, { ok: false, error: "productId, mode, and token required" }, origin);
    }

    logStep("Download request", { productId, mode });

    const { data: purchase, error: pErr } = await adminClient
      .from('work_purchases')
      .select('id, download_token, token_expires_at, produkt_id')
      .eq('download_token', token)
      .eq('produkt_id', productId)
      .maybeSingle();

    if (pErr || !purchase) {
      logStep("Invalid token", { token: token.slice(0, 8) + '...' });
      return json(403, { ok: false, error: "Invalid or expired download token" }, origin);
    }

    if (purchase.token_expires_at && new Date(purchase.token_expires_at) < new Date()) {
      logStep("Token expired");
      return json(403, { ok: false, error: "Download token has expired" }, origin);
    }

    const { data: pdfExport } = await adminClient
      .from('work_pdf_exports')
      .select('storage_path')
      .eq('product_id', productId)
      .eq('mode', mode)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!pdfExport?.storage_path) {
      return json(404, { ok: false, error: "PDF not found for this mode" }, origin);
    }

    const { data: signedData, error: signErr } = await adminClient
      .storage
      .from('berufski-assets')
      .createSignedUrl(pdfExport.storage_path, 900);

    if (signErr || !signedData?.signedUrl) {
      logStep("Signed URL error", { error: signErr?.message });
      return json(500, { ok: false, error: "Could not generate download URL" }, origin);
    }

    await adminClient.from('work_purchases').update({
      download_count: (purchase as any).download_count ? (purchase as any).download_count + 1 : 1,
      last_download_at: new Date().toISOString(),
    }).eq('id', purchase.id);

    logStep("Download URL generated", { purchaseId: purchase.id, mode });
    return json(200, { ok: true, url: signedData.signedUrl }, origin);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return json(500, { ok: false, error: msg }, origin);
  }
});
