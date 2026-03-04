import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * work-generate-product (formerly berufski-generate-product)
 *
 * Generates structured content_json for an ExamFit@work product (tier 9/19/29).
 */

interface SSOTContext {
  beruf: Record<string, unknown> | null;
  curriculum: Record<string, unknown> | null;
  learningFields: Array<Record<string, unknown>>;
  competencies: Array<Record<string, unknown>>;
  professionProfile: Record<string, unknown> | null;
  blueprintSamples: Array<Record<string, unknown>>;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightRequest(req);
  if (preflight) return preflight;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  }

  try {
    const { berufskiId, tier } = await req.json();
    if (!berufskiId || !tier) {
      return new Response(JSON.stringify({ error: "berufskiId and tier required" }), { status: 400, headers });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 1) Load Work Beruf ──
    const { data: bkBeruf, error: bkErr } = await sb
      .from("work_berufe")
      .select("*")
      .eq("id", berufskiId)
      .single();

    if (bkErr || !bkBeruf) {
      return new Response(JSON.stringify({ error: "Beruf nicht gefunden" }), { status: 404, headers });
    }

    // ── 2) Gather SSOT context from ExamFit ──
    const ssot = await gatherSSOTContext(sb, bkBeruf);

    // ── 3) Build tier-specific prompt ──
    const systemPrompt = buildSystemPrompt(bkBeruf, ssot, tier);
    const userPrompt = buildUserPrompt(bkBeruf, tier);

    // ── 4) Generate structured content ──
    const aiResp = await callAIJSON({
      provider: "lovable",
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: tier === "29" ? 8192 : tier === "19" ? 6144 : 4096,
      temperature: 0.7,
    });

    // ── 5) Parse JSON response ──
    let contentJson: unknown;
    try {
      const raw = aiResp.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      contentJson = JSON.parse(raw.slice(jsonStart, jsonEnd + 1).replace(/,\s*([\]}])/g, "$1"));
    } catch {
      return new Response(JSON.stringify({ error: "AI response parse error", raw: aiResp.content?.slice(0, 500) }), { status: 500, headers });
    }

    // ── 6) Upsert product ──
    const titel = `KI im Berufsalltag – ${bkBeruf.name}`;
    const tierLabel = tier === "29" ? "Komplettsystem" : tier === "19" ? "Praxisleitfaden" : "Prompt Guide";

    const { data: product, error: insertErr } = await sb
      .from("work_produkte")
      .upsert({
        beruf_id: berufskiId,
        tier,
        titel: `${titel} (${tierLabel})`,
        content_json: contentJson,
        status: "generated",
        generation_model: "google/gemini-2.5-flash",
        landing_headline: `KI-${tierLabel} für ${bkBeruf.name}`,
        landing_subline: `Spare 3–7 Stunden pro Woche durch berufsspezifische KI-Workflows`,
        meta_title: `KI für ${bkBeruf.name} – ${tierLabel} | ExamFit@work`,
        meta_description: `${tierLabel} mit ${tier === "9" ? "50+" : tier === "19" ? "50+ Prompts & 10 Praxisfällen" : "50+ Prompts, 10 Praxisfällen & DSGVO-Leitfaden"} für ${bkBeruf.name}. Sofort einsetzbar.`,
      }, { onConflict: "beruf_id,tier" })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[work-generate] DB error:", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers });
    }

    return new Response(JSON.stringify({
      ok: true,
      productId: product?.id,
      tier,
      beruf: bkBeruf.name,
      ssotEnriched: {
        hasExamFitBeruf: !!ssot.beruf,
        learningFieldCount: ssot.learningFields.length,
        competencyCount: ssot.competencies.length,
        hasProfessionProfile: !!ssot.professionProfile,
        blueprintSampleCount: ssot.blueprintSamples.length,
      },
    }), { headers });

  } catch (e) {
    console.error("[work-generate] Error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers });
  }
});

// ─────────────────────────────────────────────────────────────
// SSOT Context Gathering
// ─────────────────────────────────────────────────────────────

