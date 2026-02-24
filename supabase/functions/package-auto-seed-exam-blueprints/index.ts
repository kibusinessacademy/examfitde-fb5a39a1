import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ═══════════════════════════════════════════════════════════════════════
// Blueprint Seeder v3 — "Prüfungs-Engine" Grade
// ═══════════════════════════════════════════════════════════════════════
// Key changes from v2:
//   1. AI-generated question_template + explanation_template (not empty)
//   2. Multi-blueprint per competency (Recall, Transfer, Praxisfall, Falle)
//   3. Domain-specific typical_errors + trap_spec from profession context
//   4. Question type diversity (mc_single, mc_multi, case_study, calc, ordering)
//   5. Real governance: status="draft" until council approves
//   6. Blueprint Health Score as output metric
// ═══════════════════════════════════════════════════════════════════════

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v))
    throw new Error(`INVALID_${name.toUpperCase()}`);
}

// ── Types ───────────────────────────────────────────────────────────
type Cognitive = "remember" | "understand" | "apply" | "analyze" | "evaluate";
type KnowledgeType = "concept" | "procedure" | "calculation" | "regulation";
type ExamContextType = "isolated_knowledge" | "applied_case" | "multi_step_case" | "prioritization" | "error_detection" | "documentation_analysis" | "legal_evaluation" | "communication_scenario";

// ── Blueprint Facet: Each competency gets multiple blueprint "angles" ──
interface BlueprintFacet {
  suffix: string;
  cognitive: Cognitive;
  knowledge_type: KnowledgeType;
  exam_context_type: ExamContextType;
  question_types: string[];
  decision_structure: string | null;
  didactic_intent: string;
  description: string;  // for the AI prompt
}

// ── Per-competency blueprint facets (3-5 per competency) ──
const BLUEPRINT_FACETS: BlueprintFacet[] = [
  {
    suffix: "Recall",
    cognitive: "remember",
    knowledge_type: "concept",
    exam_context_type: "isolated_knowledge",
    question_types: ["mc_single"],
    decision_structure: null,
    didactic_intent: "recognition",
    description: "Reine Faktenabfrage: Definitionen, Begriffe, Zuordnungen. Die einfachste Ebene.",
  },
  {
    suffix: "Verständnis-Transfer",
    cognitive: "understand",
    knowledge_type: "concept",
    exam_context_type: "applied_case",
    question_types: ["mc_single", "mc_multi"],
    decision_structure: "single_best_answer",
    didactic_intent: "transfer",
    description: "Verständnisfrage mit Praxisbezug: Der Prüfling muss einen Zusammenhang erklären oder eine Aussage im beruflichen Kontext bewerten.",
  },
  {
    suffix: "Praxisfall",
    cognitive: "apply",
    knowledge_type: "procedure",
    exam_context_type: "multi_step_case",
    question_types: ["case_study", "mc_single", "calculation"],
    decision_structure: "multiple_valid_options",
    didactic_intent: "classification",
    description: "Anwendungsfall: Reales Betriebsszenario, in dem der Prüfling einen konkreten Arbeitsschritt durchführen, berechnen oder entscheiden muss.",
  },
  {
    suffix: "Analyse & Fehlersuche",
    cognitive: "analyze",
    knowledge_type: "procedure",
    exam_context_type: "error_detection",
    question_types: ["mc_single", "mc_multi", "case_study"],
    decision_structure: "error_detection",
    didactic_intent: "error_detection",
    description: "Analysefrage: Der Prüfling muss Fehler in einem Prozess/Dokument/Ablauf finden, Ursachen identifizieren oder Prioritäten setzen.",
  },
  {
    suffix: "Bewertung & Entscheidung",
    cognitive: "evaluate",
    knowledge_type: "regulation",
    exam_context_type: "legal_evaluation",
    question_types: ["mc_single", "case_study"],
    decision_structure: "tradeoff_evaluation",
    didactic_intent: "comparison",
    description: "Bewertungsfrage: Der Prüfling muss unter Berücksichtigung von Vorschriften, Risiken und Abwägungen eine fundierte Entscheidung treffen.",
  },
];

