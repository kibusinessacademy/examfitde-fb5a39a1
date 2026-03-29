import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 20;

/**
 * Reconcile Store Purchases
 *
 * Re-processes pending/error purchase events. Attempts re-validation
 * and entitlement creation for events that failed previously.
 * Suitable for cron/job-queue invocation.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    let body: { store?: string; purchase_event_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }

    // ── 1. Load events to reconcile ──────────────────────────
    let query = sb
      .from("mobile_store_purchase_events")
      .select("id, store, store_sku, external_transaction_id, verification_status, user_id, learner_identity_id, raw_payload_json")
      .in("verification_status", ["pending", "error"])
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (body.store) {
      query = query.eq("store", body.store);
    }
    if (body.purchase_event_id) {
      query = query.eq("id", body.purchase_event_id);
    }

    const { data: events, error: fetchErr } = await query;

    if (fetchErr) {
      console.error("Reconcile: fetch error", { error: fetchErr });
      return new Response(
        JSON.stringify({ error: "Failed to fetch events" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!events?.length) {
      return new Response(
        JSON.stringify({ reconciled: 0, message: "No pending events" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = { reconciled: 0, verified: 0, failed: 0, skipped: 0 };

    for (const event of events) {
      results.reconciled++;

      try {
        // Resolve product
        const { data: productData } = await sb.rpc("resolve_mobile_store_product", {
          p_store: event.store,
          p_store_sku: event.store_sku,
        });

        if (!productData?.length || !productData[0].is_active) {
          // No active product mapping — mark as error
          await sb
            .from("mobile_store_purchase_events")
            .update({ verification_status: "error", processed_at: new Date().toISOString() })
            .eq("id", event.id);
          results.failed++;
          continue;
        }

        const storeProduct = productData[0];

        // TODO: PRODUCTION — Re-attempt provider verification here
        // For now: structural re-check
        const isValid = !!event.store_sku && !!event.external_transaction_id;

        if (!isValid) {
          await sb
            .from("mobile_store_purchase_events")
            .update({ verification_status: "rejected", processed_at: new Date().toISOString() })
            .eq("id", event.id);
          results.failed++;
          continue;
        }

        // Mark as verified
        await sb
          .from("mobile_store_purchase_events")
          .update({ verification_status: "verified", processed_at: new Date().toISOString() })
          .eq("id", event.id);

        // Check if entitlement already exists
        const { data: existingLink } = await sb
          .from("mobile_store_receipt_links")
          .select("id")
          .eq("purchase_event_id", event.id)
          .eq("status", "active")
          .maybeSingle();

        if (!existingLink) {
          // Create entitlement
          const isSubscription = storeProduct.store_product_type === "subscription";
          await sb.rpc("create_mobile_store_entitlement", {
            p_store: event.store,
            p_purchase_event_id: event.id,
            p_product_id: storeProduct.product_id,
            p_user_id: event.user_id || null,
            p_learner_identity_id: event.learner_identity_id || null,
            p_source_ref: event.external_transaction_id,
            p_is_subscription: isSubscription,
          });
        }

        results.verified++;
      } catch (itemErr) {
        console.error("Reconcile: item error", { eventId: event.id, error: String(itemErr) });
        await sb
          .from("mobile_store_purchase_events")
          .update({ verification_status: "error", processed_at: new Date().toISOString() })
          .eq("id", event.id);
        results.failed++;
      }
    }

    // Log reconciliation
    await sb.from("mobile_store_sync_log").insert({
      store: body.store || "all",
      event_type: "reconciliation",
      payload_json: results,
      status: "completed",
    });

    console.log("Reconcile: complete", results);

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Reconcile error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error during reconciliation" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
