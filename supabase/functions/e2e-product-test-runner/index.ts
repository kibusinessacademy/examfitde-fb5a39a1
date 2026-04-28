// E2E Test Runner: für alle (curriculum × product_key) Kombinationen
// 1) login as E2E_TEST_USER → JWT
// 2) call create-checkout (live Stripe test session)
// 3) admin-grant via grant_learner_course_access
// 4) tutor_access_check returns allowed
// 5) cleanup grant
//
// Runs in batches to keep response size manageable.
// Returns aggregate: pass/fail/error counts + list of failures.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Stripe from "npm:stripe@14.21.0";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

interface RunRequest {
  start?: number;          // offset into the curriculum list
  limit?: number;          // batch size (defaults to 50)
  product_keys?: string[]; // defaults to all 3
  skip_stripe?: boolean;   // skip live Stripe session creation
  cleanup_only?: boolean;  // only delete test grants, no test
}

interface ComboResult {
  curriculum_id: string;
  curriculum_title: string;
  product_key: string;
  checkout_status: number | null;
  checkout_has_url: boolean;
  checkout_error: string | null;
  grant_id: string | null;
  grant_error: string | null;
  tutor_allowed: boolean | null;
  tutor_reason: string | null;
  tutor_error: string | null;
  pass: boolean;
}

