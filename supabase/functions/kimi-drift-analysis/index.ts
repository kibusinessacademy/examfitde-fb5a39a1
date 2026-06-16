/**
 * KIMI Drift Intelligence
 * Detects status drift: 'done' but not publishable, 'published' but missing assets,
 * coverage-met but no promotion, etc. Read-only.
 */
import {
  corsHeaders, getServiceClient, startSnapshot, finishSnapshot,
  persistFindings, callKimi, RESPONSE_SCHEMA_INSTRUCTIONS,
} from "../_shared/kimi-qil.ts";

const SYSTEM_PROMPT = `Du bist KIMI — Drift Intelligence Auditor für ExamFit.
Du erhältst Drift-Signale: Pakete deren Status nicht mit ihrem realen Zustand übereinstimmt.

Drift-Typen:
- DONE_BUT_NOT_INTEGRITY: status=done aber integrity_passed=false
- PUBLISHED_BUT_NO_PRODUCT: is_published=true aber kein active product
- PUBLISHED_BUT_NO_PRICE: product aktiv aber kein product_price
- READY_NOT_PROMOTED: integrity_passed=true, status=done, aber nicht published (vergessen)
- PUBLISHED_NO_PILLAR: published aber kein SEO-Pillar generiert

Cluster die Drifts, finde gemeinsame Ursachen, schlage Repair-Aktionen vor.
Du darfst NICHTS ändern.

${RESPONSE_SCHEMA_INSTRUCTIONS}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = getServiceClient();
  const t0 = Date.now();
  let snapshotId: string | null = null;

  try {
    // Gather 5 drift categories in parallel
    const [doneNotIntegrity, readyNotPromoted, publishedNoProduct] = await Promise.all([
      sb.from("course_packages")
        .select("id, title, certification_type, integrity_passed, blocked_reason")
        .eq("status", "done").eq("integrity_passed", false).limit(100),
      sb.from("course_packages")
        .select("id, title, certification_type, ready_since")
        .eq("status", "done").eq("integrity_passed", true).eq("is_published", false).limit(100),
      sb.from("course_packages")
        .select("id, title, product_id, is_published")
        .eq("is_published", true).is("product_id", null).limit(100),
    ]);

    // Published but no active price
    const { data: publishedNoPrice } = await sb.rpc("fn_qil_open_recommendations", { p_limit: 1 })
      .then(() => sb.from("course_packages")
        .select("id, title, product_id")
        .eq("is_published", true)
        .not("product_id", "is", null)
        .limit(500))
      .catch(() => ({ data: [] as any[] }));

    let noPriceList: any[] = [];
    if (publishedNoPrice && publishedNoPrice.length > 0) {
      const productIds = publishedNoPrice.map((p: any) => p.product_id).filter(Boolean);
      const { data: prices } = await sb
        .from("product_prices")
        .select("product_id, active")
        .in("product_id", productIds);
      const productsWithActivePrice = new Set(
        (prices ?? []).filter((p: any) => p.active).map((p: any) => p.product_id),
      );
      noPriceList = publishedNoPrice.filter((p: any) => !productsWithActivePrice.has(p.product_id)).slice(0, 50);
    }

    const inputSummary = {
      done_not_integrity: doneNotIntegrity.data?.length ?? 0,
      ready_not_promoted: readyNotPromoted.data?.length ?? 0,
      published_no_product: publishedNoProduct.data?.length ?? 0,
      published_no_active_price: noPriceList.length,
    };

    snapshotId = await startSnapshot(sb, "drift", inputSummary);

    const total = inputSummary.done_not_integrity + inputSummary.ready_not_promoted
                + inputSummary.published_no_product + inputSummary.published_no_active_price;

    if (total === 0) {
      await finishSnapshot(sb, snapshotId, {
        status: "succeeded", finding_count: 0, recommendation_count: 0,
        duration_ms: Date.now() - t0,
        output_summary: { message: "no drift detected — state ≡ reality" },
      });
      return new Response(JSON.stringify({ ok: true, snapshot_id: snapshotId, findings: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { result, tokens_input, tokens_output } = await callKimi(SYSTEM_PROMPT, {
      done_but_not_integrity: doneNotIntegrity.data ?? [],
      ready_but_not_promoted: readyNotPromoted.data ?? [],
      published_but_no_product: publishedNoProduct.data ?? [],
      published_but_no_active_price: noPriceList,
    });

    const { recCount } = await persistFindings(sb, snapshotId, "drift", result.findings);

    await finishSnapshot(sb, snapshotId, {
      status: "succeeded",
      finding_count: result.findings.length,
      recommendation_count: recCount,
      tokens_input, tokens_output,
      duration_ms: Date.now() - t0,
      output_summary: { summary: result.summary, ...inputSummary },
    });

    return new Response(JSON.stringify({
      ok: true, snapshot_id: snapshotId,
      findings: result.findings.length, recommendations: recCount,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (snapshotId) {
      await finishSnapshot(sb, snapshotId, {
        status: "failed", error_message: msg, duration_ms: Date.now() - t0,
      });
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
