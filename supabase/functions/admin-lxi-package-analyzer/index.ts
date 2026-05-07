/**
 * admin-lxi-package-analyzer
 * ──────────────────────────
 * Liefert eine kompakte KI-Analyse für ein einzelnes queued/no-lessons Paket:
 *  - Step-Status-Verteilung
 *  - Bootstrap-Step-Diagnose
 *  - track_step_applicability-Vergleich
 *  - letzte Heal-Log-Einträge
 *
 * Antwortet mit { diagnosis, recommendation, confidence, reasoning }.
 *
 * Input:  { package_id: string }
 * Auth :  admin only
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/adminGuard.ts";

interface AnalysisRequest {
  package_id: string;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const headers = {
    ...getCorsHeaders(req.headers.get("origin")),
    "Content-Type": "application/json; charset=utf-8",
  };

  const guard = await requireAdmin(req);
  if (guard instanceof Response) return guard;

  try {
    const body = (await req.json()) as AnalysisRequest;
    if (!body?.package_id) {
      return new Response(JSON.stringify({ error: "package_id required" }), { status: 400, headers });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { status: 500, headers });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Gather facts ──────────────────────────────────
    const { data: pkg } = await sb
      .from("course_packages")
      .select("id, title, status, track, archived, curriculum_id, feature_flags")
      .eq("id", body.package_id)
      .maybeSingle();

    if (!pkg) {
      return new Response(JSON.stringify({ error: "package_not_found" }), { status: 404, headers });
    }

    const { data: steps } = await sb
      .from("package_steps")
      .select("step_key, status, attempts, last_error, updated_at")
      .eq("package_id", body.package_id);

    const { data: rules } = await sb
      .from("track_step_applicability")
      .select("step_key, should_run")
      .eq("track", pkg.track);

    const ruleMap = new Map((rules ?? []).map((r) => [r.step_key, r.should_run]));

    const stepRows = (steps ?? []).map((s) => ({
      ...s,
      should_run: ruleMap.get(s.step_key) ?? true,
    }));

    const dist: Record<string, number> = {};
    for (const s of stepRows) dist[s.status] = (dist[s.status] ?? 0) + 1;

    const bootstrap = stepRows.find((s) => s.step_key === "scaffold_learning_course");
    const skippedApplicable = stepRows.filter((s) => s.status === "skipped" && s.should_run);
    const skippedNonApplicable = stepRows.filter((s) => s.status === "skipped" && !s.should_run);
    const failedSteps = stepRows.filter((s) => s.status === "failed");

    const { data: jobs } = await sb
      .from("job_queue")
      .select("job_type, status, last_error, created_at")
      .eq("package_id", body.package_id)
      .order("created_at", { ascending: false })
      .limit(5);

    const { data: log } = await sb
      .from("auto_heal_log")
      .select("action_type, result_status, result_detail, created_at")
      .eq("target_id", body.package_id)
      .order("created_at", { ascending: false })
      .limit(5);

    // ── Heuristic recommendation (deterministic, fast path) ──
    let recommendation = "no_action";
    let confidence: "high" | "medium" | "low" = "medium";
    let reasoning = "";

    if (pkg.status !== "queued") {
      recommendation = "skip_not_queued";
      confidence = "high";
      reasoning = `Paket ist im Status '${pkg.status}', nicht 'queued'.`;
    } else if (pkg.feature_flags?.bronze?.locked) {
      recommendation = "skip_bronze_locked";
      confidence = "high";
      reasoning = "Paket ist Bronze-locked. Reinit nicht zulässig.";
    } else if (bootstrap?.status === "skipped" && (ruleMap.get("scaffold_learning_course") ?? true)) {
      recommendation = "reinit_bootstrap_step";
      confidence = "high";
      reasoning =
        "Bootstrap-Step 'scaffold_learning_course' ist skipped, aber laut track_step_applicability erlaubt. " +
        `Nach Reset → queued nudged der Atomic-Trigger das Paket; die ${skippedApplicable.length} weiteren ` +
        "applicable skipped Steps werden vom Pipeline-Cascade reaktiviert.";
    } else if (!bootstrap) {
      recommendation = "investigate_missing_bootstrap";
      confidence = "high";
      reasoning =
        "Kein 'scaffold_learning_course' Step vorhanden — Step-Materialisierung hat nie stattgefunden. " +
        "Manuelles Re-Materialisieren via package_seed_steps nötig.";
    } else if (failedSteps.length > 0) {
      recommendation = "investigate_failed_steps";
      confidence = "medium";
      reasoning = `${failedSteps.length} Step(s) im failed-Status. Reinit nicht ausreichend, root-cause klären.`;
    } else {
      recommendation = "no_action";
      confidence = "low";
      reasoning = "Keine eindeutige Reinit-Indikation. Manuelle Diagnose empfohlen.";
    }

    // ── AI summary on top of facts ──────────────────────
    const facts = {
      package: { title: pkg.title, status: pkg.status, track: pkg.track, bronze_locked: !!pkg.feature_flags?.bronze?.locked },
      step_distribution: dist,
      bootstrap_step: bootstrap ? { status: bootstrap.status, attempts: bootstrap.attempts, last_error: bootstrap.last_error } : null,
      skipped_applicable_count: skippedApplicable.length,
      skipped_non_applicable: skippedNonApplicable.map((s) => s.step_key),
      failed_steps: failedSteps.map((s) => ({ step_key: s.step_key, last_error: s.last_error })),
      recent_jobs: (jobs ?? []).slice(0, 5),
      recent_heal_log: (log ?? []).slice(0, 5),
      heuristic: { recommendation, confidence, reasoning },
    };

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "Du bist Senior Pipeline Engineer für ExamFit. Analysiere den Paket-Zustand kompakt auf Deutsch. " +
              "Bestätige oder widerlege die Heuristik. Antworte in max. 6 Bullet-Points, plus 1 klare Empfehlung am Ende. " +
              "Keine Floskeln, kein Marketing-Sprech.",
          },
          {
            role: "user",
            content:
              "Analysiere folgenden LXI queued/no-lessons Paket-Zustand und gib eine prägnante Diagnose + " +
              "klare Reinit-Empfehlung mit Begründung. Wenn die Heuristik korrekt ist, bestätige sie kurz.\n\n" +
              "FAKTEN (JSON):\n" + JSON.stringify(facts, null, 2),
          },
        ],
      }),
    });

    if (!aiResp.ok) {
      const status = aiResp.status;
      if (status === 429)
        return new Response(JSON.stringify({ error: "rate_limited", facts, heuristic: facts.heuristic }), { status: 429, headers });
      if (status === 402)
        return new Response(JSON.stringify({ error: "ai_credits_exhausted", facts, heuristic: facts.heuristic }), { status: 402, headers });
      return new Response(JSON.stringify({ error: "ai_gateway_error", facts, heuristic: facts.heuristic }), { status: 500, headers });
    }

    const aiData = await aiResp.json();
    const diagnosis = aiData?.choices?.[0]?.message?.content ?? "";

    return new Response(
      JSON.stringify({
        diagnosis,
        heuristic: { recommendation, confidence, reasoning },
        facts,
      }),
      { status: 200, headers },
    );
  } catch (e) {
    console.error("[admin-lxi-package-analyzer] Error:", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500, headers });
  }
});
