/**
 * lesson-gen-core.ts — Core processing logic for lesson-generate-content.
 * Extracted to reduce bundle size of the edge function entrypoint.
 */

import { callAIWithFailover, logLLMCostEvent, RateLimitError } from "./ai-client.ts";
import { isTransientLlmError, classifyError } from "./llm/normalize.ts";
import { setProviderCooldown, filterCooledDownProviders } from "./llm/provider-cooldown.ts";
import { getModelChainAsync } from "./model-routing.ts";
import { resolveAvailableRoute } from "./llm/provider-load-balancer.ts";
import { resolveProfession } from "./profession-resolver.ts";
import { loadCachedGlossary, formatGlossaryForPrompt } from "./glossary-loader.ts";
import { runV2QualityGate, loadMasteryContext, buildMasteryFeedbackSuffix, adjustDifficultyByMastery, mapToDifficultyLevel, getRequiredDepth } from "./prompt-kit.ts";
import type { DifficultyLevel, MasteryContext } from "./prompt-kit.ts";
import { canonicalStepKey } from "./step-keys.ts";
import { getTimeBudget, shouldSoftStop } from "./time-budget.ts";
import { STEP_PROMPTS, STEP_BLOOM_MAP, buildMiniCheckPrompt } from "./lesson-gen-prompts.ts";

// ═══════════════════════════════════════════════════════════════
// JSON Extraction Utilities
// ═══════════════════════════════════════════════════════════════

/**
 * Balanced-brace JSON extraction: finds the first { and counts braces to find matching }.
 */
export function extractBalancedJson(text: string): any | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  // Truncated JSON — repair using nesting stack
  const partial = text.slice(start);
  const nestStack: string[] = [];
  inString = false; escape = false;
  for (const ch of partial) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") nestStack.push("{");
    else if (ch === "}") nestStack.pop();
    else if (ch === "[") nestStack.push("[");
    else if (ch === "]") nestStack.pop();
  }
  if (nestStack.length > 0 || inString) {
    let repaired = partial;
    repaired = repaired.replace(/,\s*$/, "");
    repaired = repaired.replace(/:\s*$/, ': null');
    let strOpen = false; escape = false;
    for (const ch of repaired) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') strOpen = !strOpen;
    }
    if (strOpen) repaired += '"';
    for (let i = nestStack.length - 1; i >= 0; i--) {
      repaired += nestStack[i] === "{" ? "}" : "]";
    }
    try {
      const parsed = JSON.parse(repaired);
      console.log(`[lesson-gen] extractBalancedJson: repaired truncated JSON (stack depth=${nestStack.length})`);
      return parsed;
    } catch { /* noop */ }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Idempotency check
// ═══════════════════════════════════════════════════════════════

