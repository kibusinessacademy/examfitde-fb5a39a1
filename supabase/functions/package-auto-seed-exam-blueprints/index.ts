import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveAvailableRoute } from "../_shared/llm/provider-load-balancer.ts";

// ═══════════════════════════════════════════════════════════════════════
// Blueprint Seeder v4 — "Premium Elite" Grade
// ═══════════════════════════════════════════════════════════════════════
// Upgrades from v3:
//   1. Shared AI client + model-routing (Google-first, failover chain)
//   2. Leverages enriched competency data (bloom_level, misconceptions)
//   3. exam_part propagation from learning_fields
//   4. Stricter elite gates: min 3 typical_errors, max 20% isolated
//   5. discrimination_tier + scenario_type metadata
//   6. Profession glossary injection for domain depth
//   7. Blueprint diversity enforcement (cognitive spread validation)
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

// ── Blueprint Facets (5 per competency) ──
interface BlueprintFacet {
  suffix: string;
  cognitive: Cognitive;
  knowledge_type: KnowledgeType;
  exam_context_type: ExamContextType;
  question_types: string[];
  decision_structure: string | null;
  didactic_intent: string;
  description: string;
}

const BLUEPRINT_FACETS: BlueprintFacet[] = [
  {
    suffix: "Recall",
    cognitive: "remember",
    knowledge_type: "concept",
    exam_context_type: "isolated_knowledge",
    question_types: ["mc_single"],
    decision_structure: null,
    didactic_intent: "recognition",
    description: "Reine Faktenabfrage: Definitionen, Begriffe, Zuordnungen.",
  },
  {
    suffix: "Verständnis-Transfer",
    cognitive: "understand",
    knowledge_type: "concept",
    exam_context_type: "applied_case",
    question_types: ["mc_single", "mc_multi"],
    decision_structure: "single_best_answer",
    didactic_intent: "transfer",
    description: "Verständnisfrage mit Praxisbezug: Zusammenhang erklären oder Aussage im Kontext bewerten.",
  },
  {
    suffix: "Praxisfall",
    cognitive: "apply",
    knowledge_type: "procedure",
    exam_context_type: "multi_step_case",
    question_types: ["case_study", "mc_single", "calculation"],
    decision_structure: "multiple_valid_options",
    didactic_intent: "classification",
    description: "Anwendungsfall: Reales Betriebsszenario mit konkretem Arbeitsschritt, Berechnung oder Entscheidung.",
  },
  {
    suffix: "Analyse & Fehlersuche",
    cognitive: "analyze",
    knowledge_type: "procedure",
    exam_context_type: "error_detection",
    question_types: ["mc_single", "mc_multi", "case_study"],
    decision_structure: "error_detection",
    didactic_intent: "error_detection",
    description: "Analysefrage: Fehler in Prozess/Dokument finden, Ursachen identifizieren, Prioritäten setzen.",
  },
  {
    suffix: "Bewertung & Entscheidung",
    cognitive: "evaluate",
    knowledge_type: "regulation",
    exam_context_type: "legal_evaluation",
    question_types: ["mc_single", "case_study"],
    decision_structure: "tradeoff_evaluation",
    didactic_intent: "comparison",
    description: "Bewertungsfrage: Unter Vorschriften, Risiken und Abwägungen eine fundierte Entscheidung treffen.",
  },
];

// ── Mappings ────────────────────────────────────────────────────────
const DIFFICULTY_BY_COGNITIVE: Record<Cognitive, string> = {
  remember: "easy", understand: "easy", apply: "medium", analyze: "hard", evaluate: "hard",
};

function calcRelevanceScore(c: Cognitive): number {
  return ({ evaluate: 5, analyze: 5, apply: 4, understand: 3, remember: 2 } as Record<Cognitive, number>)[c];
}

function calcEstimatedTime(c: Cognitive): number {
  return ({ evaluate: 200, analyze: 180, apply: 150, understand: 90, remember: 60 } as Record<Cognitive, number>)[c];
}

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

// ── Enriched Competency Data ────────────────────────────────────────
interface CompetencyData {
  id: string;
  learning_field_id: string;
  code: string;
  title: string;
  description: string | null;
  taxonomy_level: string | null;
  // v4: enriched fields from S2
  bloom_level: string | null;
  action_verb: string | null;
  typical_misconceptions: string[] | null;
  exam_relevance_tier: string | null;
}

