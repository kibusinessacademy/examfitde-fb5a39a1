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

  const startMs = Date.now();
  try {

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
  const budget = getTimeBudget("lesson_single");

  if (!packageId || !courseId || !lessonId || !stepKeyRaw) {
    return json({ error: "Missing required fields (package_id, course_id, lesson_id, step_key)" }, 400);
  }

  const stepKey = canonicalStepKey(stepKeyRaw);
  const isMiniCheck = stepKey === "mini_check" || stepKey === "step_5_minicheck";

  // ── Idempotency: skip if content_version already exists ──
  // CRITICAL: tier1_failed lessons MUST regenerate — reject stale versions first
  const { data: lessonQc } = await sb
    .from("lessons")
    .select("qc_status")
    .eq("id", lessonId)
    .maybeSingle();

  const forceRegen = lessonQc?.qc_status === "tier1_failed";

  if (forceRegen) {
    // Reject all non-rejected versions so idempotency doesn't block regen
    const { data: staleVersions } = await sb
      .from("content_versions")
      .select("id")
      .eq("lesson_id", lessonId)
      .eq("step_key", canonicalStepKey(stepKeyRaw))
      .neq("status", "rejected");

    if (staleVersions && staleVersions.length > 0) {
      const vIds = staleVersions.map((v: any) => v.id);
      await sb
        .from("content_versions")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .in("id", vIds);
      console.log(`[worker] FORCE_REGEN: Rejected ${vIds.length} stale versions for tier1_failed lesson ${lessonId.slice(0, 8)}`);
    }
  } else {
    const existing = await existingVersion(sb, lessonId, stepKey);
    if (existing) {
      return json({ ok: true, skipped: true, reason: "already_generated", versionId: existing.id });
    }
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

  // ═══════════════════════════════════════════════════════════════
  // v9.1 HARDENING: Platform-aware time governance
  // Platform hard-kills at 55s. All budgets must fit within this.
  // ═══════════════════════════════════════════════════════════════

  const PLATFORM_HARD_LIMIT_MS = 55_000;
  const MIN_LLM_BUDGET_MS = 12_000;   // min time we need for a useful LLM call
  const MIN_PERSIST_MS = 5_000;        // DB write + council + cost log
  const MIN_CHECKPOINT_MS = 1_500;     // raw checkpoint write

  // ── Gate 1: Soft-stop check ──
  if (shouldSoftStop(startMs, "lesson_single")) {
    return json({ ok: false, retry: true, error: "SOFTSTOP: budget_exhausted_pre", elapsed_ms: Date.now() - startMs }, 503);
  }

  // ── Gate 2: Remaining-time fast-fail ──
  const elapsedMs = Date.now() - startMs;
  const remainingPlatformMs = PLATFORM_HARD_LIMIT_MS - elapsedMs;
  const requiredMinMs = MIN_LLM_BUDGET_MS + MIN_PERSIST_MS + MIN_CHECKPOINT_MS;

  if (remainingPlatformMs < requiredMinMs) {
    console.warn(`[lesson-gen] FAST_FAIL: only ${remainingPlatformMs}ms left (need ${requiredMinMs}ms). Init took ${elapsedMs}ms.`);
    return json({
      ok: false, retry: true,
      error: `SOFTSTOP: insufficient_time_budget (remaining=${remainingPlatformMs}ms, need=${requiredMinMs}ms, init=${elapsedMs}ms)`,
      elapsed_ms: elapsedMs,
    }, 503);
  }

  // ── Autopilot: p95 latency check → model/token downgrade ──
  let maxTokensOverride: number | null = null;
  let autopilotAction: string | null = null;
  const fullChain = await getModelChainAsync(isMiniCheck ? "minicheck" : "learning_content");

  try {
    const { data: latencyStats } = await sb.rpc("get_provider_p95_latency", {
      p_job_type: "lesson_generate_content",
      p_window_minutes: 30,
    }).maybeSingle();

    if (latencyStats?.p95_ms && latencyStats.p95_ms > 35_000) {
      const originalMax = isMiniCheck ? 2200 : 3200;
      maxTokensOverride = Math.round(originalMax * 0.65);
      autopilotAction = `p95_clamp: ${latencyStats.p95_ms}ms → tokens ${originalMax}→${maxTokensOverride}`;
      console.log(`[lesson-gen] AUTOPILOT: ${autopilotAction}`);
    }
  } catch {
    // RPC doesn't exist yet or failed — proceed without autopilot
  }

  // ═══════════════════════════════════════════════════════════════
  // v9.2 CRITICAL FIX: Single-provider per edge run
  //
  // ROOT CAUSE: Sequential fallback chain (4 providers) shares 38s
  // budget → each gets ~9s → ALL timeout → 100% failure rate.
  //
  // FIX: Use exactly 1 provider per edge invocation.
  // On retry (next job attempt), rotate to next provider in chain.
  // This gives each provider the FULL 38s budget.
  // ═══════════════════════════════════════════════════════════════

  // ── v9.3: Explicit attempt_index for deterministic provider rotation ──
  // attempt_index is 0-based, sent by content-runner. Falls back gracefully.
  const attemptIndex = Number.isFinite(p.attempt_index) ? p.attempt_index : (p.attempts ?? 0);
  const providerIndex = attemptIndex % fullChain.length;
  const chain = [fullChain[providerIndex]];
  console.log(`[lesson-gen] SINGLE_PROVIDER: chain[${providerIndex}] = ${chain[0].provider}/${chain[0].model} (attempt_index=${attemptIndex}, chain_size=${fullChain.length}, job=${(p.job_id || 'unknown').slice(0,8)})`);

  // ═══════════════════════════════════════════════════════════════
  // v9.2 TOKEN CLAMP: Hard limit to fit within 38s LLM budget
  //
  // With 3200 tokens + tool-calling, providers consistently need >38s.
  // Clamping to 1200 (lesson) / 600 (minicheck) ensures completion
  // within the time budget while still producing quality content.
  // ═══════════════════════════════════════════════════════════════

  const TOKEN_CLAMP_LESSON = 2400;   // v10.4: was 3200 — reduced to fit within 38s LLM budget during provider slowdowns
  const TOKEN_CLAMP_MINICHECK = 1200; // v10.3: was 700 — too tight for structured tool responses
  const baseTokenClamp = isMiniCheck ? TOKEN_CLAMP_MINICHECK : TOKEN_CLAMP_LESSON;
  const effectiveMaxTokens = maxTokensOverride
    ? Math.min(maxTokensOverride, baseTokenClamp)
    : baseTokenClamp;

  // ── Compute LLM timeout: allow slower providers enough room without hitting platform hard-limit ──
  const llmBudgetMs = remainingPlatformMs - MIN_PERSIST_MS - MIN_CHECKPOINT_MS;
  const llmTimeoutMs = Math.max(MIN_LLM_BUDGET_MS, Math.min(38_000, llmBudgetMs));
  const llmAbort = new AbortController();
  const llmTimer = setTimeout(() => llmAbort.abort(), llmTimeoutMs) as unknown as number;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`LLM_TIMEOUT_${llmTimeoutMs}`)), llmTimeoutMs + 500);
  });

  console.log(`[lesson-gen] Time budget: init=${elapsedMs}ms, llm_cap=${llmTimeoutMs}ms, remaining=${remainingPlatformMs}ms, tokens=${effectiveMaxTokens}${autopilotAction ? `, autopilot=${autopilotAction}` : ""}`);

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

