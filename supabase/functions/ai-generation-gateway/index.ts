import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { resolvePolicy } from "../_shared/ai-gateway/policies.ts";
import { computeDeficit } from "../_shared/ai-gateway/deficits.ts";
import { buildCacheKey, hashPrompt, checkCache, storeInCache } from "../_shared/ai-gateway/cache.ts";
import { decideRouting } from "../_shared/ai-gateway/router.ts";
import { buildRequestFingerprint, checkDuplicateRequest } from "../_shared/ai-gateway/fingerprints.ts";
import { logGatewayDecision, logCostSaving } from "../_shared/ai-gateway/observability.ts";
import type { GatewayRequest, GatewayResult, RoutingDecision } from "../_shared/ai-gateway/types.ts";
import { buildBatchRequests, submitBatchViaFunction } from "../_shared/batch/enqueue-openai.ts";
import { batchSafeModel } from "../_shared/batch/routing-config.ts";
import { executeSyncDispatch } from "../_shared/ai-gateway/sync-executor.ts";

/**
 * ai-generation-gateway — Central entry point for all AI generation requests.
 *
 * Enforces: Policy → Deficit → Cache → Dedup → Routing → Dispatch → Finalize
 * Phase C1: Sync paths are now executed inline via domain function calls.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const startMs = Date.now();

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body: GatewayRequest = await req.json().catch(() => ({} as any));

    // ── 1. Validate input ──
    if (!body.jobType || !body.targetArtifact) {
      return json({ error: "Missing required fields: jobType, targetArtifact" }, 400);
    }

    const urgency = body.urgency || "async";
    const qualityTier = body.qualityTier || "standard";
    const forceSyncMode = body.forceSyncMode === true;

    // ── 2. Load policy ──
    const policy = await resolvePolicy(sb, body.jobType);

    if (!policy.enabled) {
      console.log(`[ai-gateway] POLICY_DISABLED: ${body.jobType}`);
      return json({
        ok: true,
        requestId: "n/a",
        status: "skipped",
        routingMode: "skipped",
        cacheHit: false,
        skipped: true,
        deficitResult: { shouldGenerate: false, artifact: body.targetArtifact, reason: "policy_disabled" },
      } satisfies GatewayResult);
    }

    // ── 3. Compute deficit ──
    const deficit = await computeDeficit(sb, body.jobType, {
      packageId: body.packageId,
      courseId: body.courseId,
      lessonId: body.sourceId,
      stepKey: (body.payload?.step_key as string) || undefined,
      curriculumId: body.curriculumId,
      blueprintId: (body.payload?.blueprint_id as string) || undefined,
    });

    // ── 4. Check cache ──
    let cacheHit = false;
    let cacheKey: string | undefined;
    let cachedResponse: Record<string, unknown> | undefined;

    if (policy.useCache && body.messages?.length) {
      const promptText = body.messages.map(m => m.content).join("\n");
      const promptHash = await hashPrompt(promptText);
      cacheKey = await buildCacheKey({
        jobType: body.jobType,
        model: policy.defaultModel,
        promptHash,
        blueprintId: (body.payload?.blueprint_id as string) || undefined,
        difficulty: (body.payload?.difficulty as string) || undefined,
      });

      const cached = await checkCache(sb, cacheKey);
      if (cached.found) {
        cacheHit = true;
        cachedResponse = cached.responseBody;
      }
    }

    // ── 5. Routing decision ──
    const routingMode: RoutingDecision = decideRouting({
      policy,
      deficit,
      cacheHit,
      urgency,
      forceSyncMode,
      templatePossible: false, // Template engine Phase 3
      packageId: body.packageId || undefined,
    });

    // ── 6. Fingerprint + dedup ──
    const promptText = body.messages?.map(m => m.content).join("\n") || "";
    const fingerprint = await buildRequestFingerprint({
      jobType: body.jobType,
      sourceId: body.sourceId,
      targetArtifact: body.targetArtifact,
      model: policy.defaultModel,
      promptText,
      payloadKeys: {
        blueprint_id: (body.payload?.blueprint_id as string) || undefined,
        step_key: (body.payload?.step_key as string) || undefined,
        difficulty: (body.payload?.difficulty as string) || undefined,
      },
    });

    if (routingMode !== "skipped" && routingMode !== "cache_hit") {
      const dup = await checkDuplicateRequest(sb, fingerprint);
      if (dup.isDuplicate) {
        console.log(`[ai-gateway] DEDUP: ${body.jobType} already ${dup.existingStatus} (${dup.existingId?.slice(0, 8)})`);
        return json({
          ok: true,
          requestId: dup.existingId!,
          status: dup.existingStatus!,
          routingMode: routingMode,
          cacheHit: false,
          skipped: false,
          error: "duplicate_request",
        } satisfies GatewayResult);
      }
    }

    // ── 7. Persist request record ──
    const { data: reqRow, error: insertErr } = await sb
      .from("ai_generation_requests")
      .insert({
        job_type: body.jobType,
        source_table: body.sourceTable || null,
        source_id: body.sourceId || null,
        source_ref: body.sourceRef || null,
        package_id: body.packageId || null,
        course_id: body.courseId || null,
        certification_id: body.certificationId || null,
        target_artifact: body.targetArtifact,
        urgency,
        quality_tier: qualityTier,
        deficit_required: policy.requireDeficit,
        deficit_result: deficit,
        cache_key: cacheKey || null,
        request_fingerprint: fingerprint,
        routing_mode: routingMode,
        provider: null,
        model: policy.defaultModel,
        status: routingMode === "skipped" ? "skipped" : routingMode === "cache_hit" ? "cache_hit" : "queued",
        policy_snapshot: policy as any,
        request_payload: body.payload || {},
        max_retries: policy.maxRetries,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error(`[ai-gateway] INSERT_FAIL: ${insertErr.message}`);
      return json({ ok: false, error: `INSERT_FAIL: ${insertErr.message}` }, 500);
    }

    const requestId = reqRow.id;

    // ── 8. Execute routing decision ──

    // SKIP
    if (routingMode === "skipped") {
      logCostSaving(body.jobType, "deficit_skip", policy.maxTokensOut || 1000);
      logGatewayDecision({
        jobType: body.jobType, routingMode, deficitResult: deficit,
        cacheHit: false, model: policy.defaultModel,
        elapsedMs: Date.now() - startMs, requestId,
      });
      return json({
        ok: true, requestId, status: "skipped", routingMode,
        cacheHit: false, skipped: true, deficitResult: deficit,
      } satisfies GatewayResult);
    }

    // CACHE HIT
    if (routingMode === "cache_hit" && cachedResponse) {
      await sb.from("ai_generation_requests").update({
        status: "completed",
        result_summary: cachedResponse,
        completed_at: new Date().toISOString(),
      }).eq("id", requestId);

      logCostSaving(body.jobType, "cache_hit", policy.maxTokensOut || 1000);
      logGatewayDecision({
        jobType: body.jobType, routingMode, deficitResult: deficit,
        cacheHit: true, model: policy.defaultModel,
        elapsedMs: Date.now() - startMs, requestId,
      });
      return json({
        ok: true, requestId, status: "cache_hit", routingMode,
        cacheHit: true, skipped: false, deficitResult: deficit,
      } satisfies GatewayResult);
    }

    // BATCH
    if (routingMode === "batch" && body.messages?.length) {
      // CRITICAL: Ensure model is batch-compatible (Phase A: OpenAI only)
      const model = batchSafeModel(policy.defaultModel);
      const customId = `gw_${body.jobType}_${requestId.slice(0, 8)}_${Date.now()}`;

      const batchRequests = buildBatchRequests([{
        customId,
        sourceJobId: null,
        sourceRef: {
          ...(body.sourceRef || {}),
          course_id: body.courseId || (body.sourceRef as any)?.course_id || null,
          package_id: body.packageId || (body.sourceRef as any)?.package_id || null,
          lesson_id: body.sourceId || (body.sourceRef as any)?.lesson_id || null,
        },
        aiGenerationRequestId: requestId,
        jobType: body.jobType,
        model,
        messages: body.messages as Array<{ role: string; content: string }>,
        temperature: 0.7,
        maxTokens: policy.maxTokensOut || 4096,
      }]);

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const submitResult = await submitBatchViaFunction(supabaseUrl, serviceRoleKey, {
        jobType: body.jobType,
        model,
        requests: batchRequests,
        metadata: {
          gateway_request_id: requestId,
          package_id: body.packageId,
          course_id: body.courseId,
          target_artifact: body.targetArtifact,
        },
      });

      if (submitResult.ok) {
        await sb.from("ai_generation_requests").update({
          status: "batch_pending",
          started_at: new Date().toISOString(),
          llm_batch_id: submitResult.batchId || null,
        }).eq("id", requestId);

        logGatewayDecision({
          jobType: body.jobType, routingMode, deficitResult: deficit,
          cacheHit: false, model,
          elapsedMs: Date.now() - startMs, requestId,
        });

        return json({
          ok: true, requestId, status: "batch_pending", routingMode,
          cacheHit: false, skipped: false, deficitResult: deficit,
          batchId: submitResult.batchId,
        } satisfies GatewayResult);
      } else {
        // Batch submit failed — mark for sync fallback
        console.error(`[ai-gateway] BATCH_SUBMIT_FAILED: ${submitResult.error}`);
        await sb.from("ai_generation_requests").update({
          status: "queued",
          routing_mode: "sync",
          error_summary: { batch_submit_error: submitResult.error },
        }).eq("id", requestId);

        // Fall through to sync or return retry
        return json({
          ok: false, requestId, status: "queued", routingMode: "sync" as RoutingDecision,
          cacheHit: false, skipped: false,
          error: `BATCH_SUBMIT_FAILED: ${submitResult.error}`,
        }, 503);
      }
    }

    // SYNC — execute via domain function call (Phase C1)
    const syncResult = await executeSyncDispatch(sb, {
      requestId,
      jobType: body.jobType,
      payload: body.payload || {},
      sourceRef: body.sourceRef as Record<string, unknown> | undefined,
      sourceId: body.sourceId,
      packageId: body.packageId,
      courseId: body.courseId,
      curriculumId: body.curriculumId,
      certificationId: body.certificationId,
      model: policy.defaultModel,
    });

    logGatewayDecision({
      jobType: body.jobType, routingMode, deficitResult: deficit,
      cacheHit: false, model: policy.defaultModel,
      elapsedMs: Date.now() - startMs, requestId,
    });

    return json({
      ok: syncResult.ok,
      requestId,
      status: syncResult.status,
      routingMode,
      cacheHit: false,
      skipped: false,
      deficitResult: deficit,
      ...(syncResult.resultSummary ? { resultSummary: syncResult.resultSummary } : {}),
      ...(syncResult.errorSummary ? { error: (syncResult.errorSummary as any).domain_error || "sync_execution_failed" } : {}),
    } satisfies GatewayResult, syncResult.ok ? 200 : 502);

  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[ai-gateway] UNHANDLED: ${msg.slice(0, 300)}`);
    return json({ ok: false, error: `UNHANDLED: ${msg.slice(0, 200)}`, elapsed_ms: Date.now() - startMs }, 500);
  }
});
