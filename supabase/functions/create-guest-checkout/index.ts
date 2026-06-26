/**
 * create-guest-checkout — Guest (unauthenticated) B2C Einmalkauf.
 *
 * Sofortkauf ohne vorheriges Login. Stripe sammelt E-Mail/Adresse selbst.
 * Der Account-Claim erfolgt im stripe-webhook (siehe handleCheckoutCompleted →
 * is_guest='true' Branch): dort wird auth.admin.createUser() für die
 * Customer-E-Mail aufgerufen (falls noch kein User existiert) und ein
 * Magic-Link/Recovery-Link verschickt, mit dem der Käufer sein Passwort setzt.
 *
 * Input:  { product_slug: string, source?, persona_type?, source_page?, anonymous_id?, session_id? }
 * Output: { ok: true, checkout_url: string }
 *
 * KEINE Order wird vorab angelegt — buyer_user_id ist NOT NULL und ohne User
 * unbekannt. Order/Entitlement werden erst im Webhook (nach Account-Claim)
 * über ensureB2cOrderForSession() erzeugt.
 */
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { recoverProductSlug, normalizeSlug, suggestClosestSlug } from "../_shared/slug-normalize.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-GUEST-CHECKOUT] ${step}`, details ? JSON.stringify(details) : "");
};

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const productSlug = String(body.product_slug ?? "").trim();
    if (!productSlug) {
      return new Response(JSON.stringify({ ok: false, error: "product_slug is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resolve product (canonical_slug → exact → recovery → sellable_view) ──
    let product: { id: string; slug: string; title: string; certification_id: string | null } | null = null;
    let allActiveCandidates: { id: string; slug: string }[] = [];

    const { data: canon } = await adminClient
      .from("products")
      .select("id, slug, title, certification_id, canonical_slug")
      .eq("canonical_slug", productSlug)
      .eq("status", "active")
      .maybeSingle();
    if (canon) product = canon;

    if (!product) {
      const { data: exact } = await adminClient
        .from("products")
        .select("id, slug, title, certification_id")
        .eq("slug", productSlug)
        .eq("status", "active")
        .maybeSingle();
      if (exact) product = exact;
    }

    if (!product) {
      const { data: candidates } = await adminClient
        .from("products")
        .select("id, slug, title, certification_id")
        .eq("status", "active");
      const rows = (candidates ?? []).map((r) => ({ id: r.id, slug: r.slug }));
      allActiveCandidates = rows;
      const rec = recoverProductSlug(productSlug, rows);
      if (rec.matched) {
        product = (candidates ?? []).find((r) => r.id === rec.matched!.id) ?? null;
      } else if (rec.strategy === "ambiguous") {
        return new Response(JSON.stringify({
          ok: false,
          error: "Mehrere Produkte passen zu diesem Link.",
          error_code: "slug_ambiguous",
          candidates: rec.candidates.map((c) => ({ slug: c.slug, url: `/paket/${c.slug}` })),
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
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
          if (byId) product = byId;
        }
      }
    }

    if (!product) {
      const suggestion = suggestClosestSlug(productSlug, allActiveCandidates);
      return new Response(JSON.stringify({
        ok: false,
        error: "Komplettpaket nicht gefunden.",
        error_code: "product_not_found",
        original_slug: productSlug,
        suggested_slug: suggestion?.slug ?? null,
        suggested_url: suggestion ? `/paket/${suggestion.slug}` : null,
        fallback_url: "/berufe",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Resolve package + persona + sellable_and_deliverable gate ──
    let resolvedPackageId: string | null = null;
    let resolvedPersona: string | null = null;
    let resolvedCurriculumId: string | null = null;
    const { data: prodWithCur } = await adminClient
      .from("products")
      .select("curriculum_id")
      .eq("id", product.id)
      .maybeSingle();
    resolvedCurriculumId = prodWithCur?.curriculum_id ?? null;
    if (resolvedCurriculumId) {
      const { data: pkg } = await adminClient
        .from("course_packages")
        .select("id, persona_profile")
        .eq("curriculum_id", resolvedCurriculumId)
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      resolvedPackageId = pkg?.id ?? null;
      resolvedPersona = pkg?.persona_profile
        ? String(pkg.persona_profile).toLowerCase().split("_")[0]
        : null;
    }

    if (resolvedPackageId) {
      const { data: gate } = await adminClient
        .from("v_sellable_and_deliverable")
        .select("is_sellable_and_deliverable, is_published, delivery_ready, product_public, has_stripe_price, delivery_blocking_reasons")
        .eq("course_package_id", resolvedPackageId)
        .maybeSingle();
      if (gate && gate.is_sellable_and_deliverable !== true) {
        const reasons: string[] = [];
        if (gate.is_published === false) reasons.push("not_published");
        if (gate.delivery_ready === false) reasons.push("delivery_not_ready");
        if (gate.product_public === false) reasons.push("product_not_public");
        if (gate.has_stripe_price === false) reasons.push("no_stripe_price");
        for (const r of (gate.delivery_blocking_reasons ?? [])) reasons.push(`delivery:${r}`);
        return new Response(JSON.stringify({
          ok: false,
          error: "Dieses Produkt ist aktuell nicht kaufbar.",
          error_code: "not_sellable_and_deliverable",
          reasons,
        }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Load active price ──
    const { data: price, error: priceError } = await adminClient
      .from("product_prices")
      .select("id, amount_cents, currency, access_months, stripe_price_id")
      .eq("product_id", product.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (priceError || !price) {
      return new Response(JSON.stringify({ ok: false, error: "No active price for this product" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Stripe Checkout Session — guest mode ──
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const appUrl = origin || Deno.env.get("APP_URL") || "https://berufos.com";

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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Stripe sammelt E-Mail + Adresse selbst — kein customer/customer_email vorab.
      customer_creation: "always",
      billing_address_collection: "auto",
      phone_number_collection: { enabled: false },
      line_items: lineItems,
      success_url: `${appUrl}/willkommen?session_id={CHECKOUT_SESSION_ID}&guest=1`,
      cancel_url: `${appUrl}/paket/${encodeURIComponent(product.slug)}?checkout=cancelled`,
      metadata: {
        is_guest: "true",
        product_id: product.id,
        product_slug: product.slug,
        package_id: resolvedPackageId ?? "",
        curriculum_id: resolvedCurriculumId ?? "",
        persona: resolvedPersona ?? "",
        flow: "paywall_variant",
        checkout_source: "create-payment",
        access_months: String(price.access_months),
        duration_days: String(price.access_months * 30),
      },
    });

    if (!session?.id || !session?.url) throw new Error("Stripe session creation failed");

    // SSOT: checkout_started conversion event (guest → no user_id yet)
    try {
      const clientAnonId = typeof body.anonymous_id === "string" ? String(body.anonymous_id).slice(0, 80) : null;
      const clientSessionId = typeof body.session_id === "string" ? String(body.session_id).slice(0, 80) : null;
      const clientSource = typeof body.source === "string" ? String(body.source).slice(0, 200) : null;
      const clientSourcePage = typeof body.source_page === "string" ? String(body.source_page).slice(0, 500) : null;

      await adminClient.from("conversion_events").insert({
        user_id: null,
        anonymous_id: clientAnonId,
        session_id: clientSessionId,
        curriculum_id: resolvedCurriculumId,
        event_type: "checkout_started",
        page_path: clientSourcePage,
        metadata: {
          package_id: resolvedPackageId,
          persona: resolvedPersona,
          source: clientSource ?? "create-guest-checkout",
          source_page: clientSourcePage,
          product_id: product.id,
          product_slug: product.slug,
          price_id: price.id,
          stripe_price_id: price.stripe_price_id ?? null,
          amount_cents: price.amount_cents,
          currency: price.currency,
          stripe_session_id: session.id,
          flow: "paywall_variant_guest",
          is_guest: true,
          ts_server: new Date().toISOString(),
        },
      });
    } catch (trackErr) {
      logStep("checkout_started insert failed (non-fatal)", { error: String(trackErr) });
    }

    logStep("Guest checkout session ready", { sessionId: session.id, productSlug: product.slug });

    return new Response(JSON.stringify({
      ok: true,
      checkout_url: session.url,
      product_id: product.id,
      price_id: price.id,
      stripe_price_id: price.stripe_price_id ?? null,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logStep("ERROR", { error: message });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