interface LfData {
  id: string;
  code: string;
  title: string;
  exam_part: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
// v4: AI-Powered Blueprint Generation with shared client + enrichment
// ═══════════════════════════════════════════════════════════════════════

async function generateBlueprintTemplates(
  berufName: string,
  comp: CompetencyData,
  lfTitle: string,
  facets: BlueprintFacet[],
  glossaryTerms: string[],
): Promise<Array<{
  question_template: string;
  explanation_template: string;
  typical_errors: string[];
  trap_spec: object;
  typical_exam_trap: string;
}>> {
  const facetDescriptions = facets.map((f, i) =>
    `${i + 1}. "${f.suffix}" (${f.cognitive}/${f.exam_context_type}): ${f.description}`
  ).join("\n");

  // v4: Inject enriched competency data into prompt
  const misconceptionBlock = comp.typical_misconceptions?.length
    ? `\nBEKANNTE FEHLVORSTELLUNGEN bei dieser Kompetenz:\n${comp.typical_misconceptions.map(m => `- ${m}`).join("\n")}`
    : "";

  const glossaryBlock = glossaryTerms.length > 0
    ? `\nFACHBEGRIFFE (${berufName}):\n${glossaryTerms.slice(0, 30).join(", ")}`
    : "";

  const systemPrompt = `Du bist ein IHK-Prüfungsexperte für den Beruf "${berufName}".
Du erstellst Blueprint-Templates für Prüfungsfragen auf ELITE-Niveau.

BERUF: ${berufName}
LERNFELD: ${lfTitle}
KOMPETENZ: ${comp.title}${comp.action_verb ? ` (Handlungsverb: ${comp.action_verb})` : ""}
${comp.description ? `BESCHREIBUNG: ${comp.description}` : ""}
BLOOM-LEVEL: ${comp.bloom_level || normCognitive(comp.taxonomy_level)}
PRÜFUNGSRELEVANZ: ${comp.exam_relevance_tier || "core"}
${misconceptionBlock}${glossaryBlock}

Erstelle ${facets.length} Blueprint-Facetten mit verschiedenen kognitiven Ebenen:

${facetDescriptions}

ELITE-ANFORDERUNGEN PRO FACETTE:
1. question_template: Konkretes Fragemuster mit {variable} Platzhaltern.
   - MUSS berufsspezifisch sein (${berufName}!)
   - MUSS ein realistisches IHK-Prüfungsszenario darstellen
   - Bei apply/analyze/evaluate: IMMER mit konkreter Betriebssituation
   - Mindestens 2 Variablen-Platzhalter pro Template

2. explanation_template: Strukturiertes Erklärungsschema.
   - Fachliche Begründung mit Rechtsgrundlage/Norm wenn relevant
   - Warum sind die Alternativen falsch?

3. typical_errors: Exakt 3-5 berufsspezifische IHK-typische Prüfungsfehler.
   - KEINE generischen Fehler!
   - Jeder Fehler muss konkret zum Berufsfeld ${berufName} passen
   - Fehler müssen psychometrisch plausibel sein (häufige Verwechslungen)

4. trap_spec: JSON mit Prüfungsfallen-Spezifikation:
   { "trap_type": "...", "why_tempting": "...", "examiner_intention": "...", "common_misconception": "..." }

5. typical_exam_trap: Ein Satz zur häufigsten Prüfungsfalle.

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
    // v11: Failover chain — policy-first, then model-routing chain
    let chain: Array<{ provider: string; model: string }> = [];
    const policyRoute = await resolveAvailableRoute("exam_blueprint");
    if (policyRoute.ok && policyRoute.provider && policyRoute.model) {
      chain.push({ provider: policyRoute.provider, model: policyRoute.model });
      console.log(`[SeedV4] POLICY_ROUTE: exam_blueprint → ${policyRoute.provider}/${policyRoute.model}`);
    }
    // Always append full model-routing chain as fallback
    const routingChain = await getModelChainAsync("exam_questions");
    for (const c of routingChain) {
      if (!chain.some(x => x.provider === c.provider && x.model === c.model)) {
        chain.push({ provider: c.provider, model: c.model });
      }
    }

    const result = await callAIWithFailover(
      chain.map(c => ({ provider: c.provider as any, model: c.model })),
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Erstelle ${facets.length} Elite-Blueprint-Facetten für die Kompetenz "${comp.title}" im Beruf "${berufName}".` },
        ],
        temperature: 0.6,
      },
    );

    const blueprints = result?.blueprints || [];

    // Pad if AI returned fewer than expected
    while (blueprints.length < facets.length) {
      blueprints.push(generateFallbackTemplate(facets[blueprints.length], comp, berufName));
    }

    // v4: Enforce minimum 3 typical_errors per blueprint
    for (const bp of blueprints) {
      if (!Array.isArray(bp.typical_errors) || bp.typical_errors.length < 3) {
        bp.typical_errors = ensureMinErrors(bp.typical_errors, comp, berufName);
      }
    }

    return blueprints.slice(0, facets.length);
  } catch (e) {
    console.warn(`[SeedV4] AI generation error: ${(e as Error).message}`);
    return facets.map((f) => generateFallbackTemplate(f, comp, berufName));
  }
}

