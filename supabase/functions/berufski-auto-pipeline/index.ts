// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (step: string, d?: Record<string, unknown>) =>
  console.log(`[AUTO-PIPELINE] ${step}`, d ? JSON.stringify(d) : "");

async function invokeFunction(
  supabaseUrl: string, serviceKey: string, fnName: string, body: Record<string, unknown>,
): Promise<{ data: any; error: string | null }> {
  const url = `${supabaseUrl}/functions/v1/${fnName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { data, error: data?.error || `${fnName} returned ${res.status}` };
  return { data, error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { berufskiId, tier } = await req.json();
    if (!berufskiId || !tier) {
      return new Response(JSON.stringify({ error: "berufskiId and tier required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const steps: Array<{ step: string; status: string; detail?: any }> = [];

    log("Step 1: Generate product", { berufskiId, tier });
    const gen = await invokeFunction(supabaseUrl, serviceKey, "berufski-generate-product", { berufskiId, tier });
    if (gen.error) {
      steps.push({ step: "generate", status: "failed", detail: gen.error });
      return new Response(JSON.stringify({ ok: false, steps }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const productId = gen.data?.productId;
    steps.push({ step: "generate", status: "ok", detail: { productId } });

    if (!productId) {
      steps.push({ step: "generate", status: "failed", detail: "No productId returned" });
      return new Response(JSON.stringify({ ok: false, steps }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    log("Step 2: Render screen PDF");
    const screenPdf = await invokeFunction(supabaseUrl, serviceKey, "berufski-render-pdf", { productId, mode: "screen" });
    steps.push({ step: "render_screen", status: screenPdf.error ? "failed" : "ok", detail: screenPdf.error || { path: screenPdf.data?.storagePath } });

    log("Step 3: Render print PDF");
    const printPdf = await invokeFunction(supabaseUrl, serviceKey, "berufski-render-pdf", { productId, mode: "print" });
    steps.push({ step: "render_print", status: printPdf.error ? "failed" : "ok", detail: printPdf.error || { path: printPdf.data?.storagePath } });

    log("Step 4: Publish gate");
    const pub = await invokeFunction(supabaseUrl, serviceKey, "berufski-publish-gate", { productId });
    steps.push({ step: "publish", status: pub.error ? "failed" : "ok", detail: pub.error || { stripePriceId: pub.data?.stripePriceId } });

    // ─── Step 5: Build landing URL ───
    const { data: produkt } = await adminClient.from("work_produkte").select("beruf_id").eq("id", productId).single();

    let landingUrl = "";
    if (produkt?.beruf_id) {
      const { data: beruf } = await adminClient.from("work_berufe").select("slug").eq("id", produkt.beruf_id).single();
      if (beruf?.slug) {
        const appBase = Deno.env.get("APP_BASE_URL") || "https://berufos.com";
        landingUrl = `${appBase}/work/beruf/${beruf.slug}`;
      }
    }
    steps.push({ step: "seo", status: "ok", detail: { landingUrl } });

    const allOk = steps.every((s) => s.status === "ok");

    return new Response(JSON.stringify({ ok: allOk, productId, landingUrl, steps }),
      { status: allOk ? 200 : 207, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    log("ERROR", { message: (e as Error).message });
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
