import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";

/**
 * package-validate-handbook — Pipeline Step (after generate_handbook)
 *
 * Structural quality gate for handbook chapters/sections:
 *   - Min 3 chapters
 *   - Each chapter has ≥ 1 section
 *   - Section content_markdown ≥ 200 chars
 *   - No placeholder text remaining ("_Wird durch Council ergänzt._", "[TODO]", etc.)
 *   - Sections have heading structure (## or ###)
 *   - Contamination guard
 *   - Depth enrichment check (curriculum_topics referenced)
 *
 * No LLM needed — handbook is structural + template-based.
 */

const MIN_CHAPTERS = 3;
const MIN_SECTION_LENGTH = 200;
const PLACEHOLDER_PATTERNS = [
  "_Wird durch Council",
  "_Beschreibung folgt",
  "[TODO]",
  "Lorem ipsum",
  "Platzhalter",
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
    if (meta?.depth_enriched) {
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
    await sb.from("ops_alerts").insert({
      source: "validate-handbook",
      severity: "warning",
      message: `Handbook QC failed for pkg ${packageId.slice(0, 8)}: ${passed}/${results.length} passed, ${placeholderCount} placeholders`,
      payload: { packageId, pass_rate: passRate, placeholder_count: placeholderCount, chapter_issues: chapterIssues },
    }).then(() => {}).catch(() => {});
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
