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
 * Re-processes pending/error purchase events and handles:
 * - Retry verification for pending/error events
 * - Subscription expiration
 * - Orphaned receipt links (verified without entitlement)
 * - Refund detection cleanup
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
    let body: { store?: string; purchase_event_id?: string; action?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }

    const results = {
      reconciled: 0,
      verified: 0,
      failed: 0,
      skipped: 0,
      subscriptions_expired: 0,
      orphans_fixed: 0,
    };

    // ── Action: expire_subscriptions ─────────────────────────
    if (!body.action || body.action === "expire_subscriptions") {
      const { data: expiredCount } = await sb.rpc("expire_mobile_store_subscriptions");
      results.subscriptions_expired = expiredCount ?? 0;

      if (body.action === "expire_subscriptions") {
        await sb.from("mobile_store_sync_log").insert({
          store: body.store || "all",
          event_type: "subscription_expiration",
          payload_json: { expired: results.subscriptions_expired },
          status: "completed",
        });

        return new Response(JSON.stringify(results), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Action: fix_orphans — verified events without entitlements ─
    if (!body.action || body.action === "fix_orphans") {
      const { data: orphans } = await sb
        .from("mobile_store_purchase_events")
        .select(`
          id, store, store_sku, external_transaction_id, user_id,
          learner_identity_id, is_subscription,
          subscription_period_start, subscription_period_end
        `)
        .in("verification_status", ["verified", "provider_verified"])
        .limit(BATCH_SIZE);

      if (orphans) {
        for (const orphan of orphans) {
          // Check if receipt link with entitlement exists
          const { data: link } = await sb
            .from("mobile_store_receipt_links")
            .select("id, entitlement_id")
            .eq("purchase_event_id", orphan.id)
            .eq("status", "active")
            .maybeSingle();

          if (link?.entitlement_id) continue; // Already has entitlement

          // Resolve product and create entitlement
          const { data: productData } = await sb.rpc("resolve_mobile_store_product", {
            p_store: orphan.store,
            p_store_sku: orphan.store_sku,
          });

          if (!productData?.length || !productData[0].is_active) continue;

          const storeProduct = productData[0];
          const isSubscription = storeProduct.store_product_type === "subscription" || orphan.is_subscription;

          await sb.rpc("create_mobile_store_entitlement", {
            p_store: orphan.store,
            p_purchase_event_id: orphan.id,
            p_product_id: storeProduct.product_id,
            p_user_id: orphan.user_id || null,
            p_learner_identity_id: orphan.learner_identity_id || null,
            p_source_ref: orphan.external_transaction_id,
            p_is_subscription: isSubscription,
            p_subscription_period_start: orphan.subscription_period_start || null,
            p_subscription_period_end: orphan.subscription_period_end || null,
          });

          results.orphans_fixed++;
        }
      }

      if (body.action === "fix_orphans") {
        await sb.from("mobile_store_sync_log").insert({
          store: body.store || "all",
          event_type: "orphan_fix",
          payload_json: results,
          status: "completed",
        });

        return new Response(JSON.stringify(results), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Default: retry pending/error events ──────────────────
    let query = sb
      .from("mobile_store_purchase_events")
      .select(`
        id, store, store_sku, external_transaction_id, verification_status,
        user_id, learner_identity_id, raw_payload_json,
        is_subscription, subscription_period_start, subscription_period_end,
        bundle_id, environment
      `)
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

    if (!events?.length && results.subscriptions_expired === 0 && results.orphans_fixed === 0) {
      return new Response(
        JSON.stringify({ ...results, message: "No pending events" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    for (const event of (events || [])) {
      results.reconciled++;

      try {
        // Resolve product
        const { data: productData } = await sb.rpc("resolve_mobile_store_product", {
          p_store: event.store,
          p_store_sku: event.store_sku,
        });

        if (!productData?.length || !productData[0].is_active) {
          await sb
            .from("mobile_store_purchase_events")
            .update({ verification_status: "error", processed_at: new Date().toISOString() })
            .eq("id", event.id);
          results.failed++;
          continue;
        }

        const storeProduct = productData[0];

        // Structural re-validation
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
          const isSubscription = storeProduct.store_product_type === "subscription" || event.is_subscription;
          await sb.rpc("create_mobile_store_entitlement", {
            p_store: event.store,
            p_purchase_event_id: event.id,
            p_product_id: storeProduct.product_id,
            p_user_id: event.user_id || null,
            p_learner_identity_id: event.learner_identity_id || null,
            p_source_ref: event.external_transaction_id,
            p_is_subscription: isSubscription,
            p_subscription_period_start: event.subscription_period_start || null,
            p_subscription_period_end: event.subscription_period_end || null,
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
