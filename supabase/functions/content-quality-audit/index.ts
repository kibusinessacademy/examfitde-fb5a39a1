import { createClient } from "jsr:@supabase/supabase-js@2";
import { runContentAudit, type AuditInput } from "../_shared/content-audit-engine.ts";
import type { ContentAuditResult } from "../_shared/content-audit-types.ts";
import { normalizeTrack } from "../_shared/audit-profiles.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type FindingInsert = {
  audit_run_id: string;
  package_id: string;
  curriculum_id?: string | null;
  course_id?: string | null;
  artifact_type: string;
  artifact_id: string;
  severity: string;
  status: string;
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

  // ── Run-Lock: reject if another audit is already running ──
  const { data: existingRun } = await sb
    .from("content_quality_audit_runs")
    .select("id, started_at")
    .eq("scope", "published_packages")
    .eq("status", "running")
    .maybeSingle();

  if (existingRun) {
    return json(409, {
      ok: false,
      error: "AUDIT_ALREADY_RUNNING",
      run_id: existingRun.id,
      started_at: existingRun.started_at,
    });
  }

  // Create audit run
  const { data: run, error: runError } = await sb
    .from("content_quality_audit_runs")
    .insert({ scope: "published_packages", status: "running", meta: { detector_version: "v3", engine: "track-aware-hardened" } })
    .select("id")
    .single();

  if (runError || !run) {
    return json(500, { ok: false, error: runError?.message });
  }

  const runId = run.id;

  try {
    // Get published packages — track comes from SSOT (DB), not from request
    const { data: packages, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, curriculum_id, course_id, status, track")
      .eq("status", "published");

    if (pkgErr) throw pkgErr;

    let artifactCount = 0;
    let findingCount = 0;
    let criticalCount = 0;
    let errorCount = 0;
    let warningCount = 0;

    for (const pkg of packages ?? []) {
      // SSOT: Track from DB, normalized through audit-profiles
      const track = normalizeTrack(pkg.track);
      const findings: FindingInsert[] = [];

      // ── Scan handbook sections (content lives here, not in chapters) ──
      if (pkg.curriculum_id) {
        // Get chapter IDs for this curriculum
        const { data: chapterIds } = await sb
          .from("handbook_chapters")
          .select("id")
          .eq("curriculum_id", pkg.curriculum_id);

        const chIds = (chapterIds ?? []).map((c: any) => c.id);

        if (chIds.length > 0) {
          let from = 0;
          while (true) {
            const { data: sections } = await sb
              .from("handbook_sections")
              .select("id, title, content_markdown, expanded_content, basis_content, chapter_id, competency_id, learning_field_id, content_tier, verification_score, verification_missing")
              .in("chapter_id", chIds)
              .order("id", { ascending: true })
              .range(from, from + 499);

            if (!sections || sections.length === 0) break;
            for (const sec of sections) {
              artifactCount++;
              // Use best available content: expanded > basis > content_markdown
              const content = sec.expanded_content || sec.basis_content || sec.content_markdown || "";
              const result = runContentAudit({
                track,
                artifact_type: "handbook_section",
                artifact_id: sec.id,
                curriculum_id: pkg.curriculum_id,
                competency_id: sec.competency_id,
                learning_field_id: sec.learning_field_id,
                title: sec.title,
                content,
                meta: {
                  content_tier: sec.content_tier,
                  verification_score: sec.verification_score,
                  verification_missing: sec.verification_missing,
                },
              });
              if (result.audit_status !== "approved") {
                findings.push(resultToFinding(runId, pkg, "handbook_section", sec.id, sec.title, content, result));
              }
            }
            if (sections.length < 500) break;
            from += 500;
          }
        }
      }

      // ── Scan lessons (paginated) ──
      if (pkg.curriculum_id) {
        let from = 0;
        while (true) {
          const { data: lessons } = await sb
            .from("lessons")
            .select("id, title, content, competency_id, learning_field_id")
            .eq("curriculum_id", pkg.curriculum_id)
            .order("id", { ascending: true })
            .range(from, from + 499);

          if (!lessons || lessons.length === 0) break;
          for (const ls of lessons) {
            artifactCount++;
            const result = runContentAudit({
              track,
              artifact_type: "lesson",
              artifact_id: ls.id,
              curriculum_id: pkg.curriculum_id,
              competency_id: (ls as any).competency_id ?? null,
              learning_field_id: (ls as any).learning_field_id ?? null,
              title: ls.title,
              content: ls.content,
            });
            if (result.audit_status !== "approved") {
              findings.push(resultToFinding(runId, pkg, "lesson", ls.id, ls.title, ls.content, result));
            }
          }
          if (lessons.length < 500) break;
          from += 500;
        }
      }

      // ── Dedup: close old open/rehealing findings for artifacts we're re-scanning ──
      if (findings.length > 0) {
        const artifactIds = [...new Set(findings.map(f => f.artifact_id))];
        for (let i = 0; i < artifactIds.length; i += 100) {
          const chunk = artifactIds.slice(i, i + 100);
          await sb
            .from("content_quality_audit_findings")
            .update({ status: "resolved", resolved_at: new Date().toISOString() } as any)
            .eq("package_id", pkg.id)
            .in("artifact_id", chunk)
            .in("status", ["open", "rehealing"]);
        }

        // Batch insert new findings
        for (let i = 0; i < findings.length; i += 50) {
          const batch = findings.slice(i, i + 50);
          const { error: insErr } = await sb
            .from("content_quality_audit_findings")
            .insert(batch);
          if (insErr) throw insErr;
        }
      }

      for (const f of findings) {
        findingCount++;
        if (f.severity === "critical") criticalCount++;
        else if (f.severity === "error") errorCount++;
        else if (f.severity === "warning") warningCount++;
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
      info_count: 0,
    }).eq("id", runId);

    return json(200, {
      ok: true, run_id: runId,
      engine: "track-aware-v3-hardened",
      package_count: packages?.length ?? 0,
      artifact_count: artifactCount,
      finding_count: findingCount,
      critical_count: criticalCount,
      error_count: errorCount,
      warning_count: warningCount,
    });
  } catch (e) {
    await sb.from("content_quality_audit_runs").update({
      status: "failed", finished_at: new Date().toISOString(),
      meta: { error: String(e), engine: "track-aware-v3-hardened" },
    }).eq("id", runId);

    return json(500, { ok: false, error: String(e), run_id: runId });
  }
});

