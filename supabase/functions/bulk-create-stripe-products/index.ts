/**
 * bulk-create-stripe-products
 *
 * Cut A — Shop-Coverage Backfill.
 *
 * Creates Stripe Product + Price for every published course that has no
 * public+active product yet, then inserts public.products + public.product_prices
 * rows and emits audit log shop_coverage_backfill_v1.
 *
 * Idempotent via Stripe metadata.curriculum_id search:
 *   - same curriculum_id already in Stripe → reuse existing product+price
 *   - already has DB row → skipped
 *
 * Auth: bearer JWT must belong to user with has_role('admin').
 * Default amount: 2490 EUR one-time, 12 months access.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_AMOUNT_CENTS = 2490;
const DEFAULT_CURRENCY = "EUR";
const DEFAULT_ACCESS_MONTHS = 12;
const DEFAULT_BILLING_TYPE = "one_time";

const log = (step: string, details?: unknown) => {
  const d = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[BULK-STRIPE-PRODUCTS] ${step}${d}`);
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

interface GapCourse {
  course_id: string;
  curriculum_id: string;
  title: string;
}

interface ResultRow {
  course_id: string;
  curriculum_id: string;
  title: string;
  status: "created" | "reused_stripe" | "reused_db" | "skipped" | "error";
  product_id?: string;
  price_id?: string;
  stripe_product_id?: string;
  stripe_price_id?: string;
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY missing");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1) auth + role gate
    const authHeader = req.headers.get("Authorization");
    // 1) auth + role gate (or internal shared-secret bypass for ops/cron)
    const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET");
    const internalHeader = req.headers.get("x-internal-secret");
    const isInternal =
      !!internalSecret && !!internalHeader && internalHeader === internalSecret;

    const supabaseUrlEarly = supabaseUrl;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    if (!isInternal) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) throw new Error("Missing Authorization header");
      const token = authHeader.replace("Bearer ", "");

      const userClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser(token);
      if (userErr || !userData.user) throw new Error("auth_failed");
      const userId = userData.user.id;

      const { data: roleRow, error: roleErr } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      if (roleErr) throw new Error(`role_check_failed: ${roleErr.message}`);
      if (!roleRow) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = Boolean(body.dry_run);
    const limit = Math.min(Number(body.limit ?? 100), 100);
    const amountCents = Number(body.amount_cents ?? DEFAULT_AMOUNT_CENTS);
    const currency = String(body.currency ?? DEFAULT_CURRENCY).toUpperCase();
    const accessMonths = Number(body.access_months ?? DEFAULT_ACCESS_MONTHS);

    // 3) Read gap list
    const { data: gaps, error: gapErr } = await admin.rpc(
      "exec_sql_readonly_jsonb_array",
      {} as Record<string, unknown>,
    ).then(
      // Fallback path when the helper does not exist — use direct query
      () => ({ data: null, error: { message: "no rpc, using direct query" } }),
      (e: unknown) => ({ data: null, error: e as { message: string } }),
    );

    let courses: GapCourse[] = [];
    if (!gaps) {
      const { data, error } = await admin
        .from("courses")
        .select("id, curriculum_id, title, status")
        .eq("status", "published")
        .order("title");
      if (error) throw new Error(`courses_fetch_failed: ${error.message}`);

      const curriculumIds = (data ?? [])
        .map((c) => c.curriculum_id)
        .filter(Boolean) as string[];
      const { data: existing } = await admin
        .from("products")
        .select("curriculum_id")
        .in("curriculum_id", curriculumIds)
        .eq("status", "active")
        .eq("visibility", "public");
      const have = new Set(
        (existing ?? []).map((p) => p.curriculum_id as string),
      );
      courses = (data ?? [])
        .filter((c) => c.curriculum_id && !have.has(c.curriculum_id))
        .slice(0, limit)
        .map((c) => ({
          course_id: c.id,
          curriculum_id: c.curriculum_id as string,
          title: c.title,
        }));
    }

    log("gap_courses_resolved", { count: courses.length, dryRun, limit });
    if (dryRun) {
      return new Response(
        JSON.stringify({ dry_run: true, count: courses.length, courses }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 4) Stripe + DB writes
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const results: ResultRow[] = [];

    for (const course of courses) {
      try {
        // 4a) reuse existing public+active product if any (defensive)
        const { data: existingProduct } = await admin
          .from("products")
          .select("id")
          .eq("curriculum_id", course.curriculum_id)
          .eq("status", "active")
          .eq("visibility", "public")
          .maybeSingle();
        if (existingProduct) {
          results.push({
            ...course,
            status: "reused_db",
            product_id: existingProduct.id,
          });
          continue;
        }

        // 4b) Stripe idempotency — search by metadata.curriculum_id
        let stripeProduct: Stripe.Product | undefined;
        const search = await stripe.products.search({
          query: `metadata['curriculum_id']:'${course.curriculum_id}'`,
          limit: 1,
        });
        if (search.data.length > 0) stripeProduct = search.data[0];

        if (!stripeProduct) {
          stripeProduct = await stripe.products.create({
            name: course.title.slice(0, 250),
            metadata: {
              curriculum_id: course.curriculum_id,
              course_id: course.course_id,
              source: "shop_coverage_backfill_v1",
            },
          });
        }

        // 4c) Stripe price (create new if no active matching one)
        const existingPrices = await stripe.prices.list({
          product: stripeProduct.id,
          active: true,
          limit: 10,
        });
        let stripePrice = existingPrices.data.find(
          (p) =>
            p.unit_amount === amountCents &&
            p.currency.toLowerCase() === currency.toLowerCase() &&
            !p.recurring,
        );
        if (!stripePrice) {
          stripePrice = await stripe.prices.create({
            product: stripeProduct.id,
            unit_amount: amountCents,
            currency: currency.toLowerCase(),
            metadata: {
              curriculum_id: course.curriculum_id,
              source: "shop_coverage_backfill_v1",
            },
          });
        }

        // 4d) Resolve channel_policy_json via fn_default_channel_policy
        const { data: policy } = await admin.rpc("fn_default_channel_policy", {
          _track: "EXAM_FIRST",
        });

        // 4e) Insert products
        const baseSlug = slugify(course.title) || `kurs-${course.course_id.slice(0, 8)}`;
        let slug = baseSlug;
        let attempt = 0;
        let productId: string | null = null;
        while (attempt < 4) {
          const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
          const { data: ins, error: insErr } = await admin
            .from("products")
            .insert({
              slug: candidate,
        // 4g) Audit (parameter is _payload, not _meta)
        await admin.rpc("fn_emit_audit", {
          _action_type: "shop_coverage_backfill_v1",
          _target_type: "course",
          _target_id: course.course_id,
          _result_status: "success",
          _payload: {
            course_id: course.course_id,
            curriculum_id: course.curriculum_id,
            product_id: productId,
            price_id: priceRow.id,
            stripe_product_id: stripeProduct.id,
            stripe_price_id: stripePrice.id,
            amount_cents: amountCents,
            currency,
            slug,
          },
          _trigger_source: "edge_bulk_create_stripe_products",
        });

          }
          throw new Error(`product_insert_failed: ${insErr?.message ?? "unknown"}`);
        }
        if (!productId) throw new Error("product_insert_failed: slug_exhausted");

        // 4f) Insert product_prices
        const { data: priceRow, error: priceErr } = await admin
          .from("product_prices")
          .insert({
            product_id: productId,
            currency,
            amount_cents: amountCents,
            billing_type: DEFAULT_BILLING_TYPE,
            access_months: accessMonths,
            active: true,
            stripe_price_id: stripePrice.id,
          })
          .select("id")
          .single();
        if (priceErr) throw new Error(`price_insert_failed: ${priceErr.message}`);

        // 4g) Audit
        await admin.rpc("fn_emit_audit", {
          _action_type: "shop_coverage_backfill_v1",
          _target_type: "course",
          _target_id: course.course_id,
          _result_status: "success",
          _meta: {
            course_id: course.course_id,
            curriculum_id: course.curriculum_id,
            product_id: productId,
            price_id: priceRow.id,
            stripe_product_id: stripeProduct.id,
            stripe_price_id: stripePrice.id,
            amount_cents: amountCents,
            currency,
            slug,
          },
        });

        results.push({
          ...course,
          status: search.data.length > 0 ? "reused_stripe" : "created",
          product_id: productId,
          price_id: priceRow.id,
          stripe_product_id: stripeProduct.id,
          stripe_price_id: stripePrice.id,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log("course_failed", { course_id: course.course_id, error: msg });
        results.push({ ...course, status: "error", error: msg });
      }
    }

    const summary = {
      total: courses.length,
      created: results.filter((r) => r.status === "created").length,
      reused_stripe: results.filter((r) => r.status === "reused_stripe").length,
      reused_db: results.filter((r) => r.status === "reused_db").length,
      errors: results.filter((r) => r.status === "error").length,
    };
    log("done", summary);

    return new Response(JSON.stringify({ summary, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("FATAL", { error: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
