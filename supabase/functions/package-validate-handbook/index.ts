import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { getContentProfile } from "../_shared/track-content-profiles.ts";
import { resolveIntegrityProfile, getValidationPolicy, buildValidatorMeta } from "../_shared/validation/learning-content-policy.ts";
import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";

/**
 * package-validate-handbook — Pipeline Step (after generate_handbook)
 *
 * Structural + content quality gate for handbook chapters/sections.
 * 
 * v2: Hardened against heading-only / placeholder content.
 * Detects sections that contain only markdown headings but no prose.
 *
 * ANTI-LOOP PROTECTION: If this step has been retried ≥ 10 times,
 * it resets generate_handbook to 'queued' to force re-generation.
 */

/**
 * v4: Phase-aware thresholds — aligned with write-guard and post-conditions.
 * Basis pass validates at write-guard thresholds (800/500).
 * Sections that pass basis validation unlock the expand pipeline.
 * Elite thresholds (2000/1500) are enforced by validate_handbook_depth AFTER expansion.
 */
const MIN_CHAPTERS = 3;
const MIN_SECTION_LENGTH = 800;         // v4: aligned with write-guard MIN_SECTION_CONTENT_CHARS (was 2000)
const MIN_PROSE_LENGTH = 500;           // v4: aligned with write-guard MIN_SECTION_PROSE_CHARS (was 1500)
const MIN_SECTION_WORD_COUNT = 120;     // v4: realistic for basis (was 400)
const MIN_HANDBOOK_TOTAL_CHARS = 8000;  // v4: basis floor for ~10 sections × 800 (was 60000)
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
  "_(kein Inhalt)_",
  "_(nicht verfügbar)_",
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