async function gatherSSOTContext(sb: ReturnType<typeof createClient>, bkBeruf: Record<string, unknown>): Promise<SSOTContext> {
  const ctx: SSOTContext = {
    beruf: null, curriculum: null, learningFields: [], competencies: [],
    professionProfile: null, blueprintSamples: [],
  };

  const curriculumId = bkBeruf.examfit_curriculum_id as string | null;
  if (!curriculumId) return ctx;

  const [currRes, profileRes] = await Promise.all([
    sb.from("curricula").select("id, title, beruf_id, status").eq("id", curriculumId).maybeSingle(),
    sb.from("profession_profiles").select("profile, profession_name").eq("beruf_id", curriculumId).maybeSingle(),
  ]);

  ctx.curriculum = currRes.data;

  const berufId = (currRes.data as any)?.beruf_id;
  if (berufId) {
    const [berufRes, profileByBerufRes] = await Promise.all([
      sb.from("berufe").select("bezeichnung_kurz, bezeichnung_lang, zustaendigkeit, ausbildungsdauer_monate, taetigkeitsprofil, einsatzgebiete").eq("id", berufId).maybeSingle(),
      sb.from("profession_profiles").select("profile, profession_name").eq("beruf_id", berufId).maybeSingle(),
    ]);
    ctx.beruf = berufRes.data;
    ctx.professionProfile = profileByBerufRes.data || profileRes.data;
  } else {
    ctx.professionProfile = profileRes.data;
  }

  const { data: lfs } = await sb.from("learning_fields").select("id, code, title, exam_part, sort_order").eq("curriculum_id", curriculumId).order("sort_order").limit(20);
  ctx.learningFields = lfs || [];

  if (lfs?.length) {
    const lfIds = lfs.map((lf: any) => lf.id);
    const { data: comps } = await sb.from("competencies").select("id, code, title, learning_field_id").in("learning_field_id", lfIds).limit(100);
    ctx.competencies = comps || [];
  }

  const { data: blueprints } = await sb.from("question_blueprints").select("canonical_statement, knowledge_type, cognitive_level, question_template").eq("curriculum_id", curriculumId).limit(15);
  ctx.blueprintSamples = blueprints || [];

  return ctx;
}

// ─────────────────────────────────────────────────────────────
// Prompt Building with SSOT Enrichment
// ─────────────────────────────────────────────────────────────

function buildSystemPrompt(bkBeruf: Record<string, unknown>, ssot: SSOTContext, tier: string): string {
  const name = bkBeruf.name as string;

  let dnaSection = `
## Berufs-DNA
Beruf: ${name}
Branche: ${bkBeruf.branche || "k.A."}
Typische Aufgaben: ${(bkBeruf.typische_aufgaben as string[] || []).join(", ") || "k.A."}
Dokumenttypen: ${(bkBeruf.dokumenttypen as string[] || []).join(", ") || "k.A."}
Pain Points: ${(bkBeruf.pain_points as string[] || []).join(", ") || "k.A."}
Haftungsrisiken: ${(bkBeruf.haftungsrisiken as string[] || []).join(", ") || "k.A."}
Digitalisierungsgrad: ${bkBeruf.digitalisierungsgrad || "k.A."}`;

  let ssotSection = "";

  if (ssot.beruf) {
    const b = ssot.beruf as any;
    ssotSection += `

## ExamFit Berufsdaten (SSOT)
Offizielle Bezeichnung: ${b.bezeichnung_kurz} (${b.bezeichnung_lang || ""})
Zuständigkeit: ${b.zustaendigkeit}
Ausbildungsdauer: ${b.ausbildungsdauer_monate} Monate
Tätigkeitsprofil: ${(b.taetigkeitsprofil || "").slice(0, 600)}`;
    if (b.einsatzgebiete) {
      ssotSection += `
Einsatzgebiete: ${JSON.stringify(b.einsatzgebiete).slice(0, 300)}`;
    }
  }

  if (ssot.learningFields.length) {
    ssotSection += `

## Lernfelder aus dem Rahmenlehrplan (${ssot.learningFields.length} Felder)`;
    for (const lf of ssot.learningFields) {
      const l = lf as any;
      ssotSection += `
- ${l.code}: ${l.title}${l.exam_part ? ` (${l.exam_part})` : ""}`;
    }
  }

  if (ssot.competencies.length) {
    ssotSection += `

## Kompetenzen (${ssot.competencies.length} aus dem Curriculum)`;
    const grouped = new Map<string, string[]>();
    for (const c of ssot.competencies) {
      const comp = c as any;
      const lfId = comp.learning_field_id;
      if (!grouped.has(lfId)) grouped.set(lfId, []);
      grouped.get(lfId)!.push(`${comp.code}: ${comp.title}`);
    }
    for (const [lfId, comps] of grouped) {
      const lf = ssot.learningFields.find((l: any) => l.id === lfId) as any;
      ssotSection += `
${lf?.code || "?"}: ${comps.slice(0, 5).join("; ")}`;
    }
  }

  if (ssot.professionProfile) {
    const pp = (ssot.professionProfile as any).profile;
    if (pp) {
      ssotSection += `

## Berufsprofil (IHK-Expertise)`;
      if (pp.typical_task_types) ssotSection += `
Typische Aufgabentypen: ${pp.typical_task_types.join(", ")}`;
      if (pp.term_strictness) ssotSection += `
Fachbegriff-Strenge: ${pp.term_strictness} – ${pp.term_strictness_rationale || ""}`;
      if (pp.exam_style_hints) ssotSection += `
Prüfungsstil: ${pp.exam_style_hints.slice(0, 3).join("; ")}`;
      if (pp.common_error_patterns) {
        ssotSection += `
Häufige Fehler: ${pp.common_error_patterns.slice(0, 5).map((e: any) => `${e.error} (${e.domain})`).join("; ")}`;
      }
      if (pp.industry_context) {
        const ic = pp.industry_context;
        if (ic.key_regulations) ssotSection += `
Relevante Vorschriften: ${ic.key_regulations.join(", ")}`;
        if (ic.digital_tools) ssotSection += `
Digitale Tools: ${ic.digital_tools.join(", ")}`;
      }
    }
  }

  if (ssot.blueprintSamples.length) {
    ssotSection += `

## Echte Prüfungsmuster (Blueprint-Beispiele)`;
    for (const bp of ssot.blueprintSamples.slice(0, 8)) {
      const b = bp as any;
      ssotSection += `
- [${b.knowledge_type}/${b.cognitive_level}] ${b.canonical_statement?.slice(0, 120)}`;
      if (b.question_template) ssotSection += ` → Template: "${b.question_template.slice(0, 80)}"`;
    }
  }

  const tierStructure = getTierStructure(tier);

  return `Du bist ein Fachautor für KI-Anwendungen im Beruf "${name}" in Deutschland.
Du erstellst ein strukturiertes, berufsspezifisches KI-Praxisprodukt.

WICHTIG: Nutze die SSOT-Daten (Lernfelder, Kompetenzen, Prüfungsmuster, Berufsprofil), um die Prompts und Praxisfälle EXAKT auf die realen beruflichen Anforderungen zuzuschneiden.
Jeder Prompt und jedes Fallbeispiel MUSS einen direkten Bezug zu konkreten Lernfeldern, Kompetenzen oder Tätigkeitsbereichen dieses Berufs haben.

${dnaSection}
${ssotSection}

## Produkt-Struktur (Tier ${tier}€)
${tierStructure}

## Output-Format
Liefere ein JSON-Objekt mit der folgenden Struktur. Jedes Kapitel ist ein Objekt mit "title", "type" (text|prompts|cases|checklist|table|workflow), und "content" (Array von Items).
Prompts müssen Objekte sein: {\"prompt\": \"...\", \"context\": \"...\", \"expected_output\": \"...\", \"lernfeld_ref\": \"...\"}
Praxisfälle: {\"title\": \"...\", \"situation\": \"...\", \"ki_loesung\": \"...\", \"zeitersparnis_min\": number, \"kompetenz_ref\": \"...\"}

KEINE generischen Inhalte. ALLES muss spezifisch für ${name} sein.`;
}

