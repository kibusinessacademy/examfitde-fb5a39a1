import { createClient } from "jsr:@supabase/supabase-js@2";
import { auditGenericContent } from "../_shared/generic-content-detector.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type FindingInsert = {
  audit_run_id: string;
  package_id: string;
  curriculum_id?: string | null;
  course_id?: string | null;
  artifact_type: string;
  artifact_id: string;
  severity: string;
  title?: string | null;
  excerpt?: string | null;
  generic_phrase_count: number;
  spelling_error_count: number;
  generic_ratio: number;
  generic_phrases: unknown;
  spelling_errors: unknown;
  detector_version: string;
  auto_reheal_eligible: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Create audit run
  const { data: run, error: runError } = await sb
    .from("content_quality_audit_runs")
    .insert({ scope: "published_packages", status: "running", meta: { detector_version: "v1" } })
    .select("id")
    .single();

  if (runError || !run) {
    return new Response(JSON.stringify({ ok: false, error: runError?.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const runId = run.id;

  try {
    // Get published packages
    const { data: packages, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, curriculum_id, course_id, status")
      .eq("status", "published");

    if (pkgErr) throw pkgErr;

    let artifactCount = 0;
    let findingCount = 0;
    let criticalCount = 0;
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    for (const pkg of packages ?? []) {
      const findings: FindingInsert[] = [];

      // ── Scan handbook chapters ──
      if (pkg.curriculum_id) {
        const { data: chapters } = await sb
          .from("handbook_chapters")
          .select("id, title, content")
          .eq("curriculum_id", pkg.curriculum_id)
          .order("id", { ascending: true });

        for (const ch of chapters ?? []) {
          artifactCount++;
          const r = auditGenericContent(ch.content ?? "", "handbook_chapter");
          if (r.severity !== "info") {
            findings.push(makeFinding(runId, pkg, "handbook_chapter", ch.id, ch.title, ch.content, r));
          }
        }
      }

      // ── Scan lessons ──
      if (pkg.curriculum_id) {
        const { data: lessons } = await sb
          .from("lessons")
          .select("id, title, content")
          .eq("curriculum_id", pkg.curriculum_id)
          .order("id", { ascending: true });

        for (const ls of lessons ?? []) {
          artifactCount++;
          const r = auditGenericContent(ls.content ?? "", "lesson");
          if (r.severity !== "info") {
            findings.push(makeFinding(runId, pkg, "lesson", ls.id, ls.title, ls.content, r));
          }
        }
      }

      // Batch insert findings
      if (findings.length > 0) {
        const { error: insErr } = await sb
          .from("content_quality_audit_findings")
          .insert(findings);
        if (insErr) throw insErr;
      }

      for (const f of findings) {
        findingCount++;
        if (f.severity === "critical") criticalCount++;
        else if (f.severity === "error") errorCount++;
        else if (f.severity === "warning") warningCount++;
        else infoCount++;
      }

      // Update package summary
      await upsertPackageSummary(sb, runId, pkg.id);
    }

    // Finalize run
    await sb.from("content_quality_audit_runs").update({
      status: "completed",
      finished_at: new Date().toISOString(),
      package_count: packages?.length ?? 0,
      artifact_count: artifactCount,
      finding_count: findingCount,
      critical_count: criticalCount,
      error_count: errorCount,
      warning_count: warningCount,
      info_count: infoCount,
    }).eq("id", runId);

    const result = {
      ok: true, run_id: runId,
      package_count: packages?.length ?? 0,
      artifact_count: artifactCount,
      finding_count: findingCount,
      critical_count: criticalCount, error_count: errorCount,
      warning_count: warningCount, info_count: infoCount,
    };

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await sb.from("content_quality_audit_runs").update({
      status: "failed", finished_at: new Date().toISOString(),
      meta: { error: String(e) },
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: false, error: String(e), run_id: runId }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function makeFinding(
  runId: string,
  pkg: { id: string; curriculum_id: string | null; course_id: string | null },
  artifactType: string,
  artifactId: string,
  title: string | null,
  content: string | null,
  r: ReturnType<typeof auditGenericContent>,
): FindingInsert {
  return {
    audit_run_id: runId,
    package_id: pkg.id,
    curriculum_id: pkg.curriculum_id,
    course_id: pkg.course_id,
    artifact_type: artifactType,
    artifact_id: artifactId,
    severity: r.severity,
    title,
    excerpt: String(content ?? "").replace(/<[^>]+>/g, " ").slice(0, 300),
    generic_phrase_count: r.genericPhraseCount,
    spelling_error_count: r.spellingErrors.length,
    generic_ratio: r.genericRatio,
    generic_phrases: r.genericPhrases,
    spelling_errors: r.spellingErrors,
    detector_version: "v1",
    auto_reheal_eligible: r.autoRehealEligible,
  };
}

async function upsertPackageSummary(sb: any, runId: string, packageId: string) {
  const { data: findings } = await sb
    .from("content_quality_audit_findings")
    .select("severity, artifact_type, status")
    .eq("package_id", packageId)
    .eq("status", "open");

  const open = findings ?? [];
  const critical = open.filter((x: any) => x.severity === "critical").length;
  const error = open.filter((x: any) => x.severity === "error").length;
  const warning = open.filter((x: any) => x.severity === "warning").length;
  const info = open.filter((x: any) => x.severity === "info").length;

  const handbookCritical = open.filter(
    (x: any) => x.severity === "critical" && x.artifact_type === "handbook_chapter"
  ).length;
  const lessonCritical = open.filter(
    (x: any) => x.severity === "critical" && x.artifact_type === "lesson"
  ).length;

  const overallSeverity =
    critical > 0 ? "critical" : error > 0 ? "error" : warning > 0 ? "warning" : "info";

  await sb.from("package_content_quality_summary").upsert({
    package_id: packageId,
    last_audit_run_id: runId,
    last_scanned_at: new Date().toISOString(),
    open_findings: open.length,
    critical_count: critical,
    error_count: error,
    warning_count: warning,
    info_count: info,
    handbook_critical_count: handbookCritical,
    lesson_critical_count: lessonCritical,
    overall_severity: overallSeverity,
    reheal_recommended: critical > 0 || error >= 3,
  }, { onConflict: "package_id" });
}
