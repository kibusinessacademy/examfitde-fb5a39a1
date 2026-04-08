import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover, logLLMCostEvent } from "../_shared/ai-client.ts";
import { shouldSoftStop, getTimeBudget } from "../_shared/time-budget.ts";
import { getModelChain } from "../_shared/model-routing.ts";
import { resolvePersonaProfile, PERSONA_CONFIGS } from "../_shared/persona-profiles.ts";
import { HANDBOOK_REQUIREMENTS, verifyContentQuality } from "../_shared/didactic-requirements.ts";

/**
 * expand-handbook-section — Depth expansion for a single handbook section.
 *
 * v2: P3-hardened — injects exam questions + competency context for real depth.
 *     Uses persona-aware prompts and post-generation verification (Guardrail B).
 *
 * Phase B of the Handbook architecture:
 * - Reads existing basis_content
 * - Enriches with examples, exam relevance, transfer, misconceptions
 * - Writes to expanded_content (basis_content is NEVER modified)
 *
 * SSOT Rules:
 * - NEVER creates new sections (only generate_handbook does that)
 * - NEVER deletes or clears basis_content
 * - NEVER modifies chapter structure
 * - expand_status tracks: pending → expanding → done | failed_soft
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const MIN_BASIS_CHARS = 800;
const MIN_EXPANDED_IMPROVEMENT = 1.2;
const MAX_EXPAND_ATTEMPTS = 6;
const MAX_CONTEXT_QUESTIONS = 5;
const MAX_CONTEXT_COMPETENCIES = 8;

// Depth markers to check for quality scoring
const DEPTH_MARKERS = [
  { key: "examples", pattern: /beispiel|berechnungsbeispiel|praxisbeispiel|fallbeispiel/i },
  { key: "exam_traps", pattern: /prüfungsfalle|prüfungsfallen|typische fehler|häufige fehler/i },
  { key: "sample_tasks", pattern: /musteraufgabe|musterlösung|lösungsweg|aufgabe.*lösung/i },
  { key: "mnemonics", pattern: /merke|merkregel|eselsbrücke|checkliste/i },
  { key: "transfer", pattern: /transfer|praxisbezug|anwendung|betriebliche praxis/i },
  { key: "misconceptions", pattern: /fehlvorstellung|misconception|irrtum|verwechsl/i },
  { key: "exam_relevance", pattern: /prüfungsrelevant|prüfungswissen|ihk.*prüfung/i },
  { key: "differentiation", pattern: /unterschied|abgrenzung|vergleich|gegenüberstellung/i },
];

function scoreDepthMarkers(content: string): { score: number; markers: Record<string, boolean> } {
  const markers: Record<string, boolean> = {};
  let found = 0;
  for (const m of DEPTH_MARKERS) {
    const present = m.pattern.test(content);
    markers[m.key] = present;
    if (present) found++;
  }
  return { score: Math.round((found / DEPTH_MARKERS.length) * 100), markers };
}

/**
 * P3: Load real exam questions for this section's learning field.
 * Provides concrete examples of what the exam actually asks.
 */
async function loadSectionExamContext(
  sb: any,
  curriculumId: string,
  learningFieldId: string | null,
): Promise<string[]> {
  if (!learningFieldId) return [];
  try {
    const { data } = await sb
      .from("exam_questions")
      .select("question_text, difficulty")
      .eq("curriculum_id", curriculumId)
      .eq("learning_field_id", learningFieldId)
      .in("status", ["approved", "tier1_passed"])
      .order("elite_score", { ascending: false })
      .limit(MAX_CONTEXT_QUESTIONS);
    return (data || []).map((q: any) =>
      `[${(q.difficulty || "mittel").toUpperCase()}] ${(q.question_text || "").slice(0, 200)}`
    ).filter(Boolean);
  } catch { return []; }
}

/**
 * P3: Load competencies for this section's learning field.
 * Provides bloom levels and misconceptions for targeted depth.
 */
async function loadSectionCompetencies(
  sb: any,
  learningFieldId: string | null,
): Promise<Array<{ name: string; bloom: string; misconception: string }>> {
  if (!learningFieldId) return [];
  try {
    const { data } = await sb
      .from("competencies")
      .select("competency_name, bloom_level, typical_misconceptions")
      .eq("learning_field_id", learningFieldId)
      .limit(MAX_CONTEXT_COMPETENCIES);
    return (data || []).map((c: any) => ({
      name: c.competency_name || "",
      bloom: c.bloom_level || "understand",
      misconception: Array.isArray(c.typical_misconceptions) && c.typical_misconceptions.length > 0
        ? c.typical_misconceptions[0] : "",
    }));
  } catch { return []; }
}