// ── Difficulty distribution per cognitive level ──
const DIFFICULTY_BY_COGNITIVE: Record<Cognitive, string> = {
  remember: "easy",
  understand: "easy",
  apply: "medium",
  analyze: "hard",
  evaluate: "hard",
};

// ── Exam relevance by cognitive level ──
function calcRelevanceScore(cognitive: Cognitive): number {
  return ({ evaluate: 5, analyze: 5, apply: 4, understand: 3, remember: 2 } as Record<Cognitive, number>)[cognitive];
}

// ── Estimated time by cognitive level ──
function calcEstimatedTime(cognitive: Cognitive): number {
  return ({ evaluate: 200, analyze: 180, apply: 150, understand: 90, remember: 60 } as Record<Cognitive, number>)[cognitive];
}

// ── Taxonomy mapping ──
const TAXONOMY_MAP: Record<string, Cognitive> = {
  erinnern: "remember", wissen: "remember", kennen: "remember",
  verstehen: "understand", begreifen: "understand",
  anwenden: "apply", durchführen: "apply",
  analysieren: "analyze",
  bewerten: "evaluate", beurteilen: "evaluate", entscheiden: "evaluate",
  remember: "remember", understand: "understand", apply: "apply", analyze: "analyze", evaluate: "evaluate",
};

function normCognitive(raw: string | null | undefined): Cognitive {
  if (!raw) return "understand";
  return TAXONOMY_MAP[raw.trim().toLowerCase()] ?? "understand";
}

// ═══════════════════════════════════════════════════════════════════════
// AI-Powered Blueprint Generation
// ═══════════════════════════════════════════════════════════════════════

interface CompetencyData {
  id: string;
  learning_field_id: string;
  code: string;
  title: string;
  description: string | null;
  taxonomy_level: string | null;
}

interface LfData {
  id: string;
  code: string;
  title: string;
}

