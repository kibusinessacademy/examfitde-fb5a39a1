/**
 * create-product-checkout — B2C Einmalkauf-Checkout für Landingpages.
 * 
 * Input: { product_slug: string }
 * Output: { ok: true, checkout_url: string, order_id: string }
 *
 * Flow:
 *   1. Auth user
 *   2. Load product + active price from product_prices
 *   3. Create order (pending)
 *   4. Create Stripe Checkout Session (mode: payment)
 *   5. Return checkout_url
 */
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { recoverProductSlug, normalizeSlug, suggestClosestSlug } from "../_shared/slug-normalize.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-PRODUCT-CHECKOUT] ${step}`, details ? JSON.stringify(details) : '');
};

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user?.email) {
      throw new Error("User not authenticated");
    }
    logStep("User authenticated", { userId: user.id, email: user.email });

    // ── Parse request ──
    const body = await req.json();
    const productSlug = String(body.product_slug ?? "").trim();
    if (!productSlug) {
      return new Response(JSON.stringify({ error: "product_slug is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── Idempotency: 60s dedup window per (user, product_slug, status=pending) ──
    // Prevents zombie orders from double-clicks, retries or double-mounts.
    try {
      const sinceIso = new Date(Date.now() - 60_000).toISOString();
      const { data: recent } = await adminClient
        .from("orders")
        .select("id, stripe_checkout_session_id, created_at, notes")
        .eq("buyer_user_id", user.id)
        .eq("status", "pending")
        .gte("created_at", sinceIso)
        .ilike("notes", `product_checkout:${productSlug}`)
        .order("created_at", { ascending: false })
        .limit(1);
      if (recent && recent.length > 0 && recent[0].stripe_checkout_session_id) {
        const existing = recent[0];
        // Best-effort: rebuild the Stripe URL — re-retrieve session
        try {
          const stripeEarly = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
          const sess = await stripeEarly.checkout.sessions.retrieve(existing.stripe_checkout_session_id);
          if (sess?.url && sess?.status !== "complete" && sess?.status !== "expired") {
            await adminClient.from("auto_heal_log").insert({
              action_type: "checkout_idempotency_hit",
              target_type: "orders",
              target_id: existing.id,
              result_status: "success",
              metadata: {
                user_id: user.id,
                product_slug: productSlug,
                stripe_session_id: existing.stripe_checkout_session_id,
                source: "create-product-checkout",
              },
            });
            return new Response(JSON.stringify({
              ok: true,
              checkout_url: sess.url,
              order_id: existing.id,
              idempotent: true,
            }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (sessErr) {
          logStep("idempotency Stripe retrieve failed (non-fatal)", { error: String(sessErr) });
        }
      }
    } catch (idemErr) {
      logStep("idempotency check failed (non-fatal)", { error: String(idemErr) });
    }

    // ── Load product (with slug recovery bridge) ──
    // Strategy: exact → uuid_suffix_strip → normalized → prefix.
    // Ambiguous matches fail-closed with audit so we never silently checkout
    // the wrong course. Original input is also looked up against
    // v_public_sellable_courses as a final safety net.
    let product: { id: string; slug: string; title: string; certification_id: string | null } | null = null;
    let recoveryStrategy: string = "exact";
    let recoveryAuditNote: Record<string, unknown> | null = null;
    let allActiveCandidates: { id: string; slug: string }[] = [];


    {
      const { data: exact } = await adminClient
        .from("products")
        .select("id, slug, title, certification_id")
        .eq("slug", productSlug)
        .eq("status", "active")
        .maybeSingle();

      if (exact) {
        product = exact;
      } else {
        // Pull all active product slugs (~few hundred rows) and run recovery
        // in-memory. Cheaper than full-text/like and deterministic.
        const { data: candidates } = await adminClient
          .from("products")
          .select("id, slug, title, certification_id")
          .eq("status", "active");

        const rows = (candidates ?? []).map((r) => ({ id: r.id, slug: r.slug }));
        allActiveCandidates = rows;
        const rec = recoverProductSlug(productSlug, rows);

        if (rec.matched) {
          product = (candidates ?? []).find((r) => r.id === rec.matched!.id) ?? null;
          recoveryStrategy = rec.strategy;
          recoveryAuditNote = {
            original_slug: productSlug,
            normalized_input: normalizeSlug(productSlug),
            resolved_product_id: rec.matched.id,
            resolved_slug: rec.matched.slug,
            strategy: rec.strategy,
          };
        } else if (rec.strategy === "ambiguous") {
          await adminClient.from("auto_heal_log").insert({
            action_type: "checkout_slug_ambiguous",
            target_type: "products",
            target_id: null,
            result_status: "blocked",
            metadata: {
              user_id: user.id,
              product_slug: productSlug,
              normalized_input: normalizeSlug(productSlug),
              candidates: rec.candidates.map((c) => ({ id: c.id, slug: c.slug })),
              source: "create-product-checkout",
            },
          });
          logStep("Slug recovery ambiguous", { slug: productSlug, count: rec.candidates.length });
          // Return 200 with structured payload so the client can render a
          // friendly UI fallback (Stripe-Funnel würde bei 4xx hart abbrechen).
          return new Response(JSON.stringify({
            ok: false,
            error: "Mehrere Produkte passen zu diesem Link. Bitte wähle das Paket erneut über die Produktseite.",
            error_code: "slug_ambiguous",
            candidates: rec.candidates.map((c) => ({ slug: c.slug, url: `/paket/${c.slug}` })),
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Final safety net: try v_public_sellable_courses (in case caller
        // passed a public-course slug rather than a product slug).
        if (!product) {
          const { data: pubMatch } = await adminClient
            .from("v_public_sellable_courses")
            .select("product_id, product_slug")
            .or(`product_slug.eq.${productSlug},product_slug.eq.${normalizeSlug(productSlug)}`)
            .limit(2);
          if (pubMatch && pubMatch.length === 1 && pubMatch[0].product_id) {
            const { data: byId } = await adminClient
              .from("products")
              .select("id, slug, title, certification_id")
              .eq("id", pubMatch[0].product_id)
              .eq("status", "active")
              .maybeSingle();
            if (byId) {
              product = byId;
              recoveryStrategy = "sellable_view";
              recoveryAuditNote = {
                original_slug: productSlug,
                resolved_product_id: byId.id,
                resolved_slug: byId.slug,
                strategy: "sellable_view",
              };
            }
          }
        }
      }
    }

    if (!product) {
      logStep("Product not found after recovery", { slug: productSlug });
      const suggestion = suggestClosestSlug(productSlug, allActiveCandidates);
      await adminClient.from("auto_heal_log").insert({
        action_type: "checkout_slug_unresolved",
        target_type: "products",
        target_id: null,
        result_status: "miss",
        metadata: {
          user_id: user.id,
          product_slug: productSlug,
          normalized_input: normalizeSlug(productSlug),
          suggested_slug: suggestion?.slug ?? null,
          source: "create-product-checkout",
        },
      });
      // 200 + ok:false → client kann eine verständliche Meldung zeigen und
      // den Nutzer auf eine Vorschlagsseite weiterleiten, statt den Funnel
      // mit einem rohen "non-2xx" abzubrechen.
      return new Response(JSON.stringify({
        ok: false,
        error: "Komplettpaket nicht gefunden.",
        error_code: "product_not_found",
        original_slug: productSlug,
        suggested_slug: suggestion?.slug ?? null,
        suggested_url: suggestion ? `/paket/${suggestion.slug}` : null,
        fallback_url: "/berufe",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (recoveryAuditNote) {
      await adminClient.from("auto_heal_log").insert({
        action_type: "checkout_slug_recovered",
        target_type: "products",
        target_id: product.id,
        result_status: "success",
        metadata: { ...recoveryAuditNote, source: "create-product-checkout" },
      });
      logStep("Product slug recovered", recoveryAuditNote);
    } else {
      logStep("Product loaded", { id: product.id, title: product.title, strategy: recoveryStrategy });
    }

    // ── Resolve package_id + persona (SSOT: product → curriculum → published package) ──
    let resolvedPackageId: string | null = null;
    let resolvedPersona: string | null = null;
    let resolvedCurriculumId: string | null = null;
    try {
      const { data: prodWithCur } = await adminClient
        .from('products')
        .select('curriculum_id')
        .eq('id', product.id)
        .maybeSingle();
      resolvedCurriculumId = prodWithCur?.curriculum_id ?? null;
      if (resolvedCurriculumId) {
        const { data: pkg } = await adminClient
          .from('course_packages')
          .select('id, persona_profile')
          .eq('curriculum_id', resolvedCurriculumId)
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedPackageId = pkg?.id ?? null;
        resolvedPersona = pkg?.persona_profile
          ? String(pkg.persona_profile).toLowerCase().split('_')[0]
          : null;
      }
    } catch (resolveErr) {
      logStep("package_id resolve failed (non-fatal)", { error: String(resolveErr) });
    }
    logStep("Package resolved", { packageId: resolvedPackageId, persona: resolvedPersona });

    // ── Sellable & Deliverable Hard-Gate (SSOT v_sellable_and_deliverable) ──
    // No checkout if package is not published, not delivery-ready, product not public, or no Stripe price.
    if (resolvedPackageId) {
      const { data: gate, error: gateErr } = await adminClient
        .from("v_sellable_and_deliverable")
        .select("is_sellable_and_deliverable, is_published, delivery_ready, product_public, has_stripe_price, delivery_blocking_reasons")
        .eq("course_package_id", resolvedPackageId)
        .maybeSingle();

      if (gateErr) {
        logStep("sellable_and_deliverable gate lookup failed (non-fatal, allowing)", { error: gateErr.message });
      } else if (gate && gate.is_sellable_and_deliverable !== true) {
        const reasons: string[] = [];
        if (gate.is_published === false) reasons.push("not_published");
        if (gate.delivery_ready === false) reasons.push("delivery_not_ready");
        if (gate.product_public === false) reasons.push("product_not_public");
        if (gate.has_stripe_price === false) reasons.push("no_stripe_price");
        for (const r of (gate.delivery_blocking_reasons ?? [])) reasons.push(`delivery:${r}`);

        await adminClient.from("auto_heal_log").insert({
          action_type: "checkout_blocked_not_sellable_and_deliverable",
          target_type: "course_packages",
          target_id: resolvedPackageId,
          result_status: "blocked",
          metadata: {
            user_id: user.id,
            product_id: product.id,
            product_slug: productSlug,
            reasons,
            gate,
            source: "create-product-checkout",
          },
        });
        logStep("Checkout blocked: package not sellable_and_deliverable", { packageId: resolvedPackageId, reasons });
        return new Response(JSON.stringify({
          ok: false,
          error: "Dieses Produkt ist aktuell nicht kaufbar. Bitte versuche es in wenigen Minuten erneut.",
          error_code: "not_sellable_and_deliverable",
          reasons,
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Load active price ──
    const { data: price, error: priceError } = await adminClient
      .from("product_prices")
      .select("id, amount_cents, currency, access_months, stripe_price_id, compare_at_cents")
      .eq("product_id", product.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (priceError || !price) {
      logStep("No active price", { productId: product.id, error: priceError?.message });
      return new Response(JSON.stringify({ error: "No active price for this product" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    logStep("Price loaded", { id: price.id, amount_cents: price.amount_cents });

    // ── Check existing entitlement (prevent double-buy) ──
    const { data: existingEntitlement } = await adminClient
      .from("entitlements")
      .select("id, valid_until")
      .eq("user_id", user.id)
      .eq("product_id", product.id)
      .gt("valid_until", new Date().toISOString())
      .limit(1);

    if (existingEntitlement && existingEntitlement.length > 0) {
      logStep("User already has active entitlement", { entitlementId: existingEntitlement[0].id });
      return new Response(JSON.stringify({
        error: "Du hast bereits Zugang zu diesem Produkt.",
        already_entitled: true,
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Stripe Checkout Session FIRST (no zombie orders on Stripe failure) ──
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data.length > 0 ? customers.data[0].id : undefined;

    const appUrl = origin || Deno.env.get("APP_URL") || "https://examfit.de";

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = price.stripe_price_id
      ? [{ price: price.stripe_price_id, quantity: 1 }]
      : [{
          price_data: {
            currency: price.currency.toLowerCase(),
            product_data: { name: product.title },
            unit_amount: price.amount_cents,
          },
          quantity: 1,
        }];

    // Pre-generate order UUID so Stripe metadata + success_url can reference it
    // even though the DB row is created AFTER Stripe confirms session creation.
    const pendingOrderId = crypto.randomUUID();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: lineItems,
      success_url: `${appUrl}/willkommen?order_id=${pendingOrderId}`,
      cancel_url: `${appUrl}/landing/FORTBILDUNG/${encodeURIComponent(product.slug)}?checkout=cancelled`,
      metadata: {
        order_id: pendingOrderId,
        product_id: product.id,
        user_id: user.id,
        product_slug: product.slug,
        package_id: resolvedPackageId ?? '',
        persona: resolvedPersona ?? '',
        flow: "paywall_variant",
        checkout_source: "create-payment",
        access_months: String(price.access_months),
        duration_days: String(price.access_months * 30),
      },
    });

    if (!session?.id || !session?.url) {
      logStep("Stripe session creation failed — no order inserted", { sessionId: session?.id });
      throw new Error("Stripe session creation failed");
    }
    logStep("Stripe session created", { sessionId: session.id });

    // ── Create order (pending) AFTER Stripe success — no zombie orders ──
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .insert({
        id: pendingOrderId,
        buyer_user_id: user.id,
        subtotal_cents: price.amount_cents,
        total_cents: price.amount_cents,
        tax_cents: 0,
        currency: price.currency,
        status: "pending",
        customer_type: "b2c",
        billing_email: user.email,
        notes: `product_checkout:${product.slug}`,
        stripe_checkout_session_id: session.id,
      })
      .select("id")
      .single();

    if (orderError || !order) {
      logStep("Order insert failed AFTER Stripe session — manual reconciliation needed", {
        sessionId: session.id,
        error: orderError?.message,
      });
      throw new Error(orderError?.message ?? "Order creation failed");
    }
    logStep("Order created", { orderId: order.id });

    // ── SSOT: checkout_started event ──
    try {
      const clientAnonId = typeof body.anonymous_id === 'string' ? String(body.anonymous_id).slice(0, 80) : null;
      const clientSessionId = typeof body.session_id === 'string' ? String(body.session_id).slice(0, 80) : null;
      const clientSource = typeof body.source === 'string' ? String(body.source).slice(0, 200) : null;
      const clientPersonaType = typeof body.persona_type === 'string' ? String(body.persona_type).slice(0, 50) : null;
      const clientSourcePage = typeof body.source_page === 'string' ? String(body.source_page).slice(0, 500) : null;

      await adminClient.from('conversion_events').insert({
        user_id: user.id,
        anonymous_id: clientAnonId,
        session_id: clientSessionId,
        curriculum_id: resolvedCurriculumId,
        event_type: 'checkout_started',
        page_path: clientSourcePage,
        metadata: {
          package_id: resolvedPackageId,
          persona: resolvedPersona,
          persona_type: clientPersonaType ?? resolvedPersona,
          source: clientSource ?? 'create-product-checkout',
          source_page: clientSourcePage,
          product_id: product.id,
          product_slug: product.slug,
          price_id: price.id,
          stripe_price_id: price.stripe_price_id ?? null,
          amount_cents: price.amount_cents,
          currency: price.currency,
          order_id: order.id,
          stripe_session_id: session.id,
          flow: 'paywall_variant',
          ts_server: new Date().toISOString(),
        },
      });
      logStep("checkout_started emitted", { packageId: resolvedPackageId, orderId: order.id });
    } catch (trackErr) {
      logStep("checkout_started insert failed (non-fatal)", { error: String(trackErr) });
    }

    logStep("Checkout session ready", { sessionId: session.id, url: session.url });

    return new Response(JSON.stringify({
      ok: true,
      checkout_url: session.url,
      order_id: order.id,
      package_id: resolvedPackageId,
      persona: resolvedPersona,
      product_id: product.id,
      price_id: price.id,
      stripe_price_id: price.stripe_price_id ?? null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logStep("ERROR", { error: message });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
