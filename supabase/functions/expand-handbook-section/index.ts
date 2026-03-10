import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover, logLLMCostEvent } from "../_shared/ai-client.ts";
import { shouldSoftStop, getTimeBudget } from "../_shared/time-budget.ts";
import { getModelChain } from "../_shared/model-routing.ts";

/**
 * expand-handbook-section — Depth expansion for a single handbook section.
 *
 * Phase B of the Handbook architecture:
 * - Reads existing basis_content
 * - Enriches with examples, exam relevance, transfer, misconceptions
 * - Writes to expanded_content (basis_content is NEVER modified)
 * - Uses heavy models (Pro/GPT-5) — own 55s edge window
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
const MIN_EXPANDED_IMPROVEMENT = 1.2; // expanded must be ≥120% of basis
const MAX_EXPAND_ATTEMPTS = 6;

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

Deno.serve(async (req) => {
  const startMs = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const sectionId = p?.section_id as string;
  const packageId = p?.package_id as string;

  if (!sectionId || !packageId) {
    return json({ error: "section_id and package_id required" }, 400);
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

  // Guard: only expand sections with valid basis
  const basisContent = section.basis_content as string;
  if (!basisContent || basisContent.length < MIN_BASIS_CHARS) {
    // Mark as not_ready and skip
    await sb.from("handbook_sections").update({
      expand_status: "not_ready",
    }).eq("id", sectionId);
    return json({ ok: true, skipped: true, reason: "basis_content too short" });
  }

  // Guard: max attempts
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

  // 2) Resolve profession name for prompt context
  let professionName = "Ausbildungsberuf";
  try {
    // Get curriculum_id from chapter → handbook_chapters
    const { data: chapter } = await sb
      .from("handbook_chapters")
      .select("curriculum_id")
      .eq("id", section.chapter_id)
      .maybeSingle();
    if (chapter?.curriculum_id) {
      const { data: curr } = await sb
        .from("curricula")
        .select("profession_name")
        .eq("id", chapter.curriculum_id)
        .maybeSingle();
      if (curr?.profession_name) professionName = curr.profession_name as string;
    }
  } catch { /* fallback */ }

  // 3) Call heavy model for expansion
  const expandChain = getModelChain("handbook");
  // Prefer heavy models (Pro/GPT-5), exclude Flash for depth
  const heavyModels = expandChain.filter(c => !c.model.includes("flash"));
  const chain = heavyModels.length > 0 ? heavyModels : expandChain;

  const sectionTitle = (section.title as string) || (section.section_key as string) || "Abschnitt";

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
          content: `Du bist ein IHK-Prüfungscoach und Fachbuchautor für "${professionName}". Du vertiefst bestehende Handbuch-Abschnitte auf Elite-Niveau. Antworte NUR mit dem vollständigen, erweiterten Markdown-Text. Keine Meta-Kommentare, keine Erklärungen.`,
        },
        {
          role: "user",
          content: `Erweitere den folgenden Handbuch-Abschnitt "${sectionTitle}" auf Elite-Prüfungsniveau.\n\nPFLICHT-ERWEITERUNGEN:\n1. Mindestens 3 durchgerechnete Praxisbeispiele mit vollständigem Lösungsweg\n2. Mindestens 5 konkrete Prüfungsfallen mit Erklärung, warum Prüflinge sie falsch beantworten\n3. Mindestens 2 Musteraufgaben im IHK-Stil mit detailliertem Lösungsweg\n4. "So denkt der Prüfer"-Hinweise für jeden Themenschwerpunkt\n5. Typische Fehlvorstellungen und warum sie falsch sind\n6. Transferbeispiele: Wie wendet man das Wissen in der betrieblichen Praxis an?\n7. Merkschemata, Eselsbrücken oder Checklisten zur Prüfungsvorbereitung\n8. Differenzierung: Verwandte Begriffe klar voneinander abgrenzen\n\nREGELN:\n- Den bestehenden Inhalt NICHT kürzen oder zusammenfassen\n- Alle bestehenden Informationen BEHALTEN und ERGÄNZEN\n- Strukturierte Markdown-Formatierung verwenden\n- Mindestens 50% mehr Inhalt als der Originaltext\n\nBESTEHENDER TEXT:\n\n${basisContent}`,
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
      // Expansion didn't add enough — keep basis, mark as failed_soft
      await sb.from("handbook_sections").update({
        expand_status: "failed_soft",
        expand_last_error: `Expansion too short: ${expanded.length} vs basis ${basisContent.length}`,
        expand_provider: result.provider,
        expand_model: result.model,
      }).eq("id", sectionId);

      return json({
        ok: true,
        expanded: false,
        reason: "expansion_insufficient",
        basis_chars: basisContent.length,
        expanded_chars: expanded.length,
      });
    }

    // Score depth markers
    const { score, markers } = scoreDepthMarkers(expanded);

    // 4) Write expanded_content — basis_content stays untouched
    const { error: updateErr } = await sb.from("handbook_sections").update({
      expanded_content: expanded,
      content_markdown: expanded, // materialized output = best available
      content_tier: "expanded",
      expand_status: "done",
      expanded_at: new Date().toISOString(),
      expand_provider: result.provider,
      expand_model: result.model,
      quality_score: score,
      depth_markers: markers,
      expand_last_error: null,
    }).eq("id", sectionId);

    if (updateErr) throw updateErr;

    console.log(`[expand-handbook-section] ${sectionTitle}: ${basisContent.length} → ${expanded.length} chars, depth_score=${score}%, provider=${result.provider}`);

    return json({
      ok: true,
      expanded: true,
      section_id: sectionId,
      basis_chars: basisContent.length,
      expanded_chars: expanded.length,
      improvement_pct: Math.round((expanded.length / basisContent.length - 1) * 100),
      depth_score: score,
      depth_markers: markers,
      provider: result.provider,
      model: result.model,
    });

  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[expand-handbook-section] Failed for ${sectionTitle}: ${msg}`);

    await sb.from("handbook_sections").update({
      expand_status: "failed_soft",
      expand_last_error: msg.slice(0, 500),
    }).eq("id", sectionId);

    return json({
      ok: false,
      error: msg.slice(0, 300),
      section_id: sectionId,
    }, 500);
  }
});