// ── Helpers ──

function severityFromAuditResult(result: ContentAuditResult): string {
  const rank: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };
  return result.flags.reduce<string>((worst, f) => {
    return (rank[f.severity] ?? 3) < (rank[worst] ?? 3) ? f.severity : worst;
  }, "info");
}

function resultToFinding(
  runId: string,
  pkg: { id: string; curriculum_id: string | null; course_id: string | null },
  artifactType: string,
  artifactId: string,
  title: string | null,
  content: string | null,
  result: ContentAuditResult,
): FindingInsert {
  const severity = severityFromAuditResult(result);
  const spellingFlags = result.flags.filter(f => f.code === "SPELLING_ERRORS");

  return {
    audit_run_id: runId,
    package_id: pkg.id,
    curriculum_id: pkg.curriculum_id,
    course_id: pkg.course_id,
    artifact_type: artifactType,
    artifact_id: artifactId,
    severity,
    status: "open",
    title,
    excerpt: String(content ?? "").replace(/<[^>]+>/g, " ").slice(0, 300),
    generic_phrase_count: result.generic_score,
    spelling_error_count: spellingFlags.length,
    generic_ratio: result.generic_score / 100,
    generic_phrases: result.flags.filter(f => f.layer === "C").map(f => f.message),
    spelling_errors: spellingFlags.map(f => f.message),
    detector_version: "v3-track-aware-hardened",
    auto_reheal_eligible: (severity === "critical" || severity === "error")
      && ["lesson", "handbook_section", "tutor_snippet"].includes(artifactType),
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
  const errorC = open.filter((x: any) => x.severity === "error").length;
  const warning = open.filter((x: any) => x.severity === "warning").length;

  const overallSeverity =
    critical > 0 ? "critical" : errorC > 0 ? "error" : warning > 0 ? "warning" : "info";

  await sb.from("package_content_quality_summary").upsert({
    package_id: packageId,
    last_audit_run_id: runId,
    last_scanned_at: new Date().toISOString(),
    open_findings: open.length,
    critical_count: critical,
    error_count: errorC,
    warning_count: warning,
    info_count: 0,
    handbook_critical_count: open.filter((x: any) => x.severity === "critical" && x.artifact_type === "handbook_chapter").length,
    lesson_critical_count: open.filter((x: any) => x.severity === "critical" && x.artifact_type === "lesson").length,
    overall_severity: overallSeverity,
    reheal_recommended: critical > 0 || errorC >= 3,
  }, { onConflict: "package_id" });
}