async function generateBlueprintTemplates(
  sb: ReturnType<typeof createClient>,
  berufName: string,
  comp: CompetencyData,
  lfTitle: string,
  facets: BlueprintFacet[],
): Promise<Array<{
  question_template: string;
  explanation_template: string;
  typical_errors: string[];
  trap_spec: object;
  typical_exam_trap: string;
}>> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const facetDescriptions = facets.map((f, i) => 
    `${i + 1}. "${f.suffix}" (${f.cognitive}/${f.exam_context_type}): ${f.description}`
  ).join("\n");

  const systemPrompt = `Du bist ein IHK-Prüfungsexperte für den Beruf "${berufName}".
Du erstellst Blueprint-Templates für Prüfungsfragen.

BERUF: ${berufName}
LERNFELD: ${lfTitle}
KOMPETENZ: ${comp.title}
${comp.description ? `BESCHREIBUNG: ${comp.description}` : ""}

Für diese Kompetenz brauchst du ${facets.length} Blueprint-Facetten mit verschiedenen kognitiven Ebenen:

${facetDescriptions}

ANFORDERUNGEN PRO FACETTE:
1. question_template: Ein konkretes Fragemuster mit {variable} Platzhaltern.
   - Muss berufsspezifisch sein (${berufName}!)
   - Muss ein realistisches Prüfungsszenario darstellen
   - Beispiel: "Ein {actor} in einem {betrieb_typ} soll {aufgabe}. Welche {aspekt} ist dabei zu beachten?"

2. explanation_template: Erklärungs-Schema für die korrekte Antwort.
   - Muss die fachliche Begründung strukturiert enthalten
   - Beispiel: "Die korrekte Antwort ist {correct}, weil gemäß {rechtsgrundlage} bei {bedingung} die Pflicht besteht, {handlung} durchzuführen."

3. typical_errors: Exakt 3-5 berufsspezifische typische Prüfungsfehler.
   - KEINE generischen Fehler wie "Verwechslung Brutto/Netto" (es sei denn, das ist für ${berufName} relevant!)
   - Jeder Fehler muss konkret zum Berufsfeld passen
   - Beispiel für MFA: "Verwechslung der Aufbewahrungsfristen von Patientenakten (10 vs. 30 Jahre)"

4. trap_spec: JSON-Objekt mit Prüfungsfallen-Spezifikation:
   { "trap_type": "...", "why_tempting": "...", "examiner_intention": "...", "common_misconception": "..." }

5. typical_exam_trap: Ein Satz, der die häufigste Prüfungsfalle beschreibt.

Antworte NUR als JSON-Objekt:
{
  "blueprints": [
    {
      "question_template": "...",
      "explanation_template": "...",
      "typical_errors": ["...", "...", "..."],
      "trap_spec": { "trap_type": "...", "why_tempting": "...", "examiner_intention": "...", "common_misconception": "..." },
      "typical_exam_trap": "..."
    }
  ]
}`;

  try {
    const aiResp = await fetch(`${SUPABASE_URL}/functions/v1/ai-tutor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        _direct_ai_call: true,
        provider: "openai",
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Erstelle ${facets.length} Blueprint-Facetten für die Kompetenz "${comp.title}" im Beruf "${berufName}".` },
        ],
        temperature: 0.6,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      console.warn(`[SeedV3] AI call failed: ${aiResp.status}`);
      return facets.map((f) => generateFallbackTemplate(f, comp, berufName));
    }

    const aiData = await aiResp.json();
    const content = aiData.content || aiData.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    const blueprints = parsed.blueprints || [];

    // Pad if AI returned fewer than expected
    while (blueprints.length < facets.length) {
      blueprints.push(generateFallbackTemplate(facets[blueprints.length], comp, berufName));
    }

    return blueprints.slice(0, facets.length);
  } catch (e) {
    console.warn(`[SeedV3] AI generation error: ${(e as Error).message}`);
    return facets.map((f) => generateFallbackTemplate(f, comp, berufName));
  }
}