/** Strip all markdown headings and return only prose text */
function extractProse(md: string): string {
  return md
    .split("\n")
    .filter(line => !line.match(/^#{1,6}\s/) && line.trim().length > 0)
    .join("\n")
    .trim();
}

/** Check if content is essentially just headings with no real prose */
function isHeadingOnly(md: string): boolean {
  const lines = md.split("\n").filter(l => l.trim().length > 0);
  if (lines.length === 0) return true;
  const headingLines = lines.filter(l => l.match(/^#{1,6}\s/));
  // If >80% of non-empty lines are headings, it's heading-only
  return headingLines.length / lines.length > 0.8;
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
    
    await sb
      .from("package_steps")
      .update({ status: "queued", job_id: null, started_at: null, last_heartbeat_at: null })
      .eq("package_id", packageId)
      .eq("step_key", "generate_handbook");

    await sb
      .from("package_steps")
      .update({ status: "queued", job_id: null, started_at: null, last_heartbeat_at: null })
      .eq("package_id", packageId)
      .eq("step_key", "validate_handbook");

    await sb
      .from("job_queue")
      .update({ status: "cancelled", last_error: "Anti-loop: forcing handbook re-generation" })
      .eq("job_type", "package_validate_handbook")
      .contains("payload", { package_id: packageId })
      .in("status", ["pending", "processing"]);

    await finalizeStepFailed(sb, packageId, "validate_handbook", new Error(`Anti-loop triggered after ${attempts} attempts`));
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

  // ── Resolve track profile for content-style validation ──
  const { data: pkgTrackRow } = await sb.from("course_packages").select("track").eq("id", packageId).maybeSingle();
  const track = (pkgTrackRow as any)?.track ?? "AUSBILDUNG_VOLL";
  const profile = getContentProfile(track);
  const integrityProfile = resolveIntegrityProfile({ track });
  const policy = getValidationPolicy(integrityProfile);
  const isAcademic = profile.handbook.type === "learning_script";
  const trackWarnings: string[] = [];

  // ── INCOMPLETE GUARD: Check if handbook generation is still in progress ──
  // SSOT: Use chapters as expected count, NOT learning_fields.
  // A handbook may have fewer chapters than learning fields (e.g. 5 chapters for 10 LFs,
  // where each chapter covers 2 LFs). Using learning_fields would create an unreachable threshold.
  // Chapters are the structural unit; sections belong to chapters.

  // Load chapters
  const { data: chapters, error: chErr } = await sb
    .from("handbook_chapters")
    .select("id, title, sort_order")
    .eq("curriculum_id", curriculumId)
    .order("sort_order", { ascending: true });

  if (chErr) return json({ error: chErr.message }, 500);

  if (!chapters || chapters.length < MIN_CHAPTERS) {
    await finalizeStepFailed(sb, packageId, "validate_handbook", new Error(`Nur ${chapters?.length || 0}/${MIN_CHAPTERS} Kapitel`));
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
    await finalizeStepFailed(sb, packageId, "validate_handbook", new Error("Keine Sektionen gefunden"));
    return json({ ok: false, message: "❌ Handbook QC: Keine Sektionen gefunden." });
  }

  // ── INCOMPLETE GUARD: If sections << expected chapters, handbook is still being generated ──
  // Compare against chapter count (not learning_fields count) to avoid Multi-LF false positives
  const actualSections = sections.length;
  const expectedFromChapters = chapters.length;
  const INCOMPLETE_THRESHOLD = 0.8; // need at least 80% of expected chapters covered
  const minSectionsNeeded = Math.ceil(expectedFromChapters * INCOMPLETE_THRESHOLD);
  if (actualSections < minSectionsNeeded) {
    console.log(`[validate-handbook] INCOMPLETE: ${actualSections}/${expectedFromChapters} sections (need ${minSectionsNeeded}). Requeue without alert.`);
    return json({
      ok: false,
      retry: true,
      batch_complete: false,
      incomplete: true,
      actual_sections: actualSections,
      expected_sections: expectedFromChapters,
      message: `⏳ Handbook incomplete: ${actualSections}/${expectedFromChapters} sections. Waiting for generator.`,
    }, 409);
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
  let headingOnlyCount = 0;
  let depthEnrichedCount = 0;

  for (const sec of sections) {
    const issues: string[] = [];
    const md = sec.content_markdown || "";

    // ── NEW: Empty/null content check ──
    if (!md || md.trim().length === 0) {
      issues.push("CONTENT_EMPTY");
      results.push({ sectionId: sec.id, title: sec.title, passed: false, issues });
      continue;
    }

    // ── NEW: Heading-only detection ──
    if (isHeadingOnly(md)) {
      issues.push("HEADING_ONLY: Section contains only headings, no prose content");
      headingOnlyCount++;
    }

    // ── NEW: Prose length check (ignoring headings) ──
    const prose = extractProse(md);
    if (prose.length < MIN_PROSE_LENGTH) {
      issues.push(`PROSE_TOO_SHORT: ${prose.length}/${MIN_PROSE_LENGTH} chars (excluding headings)`);
    }

    // ── NEW: Word count check ──
    const sectionWordCount = prose.split(/\s+/).filter((w: string) => w.length > 0).length;
    if (sectionWordCount < MIN_SECTION_WORD_COUNT) {
      issues.push(`WORD_COUNT_TOO_LOW: ${sectionWordCount}/${MIN_SECTION_WORD_COUNT} words`);
    }

    // Total length check (original)
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

    // Heading structure (only relevant if there's actual content)
    if (prose.length >= MIN_PROSE_LENGTH && !md.includes("##") && !md.includes("###")) {
      issues.push("NO_HEADING_STRUCTURE");
    }

    // Depth enrichment check
    const meta = sec.metadata as any;
    if (meta?.depth_enriched || meta?.llm_generated) {
      depthEnrichedCount++;
    }

    // Content has actual topic-specific bullet points or list items (not just template)
    // Match -, •, *, numbered lists (1. / 1) ), and markdown task lists
    const bulletCount = (md.match(/^(\s*[-•*]\s|^\s*\d+[.)]\s|^\s*- \[[ x]\])/gm) || []).length;
    if (bulletCount < 2 && prose.length > 300) {
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

  // ── V3: Track-aware content-style validation ──
  const trackContentWarnings: string[] = [];
  const allContent = (sections as any[]).map(s => s.content_markdown || "").join("\n");

  // Policy-driven structural checks
  for (const reqSection of policy.handbook.requiredSections) {
    if (!reqSection.pattern.test(allContent)) {
      const code = isAcademic
        ? `STUDIUM_NO_${reqSection.label.toUpperCase().replace(/[/\s]+/g, "_")}`
        : `VOCATIONAL_NO_${reqSection.label.toUpperCase().replace(/[/\s]+/g, "_")}`;
      trackContentWarnings.push(`${code}: Kein(e) ${reqSection.label} gefunden`);
    }
  }

  // Policy-driven contamination check
  for (const term of policy.handbook.contaminationTerms) {
    if (new RegExp(term, "i").test(allContent)) {
      const code = isAcademic ? "STUDIUM_IHK_CONTAMINATION" : "VOCATIONAL_ACADEMIC_CONTAMINATION";
      trackContentWarnings.push(`${code}: Track-fremder Begriff "${term}" in Handbuch`);
      break; // one contamination warning is enough
    }
  }

  if (trackContentWarnings.length > 0) {
    console.log(`[validate-handbook] Track content warnings (${track}): ${trackContentWarnings.join(", ")}`);
  }

  console.log(`[validate-handbook] ${passed}/${results.length} sections passed (${passRate.toFixed(1)}%), depth: ${depthRate.toFixed(0)}%, heading-only: ${headingOnlyCount}, track=${track}`);

  // ── Determine overall pass ──
  const placeholderRate = (placeholderCount / results.length) * 100;
  const headingOnlyRate = (headingOnlyCount / results.length) * 100;
  
  // Total handbook character count check
  const totalHandbookChars = (sections as any[]).reduce((sum, s) => sum + (s.content_markdown || '').length, 0);
  const handbookSizePass = totalHandbookChars >= MIN_HANDBOOK_TOTAL_CHARS;
  
  const overallPass = passRate >= 60 
    && placeholderRate <= 30 
    && headingOnlyRate <= 10
    && handbookSizePass
    && chapterIssues.length === 0;

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
      try {
        await sb.from("ops_alerts").insert({
          source: "validate-handbook",
          severity: headingOnlyRate > 50 || !handbookSizePass ? "critical" : "warning",
          message: `Handbook QC failed for pkg ${packageId.slice(0, 8)}: ${passed}/${results.length} passed, ${placeholderCount} placeholders, ${headingOnlyCount} heading-only, total=${totalHandbookChars} chars (min ${MIN_HANDBOOK_TOTAL_CHARS}) (attempt ${attempts})`,
          payload: { packageId, pass_rate: passRate, placeholder_count: placeholderCount, heading_only_count: headingOnlyCount, total_chars: totalHandbookChars, chapter_issues: chapterIssues, attempt: attempts },
        });
      } catch (_e) { /* best-effort */ }
    }
  }

  // SSOT Finalization
  if (overallPass) {
    await finalizeStepDone(sb, packageId, "validate_handbook", {
      pass_rate: passRate, sections_total: results.length, sections_passed: passed,
      total_handbook_chars: totalHandbookChars, depth_enriched: depthEnrichedCount,
    });
  } else {
    await finalizeStepFailed(sb, packageId, "validate_handbook", new Error(`Handbook QC: ${passed}/${results.length} passed`), {
      pass_rate: passRate, placeholder_count: placeholderCount, heading_only_count: headingOnlyCount,
    });
  }

  return json({
    ok: overallPass,
    batch_complete: overallPass,
    track,
    handbook_type: profile.handbook.type,
    chapters: chapters.length,
    sections: {
      total: results.length,
      passed,
      failed,
      pass_rate: passRate,
      placeholder_count: placeholderCount,
      heading_only_count: headingOnlyCount,
      heading_only_rate: headingOnlyRate,
      depth_enriched: depthEnrichedCount,
      depth_rate: depthRate,
      total_handbook_chars: totalHandbookChars,
      min_handbook_chars: MIN_HANDBOOK_TOTAL_CHARS,
    },
    chapter_issues: chapterIssues,
    track_content_warnings: trackContentWarnings,
    policy_meta: buildValidatorMeta(policy, trackContentWarnings),
    failures: results.filter(r => !r.passed).slice(0, 15),
    message: overallPass
      ? `✅ Handbook QC bestanden: ${passed}/${results.length} Sektionen (${passRate.toFixed(0)}%), ${depthEnrichedCount} mit Tiefe, ${totalHandbookChars} Zeichen [${profile.handbook.type}]`
      : `❌ Handbook QC fehlgeschlagen: ${passed}/${results.length} (${passRate.toFixed(0)}%), ${placeholderCount} Platzhalter, ${headingOnlyCount} heading-only, ${totalHandbookChars}/${MIN_HANDBOOK_TOTAL_CHARS} Zeichen [${profile.handbook.type}]`,
  });
});
