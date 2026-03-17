/**
 * lesson-gen/llm-runner.ts — LLM execution, checkpoint, parse, and plain-JSON fallback.
 * Knows nothing about lesson domain — only prompt execution and response extraction.
 */

import { callAIWithFailover, RateLimitError } from "../ai-client.ts";
import { isTransientLlmError, classifyError } from "../llm/normalize.ts";
import { setProviderCooldown } from "../llm/provider-cooldown.ts";
import { canonicalStepKey } from "../step-keys.ts";
import { parseLlmResponse } from "./json-repair.ts";
import type { LessonRequest, LessonRuntime, LessonPrompts, LlmResult } from "./types.ts";

/**
 * Execute the LLM call with checkpoint saving, response parsing, and plain-JSON fallback.
 */
export async function runLessonLLM(
  sb: any,
  req: LessonRequest,
  runtime: LessonRuntime,
  prompts: LessonPrompts,
  professionName: string,
  startMs: number,
  json: (body: unknown, status?: number) => Response,
): Promise<{ result: LlmResult } | { error: Response }> {
  let result: any;
  let content: any = null;
  let plainRetry = false;

  try {
    result = await callAIWithFailover(
      runtime.chain.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          { role: "system", content: prompts.systemPrompt },
          { role: "user", content: prompts.userPrompt },
        ],
        max_tokens: runtime.effectiveMaxTokens,
        timeout_ms: runtime.llmTimeoutMs,
      },
    );

    // Checkpoint: save raw LLM response immediately
    const rawResponseText = result.toolCalls?.[0]?.function?.arguments || result.content || "";
    if (rawResponseText.length > 100) {
      try {
        await sb.from("content_versions").insert({
          course_id: req.courseId,
          lesson_id: req.lessonId,
          step_key: canonicalStepKey(req.stepKey),
          content_json: {
            _checkpoint: true,
            raw: rawResponseText.slice(0, 15000),
            provider: result.provider,
            model: result.model,
            ts: Date.now(),
          },
          created_by_agent: "lesson-gen-checkpoint",
          status: "draft",
          entity_type: req.isMiniCheck ? "minicheck" : "lesson_step",
        });
        console.log(`[lesson-gen] CHECKPOINT saved: ${rawResponseText.length} chars for ${req.lessonId.slice(0, 8)}`);
      } catch (cpErr) {
        console.warn(`[lesson-gen] CHECKPOINT_FAIL: ${(cpErr as Error)?.message?.slice(0, 120) || 'unknown'} (lesson=${req.lessonId.slice(0, 8)})`);
      }
    }

    // Parse response
    content = parseLlmResponse(result, req.isMiniCheck, req.lessonId);

    if (!content || (!content.html && !content.questions)) {
      const cLen = result.content?.length || 0;
      if (cLen === 0) {
        const err = new Error(`LLM_EMPTY_RESPONSE: empty (provider=${result.provider}, model=${result.model})`);
        (err as any).name = "LLM_EMPTY_RESPONSE";
        throw err;
      }
      const fenceStripped = result.content?.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim() || "";
      if (cLen > 0) {
        console.error(`[lesson-gen] PARSE_FAIL_DIAGNOSTIC: provider=${result.provider} model=${result.model} len=${cLen} first300=${JSON.stringify(fenceStripped.slice(0, 300))} last100=${JSON.stringify(fenceStripped.slice(-100))}`);
      }
      throw new Error(`No parseable tool response (provider=${result.provider}, model=${result.model}, contentLength=${cLen})`);
    }
  } catch (e) {
    const errMsg = (e as Error).message || String(e);
    const transient = isTransientLlmError(e);
    const classification = classifyError(e);

    // Plain-JSON fallback
    if (errMsg.includes("No parseable tool response") && !plainRetry) {
      plainRetry = true;
      try {
        const plainChainCandidates = runtime.fullChain.slice(0, 1);
        const retryChain = plainChainCandidates.length > 0 ? plainChainCandidates : runtime.chain;
        console.warn(`[lesson-gen] TOOL_PARSE_FAIL → plain retry provider=${retryChain[0]?.provider} model=${retryChain[0]?.model} lesson=${req.lessonId.slice(0, 8)} isMiniCheck=${req.isMiniCheck}`);

        const plainSystemPrompt = req.isMiniCheck
          ? `Du bist ein IHK-Fachexperte. Erstelle einen MiniCheck (Quiz) für "${professionName}". Antworte mit einem JSON-Objekt: {"questions": [{"question": "...", "options": ["A","B","C","D"], "correct_answer": 0, "explanation": "..."}], "objectives": ["..."]}. NUR JSON, kein Markdown.`
          : `Du bist ein IHK-Fachexperte. Erstelle Lerninhalt für "${professionName}". Antworte mit einem JSON-Objekt: {"html": "...", "objectives": [...], "key_terms": [...], "common_mistakes": [...], "exam_triggers": [...]}. NUR JSON, kein Markdown.`;

        const plainResult = await callAIWithFailover(
          retryChain.map(c => ({ provider: c.provider, model: c.model })),
          {
            messages: [
              { role: "system", content: plainSystemPrompt },
              { role: "user", content: prompts.userPrompt },
            ],
            max_tokens: runtime.effectiveMaxTokens,
            timeout_ms: Math.min(35_000, Math.max(15_000, runtime.llmTimeoutMs - 10_000)),
          },
        );

        let plainContent: any;
        const rawPlain = (plainResult.content || "").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        // Support both object {...} and array [...] responses
        const firstBracket = rawPlain.indexOf("[");
        const firstBrace = rawPlain.indexOf("{");
        const isArray = firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);
        if (isArray) {
          const lb = rawPlain.lastIndexOf("]");
          if (lb > firstBracket) {
            try { plainContent = JSON.parse(rawPlain.slice(firstBracket, lb + 1)); } catch { /* noop */ }
          }
        } else if (firstBrace !== -1) {
          const lb = rawPlain.lastIndexOf("}");
          if (lb > firstBrace) {
            try { plainContent = JSON.parse(rawPlain.slice(firstBrace, lb + 1)); } catch { /* noop */ }
          }
        }

        const plainSuccess = req.isMiniCheck
          ? (plainContent?.questions && Array.isArray(plainContent.questions) && plainContent.questions.length > 0)
          : (plainContent?.html && plainContent.html.length > 200);

        if (plainSuccess) {
          content = plainContent;
          result = plainResult;
          console.log(`[lesson-gen] Plain JSON fallback SUCCESS (${retryChain[0].model}) for ${req.lessonId.slice(0, 8)} (${req.isMiniCheck ? plainContent.questions.length + ' questions' : plainContent.html.length + ' chars'})`);
        }
      } catch (plainErr) {
        console.warn(`[lesson-gen] Plain retry also failed: ${(plainErr as Error).message?.slice(0, 100)}`);
      }
    }

    // Only set cooldown if BOTH failed
    if (!content || (!content.html && !content.questions)) {
      if (classification.isTransient && classification.providerCooldownMs && runtime.chain.length > 0) {
        const usedProvider = runtime.chain[0];
        try {
          await setProviderCooldown({
            provider: usedProvider.provider,
            model: usedProvider.model,
            ms: classification.providerCooldownMs,
            reason: `lesson-gen: ${classification.reason} (${errMsg.slice(0, 80)})`,
          });
        } catch { /* Best-effort */ }
      }

      const isParseFailure = errMsg.includes("No parseable tool response");
      const isTransient = transient || e instanceof RateLimitError || isParseFailure;
      return {
        error: json({
          ok: false, retry: isTransient, transient: isTransient,
          error: `${isTransient ? "TRANSIENT: " : ""}${errMsg.slice(0, 200)}`,
          elapsed_ms: Date.now() - startMs,
          provider_cooldown: classification.providerCooldownMs
            ? { provider: runtime.chain[0]?.provider, model: runtime.chain[0]?.model, ms: classification.providerCooldownMs, reason: classification.reason }
            : undefined,
        }, isTransient ? 503 : 500),
      };
    }
  }

  return { result: { content, result, plainRetry } };
}