export async function existingVersion(sb: any, lessonId: string, step: string) {
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
// Main processing function
// ═══════════════════════════════════════════════════════════════

const PLATFORM_HARD_LIMIT_MS = 55_000;
const MIN_LLM_BUDGET_MS = 15_000;
const MIN_PERSIST_MS = 4_000;
const MIN_CHECKPOINT_MS = 1_000;
const TOKEN_CLAMP_LESSON = 3200;
const TOKEN_CLAMP_MINICHECK = 2400;

export async function processLesson(sb: any, p: any, startMs: number): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
      "content-type": "application/json",
    },
  });

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;
  const lessonId = p.lesson_id;
  const stepKeyRaw = p.step_key || p.step;

  if (!packageId || !courseId || !lessonId || !stepKeyRaw) {
    return json({ error: "Missing required fields (package_id, course_id, lesson_id, step_key)" }, 400);
  }

  const stepKey = canonicalStepKey(stepKeyRaw);
  const isMiniCheck = stepKey === "mini_check" || stepKey === "step_5_minicheck";

  // ── Idempotency: skip if content_version already exists ──
  const { data: lessonQc } = await sb
    .from("lessons")
    .select("qc_status")
    .eq("id", lessonId)
    .maybeSingle();

  const forceRegen = lessonQc?.qc_status === "tier1_failed";

  if (forceRegen) {
    const { data: staleVersions } = await sb
      .from("content_versions")
      .select("id")
      .eq("lesson_id", lessonId)
      .eq("step_key", canonicalStepKey(stepKeyRaw))
      .neq("status", "rejected");

    if (staleVersions && staleVersions.length > 0) {
      const vIds = staleVersions.map((v: any) => v.id);
      await sb.from("content_versions")
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

  // ── Load LF context ──
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
        if (glossary) glossaryContext = formatGlossaryForPrompt(glossary, lfData?.code || null);
      } catch { /* no glossary — proceed */ }
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  const lfContext = lfData ? [
    `Lernfeld: ${lfData.code} – ${lfData.title}`,
    `Prüfungsgewichtung: ${lfData.weight_percent}%`,
    lfData.exam_part ? `Prüfungsteil: ${lfData.exam_part}` : "",
    `Schwierigkeitsstufe: ${lfData.difficulty_tier}`,
    Array.isArray(lfData.ihk_focus_areas) && lfData.ihk_focus_areas.length > 0 ? `IHK-Schwerpunkte: ${lfData.ihk_focus_areas.join(", ")}` : "",
  ].filter(Boolean).join("\n") : "";

  // ── Adaptive difficulty ──
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
    return json({ ok: false, retry: true, error: `SOFTSTOP: insufficient_time_budget (remaining=${remainingPlatformMs}ms, need=${requiredMinMs}ms, init=${elapsedMs}ms)`, elapsed_ms: elapsedMs }, 503);
  }

  // ── Autopilot: p95 latency check ──
  let maxTokensOverride: number | null = null;
  let autopilotAction: string | null = null;

  const workloadKey = isMiniCheck ? "minicheck" : "learning_content";
  let rawChain: Awaited<ReturnType<typeof getModelChainAsync>>;
  const policyRoute = await resolveAvailableRoute(workloadKey);
  if (policyRoute.ok && policyRoute.provider && policyRoute.model) {
    console.log(`[lesson-gen] POLICY_ROUTE: ${workloadKey} → ${policyRoute.provider}/${policyRoute.model}`);
    const hardcodedChain = await getModelChainAsync(isMiniCheck ? "minicheck" : "learning_content");
    rawChain = [
      { provider: policyRoute.provider as any, model: policyRoute.model },
      ...hardcodedChain.filter(c => c.model !== policyRoute.model),
    ];
  } else {
    console.log(`[lesson-gen] POLICY_MISS: ${workloadKey} (${policyRoute.reason}) → hardcoded chain`);
    rawChain = await getModelChainAsync(isMiniCheck ? "minicheck" : "learning_content");
  }

  const fullChain = await filterCooledDownProviders(rawChain);

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

  // ── Single-provider per edge run ──
  const attemptIndex = Number.isFinite(p.attempt_index) ? p.attempt_index : (p.attempts ?? 0);
  const jobHash = Number.isFinite(p._job_hash) ? p._job_hash : 0;
  const providerIndex = (jobHash + attemptIndex) % fullChain.length;
  const chain = [fullChain[providerIndex]];
  console.log(`[lesson-gen] SINGLE_PROVIDER: chain[${providerIndex}] = ${chain[0].provider}/${chain[0].model} (attempt=${attemptIndex}, hash=${jobHash}, chain_size=${fullChain.length}, job=${(p.job_id || 'unknown').slice(0,8)})`);

  const baseTokenClamp = isMiniCheck ? TOKEN_CLAMP_MINICHECK : TOKEN_CLAMP_LESSON;
  const effectiveMaxTokens = maxTokensOverride
    ? Math.min(maxTokensOverride, baseTokenClamp)
    : baseTokenClamp;

  const llmBudgetMs = remainingPlatformMs - MIN_PERSIST_MS - MIN_CHECKPOINT_MS;
  const llmTimeoutMs = Math.max(MIN_LLM_BUDGET_MS, Math.min(50_000, llmBudgetMs));

  console.log(`[lesson-gen] Time budget: init=${elapsedMs}ms, llm_cap=${llmTimeoutMs}ms, remaining=${remainingPlatformMs}ms, tokens=${effectiveMaxTokens}${autopilotAction ? `, autopilot=${autopilotAction}` : ""}`);

  let result: Awaited<ReturnType<typeof callAIWithFailover>>;
  let content: any = null;
  let plainRetry = false;

  try {
    result = await callAIWithFailover(
      chain.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          {
            role: "system",
            content: `Du bist IHK-Fachexperte (20 J. Erfahrung) für ${professionName}. Schreibe wie ein Ausbilder, nicht wie KI.
${glossaryContext}
PFLICHT: ⭐ IHK-Prüfungstipp + ⚠️ Prüfungsfalle. Praxis statt Theorie. Konkrete §§ bei Recht, vollständige Rechenwege bei Zahlen.
${lfData?.difficulty_tier === 'hard' ? 'SCHWER: Mehrstufige Berechnungen, Kombinationsaufgaben, Pro-Contra.' : ''}
${lfData?.ihk_focus_areas?.length ? `IHK-Schwerpunkte: ${lfData.ihk_focus_areas.join(", ")}` : ''}
Keine Floskeln. Keine Einleitungen. Direkt zum Inhalt.

FORMAT: Antworte NUR mit validem JSON (kein Markdown, keine Fences).
${isMiniCheck
  ? '{"questions": [{"question": "...", "options": ["A","B","C","D"], "correct_answer": 0, "explanation": "..."}], "objectives": ["..."]}'
  : '{"html": "<h3>...</h3><p>...</p>", "objectives": ["..."], "key_terms": [{"term": "...", "definition": "...", "exam_relevance": "..."}], "common_mistakes": [{"mistake": "...", "correction": "...", "trap_type": "..."}], "exam_triggers": ["..."]}'
}`,
          },
          { role: "user", content: userPrompt },
        ],
        max_tokens: effectiveMaxTokens,
        timeout_ms: llmTimeoutMs,
      },
    );

    // ── CHECKPOINT: Save raw LLM response immediately ──
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

    // Parse tool call
    if (result.toolCalls?.length > 0) {
      try { content = JSON.parse(result.toolCalls[0].function.arguments); } catch { /* fallthrough */ }
    }
    const fenceStripped = result.content
      ? result.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
      : "";
    if (!content && fenceStripped) {
      try { content = JSON.parse(fenceStripped); } catch { /* fallthrough */ }
    }
    if (!content && fenceStripped) {
      content = extractBalancedJson(fenceStripped);
    }
    if (!content && !isMiniCheck && fenceStripped && fenceStripped.length > 200) {
      if (fenceStripped.includes("<h3") || fenceStripped.includes("<p") || fenceStripped.includes("<strong")) {
        content = { html: fenceStripped, objectives: [] };
      }
    }
    if (!content && isMiniCheck && fenceStripped && fenceStripped.length > 200) {
      const qMatch = fenceStripped.match(/"questions"\s*:\s*\[/);
      if (qMatch && qMatch.index !== undefined) {
        let searchStart = fenceStripped.lastIndexOf("{", qMatch.index);
        if (searchStart === -1) searchStart = 0;
        const candidate = extractBalancedJson(fenceStripped.slice(searchStart));
        if (candidate?.questions && Array.isArray(candidate.questions)) {
          content = candidate;
          console.log(`[lesson-gen] Fallback4: extracted questions array (${candidate.questions.length} items) for ${lessonId.slice(0, 8)}`);
        }
      }
    }
    // P0-A Sanitizer
    if (content?.html && typeof content.html === "string") {
      const trimmed = content.html.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
        const cleaned = trimmed.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        try {
          const inner = JSON.parse(cleaned);
          if (inner.html && typeof inner.html === "string") {
            content.html = inner.html;
            content.objectives = content.objectives || inner.objectives || [];
            content.key_terms = content.key_terms || inner.key_terms || [];
            console.log(`[lesson-gen] P0-A: Unwrapped double-serialized content.html for ${lessonId.slice(0, 8)}`);
          }
        } catch { /* not JSON, leave as-is */ }
      }
    }

    if (!content || (!content.html && !content.questions)) {
      const cLen = result.content?.length || 0;
      if (cLen > 0) {
        console.error(`[lesson-gen] PARSE_FAIL_DIAGNOSTIC: provider=${result.provider} model=${result.model} len=${cLen} first300=${JSON.stringify(fenceStripped.slice(0, 300))} last100=${JSON.stringify(fenceStripped.slice(-100))}`);
      }
      if (cLen === 0) {
        const err = new Error(`LLM_EMPTY_RESPONSE: empty (provider=${result.provider}, model=${result.model})`);
        (err as any).name = "LLM_EMPTY_RESPONSE";
        throw err;
      }
      throw new Error(`No parseable tool response (provider=${result.provider}, model=${result.model}, contentLength=${cLen})`);
    }
  } catch (e) {
    const errMsg = (e as Error).message || String(e);
    const transient = isTransientLlmError(e);
    const classification = classifyError(e);

    // ── Plain-JSON fallback ──
    if (errMsg.includes("No parseable tool response") && !plainRetry) {
      plainRetry = true;
      try {
        const plainChainCandidates = fullChain.filter(c => !c.model.includes("gemini")).slice(0, 1);
        const retryChainResolved = plainChainCandidates.length > 0 ? plainChainCandidates : chain;
        console.warn(`[lesson-gen] TOOL_PARSE_FAIL → plain retry provider=${retryChainResolved[0]?.provider} model=${retryChainResolved[0]?.model} lesson=${lessonId.slice(0,8)} isMiniCheck=${isMiniCheck}`);

        const plainRetrySystemPrompt = isMiniCheck
          ? `Du bist ein IHK-Fachexperte. Erstelle einen MiniCheck (Quiz) für "${professionName}". Antworte mit einem JSON-Objekt: {"questions": [{"question": "...", "options": ["A","B","C","D"], "correct_answer": 0, "explanation": "..."}], "objectives": ["..."]}. NUR JSON, kein Markdown.`
          : `Du bist ein IHK-Fachexperte. Erstelle Lerninhalt für "${professionName}". Antworte mit einem JSON-Objekt: {"html": "...", "objectives": [...], "key_terms": [...], "common_mistakes": [...], "exam_triggers": [...]}. NUR JSON, kein Markdown.`;

        const plainResult = await callAIWithFailover(
          retryChainResolved.map(c => ({ provider: c.provider, model: c.model })),
          {
            messages: [
              { role: "system", content: plainRetrySystemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: effectiveMaxTokens,
            timeout_ms: Math.min(35_000, Math.max(15_000, llmTimeoutMs - 10_000)),
          },
        );

        let plainContent: any;
        const rawPlain = (plainResult.content || "").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const fb = rawPlain.indexOf("{");
        const lb = rawPlain.lastIndexOf("}");
        if (fb !== -1 && lb > fb) {
          try { plainContent = JSON.parse(rawPlain.slice(fb, lb + 1)); } catch { /* noop */ }
        }

        const plainSuccess = isMiniCheck
          ? (plainContent?.questions && Array.isArray(plainContent.questions) && plainContent.questions.length > 0)
          : (plainContent?.html && plainContent.html.length > 200);

        if (plainSuccess) {
          content = plainContent;
          result = plainResult as any;
          console.log(`[lesson-gen] Plain JSON fallback SUCCESS (${retryChainResolved[0].model}) for ${lessonId.slice(0, 8)} (${isMiniCheck ? plainContent.questions.length + ' questions' : plainContent.html.length + ' chars'})`);
        }
      } catch (plainErr) {
        console.warn(`[lesson-gen] Plain retry also failed: ${(plainErr as Error).message?.slice(0, 100)}`);
      }
    }

    // Only set cooldown if BOTH failed
    if (!content || (!content.html && !content.questions)) {
      if (classification.isTransient && classification.providerCooldownMs && chain.length > 0) {
        const usedProvider = chain[0];
        try {
          await setProviderCooldown({
            provider: usedProvider.provider,
            model: usedProvider.model,
            ms: classification.providerCooldownMs,
            reason: `lesson-gen: ${classification.reason} (${errMsg.slice(0, 80)})`,
          });
        } catch (_cdErr) { /* Best-effort */ }
      }

      const isParseFailure = errMsg.includes("No parseable tool response");
      const isTransient = transient || e instanceof RateLimitError || isParseFailure;
      return json({
        ok: false, retry: isTransient, transient: isTransient,
        error: `${isTransient ? "TRANSIENT: " : ""}${errMsg.slice(0, 200)}`,
        elapsed_ms: Date.now() - startMs,
        provider_cooldown: classification.providerCooldownMs ? { provider: chain[0]?.provider, model: chain[0]?.model, ms: classification.providerCooldownMs, reason: classification.reason } : undefined,
      }, isTransient ? 503 : 500);
    }
  }

  // ── Quality gate ──
  if (!isMiniCheck && content.html) {
    const v2Result = runV2QualityGate(content.html, stepKey, difficultyLevel);
    if (v2Result.hallucinationRisk.verdict === "regenerate") {
      return json({ ok: false, retry: true, error: `HALLUCINATION_RISK: ${v2Result.hallucinationRisk.riskScore}`, elapsed_ms: Date.now() - startMs }, 503);
    }
    const charCount = content.html.length;
    const minChars = stepConfig.minChars || 400;
    if (charCount < minChars) {
      return json({ ok: false, retry: true, error: `Content too short: ${charCount}/${minChars} chars`, elapsed_ms: Date.now() - startMs }, 503);
    }
  }

  // ── Build final content payload ──
  const bloomLevel = STEP_BLOOM_MAP[stepKey] || "understand";
  const lfWeightPct = lfData?.weight_percent || 0;
  const examRelevanceScore = Math.min(5, Math.max(1,
    Math.round((lfWeightPct > 15 ? 4 : lfWeightPct > 10 ? 3 : 2) + (difficultyLevel === "hard" ? 1 : 0))
  ));

  const enrichedQuestions = isMiniCheck && Array.isArray(content.questions)
    ? content.questions.map((q: any) => ({
        question: q.question || q.question_text || "",
        options: q.options || [],
        correct_answer: q.correct_answer ?? q.correctIndex ?? 0,
        explanation: q.explanation || "",
        difficulty: q.difficulty || "mittel",
        bloom_level: q.bloom_level || "apply",
        trap_type: q.trap_type || null,
      }))
    : content.questions;

  const finalContent = isMiniCheck
    ? {
        type: "mini_check",
        questions: enrichedQuestions,
        objectives: content.objectives,
        bloom_level: "apply",
        exam_relevance_score: examRelevanceScore,
        competency_id: (lesson as any).competency_id || null,
        learning_field_id: lfId || null,
        generated_at: new Date().toISOString(),
        version: 6,
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

  // ── Gate 3: Pre-persist budget check ──
  const prePersistRemaining = PLATFORM_HARD_LIMIT_MS - (Date.now() - startMs);
  if (prePersistRemaining < MIN_PERSIST_MS) {
    console.warn(`[lesson-gen] SOFTSTOP pre-persist: only ${prePersistRemaining}ms left.`);
    return json({ ok: false, retry: true, error: `SOFTSTOP: pre_persist_budget (remaining=${prePersistRemaining}ms)`, elapsed_ms: Date.now() - startMs }, 503);
  }

  // ── Persist to content_versions ──
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
    if (vErr.message?.includes("idx_cv_idempotency") || vErr.code === "23505") {
      return json({ ok: true, skipped: true, reason: "deduped_on_persist" });
    }
    const isConstraint = vErr.code?.startsWith("23");
    return json({
      ok: false, retry: !isConstraint, transient: !isConstraint,
      error: `persist_failed: ${vErr.message?.slice(0, 150)}`,
      elapsed_ms: Date.now() - startMs,
    }, isConstraint ? 500 : 503);
  }

  // ── Direct sync to lessons.content ──
  try {
    await sb.rpc("pipeline_write_lesson_content", { p_lesson_id: lessonId, p_content: finalContent });
  } catch (_syncErr) {
    console.warn(`[lesson-gen] direct sync fallback failed for ${lessonId.slice(0, 8)}: ${(_syncErr as Error)?.message?.slice(0, 100)}`);
  }

  // ── Cleanup checkpoint ──
  try {
    await sb.from("content_versions")
      .delete()
      .eq("lesson_id", lessonId)
      .eq("step_key", stepKeyCanonical)
      .eq("created_by_agent", "lesson-gen-checkpoint")
      .eq("status", "draft");
  } catch (_e) { /* best-effort */ }

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
    used_provider: (result as any).provider,
    used_model: (result as any).model,
    plain_retry: plainRetry,
    autopilot: autopilotAction,
    elapsed_ms: Date.now() - startMs,
    llm_timeout_ms: llmTimeoutMs,
    chars: isMiniCheck ? undefined : content.html?.length,
  });
}