Deno.serve(async (req) => {
  const startMs = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const sectionId = p?.section_id as string;
  const packageId = p?.package_id as string;

  if (!packageId) {
    return json({ error: "package_id required" }, 400);
  }

  // Fan-out guard
  if (!sectionId) {
    console.log(`[expand-handbook-section] Fan-out guard call (no section_id) for package ${packageId.slice(0, 8)}`);
    return json({ ok: true, fan_out_skipped: true, batch_complete: true });
  }

  // 1) Load section with basis_content
  const { data: section, error: secErr } = await sb
    .from("handbook_sections")
    .select("id, basis_content, expanded_content, expand_status, expand_attempts, title, section_key, chapter_id, learning_field_id")
    .eq("id", sectionId)
    .maybeSingle();

  if (secErr || !section) {
    return json({ error: `Section not found: ${secErr?.message || sectionId}` }, 404);
  }

  const basisContent = section.basis_content as string;
  if (!basisContent || basisContent.length < MIN_BASIS_CHARS) {
    await sb.from("handbook_sections").update({
      expand_status: "not_ready",
    }).eq("id", sectionId);
    return json({ ok: true, skipped: true, reason: "basis_content too short" });
  }

  const attempts = (section.expand_attempts as number) || 0;
  if (attempts >= MAX_EXPAND_ATTEMPTS) {
    await sb.from("handbook_sections").update({
      expand_status: "failed_soft",
      expand_last_error: `Max attempts (${MAX_EXPAND_ATTEMPTS}) reached`,
    }).eq("id", sectionId);
    return json({ ok: true, skipped: true, reason: "max_attempts_reached" });
  }

  // Mark as expanding
  await sb.from("handbook_sections").update({
    expand_status: "expanding",
    expand_attempts: attempts + 1,
  }).eq("id", sectionId);

  // 2) Resolve profession name, persona, and curriculum context
  let professionName = "Ausbildungsberuf";
  let curriculumId = "";
  let persona = resolvePersonaProfile({});
  try {
    const { data: chapter } = await sb
      .from("handbook_chapters")
      .select("curriculum_id")
      .eq("id", section.chapter_id)
      .maybeSingle();
    if (chapter?.curriculum_id) {
      curriculumId = chapter.curriculum_id;
      const { data: curr } = await sb
        .from("curricula")
        .select("profession_name")
        .eq("id", curriculumId)
        .maybeSingle();
      if (curr?.profession_name) professionName = curr.profession_name as string;

      // P6-prep: Resolve persona from package — prefer package_id (deterministic)
      const pkgQuery = packageId
        ? sb.from("course_packages").select("track, persona_profile").eq("id", packageId).maybeSingle()
        : sb.from("course_packages").select("track, persona_profile").eq("curriculum_id", curriculumId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const { data: pkg } = await pkgQuery;
      if (pkg) {
        persona = resolvePersonaProfile(pkg);
      }
    }
  } catch { /* fallback */ }

  // 3) P3: Load real exam + competency context (parallel)
  const learningFieldId = section.learning_field_id as string | null;
  const [examQuestions, competencies] = await Promise.all([
    loadSectionExamContext(sb, curriculumId, learningFieldId),
    loadSectionCompetencies(sb, learningFieldId),
  ]);

  // 4) Build persona-aware expansion prompt
  const personaConfig = PERSONA_CONFIGS[persona];
  const reqs = HANDBOOK_REQUIREMENTS[persona];
  const sectionTitle = (section.title as string) || (section.section_key as string) || "Abschnitt";

  let contextBlock = "";
  if (examQuestions.length > 0) {
    contextBlock += `\n\n## Echte Prüfungsfragen zu diesem Thema (Orientierung für Tiefe und Schwierigkeit)
${examQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

PFLICHT: Vertiefe den Abschnitt so, dass die obigen Prüfungsfragen mit dem Handbuch-Wissen beantwortbar sind.`;
  }
  if (competencies.length > 0) {
    const compLines = competencies.map(c => {
      const misc = c.misconception ? ` → Fehlvorstellung: "${c.misconception}"` : "";
      return `- ${c.name} [${c.bloom}]${misc}`;
    }).join("\n");
    contextBlock += `\n\n## Kompetenzen und typische Fehlvorstellungen
${compLines}

PFLICHT: Behandle die genannten Fehlvorstellungen EXPLIZIT im Text. Erkläre, warum sie falsch sind.`;
  }

  const expandChain = getModelChain("handbook");
  const heavyModels = expandChain.filter(c => !c.model.includes("flash"));
  const chain = heavyModels.length > 0 ? heavyModels : expandChain;

  try {
    if (shouldSoftStop(startMs, "handbook")) {
      throw new Error("SOFT_STOP: insufficient time budget");
    }

    const budget = getTimeBudget("handbook");
    const remainingMs = budget.softStopMs - (Date.now() - startMs);
    if (remainingMs < 20_000) {
      throw new Error("SOFT_STOP: <20s remaining");
    }

    const llmTimeoutMs = Math.max(20_000, Math.min(70_000, remainingMs - 5_000));
    const llmAbort = new AbortController();
    const llmTimer = setTimeout(() => llmAbort.abort(), llmTimeoutMs);

    const result = await callAIWithFailover(chain, {
      messages: [
        {
          role: "system",
          content: `Du bist ${personaConfig.role} für "${professionName}". Du vertiefst bestehende Handbuch-Abschnitte auf Elite-Niveau. Antworte NUR mit dem vollständigen, erweiterten Markdown-Text. Keine Meta-Kommentare, keine Erklärungen.`,
        },
        {
          role: "user",
          content: `Erweitere den folgenden Handbuch-Abschnitt "${sectionTitle}" auf Elite-${personaConfig.examLabel}-Niveau.
${contextBlock}

${reqs.expandDepthInstructions}

REGELN:
- Den bestehenden Inhalt NICHT kürzen oder zusammenfassen
- Alle bestehenden Informationen BEHALTEN und ERGÄNZEN
- Strukturierte Markdown-Formatierung verwenden
- Mindestens 50% mehr Inhalt als der Originaltext
${reqs.promptSuffix}

BESTEHENDER TEXT:

${basisContent}`,
        },
      ],
      max_tokens: 12288,
      signal: llmAbort.signal,
    }).finally(() => clearTimeout(llmTimer));

    // Log cost
    try {
      await logLLMCostEvent(sb, {
        job_type: "handbook_expand_section",
        provider: result.provider,
        model: result.model,
        tokens_in: result.usage?.input_tokens || 0,
        tokens_out: result.usage?.output_tokens || 0,
        package_id: packageId,
        estimatedUsage: result.estimatedUsage,
      });
    } catch { /* non-blocking */ }

    let expanded = (result.content || "").trim();
    expanded = expanded.replace(/^```(?:markdown)?\n?/g, "").replace(/\n?```$/g, "").trim();

    // Validate expansion quality
    if (expanded.length < basisContent.length * MIN_EXPANDED_IMPROVEMENT) {
      await sb.from("handbook_sections").update({
        expand_status: "failed_soft",
        expand_last_error: `Expansion too short: ${expanded.length} vs basis ${basisContent.length}`,
        expand_provider: result.provider,
        expand_model: result.model,
      }).eq("id", sectionId);

      return json({
        ok: true, expanded: false, reason: "expansion_insufficient",
        basis_chars: basisContent.length, expanded_chars: expanded.length,
      });
    }

    // Score depth markers
    const { score, markers } = scoreDepthMarkers(expanded);

    // Guardrail B: Verify against didactic requirements
    const verification = verifyContentQuality(expanded, persona);

    // 5) Write expanded_content + persist verification — basis_content stays untouched
    const { error: updateErr } = await sb.from("handbook_sections").update({
      expanded_content: expanded,
      content_markdown: expanded,
      content_tier: "expanded",
      expand_status: "done",
      expanded_at: new Date().toISOString(),
      expand_provider: result.provider,
      expand_model: result.model,
      quality_score: score,
      depth_markers: markers,
      expand_last_error: null,
      // Guardrail B: persist verification for audits
      verification_score: verification.score,
      verification_missing: verification.missing,
      verification_markers: verification.markers,
      verification_version: verification.version,
    }).eq("id", sectionId);

    if (updateErr) throw updateErr;

    console.log(`[expand-handbook-section] ${sectionTitle}: ${basisContent.length} → ${expanded.length} chars, depth=${score}%, verification=${verification.score}% (missing: ${verification.missing.join(", ") || "none"}), persona=${persona}, context: ${examQuestions.length}q/${competencies.length}c`);

    return json({
      ok: true, expanded: true, section_id: sectionId,
      basis_chars: basisContent.length, expanded_chars: expanded.length,
      improvement_pct: Math.round((expanded.length / basisContent.length - 1) * 100),
      depth_score: score, depth_markers: markers,
      verification_score: verification.score,
      verification_missing: verification.missing,
      persona, provider: result.provider, model: result.model,
      context_questions: examQuestions.length,
      context_competencies: competencies.length,
    });

  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[expand-handbook-section] Failed for ${sectionTitle}: ${msg}`);

    await sb.from("handbook_sections").update({
      expand_status: "failed_soft",
      expand_last_error: msg.slice(0, 500),
    }).eq("id", sectionId);

    return json({
      ok: true, expanded: false, soft_fail: true,
      error: msg.slice(0, 300), section_id: sectionId,
    });
  }
});