// v4: Ensure minimum 3 typical errors
function ensureMinErrors(arr: unknown, comp: CompetencyData, beruf: string): string[] {
  const a = Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
  const defaults = [
    `Fachbegriff im Kontext von ${comp.title} verwechselt`,
    `Relevante Vorschrift für ${beruf} nicht beachtet`,
    `Praxisablauf bei ${comp.title} falsch priorisiert`,
  ];
  while (a.length < 3) a.push(defaults[a.length] || `Typischer Fehler bei ${comp.title}`);
  return a.slice(0, 6);
}

function generateFallbackTemplate(facet: BlueprintFacet, comp: CompetencyData, beruf: string) {
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
    typical_errors: ensureMinErrors([], comp, beruf),
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
// Blueprint Health Score (v4: enhanced with elite metrics)
// ═══════════════════════════════════════════════════════════════════════

interface HealthScore {
  total_blueprints: number;
  with_template: number;
  with_trap: number;
  with_diverse_types: number;
  with_min_errors: number;
  non_isolated: number;
  cognitive_spread: Record<string, number>;
  exam_context_spread: Record<string, number>;
  avg_relevance: number;
  isolated_pct: number;
  health_score: number;
  grade: "elite" | "acceptable" | "weak" | "critical";
}

function computeHealthScore(bps: any[]): HealthScore {
  if (!bps.length) return {
    total_blueprints: 0, with_template: 0, with_trap: 0, with_diverse_types: 0,
    with_min_errors: 0, non_isolated: 0, cognitive_spread: {}, exam_context_spread: {},
    avg_relevance: 0, isolated_pct: 100, health_score: 0, grade: "critical",
  };

  const n = bps.length;
  const withTemplate = bps.filter(b => b.question_template?.length > 10).length;
  const withTrap = bps.filter(b => b.typical_exam_trap || (b.trap_spec && Object.keys(b.trap_spec).length > 0)).length;
  const withDiverseTypes = bps.filter(b => {
    const types = b.allowed_question_types || [];
    return types.length > 1 || (types.length === 1 && types[0] !== "mc_single");
  }).length;
  const withMinErrors = bps.filter(b => Array.isArray(b.typical_errors) && b.typical_errors.length >= 3).length;
  const nonIsolated = bps.filter(b => b.exam_context_type && b.exam_context_type !== "isolated_knowledge").length;
  const isolatedPct = Math.round(((n - nonIsolated) / n) * 100);

  const cogSpread: Record<string, number> = {};
  const ctxSpread: Record<string, number> = {};
  let totalRelevance = 0;

  for (const b of bps) {
    cogSpread[b.cognitive_level] = (cogSpread[b.cognitive_level] || 0) + 1;
    ctxSpread[b.exam_context_type || "none"] = (ctxSpread[b.exam_context_type || "none"] || 0) + 1;
    totalRelevance += b.exam_relevance_score || 0;
  }

  // v4: Weighted score with elite gates
  const templateScore = (withTemplate / n) * 20;
  const trapScore = (withTrap / n) * 15;
  const typeScore = (withDiverseTypes / n) * 10;
  const errorScore = (withMinErrors / n) * 15;     // v4: new
  const contextScore = (nonIsolated / n) * 20;
  const cogDiversity = Math.min(Object.keys(cogSpread).length / 5, 1) * 10;
  const ctxDiversity = Math.min(Object.keys(ctxSpread).length / 6, 1) * 10;

  const health = Math.round(templateScore + trapScore + typeScore + errorScore + contextScore + cogDiversity + ctxDiversity);
  const grade = health >= 85 ? "elite" : health >= 70 ? "acceptable" : health >= 50 ? "weak" : "critical";

  return {
    total_blueprints: n, with_template: withTemplate, with_trap: withTrap,
    with_diverse_types: withDiverseTypes, with_min_errors: withMinErrors,
    non_isolated: nonIsolated, cognitive_spread: cogSpread,
    exam_context_spread: ctxSpread, avg_relevance: Math.round((totalRelevance / n) * 10) / 10,
    isolated_pct: isolatedPct, health_score: health, grade,
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
  console.log(`[SeedV4] Received: package_id=${p?.package_id}, curriculum_id=${p?.curriculum_id}`);

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
    console.error(`[SeedV4] Unhandled error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════

async function handleSeed(sb: ReturnType<typeof createClient>, p: any) {
  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;
  // v4.1: Support targeted re-seed for specific LFs (from pipeline auto-heal)
  const targetLfIds: string[] | undefined = Array.isArray(p.target_lf_ids) ? p.target_lf_ids : undefined;
  if (targetLfIds?.length) {
    console.log(`[SeedV4] 🎯 Targeted mode: seeding only ${targetLfIds.length} LFs`);
  }

  // 1) Load curriculum + beruf
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

  // v4: Load profession glossary for domain-specific terms
  let glossaryTerms: string[] = [];
  if (curriculum?.beruf_id) {
    const { data: glossary } = await sb
      .from("profession_glossaries")
      .select("terms")
      .eq("beruf_id", curriculum.beruf_id)
      .single();
    if (glossary?.terms && Array.isArray(glossary.terms)) {
      glossaryTerms = glossary.terms.map((t: any) => typeof t === "string" ? t : t?.term || "").filter(Boolean);
    }
  }

  // 2) Load learning fields (v4: include exam_part)
  const { data: lfs, error: lfErr } = await sb
    .from("learning_fields")
    .select("id, code, title, exam_part")
    .eq("curriculum_id", curriculumId);

  if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
  if (!lfs?.length) {
    return json({ ok: false, retry: true, error: "NO_LEARNING_FIELDS" }, 409);
  }

  // 3) Load competencies (v4: include enriched fields)
  const lfIds = lfs.map(lf => lf.id);
  // v4.1: If targeted mode, only load competencies for the target LFs
  const compLfIds = targetLfIds?.length ? targetLfIds : lfIds;
  const { data: comps, error: compErr } = await sb
    .from("competencies")
    .select("id, learning_field_id, code, title, description, taxonomy_level, bloom_level, action_verb, typical_misconceptions, exam_relevance_tier")
    .in("learning_field_id", compLfIds)
    .order("created_at", { ascending: true });

  if (compErr) throw new Error(`Competencies query: ${compErr.message}`);

  // 4) Load existing blueprints for diff
  const { data: existingBps } = await sb
    .from("question_blueprints")
    .select("id, competency_id, learning_field_id, cognitive_level, question_template, typical_exam_trap, exam_context_type, allowed_question_types, exam_relevance_score, trap_spec, typical_errors")
    .eq("curriculum_id", curriculumId);

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

  // 5) Generate blueprints
  const toInsert: any[] = [];
  const toUpgrade: { id: string; updates: any }[] = [];
  let aiCallCount = 0;
  const MAX_AI_CALLS = 30;

  // ── Build set of LFs that have competencies ──
  const lfsWithComps = new Set((comps || []).map(c => c.learning_field_id));
  // LFs WITHOUT any competencies need the LF-fallback path
  const lfsWithoutComps = lfs.filter(lf => !lfsWithComps.has(lf.id));

  if (lfsWithoutComps.length > 0) {
    console.log(`[SeedV4] ⚠️ ${lfsWithoutComps.length} LFs have NO competencies — using LF-fallback: ${lfsWithoutComps.map(l => l.title).join(", ")}`);
  }

  // ── Path A: LF-fallback for LFs without competencies ──
  for (const lf of lfsWithoutComps) {
    const existing = existingByLf.get(lf.id) || [];
    const existingCogLevels = new Set(existing.map(b => b.cognitive_level));
    const missingFacets = BLUEPRINT_FACETS.filter(f => !existingCogLevels.has(f.cognitive));

    if (missingFacets.length > 0 && aiCallCount < MAX_AI_CALLS) {
      const fakeComp: CompetencyData = {
        id: lf.id, learning_field_id: lf.id, code: lf.code, title: lf.title,
        description: null, taxonomy_level: null, bloom_level: null,
        action_verb: null, typical_misconceptions: null, exam_relevance_tier: null,
      };
      const templates = await generateBlueprintTemplates(berufName, fakeComp, lf.title, missingFacets, glossaryTerms);
      aiCallCount++;

      for (let i = 0; i < missingFacets.length; i++) {
        toInsert.push(buildBlueprintRow(curriculumId, lf.id, null, lf.title, missingFacets[i], templates[i], lf.exam_part));
      }
    }

    // Upgrade empty-template blueprints
    upgradeEmptyBlueprints(existing, lfs, berufName, toUpgrade, lf);
  }

  // ── Path B: Competency-based seeding for LFs WITH competencies ──
  if (comps?.length) {
    console.log(`[SeedV4] Seeding from ${comps.length} competencies for "${berufName}"`);

    const BATCH_SIZE = 8;
    const compBatches: CompetencyData[][] = [];
    for (let i = 0; i < comps.length; i += BATCH_SIZE) {
      compBatches.push((comps as CompetencyData[]).slice(i, i + BATCH_SIZE));
    }

    for (const batch of compBatches) {
      const batchPromises = batch.map(async (comp) => {
        const existing = existingByComp.get(comp.id) || [];
        const existingCogLevels = new Set(existing.map(b => b.cognitive_level));
        // v4: prefer enriched bloom_level over taxonomy_level
        const baseCognitive = normCognitive(comp.bloom_level || comp.taxonomy_level);

        const relevantFacets = selectFacetsForCompetency(baseCognitive, existingCogLevels);

        if (relevantFacets.length > 0 && aiCallCount < MAX_AI_CALLS) {
          const lf = lfMap.get(comp.learning_field_id);
          const lfTitle = lf?.title || "Lernfeld";
          const templates = await generateBlueprintTemplates(berufName, comp, lfTitle, relevantFacets, glossaryTerms);
          aiCallCount++;

          for (let i = 0; i < relevantFacets.length; i++) {
            toInsert.push(buildBlueprintRow(
              curriculumId, comp.learning_field_id, comp.id, comp.title,
              relevantFacets[i], templates[i], lf?.exam_part || null,
            ));
          }
        }

        // Upgrade empty-template + missing-error blueprints
        for (const bp of existing) {
          const needsTemplateUpgrade = !bp.question_template || bp.question_template.length < 10;
          const needsErrorUpgrade = !Array.isArray(bp.typical_errors) || bp.typical_errors.length < 3;

          if (needsTemplateUpgrade || needsErrorUpgrade) {
            const facet = BLUEPRINT_FACETS.find(f => f.cognitive === bp.cognitive_level) || BLUEPRINT_FACETS[0];
            const fallback = generateFallbackTemplate(facet, comp, berufName);
            const updates: any = {};
            if (needsTemplateUpgrade) {
              updates.question_template = fallback.question_template;
              updates.explanation_template = fallback.explanation_template;
              updates.trap_spec = fallback.trap_spec;
              updates.typical_exam_trap = fallback.typical_exam_trap;
            }
            if (needsErrorUpgrade) {
              updates.typical_errors = fallback.typical_errors;
            }
            toUpgrade.push({ id: bp.id, updates });
          }
        }
      });

      await Promise.all(batchPromises);
    }
  }

  // 6) Insert new blueprints
  let insertedCount = 0;
  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 50) {
      const chunk = toInsert.slice(i, i + 50);
      const { error: insErr } = await sb.from("question_blueprints").insert(chunk);
      if (insErr && insErr.code !== "23505") {
        console.error(`[SeedV4] Insert error: ${insErr.message}`);
      } else {
        insertedCount += chunk.length;
      }
    }
  }

  // 7) Upgrade existing blueprints
  let upgradedCount = 0;
  for (const upg of toUpgrade) {
    const { error: updErr } = await sb.from("question_blueprints").update(upg.updates).eq("id", upg.id);
    if (!updErr) upgradedCount++;
  }

  // 8) Health score
  const { data: allBps } = await sb
    .from("question_blueprints")
    .select("cognitive_level, question_template, typical_exam_trap, exam_context_type, allowed_question_types, exam_relevance_score, trap_spec, typical_errors")
    .eq("curriculum_id", curriculumId);

  const health = computeHealthScore(allBps || []);

  // build_progress is now auto-computed by DB trigger from package_steps — no manual write needed

  console.log(`[SeedV4] Done: +${insertedCount} new, ${upgradedCount} upgraded, health=${health.health_score}/100 (${health.grade}), AI calls=${aiCallCount}`);

  // ── ZERO-WRITE GUARD ──────────────────────────────────────────────
  // If AI was called but nothing persisted → hard fail so Runner marks
  // step as failed instead of silently completing with 0 output.
  const totalExisting = (existingBps || []).length;
  if (aiCallCount > 0 && insertedCount === 0 && upgradedCount === 0) {
    const msg = `SEED_ZERO_WRITE: ${aiCallCount} AI calls but 0 blueprints persisted/updated. Likely schema mismatch, RLS, or constraint violation. existing=${totalExisting}`;
    console.error(`[SeedV4] ${msg}`);
    return json({ ok: false, error: msg, ai_calls: aiCallCount, existing: totalExisting, batch_complete: false }, 500);
  }

  return json({
    ok: true,
    seeded: insertedCount,
    upgraded: upgradedCount,
    existing: totalExisting,
    ai_calls: aiCallCount,
    beruf: berufName,
    source: comps?.length ? "competencies" : "learning_fields",
    health,
    version: "4.0.1",
  });
}

// ── Helper: Upgrade empty blueprints (LF fallback path) ──
function upgradeEmptyBlueprints(existing: any[], _lfs: LfData[], berufName: string, toUpgrade: any[], lf: LfData) {
  for (const bp of existing) {
    if (!bp.question_template || bp.question_template.length < 10) {
      const facet = BLUEPRINT_FACETS.find(f => f.cognitive === bp.cognitive_level) || BLUEPRINT_FACETS[0];
      const fakeComp: CompetencyData = {
        id: lf.id, learning_field_id: lf.id, code: lf.code, title: lf.title,
        description: null, taxonomy_level: null, bloom_level: null,
        action_verb: null, typical_misconceptions: null, exam_relevance_tier: null,
      };
      const fallback = generateFallbackTemplate(facet, fakeComp, berufName);
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

// ── Helper: Select relevant facets for a competency ──
function selectFacetsForCompetency(baseCognitive: Cognitive, existingCogLevels: Set<string>): BlueprintFacet[] {
  const cogOrder: Cognitive[] = ["remember", "understand", "apply", "analyze", "evaluate"];
  const baseIdx = cogOrder.indexOf(baseCognitive);

  const targetLevels: Cognitive[] = [baseCognitive];
  if (baseIdx > 0) targetLevels.push(cogOrder[baseIdx - 1]);
  if (baseIdx < cogOrder.length - 1) targetLevels.push(cogOrder[baseIdx + 1]);

  const missingLevels = targetLevels.filter(c => !existingCogLevels.has(c));
  return BLUEPRINT_FACETS.filter(f => missingLevels.includes(f.cognitive));
}

// ── Helper: Build blueprint DB row (v4: with exam_part + metadata) ──
function buildBlueprintRow(
  curriculumId: string,
  lfId: string,
  compId: string | null,
  name: string,
  facet: BlueprintFacet,
  tmpl: { question_template: string; explanation_template: string; typical_errors: string[]; trap_spec: object; typical_exam_trap: string },
  examPart: string | null,
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
    question_template: tmpl.question_template || `Frage zu ${name} (${facet.cognitive})`,
    explanation_template: tmpl.explanation_template || `Erklärung zu ${name}`,
    typical_errors: tmpl.typical_errors,
    trap_spec: {
      ...(typeof tmpl.trap_spec === "object" && tmpl.trap_spec ? tmpl.trap_spec : {}),
      difficulty_default: DIFFICULTY_BY_COGNITIVE[facet.cognitive],
    },
    typical_exam_trap: tmpl.typical_exam_trap || `Typische Falle bei ${name}`,
    exam_relevance_score: calcRelevanceScore(facet.cognitive),
    estimated_time_seconds: calcEstimatedTime(facet.cognitive),
    real_world_context: facet.cognitive !== "remember",
    oral_extension: examPart ? { exam_part: examPart } : null,
    status: "draft",  // GOVERNANCE: Only Council/RPC may set 'approved'
    version: "4.0.0",
  };
}
