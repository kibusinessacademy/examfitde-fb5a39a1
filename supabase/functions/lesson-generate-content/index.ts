import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover, logLLMCostEvent, RateLimitError } from "../_shared/ai-client.ts";
import { isTransientLlmError } from "../_shared/llm/normalize.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { loadCachedGlossary, formatGlossaryForPrompt } from "../_shared/glossary-loader.ts";
import { DEPTH_SELF_CHECK, REGULATORY_GUARD, buildMiniCheckPrompt, runV2QualityGate, loadMasteryContext, buildMasteryFeedbackSuffix, adjustDifficultyByMastery, mapToDifficultyLevel, getRequiredDepth } from "../_shared/prompt-kit.ts";
import type { DifficultyLevel, MasteryContext } from "../_shared/prompt-kit.ts";
import { canonicalStepKey } from "../_shared/step-keys.ts";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { getTimeBudget, shouldSoftStop } from "../_shared/time-budget.ts";
import { assessLessonQuality } from "../_shared/content-quality.ts";

/**
 * lesson-generate-content — Single-Unit Worker (v7)
 *
 * Generates exactly ONE lesson-step per invocation.
 * Called by the dispatcher (package-generate-learning-content) via job_queue.
 *
 * Benefits:
 *   - No Edge timeout risk (<45s per call)
 *   - Perfect retry/backoff per lesson (poison pills isolated)
 *   - Parallel execution via worker pool concurrency
 *   - No batch-abort on single transient error
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// Step prompts (same SSOT as the original batch generator)
// ═══════════════════════════════════════════════════════════════

const STEP_PROMPTS: Record<string, { system: string; minChars: number; minWords: number }> = {
  einstieg: {
    system: `Erstelle eine **aktivierende Einstiegsaktivität** für eine IHK-Prüfungsvorbereitung.

MINDESTUMFANG: 250 Wörter Fließtext. Antworte NIEMALS mit weniger als 250 Wörtern.

Struktur:
- <h3>Motivierender Titel mit konkretem Bezug zum Thema</h3>
- Konkretes Praxisszenario aus dem typischen ARBEITSALLTAG des Berufs (MINDESTENS 120 Wörter)
- 2-3 Reflexionsfragen als <ul><li>
- Bezug zum Vorwissen UND zur IHK-Prüfungsrelevanz
- ⭐ IHK-Prüfungstipp mit typischer Falle
- Überleitung zum Lernschritt "Verstehen"

PFLICHT: Realistische, nicht-runde Zahlen. Ausführlich und detailreich.
${DEPTH_SELF_CHECK}
${REGULATORY_GUARD}`,
    minChars: 600,
    minWords: 250,
  },
  verstehen: {
    system: `Erstelle **ausführliches Lernmaterial** für eine IHK-Prüfungsvorbereitung.

MINDESTUMFANG: 400 Wörter Fließtext.

Struktur:
- <h3>Konzept-Titel</h3>
- Klare Definition mit berufsspezifischen Beispielen (mind. 80 Wörter)
- Mind. 3 praxisnahe Beispiele (verschiedene Schwierigkeitsgrade, je mind. 40 Wörter)
- Fachbegriffe als <strong>, Merksätze als <blockquote> mit ⭐
- Gegenbeispiele für typische Fehlannahmen

RECHENAUFGABEN (bei quantitativen Themen): Vollständige Rechenwege, mind. 2 Beispiele.
REGULATORIK (bei rechtlichen Themen): Konkrete §§-Referenzen, Fristen.
IHK-PRÜFUNGSBEZUG: ⭐ "IHK-Prüfungstipp: ..." mind. 2x

PFLICHT: Ausführlich und detailreich. Jeder Absatz mind. 3-4 Sätze.
${DEPTH_SELF_CHECK}
${REGULATORY_GUARD}`,
    minChars: 1800,
    minWords: 400,
  },
  anwenden: {
    system: `Erstelle ein **Entscheidungsszenario mit Fallstudie** für eine IHK-Prüfungsvorbereitung.

MINDESTUMFANG: 350 Wörter.

Struktur:
- <h3>Fallstudie: [konkreter Titel]</h3>
- Konkretes Fallbeispiel (mind. 100 Wörter Situationsbeschreibung)
- SITUATION → AUFGABE (3-4 Teilaufgaben mit steigender Komplexität)
- Mind. 2 Entscheidungsoptionen mit Pro-Contra

RECHENAUFGABEN (bei quantitativen Themen): Mehrstufige Berechnungen.
PRÜFUNGSFALLEN: ⚠️ Typische Prüfungsfallen markiert.

PFLICHT: Die Fallstudie muss sich wie eine echte IHK-Prüfungsaufgabe anfühlen.
${DEPTH_SELF_CHECK}
${REGULATORY_GUARD}`,
    minChars: 1400,
    minWords: 350,
  },
  wiederholen: {
    system: `Erstelle eine **PRÜFUNGSVERDICHTUNG** für eine IHK-Prüfungsvorbereitung.

MINDESTUMFANG: 300 Wörter.

Struktur:
- <h3>Prüfungsverdichtung</h3>
- 5-7 Merksätze mit Fachbegriffen
- Mind. 4 Prüfungsfallen mit Korrektur
- Abgrenzungstabelle als <table>
- Mind. 2 Transferübungen mit Musterlösung

PFLICHT: NUR Verdichtung und Prüfungsvorbereitung, keine erneute Erklärung.
${DEPTH_SELF_CHECK}`,
    minChars: 1200,
    minWords: 300,
  },
};

const CONTENT_TOOL = {
  type: "function" as const,
  function: {
    name: "create_lesson_content",
    description: "Erstelle strukturierten Lerninhalt für eine Lektion.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML-Inhalt der Lektion" },
        objectives: { type: "array", items: { type: "string" } },
        key_terms: { type: "array", items: { type: "object", properties: { term: { type: "string" }, definition: { type: "string" }, exam_relevance: { type: "string" } }, required: ["term", "definition", "exam_relevance"] } },
        common_mistakes: { type: "array", items: { type: "object", properties: { mistake: { type: "string" }, correction: { type: "string" }, trap_type: { type: "string" } }, required: ["mistake", "correction", "trap_type"] } },
        exam_triggers: { type: "array", items: { type: "string" } },
        transfer_questions: { type: "array", items: { type: "string" } },
      },
      required: ["html", "objectives", "key_terms", "common_mistakes", "exam_triggers"],
      additionalProperties: false,
    },
  },
};

const MINICHECK_TOOL = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description: "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 4, maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
              correct_answer: { type: "integer", minimum: 0, maximum: 3 },
              explanation: { type: "string" },
            },
            required: ["question", "options", "correct_answer", "explanation"],
          },
        },
        objectives: { type: "array", items: { type: "string" } },
      },
      required: ["questions", "objectives"],
    },
  },
};

const STEP_BLOOM_MAP: Record<string, string> = {
  einstieg: "remember", verstehen: "understand", anwenden: "apply",
  wiederholen: "analyze", mini_check: "apply",
};

// ═══════════════════════════════════════════════════════════════
// Idempotency check
// ═══════════════════════════════════════════════════════════════

async function existingVersion(sb: any, lessonId: string, step: string) {
  const canonKey = canonicalStepKey(step);
  const isMini = step === "mini_check" || step === "step_5_minicheck" || canonKey === "step_5_minicheck";
  const { data } = await sb
    .from("content_versions")
    .select("id, content_json")
    .eq("lesson_id", lessonId)
    .eq("step_key", canonKey)
    .eq("entity_type", isMini ? "minicheck" : "lesson_step")
    .neq("status", "rejected")
    .limit(1)
    .maybeSingle();
  return data;
}

// ═══════════════════════════════════════════════════════════════
// Main handler — exactly 1 lesson per invocation
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await assertSchemaReady("lesson-generate-content", sb);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;
  const lessonId = p.lesson_id;
  const stepKeyRaw = p.step_key || p.step;
  const startMs = Date.now();
  const budget = getTimeBudget("lesson_single");

  if (!packageId || !courseId || !lessonId || !stepKeyRaw) {
    return json({ error: "Missing required fields (package_id, course_id, lesson_id, step_key)" }, 400);
  }

  const stepKey = canonicalStepKey(stepKeyRaw);
  const isMiniCheck = stepKey === "mini_check" || stepKey === "step_5_minicheck";

  // ── Idempotency: skip if content_version already exists ──
  const existing = await existingVersion(sb, lessonId, stepKey);
  if (existing) {
    return json({ ok: true, skipped: true, reason: "already_generated", versionId: existing.id });
  }

  // ── Load lesson metadata ──
  const { data: lesson, error: lErr } = await sb
    .from("lessons")
    .select("id, title, step, module_id, content, qc_status, modules!inner(course_id, title, learning_field_id)")
    .eq("id", lessonId)
    .single();

  if (lErr || !lesson) {
    return json({ error: "Lesson not found", details: lErr?.message }, 404);
  }

  // ── Resolve profession + glossary context ──
  let professionName: string;
  let glossaryContext = "";
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
    const { data: cu } = await sb.from("curricula").select("beruf_id").eq("id", curriculumId).maybeSingle();
    if (cu?.beruf_id) {
      try {
        const glossary = await loadCachedGlossary(sb, cu.beruf_id, professionName);
        if (glossary) glossaryContext = formatGlossaryForPrompt(glossary);
      } catch { /* no glossary — proceed */ }
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  // ── Load LF context for enriched prompts ──
  const lfId = (lesson as any).modules?.learning_field_id;
  let lfData: any = null;
  if (lfId) {
    const { data } = await sb
      .from("learning_fields")
      .select("id, title, code, weight_percent, exam_part, difficulty_tier, ihk_focus_areas")
      .eq("id", lfId)
      .maybeSingle();
    lfData = data;
  }

  const lfContext = lfData ? [
    `Lernfeld: ${lfData.code} – ${lfData.title}`,
    `Prüfungsgewichtung: ${lfData.weight_percent}%`,
    lfData.exam_part ? `Prüfungsteil: ${lfData.exam_part}` : "",
    `Schwierigkeitsstufe: ${lfData.difficulty_tier}`,
    Array.isArray(lfData.ihk_focus_areas) && lfData.ihk_focus_areas.length > 0 ? `IHK-Schwerpunkte: ${lfData.ihk_focus_areas.join(", ")}` : "",
  ].filter(Boolean).join("\n") : "";

  // ── Adaptive difficulty based on mastery data ──
  const baseDifficultyLevel: DifficultyLevel = mapToDifficultyLevel(lfData?.difficulty_tier);
  let masteryCtx: MasteryContext | null = null;
  try {
    masteryCtx = await loadMasteryContext(sb, curriculumId, lfId || null);
  } catch { /* proceed without mastery */ }
  const difficultyLevel = adjustDifficultyByMastery(baseDifficultyLevel, masteryCtx);
  const adaptiveReq = getRequiredDepth(difficultyLevel);
  const masteryInjection = buildMasteryFeedbackSuffix(masteryCtx);

  const moduleName = (lesson as any).modules?.title || "";
  const contextBlock = [
    `Beruf: ${professionName}`,
    `Modul: ${moduleName}`,
    `Lektion: ${lesson.title}`,
    lfContext,
    `\n${adaptiveReq.promptSuffix}`,
    masteryInjection,
  ].filter(Boolean).join("\n");

  const stepConfig = STEP_PROMPTS[stepKey] || STEP_PROMPTS.verstehen;
  const userPrompt = isMiniCheck
    ? buildMiniCheckPrompt(professionName, contextBlock)
    : `${stepConfig.system}\n\n${contextBlock}`;

  // ── Time budget check ──
  if (shouldSoftStop(startMs, "lesson_single")) {
    return json({ ok: false, retry: true, error: "budget_exhausted_pre", elapsed_ms: Date.now() - startMs }, 503);
  }

  // ── LLM call with failover chain ──
  const chain = await getModelChainAsync(isMiniCheck ? "minicheck" : "learning_content");

  const elapsedMs = Date.now() - startMs;
  const remainingSoftMs = budget.softStopMs - elapsedMs;
  const MIN_TIMEOUT_MS = 15_000;
  const MIN_PERSIST_MS = 3_000;
  if (remainingSoftMs < MIN_TIMEOUT_MS + MIN_PERSIST_MS) {
    return json({ ok: false, retry: true, error: "budget_exhausted_after_init", elapsed_ms: Date.now() - startMs }, 503);
  }

  const llmTimeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(40_000, remainingSoftMs - MIN_PERSIST_MS));
  const llmAbort = new AbortController();
  const llmTimer = setTimeout(() => llmAbort.abort(), llmTimeoutMs) as unknown as number;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`LLM_TIMEOUT_${llmTimeoutMs}`)), llmTimeoutMs + 500);
  });

  let result: Awaited<ReturnType<typeof callAIWithFailover>>;
  let content: any = null;
  let plainRetry = false;

  try {
    result = await Promise.race([
      callAIWithFailover(
        chain.map(c => ({ provider: c.provider, model: c.model })),
        {
          messages: [
            {
              role: "system",
              content: `Du bist ein erfahrener IHK-Fachexperte mit 20 Jahren Berufserfahrung als ${professionName}. Du erstellst Lerninhalte die sich anfühlen, als wären sie von einem Fachlehrer geschrieben — NICHT von einer KI.

QUALITÄTSSTANDARD:
- Jeder Lernschritt MUSS die fachliche Tiefe des offiziellen Rahmenplans abbilden
- Praxisbeispiele MÜSSEN aus dem typischen Arbeitsalltag stammen
- Bei regulatorischen Themen: IMMER konkrete §§-Referenzen
- Bei Rechenthemen: IMMER vollständige Rechenwege mit realistischen Zahlen
- Markiere prüfungsrelevante Stellen mit ⭐
${glossaryContext}

PRÜFUNGSDRUCK-ELEMENTE (PFLICHT):
- Mindestens 1x "⭐ IHK-Prüfungstipp: ..." 
- Mindestens 1x "⚠️ Typische Prüfungsfalle: ..."
${lfData?.difficulty_tier === 'hard' ? '\nERHÖHTE SCHWIERIGKEIT:\n- Mehrstufige Berechnungen\n- Kombinationsaufgaben\n- Entscheidungsszenarien mit Pro-Contra' : ''}
${lfData?.ihk_focus_areas?.length ? `\nIHK-SCHWERPUNKTE: ${lfData.ihk_focus_areas.join(", ")}` : ''}

ANTI-KI-REGELN:
- KEINE Sätze wie "In der heutigen Geschäftswelt..."
- Schreibe so, wie ein erfahrener Ausbilder erklärt

Nutze IMMER die bereitgestellte Funktion. KEINE Platzhalter.`,
            },
            { role: "user", content: userPrompt },
          ],
          tools: [isMiniCheck ? MINICHECK_TOOL : CONTENT_TOOL] as any,
          tool_choice: { type: "function", function: { name: isMiniCheck ? "create_mini_check" : "create_lesson_content" } },
          max_tokens: isMiniCheck ? 2200 : 3200,
          signal: llmAbort.signal,
        },
      ),
      timeoutPromise,
    ]) as Awaited<ReturnType<typeof callAIWithFailover>>;

    // Parse tool call (timer cleared in finally)
    if (result.toolCalls?.length > 0) {
      try { content = JSON.parse(result.toolCalls[0].function.arguments); } catch { /* fallthrough */ }
    }
    // Fallback 1: parse content as JSON
    if (!content && result.content) {
      const raw = result.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      try { content = JSON.parse(raw); } catch { /* fallthrough */ }
    }
    // Fallback 2: extract JSON object
    if (!content && result.content) {
      const fb = result.content.indexOf("{");
      const lb = result.content.lastIndexOf("}");
      if (fb !== -1 && lb > fb) {
        try { content = JSON.parse(result.content.slice(fb, lb + 1)); } catch { /* noop */ }
      }
    }
    // Fallback 3: raw HTML wrap for non-minicheck
    if (!content && !isMiniCheck && result.content && result.content.length > 200) {
      if (result.content.includes("<h3") || result.content.includes("<p") || result.content.includes("<strong")) {
        content = { html: result.content.trim(), objectives: [] };
      }
    }

    if (!content || (!content.html && !content.questions)) {
      const cLen = result.content?.length || 0;
      if (cLen === 0) {
        const err = new Error(`LLM_EMPTY_RESPONSE: empty (provider=${result.provider}, model=${result.model})`);
        (err as any).name = "LLM_EMPTY_RESPONSE";
        throw err;
      }
      throw new Error(`No parseable tool response (provider=${result.provider}, model=${result.model}, contentLength=${cLen})`);
    }
  } catch (e) {
    // timer cleared in finally
    const errMsg = (e as Error).message || String(e);
    const transient = isTransientLlmError(e);

    // ── Plain-JSON fallback (one attempt, no tool-calling) ──
    if (errMsg.includes("No parseable tool response") && !plainRetry) {
      plainRetry = true;
      try {
        const plainChain = await getModelChainAsync("learning_content");
        const plainResult = await callAIWithFailover(
          plainChain.map(c => ({ provider: c.provider, model: c.model })),
          {
            messages: [
              { role: "system", content: `Du bist ein IHK-Fachexperte. Erstelle Lerninhalt für "${professionName}". Antworte mit einem JSON-Objekt: {"html": "...", "objectives": [...], "key_terms": [...], "common_mistakes": [...], "exam_triggers": [...]}. NUR JSON, kein Markdown.` },
              { role: "user", content: userPrompt },
            ],
            max_tokens: isMiniCheck ? 2200 : 3200,
          },
        );

        let plainContent: any;
        const rawPlain = (plainResult.content || "").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const fb = rawPlain.indexOf("{");
        const lb = rawPlain.lastIndexOf("}");
        if (fb !== -1 && lb > fb) {
          try { plainContent = JSON.parse(rawPlain.slice(fb, lb + 1)); } catch { /* noop */ }
        }

        if (plainContent?.html && plainContent.html.length > 200) {
          content = plainContent;
          result = plainResult as any;
          console.log(`[lesson-gen] Plain JSON fallback SUCCESS for ${lessonId.slice(0, 8)} (${plainContent.html.length} chars)`);
        }
      } catch (plainErr) {
        console.warn(`[lesson-gen] Plain retry also failed: ${(plainErr as Error).message?.slice(0, 100)}`);
      }
    }

    if (!content || (!content.html && !content.questions)) {
      const isTransient = transient || e instanceof RateLimitError;
      return json({
        ok: false, retry: isTransient, transient: isTransient,
        error: `${isTransient ? "TRANSIENT: " : ""}${errMsg.slice(0, 200)}`,
        elapsed_ms: Date.now() - startMs,
      }, isTransient ? 503 : 500);
    }
  } finally {
    clearTimeout(llmTimer);
  }

  // ── Quality gate (depth + hallucination) ──
  if (!isMiniCheck && content.html) {
    const v2Result = runV2QualityGate(content.html, stepKey, difficultyLevel);
    if (v2Result.hallucinationRisk.verdict === "regenerate") {
      return json({
        ok: false, retry: true,
        error: `HALLUCINATION_RISK: ${v2Result.hallucinationRisk.riskScore}`,
        elapsed_ms: Date.now() - startMs,
      }, 503);
    }

    const charCount = content.html.length;
    const minChars = stepConfig.minChars || 400;
    if (charCount < minChars) {
      return json({
        ok: false, retry: true,
        error: `Content too short: ${charCount}/${minChars} chars`,
        elapsed_ms: Date.now() - startMs,
      }, 503);
    }
  }

  // ── Build final content payload ──
  const bloomLevel = STEP_BLOOM_MAP[stepKey] || "understand";
  const lfWeightPct = lfData?.weight_percent || 0;
  const examRelevanceScore = Math.min(5, Math.max(1,
    Math.round((lfWeightPct > 15 ? 4 : lfWeightPct > 10 ? 3 : 2) + (difficultyLevel === "hard" ? 1 : 0))
  ));

  const finalContent = isMiniCheck
    ? {
        type: "mini_check",
        questions: content.questions,
        objectives: content.objectives,
        bloom_level: "apply",
        exam_relevance_score: examRelevanceScore,
        competency_id: (lesson as any).competency_id || null,
        learning_field_id: lfId || null,
        generated_at: new Date().toISOString(),
        version: 5,
      }
    : {
        type: "text",
        html: content.html,
        objectives: content.objectives || [],
        key_terms: content.key_terms || [],
        common_mistakes: content.common_mistakes || [],
        exam_triggers: content.exam_triggers || [],
        transfer_questions: content.transfer_questions || [],
        bloom_level: bloomLevel,
        exam_relevance_score: examRelevanceScore,
        step: stepKey,
        competency_id: (lesson as any).competency_id || null,
        learning_field_id: lfId || null,
        mastery_weight: lfWeightPct > 15 ? "high" : lfWeightPct > 10 ? "medium" : "low",
        generated_at: new Date().toISOString(),
        version: 5,
        meta: { plain_retry: plainRetry },
      };

  // ── Budget check before persist — prevent mid-write kills ──
  if (shouldSoftStop(startMs, "lesson_single")) {
    return json({ ok: false, retry: true, error: "budget_exhausted_pre_persist", elapsed_ms: Date.now() - startMs }, 503);
  }

  // ── Persist to content_versions (Council write path) ──
  const stepKeyCanonical = canonicalStepKey(stepKey);
  const { data: newVersion, error: vErr } = await sb.from("content_versions").insert({
    course_id: courseId,
    lesson_id: lessonId,
    step_key: stepKeyCanonical,
    content_json: finalContent,
    created_by_agent: "lesson-generate-content",
    status: "approved",
    council_round: 1,
    entity_type: isMiniCheck ? "minicheck" : "lesson_step",
    published_at: new Date().toISOString(),
    published_by: "pipeline-auto-approve",
  }).select("id").single();

  if (vErr) {
    // Handle duplicate (race condition)
    if (vErr.message?.includes("idx_cv_idempotency") || vErr.code === "23505") {
      return json({ ok: true, skipped: true, reason: "deduped_on_persist" });
    }
    return json({ error: "persist_failed", details: vErr.message }, 500);
  }

  // ── Audit: council message ──
  await sb.from("council_messages").insert({
    content_version_id: newVersion!.id,
    agent_name: "lesson-generate-content",
    message_type: "proposal",
    message_json: { source: "single-unit-worker", profession: professionName, used_provider: (result as any).provider, used_model: (result as any).model, plain_retry: plainRetry },
  });

  // ── Cost logging ──
  await logLLMCostEvent(sb, {
    job_type: "lesson_generate_content",
    provider: (result as any).provider,
    model: (result as any).model,
    tokens_in: (result as any).usage?.input_tokens || 0,
    tokens_out: (result as any).usage?.output_tokens || 0,
    package_id: packageId,
    certification_id: certificationId,
    course_id: courseId,
    estimatedUsage: (result as any).estimatedUsage,
    meta: { plain_retry: plainRetry, step_key: stepKey },
  });

  return json({
    ok: true,
    package_id: packageId,
    lesson_id: lessonId,
    step_key: stepKey,
    version_id: newVersion!.id,
    provider: (result as any).provider,
    model: (result as any).model,
    plain_retry: plainRetry,
    elapsed_ms: Date.now() - startMs,
    chars: isMiniCheck ? undefined : content.html?.length,
  });
});
