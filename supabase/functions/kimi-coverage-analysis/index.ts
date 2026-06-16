/**
 * KIMI Coverage Intelligence
 * Identifies the 'done ≠ integrity_passed' packages and analyzes coverage gaps
 * per competency / question type / difficulty. Produces prioritized repair targets.
 * READ-ONLY.
 */
import {
  corsHeaders, getServiceClient, startSnapshot, finishSnapshot,
  persistFindings, callKimi, RESPONSE_SCHEMA_INSTRUCTIONS,
} from "../_shared/kimi-qil.ts";

const SYSTEM_PROMPT = `Du bist KIMI — Coverage Intelligence Auditor für ExamFit.
Du erhältst eine Liste von course_packages, die als 'done' markiert sind, aber integrity_passed=false haben.
Für jedes Paket bekommst du: Coverage-Snapshot, fehlende Kompetenzen, Frage-Stats, integrity_report.

Aufgabe:
1. Cluster die Pakete nach gemeinsamer Ursache (z.B. selbe Domain, selber Bildungsträger, selber Blueprint-Defekt).
2. Identifiziere die TOP-Hebel: Welche EINE Reparatur entsperrt die meisten Pakete?
3. Schlage konkrete Repair-Jobs vor (action_kind = 'enqueue_coverage_repair' | 'recalibrate_blueprint' | 'expand_question_pool' | 'manual_competency_review').
4. Schätze pro Empfehlung den Revenue-Impact (24.90 EUR pro Paket × erwartete Activations) in estimated_impact.

Du darfst NICHTS direkt reparieren oder enqueuen — nur analysieren und priorisieren.

${RESPONSE_SCHEMA_INSTRUCTIONS}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = getServiceClient();
  const t0 = Date.now();
  let snapshotId: string | null = null;

  try {
    // Find packages: status='done' but integrity_passed=false  → the real bottleneck
    const { data: stuckPackages, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, title, status, integrity_passed, integrity_report, certification_type, track, curriculum_id, blocked_reason, last_error")
      .eq("status", "done")
      .eq("integrity_passed", false)
      .limit(100);
    if (pkgErr) throw pkgErr;

    const packages = stuckPackages ?? [];

    const inputSummary = {
      stuck_done_packages: packages.length,
      window: "current_state",
    };

    snapshotId = await startSnapshot(sb, "coverage", inputSummary);

    if (packages.length === 0) {
      await finishSnapshot(sb, snapshotId, {
        status: "succeeded", finding_count: 0, recommendation_count: 0,
        duration_ms: Date.now() - t0,
        output_summary: { message: "no stuck-done packages — pipeline is clean" },
      });
      return new Response(JSON.stringify({ ok: true, snapshot_id: snapshotId, findings: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull per-package coverage info: question counts per competency
    const pkgIds = packages.map((p: any) => p.id);

    const { data: qStats } = await sb
      .from("exam_questions")
      .select("course_package_id, competency_id, difficulty, status")
      .in("course_package_id", pkgIds)
      .limit(5000);

    // Aggregate counts client-side (small)
    const statsByPkg: Record<string, { total: number; approved: number; byDifficulty: Record<string, number>; competencies: Set<string> }> = {};
    for (const q of qStats ?? []) {
      const pid = (q as any).course_package_id as string;
      if (!statsByPkg[pid]) statsByPkg[pid] = { total: 0, approved: 0, byDifficulty: {}, competencies: new Set() };
      statsByPkg[pid].total++;
      if ((q as any).status === "approved") statsByPkg[pid].approved++;
      const d = (q as any).difficulty ?? "unknown";
      statsByPkg[pid].byDifficulty[d] = (statsByPkg[pid].byDifficulty[d] ?? 0) + 1;
      if ((q as any).competency_id) statsByPkg[pid].competencies.add((q as any).competency_id);
    }

    const packagesWithStats = packages.map((p: any) => ({
      id: p.id,
      title: p.title,
      certification_type: p.certification_type,
      track: p.track,
      blocked_reason: p.blocked_reason,
      integrity_report: p.integrity_report,
      question_stats: statsByPkg[p.id]
        ? {
          total: statsByPkg[p.id].total,
          approved: statsByPkg[p.id].approved,
          byDifficulty: statsByPkg[p.id].byDifficulty,
          competency_count: statsByPkg[p.id].competencies.size,
        }
        : { total: 0, approved: 0, byDifficulty: {}, competency_count: 0 },
    }));

    const { result, tokens_input, tokens_output } = await callKimi(SYSTEM_PROMPT, {
      packages: packagesWithStats,
    });

    const { recCount } = await persistFindings(sb, snapshotId, "coverage", result.findings);

    await finishSnapshot(sb, snapshotId, {
      status: "succeeded",
      finding_count: result.findings.length,
      recommendation_count: recCount,
      tokens_input, tokens_output,
      duration_ms: Date.now() - t0,
      output_summary: { summary: result.summary, packages_analyzed: packages.length },
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