ANTWORTFORMAT (PFLICHT):
Antworte mit einem einzigen JSON-Objekt. KEIN Markdown, KEINE Code-Fences, NUR valides JSON.
${isMiniCheck
  ? '{"questions": [{"question": "...", "options": ["A","B","C","D"], "correct_answer": 0, "explanation": "..."}], "objectives": ["..."]}'
  : '{"html": "<h3>...</h3><p>...</p>", "objectives": ["..."], "key_terms": [{"term": "...", "definition": "...", "exam_relevance": "..."}], "common_mistakes": [{"mistake": "...", "correction": "...", "trap_type": "..."}], "exam_triggers": ["..."]}'
}
KEINE Platzhalter. Vollständigen Inhalt generieren.`,
            },
            { role: "user", content: userPrompt },
          ],
          max_tokens: effectiveMaxTokens,
          signal: llmAbort.signal,
        },
      ),
      timeoutPromise,
    ]) as Awaited<ReturnType<typeof callAIWithFailover>>;

    // ── CHECKPOINT: Save raw LLM response immediately (before parse) ──
    // If platform kills during parse/validate, we don't lose the expensive LLM result
    const rawResponseText = result.toolCalls?.[0]?.function?.arguments || result.content || "";
    if (rawResponseText.length > 100) {
      try {
        await sb.from("content_versions").insert({
          course_id: courseId,
          lesson_id: lessonId,
          step_key: canonicalStepKey(stepKey),
          content_json: { _checkpoint: true, raw: rawResponseText.slice(0, 15000), provider: result.provider, model: result.model, ts: Date.now() },
          created_by_agent: "lesson-gen-checkpoint",
          status: "draft",
          entity_type: isMiniCheck ? "minicheck" : "lesson_step",
        });
        console.log(`[lesson-gen] CHECKPOINT saved: ${rawResponseText.length} chars for ${lessonId.slice(0,8)}`);
      } catch (cpErr) {
        console.warn(`[lesson-gen] CHECKPOINT_FAIL: ${(cpErr as Error)?.message?.slice(0, 120) || 'unknown'} (lesson=${lessonId.slice(0,8)})`);
      }
    }

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

    // ── Plain-JSON fallback: rotate to DIFFERENT provider (no tools) ──
    if (errMsg.includes("No parseable tool response") && !plainRetry) {
      plainRetry = true;
      try {
        // v10: Use a non-Gemini provider for plain retry to avoid same parse issue
        const plainChainCandidates = fullChain
          .filter(c => !c.model.includes("gemini"))
          .slice(0, 1);
        const retryChainResolved = plainChainCandidates.length > 0 ? plainChainCandidates : chain;
        console.warn(`[lesson-gen] TOOL_PARSE_FAIL → plain retry provider=${retryChainResolved[0]?.provider} model=${retryChainResolved[0]?.model} lesson=${lessonId.slice(0,8)}`);
        const retryChain = retryChainResolved;

        const plainResult = await callAIWithFailover(
          retryChain.map(c => ({ provider: c.provider, model: c.model })),
          {
            messages: [
              { role: "system", content: `Du bist ein IHK-Fachexperte. Erstelle Lerninhalt für "${professionName}". Antworte mit einem JSON-Objekt: {"html": "...", "objectives": [...], "key_terms": [...], "common_mistakes": [...], "exam_triggers": [...]}. NUR JSON, kein Markdown.` },
              { role: "user", content: userPrompt },
            ],
            max_tokens: effectiveMaxTokens,
            timeout_ms: Math.min(20_000, llmTimeoutMs),
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
          console.log(`[lesson-gen] Plain JSON fallback SUCCESS (${retryChain[0].model}) for ${lessonId.slice(0, 8)} (${plainContent.html.length} chars)`);
        }
      } catch (plainErr) {
        console.warn(`[lesson-gen] Plain retry also failed: ${(plainErr as Error).message?.slice(0, 100)}`);
      }
    }

    if (!content || (!content.html && !content.questions)) {
      // v9.4: "No parseable tool response" IS retryable — rotation will try a different provider
      const isParseFailure = errMsg.includes("No parseable tool response");
      const isTransient = transient || e instanceof RateLimitError || isParseFailure;
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

  // ── Gate 3: Pre-persist platform budget check ──
  const prePersistRemaining = PLATFORM_HARD_LIMIT_MS - (Date.now() - startMs);
  if (prePersistRemaining < MIN_PERSIST_MS) {
    console.warn(`[lesson-gen] SOFTSTOP pre-persist: only ${prePersistRemaining}ms left. Checkpoint should be saved.`);
    return json({ ok: false, retry: true, error: `SOFTSTOP: pre_persist_budget (remaining=${prePersistRemaining}ms)`, elapsed_ms: Date.now() - startMs }, 503);
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
    // DB persist errors are transient (connection issues, locks) — use 503 so runner retries
    const isConstraint = vErr.code?.startsWith("23"); // 23xxx = constraint violations = permanent
    return json({
      ok: false, retry: !isConstraint, transient: !isConstraint,
      error: `persist_failed: ${vErr.message?.slice(0, 150)}`,
      elapsed_ms: Date.now() - startMs,
    }, isConstraint ? 500 : 503);
  }

  // ── Cleanup checkpoint (best-effort, non-blocking) ──
  sb.from("content_versions")
    .delete()
    .eq("lesson_id", lessonId)
    .eq("step_key", stepKeyCanonical)
    .eq("created_by_agent", "lesson-gen-checkpoint")
    .eq("status", "draft")
    .then(() => {});

  // ── Audit: council message ──
  await sb.from("council_messages").insert({
    content_version_id: newVersion!.id,
    agent_name: "lesson-generate-content",
    message_type: "proposal",
    message_json: { source: "single-unit-worker", profession: professionName, used_provider: (result as any).provider, used_model: (result as any).model, plain_retry: plainRetry, autopilot: autopilotAction },
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
    meta: { plain_retry: plainRetry, step_key: stepKey, autopilot: autopilotAction, attempt_index: attemptIndex, provider_index: providerIndex },
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
    autopilot: autopilotAction,
    elapsed_ms: Date.now() - startMs,
    llm_timeout_ms: llmTimeoutMs,
    chars: isMiniCheck ? undefined : content.html?.length,
  });

  } catch (outerErr) {
    // ── Global safety net: classify unhandled exceptions ──
    const msg = (outerErr as Error).message || String(outerErr);
    const isTransient = isTransientLlmError(outerErr) ||
      msg.includes("timeout") || msg.includes("TIMEOUT") ||
      msg.includes("AbortError") || msg.includes("connection") ||
      msg.includes("fetch failed");
    console.error(`[lesson-gen] UNHANDLED: ${msg.slice(0, 300)}`);
    return json({
      ok: false,
      retry: isTransient,
      transient: isTransient,
      error: `UNHANDLED: ${msg.slice(0, 200)}`,
      elapsed_ms: Date.now() - startMs,
    }, isTransient ? 503 : 500);
  }
});