const TEST_GRANT_SOURCE = "e2e_test_runner";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  try {
    const body = (await req.json().catch(() => ({}))) as RunRequest;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Auth: either admin user JWT, OR service-role key in apikey header (for ops/CI)
    const authHeader = req.headers.get("Authorization");
    const apiKey = req.headers.get("apikey") ?? req.headers.get("x-service-role");
    const isServiceRole = !!apiKey && apiKey === serviceKey;

    if (!isServiceRole) {
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "missing bearer or service-role" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: callerData } = await callerClient.auth.getUser();
      if (!callerData?.user) {
        return new Response(JSON.stringify({ error: "invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isAdmin } = await admin.rpc("has_role", {
        _user_id: callerData.user.id, _role: "admin",
      });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "admin required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    const e2eEmail = Deno.env.get("E2E_TEST_USER_EMAIL")!;
    const e2ePass = Deno.env.get("E2E_TEST_USER_PASSWORD")!;

    // Cleanup mode: delete all grants from this runner
    if (body.cleanup_only) {
      const { count, error } = await admin
        .from("learner_course_grants")
        .delete({ count: "exact" })
        .eq("source", TEST_GRANT_SOURCE);
      return new Response(JSON.stringify({ cleaned: count ?? 0, error: error?.message ?? null }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Login E2E test user → JWT
    const userClient = createClient(supabaseUrl, anonKey);
    const { data: signIn, error: signInErr } = await userClient.auth.signInWithPassword({
      email: e2eEmail, password: e2ePass,
    });
    if (signInErr || !signIn.session) {
      return new Response(JSON.stringify({ error: `login failed: ${signInErr?.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userJwt = signIn.session.access_token;
    const testUserId = signIn.user!.id;

    // Resolve product UUIDs
    const productKeys = body.product_keys ?? ["bundle", "learning_course", "exam_trainer"];
    const { data: products, error: prodErr } = await admin
      .from("store_products")
      .select("id, product_key")
      .in("product_key", productKeys);
    if (prodErr || !products?.length) {
      return new Response(JSON.stringify({ error: `products: ${prodErr?.message ?? "none"}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const productByKey = new Map(products.map((p: any) => [p.product_key, p.id]));

    // Batch curricula
    const start = body.start ?? 0;
    const limit = Math.min(body.limit ?? 50, 100);
    const { data: curricula, error: curErr } = await admin
      .from("curricula")
      .select("id, title")
      .eq("status", "frozen")
      .order("title")
      .range(start, start + limit - 1);
    if (curErr) {
      return new Response(JSON.stringify({ error: `curricula: ${curErr.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2024-06-20" as any });
    const results: ComboResult[] = [];

    for (const cur of curricula ?? []) {
      for (const pk of productKeys) {
        const productId = productByKey.get(pk);
        const result: ComboResult = {
          curriculum_id: cur.id,
          curriculum_title: cur.title,
          product_key: pk,
          checkout_status: null,
          checkout_has_url: false,
          checkout_error: null,
          grant_id: null,
          grant_error: null,
          tutor_allowed: null,
          tutor_reason: null,
          tutor_error: null,
          pass: false,
        };

        // 1) create-checkout (skip_stripe = nur DB-Pricing-Check)
        if (body.skip_stripe) {
          const { data: tier, error: tierErr } = await admin
            .from("product_price_tiers")
            .select("id, total_price_cents")
            .eq("product_id", productId)
            .lte("min_quantity", 1)
            .or("max_quantity.is.null,max_quantity.gte.1")
            .order("min_quantity", { ascending: false })
            .limit(1)
            .maybeSingle();
          result.checkout_status = tier ? 200 : 404;
          result.checkout_has_url = !!tier;
          result.checkout_error = tierErr?.message ?? (tier ? null : "no price tier");
        } else {
          try {
            const resp = await fetch(`${supabaseUrl}/functions/v1/create-checkout`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${userJwt}`,
                "apikey": anonKey,
              },
              body: JSON.stringify({
                product_key: pk,
                curriculum_id: cur.id,
                quantity: 1,
                buyer_is_licensee: true,
              }),
            });
            const text = await resp.text();
            result.checkout_status = resp.status;
            try {
              const json = JSON.parse(text);
              result.checkout_has_url = !!json.url;
              if (!resp.ok) result.checkout_error = json.error ?? text.slice(0, 200);
            } catch {
              result.checkout_error = text.slice(0, 200);
            }
          } catch (e: any) {
            result.checkout_error = e?.message ?? String(e);
          }
        }

        // 2) admin grant
        try {
          const { data: grantId, error: grantErr } = await admin.rpc(
            "grant_learner_course_access",
            {
              p_user_id: testUserId,
              p_curriculum_id: cur.id,
              p_product_id: productId,
              p_source: TEST_GRANT_SOURCE,
              p_metadata: { e2e: true, product_key: pk },
            },
          );
          result.grant_id = grantId as string | null;
          if (grantErr) result.grant_error = grantErr.message;
        } catch (e: any) {
          result.grant_error = e?.message ?? String(e);
        }

        // 3) tutor_access_check (uses p_user_id since we're service role)
        try {
          const { data: gate, error: gateErr } = await admin.rpc(
            "tutor_access_check",
            { p_curriculum_id: cur.id, p_daily_limit: 200, p_user_id: testUserId },
          );
          if (gateErr) {
            result.tutor_error = gateErr.message;
          } else {
            const g = gate as any;
            result.tutor_allowed = !!g?.allowed;
            result.tutor_reason = g?.reason ?? null;
          }
        } catch (e: any) {
          result.tutor_error = e?.message ?? String(e);
        }

        // 4) cleanup grant
        if (result.grant_id) {
          await admin
            .from("learner_course_grants")
            .delete()
            .eq("id", result.grant_id);
        }

        result.pass =
          result.checkout_status === 200 &&
          result.checkout_has_url &&
          !!result.grant_id &&
          result.tutor_allowed === true;

        results.push(result);
      }
    }

    const summary = {
      batch_start: start,
      batch_limit: limit,
      curricula_in_batch: curricula?.length ?? 0,
      combos_tested: results.length,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      checkout_failures: results.filter((r) => r.checkout_status !== 200).length,
      grant_failures: results.filter((r) => !r.grant_id).length,
      tutor_failures: results.filter((r) => r.tutor_allowed !== true).length,
      failures: results.filter((r) => !r.pass).slice(0, 50), // cap response size
      sample_pass: results.find((r) => r.pass) ?? null,
    };

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
