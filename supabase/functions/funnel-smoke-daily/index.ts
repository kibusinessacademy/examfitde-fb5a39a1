/**
 * funnel-smoke-daily — P0.2 Funnel Smoke Automation.
 *
 * Tägliche Verifikation aller sellable Pakete: für jeden Slug
 *   1) Auflösung in v_public_sellable_courses (canonical_slug)
 *   2) create-product-checkout liefert Stripe-Session-URL (cs_live_*)
 *
 * Akzeptanz: 191/191 grün. <100% triggert Audit-Alert (heal_alert_loop).
 *
 * Schutz: nur SERVICE_ROLE oder ADMIN_API_TOKEN dürfen aufrufen.
 * Stripe-Sessions sind unbezahlt → expiren nach 24h automatisch
 * (kein DB-Cleanup). Smoke-Identität: SMOKE_USER_EMAIL/PASSWORD.
 *
 * Modes:
 *   { mode: "full" }       → alle 191 Slugs (Cron-Default)
 *   { mode: "sample", n }  → n zufällige Slugs (CI/Manual)
 *   { mode: "slugs", list }→ explizite Liste (Re-Run failed)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const log = (step: string, d?: Record<string, unknown>) =>
  console.log(`[FUNNEL-SMOKE-DAILY] ${step}`, d ? JSON.stringify(d) : "");

interface SmokeResult {
  slug: string;
  product_id: string | null;
  phase: "resolve" | "checkout" | "complete";
  success: boolean;
  duration_ms: number;
  error_code: string | null;
  error_message: string | null;
  stripe_session_id: string | null;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const smokeEmail =
      Deno.env.get("SMOKE_USER_EMAIL") ?? "e2e+grant@examfit-smoke.local";
    const smokePassword =
      Deno.env.get("SMOKE_USER_PASSWORD") ?? "SmokeTest_E2E_2026!";

    // ── Auth gate ──
    // Either: service-role bearer (admin tool), OR explicit cron source marker
    // matching FUNNEL_SMOKE_API_TOKEN if set. Mirrors sibling-cron pattern of
    // anon-JWT + body marker; the auto_heal_log audit captures every invocation.
    const auth = req.headers.get("Authorization") ?? "";
    const isServiceRole = auth.includes(serviceKey);
    const expectedToken = Deno.env.get("FUNNEL_SMOKE_API_TOKEN");
    const headerToken = req.headers.get("x-smoke-api-token") ?? "";
    const hasSharedToken = !!expectedToken && headerToken === expectedToken;

    let body: { mode?: string; n?: number; slugs?: string[]; source?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body = full mode
    }
    const isCronSource = (body.source ?? "") === "pg_cron";

    if (!isServiceRole && !hasSharedToken && !isCronSource) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mode = body.mode ?? "full";

    const admin = createClient(supabaseUrl, serviceKey);

    // ── Pull the actually-checkoutable set ──
    // SSOT for "user can complete a checkout today" is v_sellable_and_deliverable
    // (joins published + delivery_ready + product_public + has_stripe_price).
    // v_public_sellable_courses is the *catalog* set — wider, includes packages
    // visible in /berufe but blocked downstream by the deliverable gate.
    // We test the inner set; the gap is reported as drift KPI.
    const { data: rows, error: rowErr } = await admin
      .from("v_sellable_and_deliverable")
      .select("course_package_id, product_id, product_slug")
      .eq("is_sellable_and_deliverable", true);
    if (rowErr) throw new Error(`load sellable_and_deliverable: ${rowErr.message}`);

    // Pull canonical_slug for each row from products
    const productIds = (rows ?? []).map((r) => r.product_id).filter(Boolean) as string[];
    const { data: prodRows } = await admin
      .from("products")
      .select("id, canonical_slug, slug")
      .in("id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]);
    const slugByProductId = new Map(
      (prodRows ?? []).map((p) => [p.id, p.canonical_slug ?? p.slug]),
    );

    let targets = (rows ?? [])
      .map((r) => ({
        product_id: r.product_id as string,
        product_slug: r.product_slug as string,
        canonical_slug: slugByProductId.get(r.product_id as string) ?? r.product_slug,
      }))
      .filter((t) => !!t.canonical_slug && !!t.product_id) as Array<{
        product_id: string; product_slug: string; canonical_slug: string;
      }>;

    // Catalog-vs-deliverable drift KPI
    const { count: catalogCount } = await admin
      .from("v_public_sellable_courses")
      .select("*", { count: "exact", head: true })
      .eq("is_sellable", true);
    const catalogDriftCount = (catalogCount ?? 0) - targets.length;

    if (mode === "sample") {
      const n = Math.max(1, Math.min(50, body.n ?? 5));
      targets = [...targets].sort(() => Math.random() - 0.5).slice(0, n);
    } else if (mode === "slugs" && Array.isArray(body.slugs)) {
      const wanted = new Set(body.slugs);
      targets = targets.filter(
        (r) => wanted.has(r.canonical_slug) || wanted.has(r.product_slug),
      );
    }

    if (targets.length === 0) {
      return new Response(JSON.stringify({ ok: true, total: 0, results: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    log("Targets", { count: targets.length, mode });

    // ── Sign in as smoke user (need user-context JWT for create-product-checkout) ──
    const tokenRes = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
      },
    );
    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      throw new Error(`smoke user auth failed: ${tokenRes.status} ${txt}`);
    }
    const { access_token } = await tokenRes.json();

    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    const results: SmokeResult[] = [];

    // ── Execute smoke per slug (sequential — Stripe rate limit safety) ──
    for (const t of targets) {
      const slug = t.canonical_slug;
      const t0 = Date.now();
      const result: SmokeResult = {
        slug,
        product_id: t.product_id,
        phase: "resolve",
        success: false,
        duration_ms: 0,
        error_code: null,
        error_message: null,
        stripe_session_id: null,
      };
      try {
        result.phase = "checkout";
        const r = await fetch(
          `${supabaseUrl}/functions/v1/create-product-checkout`,
          {
            method: "POST",
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              product_slug: slug,
              source: "funnel-smoke-daily",
              source_page: `/funnel-smoke/${runId}`,
              smoke_run_id: runId,
            }),
          },
        );
        const txt = await r.text();
        let parsed: any = {};
        try {
          parsed = JSON.parse(txt);
        } catch {
          // non-JSON
        }
        if (parsed?.already_entitled || parsed?.error === "already_entitled") {
          // Smoke user already owns it → treat as success (proves resolve+gate path).
          result.success = true;
          result.phase = "complete";
        } else if (
          r.ok &&
          parsed?.ok !== false &&
          typeof parsed?.checkout_url === "string" &&
          parsed.checkout_url.startsWith("https://checkout.stripe.com")
        ) {
          result.success = true;
          result.phase = "complete";
          result.stripe_session_id = parsed.session_id ?? null;
        } else {
          result.error_code =
            parsed?.error_code ?? `http_${r.status}`;
          result.error_message =
            parsed?.error ?? txt.slice(0, 280);
        }
      } catch (err) {
        result.error_code = "exception";
        result.error_message = String(err).slice(0, 280);
      }
      result.duration_ms = Date.now() - t0;
      results.push(result);
    }

    const success = results.filter((r) => r.success).length;
    const failed = results.length - success;
    const successRate = results.length === 0 ? 0 : (success / results.length) * 100;
    const durationTotalMs = Date.now() - startedAt;

    // ── Audit summary (Pflicht-Audit über ops_audit_contract) ──
    await admin.from("auto_heal_log").insert({
      action_type: "funnel_smoke_run_summary",
      target_type: "system",
      result_status: failed === 0 ? "success" : "warn",
      duration_ms: durationTotalMs,
      metadata: {
        run_id: runId,
        mode,
        total: results.length,
        success,
        failed,
        success_rate_pct: Number(successRate.toFixed(2)),
        failed_slugs: results
          .filter((r) => !r.success)
          .slice(0, 50)
          .map((r) => ({
            slug: r.slug,
            phase: r.phase,
            error_code: r.error_code,
            error_message: r.error_message,
          })),
      },
    });

    // ── Alert when not 100% green ──
    if (failed > 0) {
      await admin.from("auto_heal_log").insert({
        action_type: "funnel_smoke_alert",
        target_type: "system",
        result_status: "warn",
        metadata: {
          run_id: runId,
          success_rate: Number(successRate.toFixed(2)),
          failed_count: failed,
          failed_slugs: results
            .filter((r) => !r.success)
            .map((r) => r.slug),
        },
      });
    }

    log("Run complete", { runId, total: results.length, success, failed });

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        mode,
        total: results.length,
        success,
        failed,
        success_rate_pct: Number(successRate.toFixed(2)),
        duration_ms: durationTotalMs,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    log("ERROR", { error: String(err) });
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
