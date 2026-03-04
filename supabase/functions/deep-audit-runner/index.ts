import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

/**
 * deep-audit-runner
 * Runs periodic deep quality audit on published/building packages.
 * Samples X% of questions, re-checks quality metrics, detects drift.
 * Can be called manually or via cron.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({}));
    const forceRun = body.force === true;

    // Get config
    const { data: config } = await sb
      .from("deep_audit_config")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!config) {
      return json({ ok: false, error: "No active deep_audit_config" });
    }

    // Check if it's time to run
    if (!forceRun && config.next_run_at && new Date(config.next_run_at) > new Date()) {
      return json({
        ok: true,
        skipped: true,
        reason: `Next run scheduled at ${config.next_run_at}`,
        config_id: config.id,
      });
    }

    // Get all published packages with questions
    const { data: packages } = await sb
      .from("course_packages")
      .select("id, title, status, certification_id, course_id")
      .in("status", ["published", "building", "quality_hold"])
      .order("created_at", { ascending: false });

    if (!packages?.length) {
      return json({ ok: true, audited: 0, reason: "No packages to audit" });
    }

    const results: any[] = [];

    for (const pkg of packages) {
      // Get latest snapshot for "before" values
      const { data: lastSnap } = await sb
        .from("production_quality_snapshots")
        .select("confidence_score, governance_score, duplicate_rate, lf_coverage_pct, difficulty_easy_pct, difficulty_medium_pct, difficulty_hard_pct")
        .eq("package_id", pkg.id)
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Count total questions for this package
      const { data: course } = await sb
        .from("courses")
        .select("id, curriculum_id")
        .eq("id", pkg.course_id)
        .maybeSingle();

      if (!course) continue;

      const { count: totalQ } = await sb
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", course.curriculum_id);

      if (!totalQ || totalQ === 0) continue;

      // Sample
      const sampleSize = Math.max(5, Math.ceil(totalQ * (config.sample_pct / 100)));

      // Get sampled questions for quality analysis
      const { data: sampledQs } = await sb
        .from("questions")
        .select("id, difficulty, lernfeld_id, validation_score, question_text")
        .eq("curriculum_id", course.curriculum_id)
        .order("created_at", { ascending: false })
        .limit(sampleSize);

      if (!sampledQs?.length) continue;

      // Analyze sample: difficulty distribution
      const diffs = { easy: 0, medium: 0, hard: 0 };
      let lowConfCount = 0;
      const lfSet = new Set<string>();

      for (const q of sampledQs) {
        const d = (q.difficulty || "medium").toLowerCase();
        if (d === "easy" || d === "leicht") diffs.easy++;
        else if (d === "hard" || d === "schwer") diffs.hard++;
        else diffs.medium++;
        if (q.lernfeld_id) lfSet.add(q.lernfeld_id);
        if ((q.validation_score || 100) < 70) lowConfCount++;
      }

      const total = sampledQs.length;
      const easyPct = Math.round((diffs.easy / total) * 100);
      const medPct = Math.round((diffs.medium / total) * 100);
      const hardPct = Math.round((diffs.hard / total) * 100);

      // Get total LF count for coverage
      const { count: totalLFs } = await sb
        .from("lernfelder")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", course.curriculum_id);

      const lfCoverageNow = totalLFs ? Math.round((lfSet.size / totalLFs) * 100) : 0;

      // Check for duplicates in sample via trigram
      const { data: dupCheck } = await sb
        .from("duplicate_detection_log")
        .select("id")
        .eq("curriculum_id", course.curriculum_id)
        .gte("detected_at", new Date(Date.now() - 86400_000 * config.cycle_days).toISOString());

      const dupRate = totalQ > 0 ? Math.round(((dupCheck?.length || 0) / totalQ) * 100 * 10) / 10 : 0;

      // Compute current confidence (simplified from RPC logic)
      const diffBalance = 100 - Math.abs(easyPct - 40) - Math.abs(medPct - 40) - Math.abs(hardPct - 20);
      const confNow = Math.max(0, Math.min(100, Math.round(
        0.35 * lfCoverageNow +
        0.25 * (100 - dupRate * 20) +
        0.20 * Math.max(0, diffBalance) +
        0.10 * 80 + // provider stability placeholder
        0.10 * (100 - (lowConfCount / total) * 100)
      )));

      const confBefore = lastSnap?.confidence_score ?? confNow;
      const govBefore = lastSnap?.governance_score ?? 100;
      const dupBefore = lastSnap?.duplicate_rate ?? 0;
      const lfBefore = lastSnap?.lf_coverage_pct ?? 0;

      const confDrift = Math.abs(confNow - confBefore);
      const driftDetected = confDrift > config.max_drift_delta;

      const flags: string[] = [];
      if (driftDetected) flags.push("confidence_drift");
      if (dupRate > 4.5) flags.push("high_duplicate_rate");
      if (lfCoverageNow < 70) flags.push("low_lf_coverage");
      if (hardPct < 10) flags.push("low_hard_questions");
      if (lowConfCount > total * 0.15) flags.push("high_low_confidence");

      // Auto-hold if drift detected and config allows
      let autoHeld = false;
      if (driftDetected && config.auto_hold_on_drift && pkg.status !== "quality_hold") {
        await sb
          .from("course_packages")
          .update({ status: "quality_hold" })
          .eq("id", pkg.id);
        autoHeld = true;

        // Write audit snapshot
        await sb.from("quality_audit_snapshots").insert({
          package_id: pkg.id,
          event_type: "periodic_audit",
          triggered_by: "system",
          trigger_reason: `Deep Audit: Confidence drift ${confDrift.toFixed(1)} > ${config.max_drift_delta}`,
          question_count: totalQ,
          confidence_score: confNow,
          governance_score: govBefore,
          duplicate_rate: dupRate,
          lf_coverage_pct: lfCoverageNow,
          hard_ratio: hardPct,
          provider_mix: {},
          snapshot_data: { flags, sample_size: sampleSize },
        });
      }

      // Insert result
      await sb.from("deep_audit_results").insert({
        config_id: config.id,
        package_id: pkg.id,
        sampled_count: sampleSize,
        total_questions: totalQ,
        confidence_before: confBefore,
        confidence_after: confNow,
        confidence_drift: confDrift,
        governance_before: govBefore,
        governance_after: govBefore,
        duplicate_rate_before: dupBefore,
        duplicate_rate_after: dupRate,
        lf_coverage_before: lfBefore,
        lf_coverage_after: lfCoverageNow,
        difficulty_drift: {
          easy: { before: lastSnap?.difficulty_easy_pct ?? easyPct, after: easyPct },
          medium: { before: lastSnap?.difficulty_medium_pct ?? medPct, after: medPct },
          hard: { before: lastSnap?.difficulty_hard_pct ?? hardPct, after: hardPct },
        },
        flags,
        drift_detected: driftDetected,
        auto_held: autoHeld,
        findings: flags.map(f => ({ flag: f, severity: driftDetected ? "critical" : "warning" })),
      });

      results.push({
        package_id: pkg.id,
        title: pkg.title,
        sampled: sampleSize,
        confidence_drift: confDrift,
        drift_detected: driftDetected,
        auto_held: autoHeld,
        flags,
      });
    }

    // Update config timing
    const nextRun = new Date();
    nextRun.setDate(nextRun.getDate() + config.cycle_days);
    await sb
      .from("deep_audit_config")
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextRun.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    console.log(`[DeepAudit] Audited ${results.length} packages, ${results.filter(r => r.drift_detected).length} drift detected`);

    return json({
      ok: true,
      audited: results.length,
      drift_count: results.filter(r => r.drift_detected).length,
      auto_held: results.filter(r => r.auto_held).length,
      results,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[DeepAudit] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