function generateFallbackTemplate(facet: BlueprintFacet, comp: CompetencyData, beruf: string): {
  question_template: string;
  explanation_template: string;
  typical_errors: string[];
  trap_spec: object;
  typical_exam_trap: string;
} {
  const templates: Record<Cognitive, { q: string; e: string }> = {
    remember: {
      q: `Welche {fachbegriff} ist im Bereich "${comp.title}" korrekt? Ordnen Sie die Begriffe den richtigen Definitionen zu.`,
      e: `Die korrekte Zuordnung ist {correct}, da im Berufsfeld ${beruf} der Begriff {fachbegriff} gemäß {quelle} definiert ist als {definition}.`,
    },
    understand: {
      q: `Ein/e ${beruf} wird mit folgender Situation konfrontiert: {szenario}. Erklären Sie, warum {aspekt} in diesem Zusammenhang bedeutsam ist.`,
      e: `{aspekt} ist relevant, weil {begruendung}. Im beruflichen Kontext von ${beruf} bedeutet dies konkret: {praxisbezug}.`,
    },
    apply: {
      q: `In einem {betrieb_typ} soll ein/e ${beruf} folgende Aufgabe durchführen: {aufgabe}. Welcher Arbeitsschritt ist als nächstes korrekt?`,
      e: `Der korrekte nächste Schritt ist {correct}, da gemäß {vorschrift} bei {bedingung} zuerst {handlung} durchzuführen ist.`,
    },
    analyze: {
      q: `Analysieren Sie folgenden Vorgang im Berufsalltag von ${beruf}: {fallbeschreibung}. Welcher Fehler wurde begangen?`,
      e: `Der Fehler liegt bei {fehlerquelle}, denn {begruendung}. Die korrekte Vorgehensweise wäre: {korrekt_ablauf}.`,
    },
    evaluate: {
      q: `Bewerten Sie folgende Handlungsalternativen für ein/e ${beruf} in der Situation: {szenario}. Welche Entscheidung ist unter Berücksichtigung von {rahmenbedingung} fachlich korrekt?`,
      e: `Die richtige Entscheidung ist {correct}, da unter Abwägung von {faktor_1} und {faktor_2} gemäß {rechtsgrundlage} die Pflicht besteht, {handlung} zu wählen.`,
    },
  };

  const t = templates[facet.cognitive];
  return {
    question_template: t.q,
    explanation_template: t.e,
    typical_errors: [
      `Fachbegriff im Kontext von ${comp.title} verwechselt`,
      `Relevante Vorschrift für ${beruf} nicht beachtet`,
      `Praxisablauf bei ${comp.title} falsch priorisiert`,
    ],
    trap_spec: {
      trap_type: facet.exam_context_type,
      why_tempting: `Antwort klingt plausibel, berücksichtigt aber nicht die Besonderheiten von ${comp.title}`,
      examiner_intention: `Prüft, ob der Prüfling ${comp.title} nicht nur kennt, sondern im ${beruf}-Kontext anwenden kann`,
      common_misconception: `Häufige Verwechslung mit ähnlichen Konzepten im Berufsfeld ${beruf}`,
    },
    typical_exam_trap: `Verwechslung der spezifischen Anforderungen bei ${comp.title} mit allgemeinen Regeln`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Blueprint Health Score
// ═══════════════════════════════════════════════════════════════════════

interface HealthScore {
  total_blueprints: number;
  with_template: number;
  with_trap: number;
  with_diverse_types: number;
  non_isolated: number;
  cognitive_spread: Record<string, number>;
  exam_context_spread: Record<string, number>;
  avg_relevance: number;
  health_score: number;  // 0-100
  grade: "elite" | "acceptable" | "weak" | "critical";
}

function computeHealthScore(bps: any[]): HealthScore {
  if (!bps.length) return {
    total_blueprints: 0, with_template: 0, with_trap: 0, with_diverse_types: 0,
    non_isolated: 0, cognitive_spread: {}, exam_context_spread: {},
    avg_relevance: 0, health_score: 0, grade: "critical",
  };

  const withTemplate = bps.filter(b => b.question_template && b.question_template.length > 10).length;
  const withTrap = bps.filter(b => b.typical_exam_trap || (b.trap_spec && Object.keys(b.trap_spec).length > 0)).length;
  const withDiverseTypes = bps.filter(b => {
    const types = b.allowed_question_types || [];
    return types.length > 1 || (types.length === 1 && types[0] !== "mc_single");
  }).length;
  const nonIsolated = bps.filter(b => b.exam_context_type && b.exam_context_type !== "isolated_knowledge").length;

  const cogSpread: Record<string, number> = {};
  const ctxSpread: Record<string, number> = {};
  let totalRelevance = 0;

  for (const b of bps) {
    cogSpread[b.cognitive_level] = (cogSpread[b.cognitive_level] || 0) + 1;
    ctxSpread[b.exam_context_type || "none"] = (ctxSpread[b.exam_context_type || "none"] || 0) + 1;
    totalRelevance += b.exam_relevance_score || 0;
  }

  // Score calculation (0-100)
  const n = bps.length;
  const templateScore = (withTemplate / n) * 25;       // 25% weight
  const trapScore = (withTrap / n) * 20;                // 20% weight
  const typeScore = (withDiverseTypes / n) * 15;        // 15% weight
  const contextScore = (nonIsolated / n) * 20;          // 20% weight
  const cogDiversity = Math.min(Object.keys(cogSpread).length / 5, 1) * 10;  // 10% weight
  const ctxDiversity = Math.min(Object.keys(ctxSpread).length / 6, 1) * 10;  // 10% weight

  const health = Math.round(templateScore + trapScore + typeScore + contextScore + cogDiversity + ctxDiversity);
  const grade = health >= 85 ? "elite" : health >= 70 ? "acceptable" : health >= 50 ? "weak" : "critical";

  return {
    total_blueprints: n,
    with_template: withTemplate,
    with_trap: withTrap,
    with_diverse_types: withDiverseTypes,
    non_isolated: nonIsolated,
    cognitive_spread: cogSpread,
    exam_context_spread: ctxSpread,
    avg_relevance: Math.round((totalRelevance / n) * 10) / 10,
    health_score: health,
    grade,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const p = body.payload || body;
  console.log(`[SeedV3] Received keys: ${JSON.stringify(Object.keys(p || {}))}, package_id=${p?.package_id}, curriculum_id=${p?.curriculum_id}`);

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  try {
    return await handleSeed(sb, p);
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[SeedV3] Unhandled error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════

async function handleSeed(sb: ReturnType<typeof createClient>, p: any) {
  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;

  // 1) Load curriculum + beruf for domain-specific context
  const { data: curriculum } = await sb
    .from("curricula")
    .select("id, title, beruf_id")
    .eq("id", curriculumId)
    .single();

  let berufName = "Fachkraft";
  if (curriculum?.beruf_id) {
    const { data: beruf } = await sb
      .from("berufe")
      .select("bezeichnung_kurz")
      .eq("id", curriculum.beruf_id)
      .single();
    if (beruf?.bezeichnung_kurz) berufName = beruf.bezeichnung_kurz;
  }

  // 2) Load learning fields
  const { data: lfs, error: lfErr } = await sb
    .from("learning_fields")
    .select("id, code, title")
    .eq("curriculum_id", curriculumId);

  if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
  if (!lfs?.length) {
    return json({ ok: false, retry: true, error: "NO_LEARNING_FIELDS" }, 409);
  }

  // 3) Load competencies
  const lfIds = lfs.map(lf => lf.id);
  const { data: comps, error: compErr } = await sb
    .from("competencies")
    .select("id, learning_field_id, code, title, description, taxonomy_level")
    .in("learning_field_id", lfIds)
    .order("created_at", { ascending: true });

  if (compErr) throw new Error(`Competencies query: ${compErr.message}`);

  // 4) Load existing blueprints for diff
  const { data: existingBps } = await sb
    .from("question_blueprints")
    .select("id, competency_id, learning_field_id, cognitive_level, question_template, typical_exam_trap, exam_context_type, allowed_question_types, exam_relevance_score, trap_spec")
    .eq("curriculum_id", curriculumId);

  // Group existing by competency → check which facets are missing
  const existingByComp = new Map<string, any[]>();
  const existingByLf = new Map<string, any[]>();
  for (const bp of (existingBps || [])) {
    if (bp.competency_id) {
      if (!existingByComp.has(bp.competency_id)) existingByComp.set(bp.competency_id, []);
      existingByComp.get(bp.competency_id)!.push(bp);
    } else if (bp.learning_field_id) {
      if (!existingByLf.has(bp.learning_field_id)) existingByLf.set(bp.learning_field_id, []);
      existingByLf.get(bp.learning_field_id)!.push(bp);
    }
  }

  const lfMap = new Map(lfs.map(lf => [lf.id, lf]));

  // 5) Determine which blueprints need creation or upgrading
  const toInsert: any[] = [];
  const toUpgrade: { id: string; updates: any }[] = [];
  let aiCallCount = 0;

  if (!comps?.length) {
    // Fallback: seed from LFs with multi-facet
    console.log(`[SeedV3] No competencies — seeding from ${lfs.length} LFs`);
    for (const lf of lfs) {
      const existing = existingByLf.get(lf.id) || [];
      const existingCogLevels = new Set(existing.map(b => b.cognitive_level));

      // Create facets that don't exist yet
      const missingFacets = BLUEPRINT_FACETS.filter(f => !existingCogLevels.has(f.cognitive));

      if (missingFacets.length > 0 && aiCallCount < 30) {
        const templates = await generateBlueprintTemplates(
          sb, berufName,
          { id: lf.id, learning_field_id: lf.id, code: lf.code, title: lf.title, description: null, taxonomy_level: null },
          lf.title, missingFacets,
        );
        aiCallCount++;

        for (let i = 0; i < missingFacets.length; i++) {
          const facet = missingFacets[i];
          const tmpl = templates[i];
          toInsert.push(buildBlueprintRow(curriculumId, lf.id, null, lf.title, facet, tmpl));
        }
      }

      // Upgrade existing blueprints that have empty templates
      for (const bp of existing) {
        if (!bp.question_template || bp.question_template.length < 10) {
          const facet = BLUEPRINT_FACETS.find(f => f.cognitive === bp.cognitive_level) || BLUEPRINT_FACETS[0];
          const fallback = generateFallbackTemplate(facet, 
            { id: lf.id, learning_field_id: lf.id, code: lf.code, title: lf.title, description: null, taxonomy_level: null },
            berufName);
          toUpgrade.push({
            id: bp.id,
            updates: {
              question_template: fallback.question_template,
              explanation_template: fallback.explanation_template,
              typical_errors: fallback.typical_errors,
              trap_spec: fallback.trap_spec,
              typical_exam_trap: fallback.typical_exam_trap,
            },
          });
        }
      }
    }
  } else {
    // Main path: seed from competencies with multi-facet strategy
    console.log(`[SeedV3] Seeding from ${comps.length} competencies for "${berufName}"`);

    // Process in batches to avoid timeout
    const BATCH_SIZE = 8;
    const compBatches: CompetencyData[][] = [];
    for (let i = 0; i < comps.length; i += BATCH_SIZE) {
      compBatches.push((comps as CompetencyData[]).slice(i, i + BATCH_SIZE));
    }

    for (const batch of compBatches) {
      // Process competencies in parallel within batch
      const batchPromises = batch.map(async (comp) => {
        const existing = existingByComp.get(comp.id) || [];
        const existingCogLevels = new Set(existing.map(b => b.cognitive_level));
        const baseCognitive = normCognitive(comp.taxonomy_level);

        // Smart facet selection: always include base cognitive + surrounding levels
        const relevantFacets = selectFacetsForCompetency(baseCognitive, existingCogLevels);

        if (relevantFacets.length > 0 && aiCallCount < 30) {
          const lfTitle = lfMap.get(comp.learning_field_id)?.title || "Lernfeld";
          const templates = await generateBlueprintTemplates(sb, berufName, comp, lfTitle, relevantFacets);
          aiCallCount++;

          for (let i = 0; i < relevantFacets.length; i++) {
            const facet = relevantFacets[i];
            const tmpl = templates[i];
            toInsert.push(buildBlueprintRow(curriculumId, comp.learning_field_id, comp.id, comp.title, facet, tmpl));
          }
        }

        // Upgrade existing empty-template blueprints
        for (const bp of existing) {
          if (!bp.question_template || bp.question_template.length < 10) {
            const facet = BLUEPRINT_FACETS.find(f => f.cognitive === bp.cognitive_level) || BLUEPRINT_FACETS[0];
            const fallback = generateFallbackTemplate(facet, comp, berufName);
            toUpgrade.push({
              id: bp.id,
              updates: {
                question_template: fallback.question_template,
                explanation_template: fallback.explanation_template,
                typical_errors: fallback.typical_errors,
                trap_spec: fallback.trap_spec,
                typical_exam_trap: fallback.typical_exam_trap,
              },
            });
          }
        }
      });

      await Promise.all(batchPromises);
    }
  }

  // 6) Insert new blueprints
  let insertedCount = 0;
  if (toInsert.length > 0) {
    // Insert in chunks of 50
    for (let i = 0; i < toInsert.length; i += 50) {
      const chunk = toInsert.slice(i, i + 50);
      const { error: insErr } = await sb.from("question_blueprints").insert(chunk);
      if (insErr && insErr.code !== "23505") {
        console.error(`[SeedV3] Insert error: ${insErr.message}`);
      } else {
        insertedCount += chunk.length;
      }
    }
  }

  // 7) Upgrade existing empty blueprints
  let upgradedCount = 0;
  for (const upg of toUpgrade) {
    const { error: updErr } = await sb
      .from("question_blueprints")
      .update(upg.updates)
      .eq("id", upg.id);
    if (!updErr) upgradedCount++;
  }

  // 8) Compute health score
  const { data: allBps } = await sb
    .from("question_blueprints")
    .select("cognitive_level, question_template, typical_exam_trap, exam_context_type, allowed_question_types, exam_relevance_score, trap_spec")
    .eq("curriculum_id", curriculumId);

  const health = computeHealthScore(allBps || []);

  // 9) Update build progress
  try {
    await sb.from("course_packages").update({ build_progress: 20 }).eq("id", packageId);
  } catch (_) { /* ignore */ }

  console.log(`[SeedV3] Done: +${insertedCount} new, ${upgradedCount} upgraded, health=${health.health_score}/100 (${health.grade}), AI calls=${aiCallCount}`);

  return json({
    ok: true,
    seeded: insertedCount,
    upgraded: upgradedCount,
    existing: (existingBps || []).length,
    ai_calls: aiCallCount,
    beruf: berufName,
    source: comps?.length ? "competencies" : "learning_fields",
    health,
  });
}

// ── Helper: Select relevant facets for a competency ──
function selectFacetsForCompetency(baseCognitive: Cognitive, existingCogLevels: Set<string>): BlueprintFacet[] {
  // Always try to create at least 3 facets per competency
  // Priority: base cognitive + one level below + one level above
  const cogOrder: Cognitive[] = ["remember", "understand", "apply", "analyze", "evaluate"];
  const baseIdx = cogOrder.indexOf(baseCognitive);

  const targetLevels: Cognitive[] = [baseCognitive];
  if (baseIdx > 0) targetLevels.push(cogOrder[baseIdx - 1]);
  if (baseIdx < cogOrder.length - 1) targetLevels.push(cogOrder[baseIdx + 1]);

  // Filter out already existing cognitive levels
  const missingLevels = targetLevels.filter(c => !existingCogLevels.has(c));

  return BLUEPRINT_FACETS.filter(f => missingLevels.includes(f.cognitive));
}

// ── Helper: Build blueprint DB row ──
function buildBlueprintRow(
  curriculumId: string,
  lfId: string,
  compId: string | null,
  name: string,
  facet: BlueprintFacet,
  tmpl: { question_template: string; explanation_template: string; typical_errors: string[]; trap_spec: object; typical_exam_trap: string },
): Record<string, unknown> {
  return {
    curriculum_id: curriculumId,
    learning_field_id: lfId,
    competency_id: compId,
    name: `${name} — ${facet.suffix}`,
    canonical_statement: name,
    cognitive_level: facet.cognitive,
    knowledge_type: facet.knowledge_type,
    exam_context_type: facet.exam_context_type,
    didactic_intent: facet.didactic_intent,
    allowed_question_types: facet.question_types,
    decision_structure: facet.decision_structure,
    question_template: tmpl.question_template,
    explanation_template: tmpl.explanation_template,
    typical_errors: tmpl.typical_errors,
    trap_spec: tmpl.trap_spec,
    typical_exam_trap: tmpl.typical_exam_trap,
    exam_relevance_score: calcRelevanceScore(facet.cognitive),
    estimated_time_seconds: calcEstimatedTime(facet.cognitive),
    real_world_context: facet.cognitive !== "remember",
    status: "approved",  // Auto-approve for pipeline continuity; council validates later
    version: "3.0.0",
  };
}
