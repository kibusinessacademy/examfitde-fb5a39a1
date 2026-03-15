/**
 * ai-gateway/sync-executor.ts — Dispatches sync generation requests
 * to the appropriate domain function and writes results back.
 *
 * Phase C1: Gateway becomes the orchestrator for sync paths.
 */

export interface SyncExecutionInput {
  requestId: string;
  jobType: string;
  payload: Record<string, unknown>;
  sourceRef?: Record<string, unknown>;
  sourceId?: string;
  packageId?: string;
  courseId?: string;
  curriculumId?: string;
  certificationId?: string;
  model?: string;
}

export interface SyncExecutionResult {
  ok: boolean;
  status: "completed" | "failed";
  resultSummary?: Record<string, unknown>;
  errorSummary?: Record<string, unknown>;
  elapsedMs: number;
}

/**
 * Map jobType → edge function name for sync dispatch.
 */
const JOB_TYPE_TO_FUNCTION: Record<string, string> = {
  lesson_generate_content: "lesson-generate-content",
  // Future: expand_handbook_section, package_generate_glossary, etc.
};

/**
 * Execute a sync generation by calling the domain function,
 * then update ai_generation_requests with the outcome.
 */
export async function executeSyncDispatch(
  sb: any,
  input: SyncExecutionInput,
): Promise<SyncExecutionResult> {
  const fnStart = Date.now();
  const functionName = JOB_TYPE_TO_FUNCTION[input.jobType];

  if (!functionName) {
    const errMsg = `No sync executor registered for jobType: ${input.jobType}`;
    console.error(`[ai-gateway] SYNC_EXEC: ${errMsg}`);
    await updateRequestStatus(sb, input.requestId, "failed", undefined, { error: errMsg });
    return { ok: false, status: "failed", errorSummary: { error: errMsg }, elapsedMs: Date.now() - fnStart };
  }

  // ── 1. Mark as processing ──
  await sb.from("ai_generation_requests").update({
    status: "processing_sync",
    started_at: new Date().toISOString(),
  }).eq("id", input.requestId);

  // ── 2. Build domain payload with correlation IDs ──
  const domainPayload = buildDomainPayload(input);

  // ── 3. Call domain function via internal fetch ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const fnUrl = `${supabaseUrl}/functions/v1/${functionName}`;

  console.log(`[ai-gateway] SYNC_EXEC: ${input.jobType} → ${functionName} (req=${input.requestId.slice(0, 8)})`);

  let fnResponse: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000); // 55s (within 60s edge limit)

    fnResponse = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
      },
      body: JSON.stringify(domainPayload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (fetchErr) {
    const errMsg = `SYNC_FETCH_FAILED: ${(fetchErr as Error).message?.slice(0, 200)}`;
    console.error(`[ai-gateway] ${errMsg}`);
    await updateRequestStatus(sb, input.requestId, "failed", undefined, {
      sync_execution: errMsg,
      transient: true,
    });
    return { ok: false, status: "failed", errorSummary: { error: errMsg }, elapsedMs: Date.now() - fnStart };
  }

  // ── 4. Parse response and update status ──
  let fnBody: any;
  try {
    fnBody = await fnResponse.json();
  } catch {
    fnBody = { ok: false, error: "Failed to parse function response" };
  }

  const elapsed = Date.now() - fnStart;

  if (fnResponse.ok && fnBody.ok !== false) {
    // Success — domain function completed (content written, etc.)
    const resultSummary = {
      sync_execution: true,
      function_name: functionName,
      domain_response_ok: true,
      batch_mode: fnBody.batch_mode || false,
      elapsed_ms: elapsed,
      finalized_at: new Date().toISOString(),
      ...(fnBody.content_version_id ? { content_version_id: fnBody.content_version_id } : {}),
    };

    await updateRequestStatus(sb, input.requestId, "completed", resultSummary);

    console.log(`[ai-gateway] SYNC_EXEC_OK: ${input.jobType} completed in ${elapsed}ms (req=${input.requestId.slice(0, 8)})`);
    return { ok: true, status: "completed", resultSummary, elapsedMs: elapsed };
  } else {
    // Failure
    const isTransient = fnBody.retry === true || fnBody.transient === true || fnResponse.status === 503;
    const errorSummary = {
      sync_execution: true,
      function_name: functionName,
      http_status: fnResponse.status,
      domain_error: fnBody.error?.slice?.(0, 300) || "unknown",
      transient: isTransient,
      elapsed_ms: elapsed,
    };

    await updateRequestStatus(sb, input.requestId, "failed", undefined, errorSummary);

    console.error(`[ai-gateway] SYNC_EXEC_FAIL: ${input.jobType} → ${fnResponse.status} in ${elapsed}ms (req=${input.requestId.slice(0, 8)})`);
    return { ok: false, status: "failed", errorSummary, elapsedMs: elapsed };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildDomainPayload(input: SyncExecutionInput): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...input.payload,
    _force_sync: true,
    _gateway_mode: true,
    _ai_generation_request_id: input.requestId,
  };

  // Propagate standard IDs from gateway request if not already in payload
  if (input.packageId && !base.package_id) base.package_id = input.packageId;
  if (input.courseId && !base.course_id) base.course_id = input.courseId;
  if (input.curriculumId && !base.curriculum_id) base.curriculum_id = input.curriculumId;
  if (input.certificationId && !base.certification_id) base.certification_id = input.certificationId;
  if (input.sourceId && !base.lesson_id) base.lesson_id = input.sourceId;

  // Propagate sourceRef fields (job_id, step_key, etc.)
  if (input.sourceRef) {
    if (input.sourceRef.job_id && !base.job_id) base.job_id = input.sourceRef.job_id;
    if (input.sourceRef.step_key && !base.step_key) base.step_key = input.sourceRef.step_key;
    if (input.sourceRef.lesson_id && !base.lesson_id) base.lesson_id = input.sourceRef.lesson_id;
  }

  return base;
}

async function updateRequestStatus(
  sb: any,
  requestId: string,
  status: "completed" | "failed",
  resultSummary?: Record<string, unknown>,
  errorSummary?: Record<string, unknown>,
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "completed") {
    update.completed_at = new Date().toISOString();
  }
  if (resultSummary) update.result_summary = resultSummary;
  if (errorSummary) update.error_summary = errorSummary;

  await sb.from("ai_generation_requests").update(update).eq("id", requestId);
}
