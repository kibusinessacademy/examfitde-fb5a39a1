import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";

/**
 * package-validate-handbook — Pipeline Step (after generate_handbook)
 *
 * Structural quality gate for handbook chapters/sections.
 * 
 * ANTI-LOOP PROTECTION: If this step has been retried ≥ 10 times,
 * it resets generate_handbook to 'queued' to force re-generation,
 * rather than retrying validation indefinitely.
 */

const MIN_CHAPTERS = 3;
const MIN_SECTION_LENGTH = 200;
const MAX_RETRIES_BEFORE_REGEN = 10;
const PLACEHOLDER_PATTERNS = [
  "_Wird durch Council",
  "_Beschreibung folgt",
  "[TODO]",
  "Lorem ipsum",
  "Platzhalter",
  "Council ergänzt",
  "Council/LLM",
  "Blueprint-Analyse ergänzt",
  "Curriculum-Analyse ergänzt",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface SectionResult {
  sectionId: string;
  title: string;
  passed: boolean;
  issues: string[];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;

  if (!packageId || !curriculumId) return json({ error: "Missing package_id or curriculum_id" }, 400);

  // ── ANTI-LOOP: Check how many times this job has been attempted ──
  const { data: jobData } = await sb
    .from("job_queue")
    .select("attempts")
    .eq("job_type", "package_validate_handbook")
    .contains("payload", { package_id: packageId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const attempts = jobData?.attempts || 0;

  if (attempts >= MAX_RETRIES_BEFORE_REGEN) {
    console.log(`[validate-handbook] Anti-loop: ${attempts} attempts exceeded threshold. Resetting generate_handbook for re-generation.`);
    
    // Reset generate_handbook step to force content re-generation
    await sb
      .from("package_steps")
      .update({ status: "queued", job_id: null, started_at: null, last_heartbeat_at: null })
      .eq("package_id", packageId)
      .eq("step_key", "generate_handbook");

    // Also reset this validation step
    await sb
      .from("package_steps")
      .update({ status: "queued", job_id: null, started_at: null, last_heartbeat_at: null })
      .eq("package_id", packageId)
      .eq("step_key", "validate_handbook");

    // Cancel the current job to prevent further retries
    await sb
      .from("job_queue")
      .update({ status: "cancelled", last_error: "Anti-loop: forcing handbook re-generation" })
      .eq("job_type", "package_validate_handbook")
      .contains("payload", { package_id: packageId })
      .in("status", ["pending", "processing"]);

    return json({
      ok: false,
      anti_loop: true,
      message: `Anti-loop triggered after ${attempts} attempts. generate_handbook reset for re-generation.`,
    });
  }

  // Resolve profession
  let professionName: string;
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  // Load chapters
  const { data: chapters, error: chErr } = await sb
    .from("handbook_chapters")
    .select("id, title, sort_order")
    .eq("curriculum_id", curriculumId)
    .order("sort_order", { ascending: true });

  if (chErr) return json({ error: chErr.message }, 500);

  if (!chapters || chapters.length < MIN_CHAPTERS) {
    return json({
      ok: false,
      message: `❌ Handbook QC: Nur ${chapters?.length || 0}/${MIN_CHAPTERS} Kapitel vorhanden.`,
    });
  }

  // Load all sections
  const chapterIds = chapters.map((c: any) => c.id);
  const { data: sections, error: secErr } = await sb
    .from("handbook_sections")
    .select("id, title, content_markdown, content_type, chapter_id, metadata")
    .in("chapter_id", chapterIds);

  if (secErr) return json({ error: secErr.message }, 500);
  if (!sections || sections.length === 0) {
    return json({ ok: false, message: "❌ Handbook QC: Keine Sektionen gefunden." });
  }

  console.log(`[validate-handbook] Validating ${chapters.length} chapters, ${sections.length} sections for ${professionName} (pkg ${packageId.slice(0, 8)})`);

  // Check each chapter has sections
  const chapterIssues: string[] = [];
  for (const ch of chapters) {
    const chSections = sections.filter((s: any) => s.chapter_id === ch.id);
    if (chSections.length === 0) {
      chapterIssues.push(`CHAPTER_EMPTY: ${ch.title}`);
    }
  }

  // Validate each section
  const results: SectionResult[] = [];
  let placeholderCount = 0;
  let depthEnrichedCount = 0;

  for (const sec of sections) {
    const issues: string[] = [];
    const md = sec.content_markdown || "";

    // Length check
    if (md.length < MIN_SECTION_LENGTH) {
      issues.push(`CONTENT_TOO_SHORT: ${md.length}/${MIN_SECTION_LENGTH}`);
    }

    // Placeholder check
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (md.includes(pattern)) {
        issues.push(`PLACEHOLDER_FOUND: "${pattern}"`);
        placeholderCount++;
        break;
      }
    }

    // Heading structure
    if (!md.includes("##") && !md.includes("###")) {
      issues.push("NO_HEADING_STRUCTURE");
    }

    // Depth enrichment check
    const meta = sec.metadata as any;
    if (meta?.depth_enriched || meta?.llm_generated) {
      depthEnrichedCount++;
    }

    // Content has actual topic-specific bullet points (not just template)
    const bulletCount = (md.match(/^[-•]\s/gm) || []).length;
    if (bulletCount < 2 && md.length > 300) {
      issues.push("NO_BULLET_POINTS_IN_LONG_SECTION");
    }

    // Contamination
    const contam = checkContamination(md.slice(0, 5000), professionName);
    if (contam.isContaminated) {
      issues.push(`CONTAMINATION: ${contam.detectedIndustry} [${contam.matchedTerms.slice(0, 3).join(", ")}]`);
    }

    results.push({ sectionId: sec.id, title: sec.title, passed: issues.length === 0, issues });
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const passRate = (passed / results.length) * 100;
  const depthRate = (depthEnrichedCount / results.length) * 100;

  console.log(`[validate-handbook] ${passed}/${results.length} sections passed (${passRate.toFixed(1)}%), depth: ${depthRate.toFixed(0)}%`);

  // Placeholder ratio determines severity
  const placeholderRate = (placeholderCount / results.length) * 100;
  const overallPass = passRate >= 60 && placeholderRate <= 30 && chapterIssues.length === 0;

  if (!overallPass) {
    // Rate-limit alerts: only one per 10 minutes
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recentAlerts } = await sb
      .from("ops_alerts")
      .select("id")
      .eq("source", "validate-handbook")
      .gte("created_at", since)
      .ilike("message", `%${packageId.slice(0, 8)}%`)
      .limit(1);

    if (!recentAlerts?.length) {
      await sb.from("ops_alerts").insert({
        source: "validate-handbook",
        severity: "warning",
        message: `Handbook QC failed for pkg ${packageId.slice(0, 8)}: ${passed}/${results.length} passed, ${placeholderCount} placeholders (attempt ${attempts})`,
        payload: { packageId, pass_rate: passRate, placeholder_count: placeholderCount, chapter_issues: chapterIssues, attempt: attempts },
      }).then(() => {}).catch(() => {});
    }
  }

  return json({
    ok: overallPass,
    batch_complete: overallPass,
    chapters: chapters.length,
    sections: {
      total: results.length,
      passed,
      failed,
      pass_rate: passRate,
      placeholder_count: placeholderCount,
      depth_enriched: depthEnrichedCount,
      depth_rate: depthRate,
    },
    chapter_issues: chapterIssues,
    failures: results.filter(r => !r.passed).slice(0, 15),
    message: overallPass
      ? `✅ Handbook QC bestanden: ${passed}/${results.length} Sektionen (${passRate.toFixed(0)}%), ${depthEnrichedCount} mit Tiefe`
      : `❌ Handbook QC fehlgeschlagen: ${passed}/${results.length} (${passRate.toFixed(0)}%), ${placeholderCount} Platzhalter`,
  });
});