function buildUserPrompt(bkBeruf: Record<string, unknown>, tier: string): string {
  return `Erstelle jetzt das vollständige KI-Praxisprodukt für "${bkBeruf.name}" im Tier ${tier}€.
Orientiere dich strikt an den Lernfeldern und Kompetenzen aus dem Rahmenlehrplan.
Jeder Prompt muss einen konkreten Arbeitsschritt oder eine typische Berufssituation adressieren.`;
}

function getTierStructure(tier: string): string {
  if (tier === "9") {
    return `Prompt Guide (9€):
1. Einführung: KI im Berufsalltag (kurz)
2. 50 berufsspezifische Prompts (gruppiert nach Lernfeldern/Tätigkeitsbereichen)
3. Quick-Start Checkliste
4. 5 häufige Fehler beim Prompten`;
  }
  if (tier === "19") {
    return `Praxisleitfaden (19€):
1. Einführung: Berufsrealität & KI-Potential
2. Zeitfresser-Analyse (berufsspezifisch)
3. 50+ berufsspezifische Prompts (gruppiert nach Kompetenzbereichen)
4. 10 Praxisfälle mit Lösung (an Lernfeldern orientiert)
5. Entscheidungslogiken & Workflows
6. DSGVO-Sicherheitsleitfaden
7. Zeitersparnis-Berechnung`;
  }
  return `Komplettsystem (29€):
1. Einführung: Berufsrealität & digitale Transformation
2. Zeitfresser-Analyse (detailliert, datenbasiert)
3. 50+ berufsspezifische Prompts (gruppiert nach Kompetenzbereichen mit Lernfeld-Referenz)
4. 10 ausführliche Praxisfälle mit Lösung (an Lernfeldern + Kompetenzen orientiert)
5. Entscheidungslogiken & Workflows (visuell beschrieben)
6. DSGVO & Compliance Leitfaden (berufsspezifische Risiken)
7. Zeitersparnis-Berechnung & ROI
8. KI-Werkzeugkasten: Tool-Empfehlungen
9. Cheat Sheets & Quick Reference
10. Zusammenfassung + 30-Tage-Plan`;
}
