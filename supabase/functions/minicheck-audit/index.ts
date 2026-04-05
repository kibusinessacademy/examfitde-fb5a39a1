/**
 * minicheck-audit — Hardened MiniCheck question quality audit.
 *
 * P0 fixes: auth (no anon key), fail-closed on AI error, strict bounds validation, schema validation
 * P1 fixes: concurrency lock, differentiated audit-log states, admin JWT via getUser
 *
 * Trigger: cron (nightly via CRON_SECRET) or manual POST (admin JWT)
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { parseLlmJson } from "../_shared/json-parse-safe.ts";

// ── Config ──────────────────────────────────────────────────────────
const BATCH_SIZE = 25;
const MAX_QUESTIONS_PER_RUN = 500;
const DELAY_BETWEEN_BATCHES_MS = 1200;
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `Du bist ein Fachprüfer für IHK-Prüfungsfragen. Prüfe ob correct_answer (0-basiert) korrekt ist.

Prüfe:
1. Stimmt die fachliche Aussage der als korrekt markierten Option?
2. Sind Rechenwege (Kalkulation, MwSt, Formeln, Spannung/Strom/Widerstand etc.) korrekt?
3. Gibt es eine andere Option, die fachlich korrekter wäre?
4. Ist die Erklärung konsistent mit der markierten Antwort?

Antworte AUSSCHLIESSLICH als JSON-Array (keine Prosa, kein Markdown, keine Code-Fences):
[{"id":"<id>","status":"ok"},{"id":"<id>","status":"error","correct_answer":<richtig>,"reason":"<kurze Begründung>"}]`;

// ── Types ───────────────────────────────────────────────────────────
interface AuditResultOk {
  id: string;
  status: "ok";
}

interface AuditResultError {
  id: string;
  status: "error";
  correct_answer: number;
  reason: string;
}

type AuditResult = AuditResultOk | AuditResultError;

interface AuditError extends AuditResultError {
  old_answer?: number;
}

type AuditLogStatus = "running" | "completed" | "completed_with_errors" | "failed";

// ── Auth ────────────────────────────────────────────────────────────

/**
 * Strict auth: only CRON_SECRET header, EDGE_INTERNAL_SHARED_SECRET, or validated admin JWT.
 * Anon key and service role key as Bearer tokens are REJECTED.
 */
async function authenticateRequest(
  req: Request,
  sb: ReturnType<typeof createClient>,
): Promise<{ authorized: boolean; source: string }> {
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

  // 1. Internal edge-to-edge / cron via dedicated header
  const jobRunnerKey = req.headers.get("x-job-runner-key");
  const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || supabaseServiceKey;
  if (jobRunnerKey && jobRunnerKey === internalSecret) {
    return { authorized: true, source: "internal" };
  }

  // 2. CRON_SECRET via dedicated header
  const cronSecret = Deno.env.get("CRON_SECRET");
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronSecret && cronHeader && cronHeader === cronSecret) {
    return { authorized: true, source: "cron" };
  }

  // 3. Admin JWT via Authorization header
  const rawAuth = req.headers.get("authorization") || "";
  if (!rawAuth.startsWith("Bearer ")) {
    return { authorized: false, source: "none" };
  }

  const token = rawAuth.replace("Bearer ", "");

  // BLOCK: reject service role key and anon key as Bearer tokens
  if (token === supabaseServiceKey || token === supabaseAnonKey) {
    console.warn("[minicheck-audit] BLOCKED: privileged key used as Bearer token");
    return { authorized: false, source: "blocked_key" };
  }

  // Validate JWT and check admin role
  try {
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      supabaseAnonKey,
      { global: { headers: { Authorization: rawAuth } } },
    );
    const { data: { user }, error } = await anonClient.auth.getUser(token);
    if (error || !user) {
      return { authorized: false, source: "invalid_jwt" };
    }

    const { data: roles } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roles) {
      return { authorized: false, source: "not_admin" };
    }

    return { authorized: true, source: "admin_jwt" };
  } catch {
    return { authorized: false, source: "auth_error" };
  }
}

// ── Concurrency Lock ────────────────────────────────────────────────

/**
 * Acquire a run lock via minicheck_audit_log.
 * If another run for the same curriculum is 'running', we skip it.
 * Returns log ID or null if locked.
 */
async function acquireRunLock(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  runType: string,
  questionCount: number,
): Promise<string | null> {
  // Check for existing running audit
  const { data: existing } = await sb
    .from("minicheck_audit_log")
    .select("id, created_at")
    .eq("curriculum_id", curriculumId)
    .eq("status", "running")
    .limit(1);

  if (existing && existing.length > 0) {
    // Stale lock check: if running > 30min, force-complete it
    const age = Date.now() - new Date(existing[0].created_at).getTime();
    if (age > 30 * 60 * 1000) {
      await sb
        .from("minicheck_audit_log")
        .update({ status: "failed" as string, completed_at: new Date().toISOString() })
        .eq("id", existing[0].id);
    } else {
      return null; // genuinely locked
    }
  }

  const { data: logEntry } = await sb
    .from("minicheck_audit_log")
    .insert({
      curriculum_id: curriculumId,
      batch_start: 0,
      batch_end: questionCount,
      status: "running",
      run_type: runType,
      model: MODEL,
    })
    .select("id")
    .single();

  return logEntry?.id || null;
}

// ── AI Call + Schema Validation ─────────────────────────────────────

function buildPrompt(questions: any[]): string {
  return questions
    .map((q: any) => {
      const opts = (q.options || [])
        .map((o: any, i: number) => {
          const txt = typeof o === "string" ? o : o?.text || String(o);
          return `  ${i}: ${txt}`;
        })
        .join("\n");
      return `ID: ${q.id}\nFrage: ${q.question_text}\nOptionen:\n${opts}\ncorrect_answer: ${q.correct_answer}\nErklärung: ${q.explanation || "-"}`;
    })
    .join("\n---\n");
}

/**
 * Validate a single AI result against known batch IDs and option counts.
 */
function validateResult(
  result: any,
  knownIds: Set<string>,
  optionCounts: Map<string, number>,
): AuditResult | null {
  if (!result || typeof result !== "object") return null;
  if (typeof result.id !== "string" || !knownIds.has(result.id)) return null;

  if (result.status === "ok") {
    return { id: result.id, status: "ok" };
  }

  if (result.status === "error") {
    const ca = result.correct_answer;
    const optCount = optionCounts.get(result.id) || 0;

    // P0: strict bounds check
    if (typeof ca !== "number" || !Number.isInteger(ca) || ca < 0 || ca >= optCount) {
      console.warn(
        `[minicheck-audit] Rejected invalid correct_answer=${ca} for ${result.id} (options: ${optCount})`,
      );
      return null;
    }

    if (typeof result.reason !== "string" || result.reason.length < 5) {
      return null;
    }

    return {
      id: result.id,
      status: "error",
      correct_answer: ca,
      reason: result.reason,
    };
  }

  return null;
}

async function callAIValidated(
  batch: any[],
  apiKey: string,
): Promise<{ results: AuditResult[]; aiError: boolean }> {
  const knownIds = new Set(batch.map((q: any) => q.id));
  const optionCounts = new Map(
    batch.map((q: any) => [q.id, Array.isArray(q.options) ? q.options.length : 0]),
  );

  const prompt = buildPrompt(batch);

  let rawText: string;
  try {
    const resp = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error(`[minicheck-audit] AI gateway error ${resp.status}: ${txt}`);
      return { results: [], aiError: true };
    }

    const data = await resp.json();
    rawText = data.choices?.[0]?.message?.content || "";
  } catch (e) {
    console.error(`[minicheck-audit] AI fetch error: ${e}`);
    return { results: [], aiError: true };
  }

  // Parse using robust LLM parser from SSOT shared module
  let parsed: any;
  try {
    parsed = parseLlmJson(rawText);
  } catch {
    console.error(`[minicheck-audit] JSON parse failed for batch`);
    return { results: [], aiError: true };
  }

  const rawArray = Array.isArray(parsed) ? parsed : parsed?.results;
  if (!Array.isArray(rawArray)) {
    console.error(`[minicheck-audit] AI response is not an array`);
    return { results: [], aiError: true };
  }

  // Validate each result strictly, reject duplicates
  const seenIds = new Set<string>();
  const validResults: AuditResult[] = [];

  for (const item of rawArray) {
    const validated = validateResult(item, knownIds, optionCounts);
    if (validated && !seenIds.has(validated.id)) {
      seenIds.add(validated.id);
      validResults.push(validated);
    }
  }

  return { results: validResults, aiError: false };
}

// ── Main Handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

  if (!lovableApiKey) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers,
    });
  }

  const sb = createClient(supabaseUrl, supabaseKey);

  // ── Auth (P0: no anon key, no service role as Bearer) ──
  const auth = await authenticateRequest(req, sb);
  if (!auth.authorized) {
    console.warn(`[minicheck-audit] Auth rejected: ${auth.source}`);
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  // ── Parse body ──
  let targetCurriculumId: string | null = null;
  let maxLimit = MAX_QUESTIONS_PER_RUN;

  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body.curriculum_id && typeof body.curriculum_id === "string") {
        targetCurriculumId = body.curriculum_id;
      }
      if (typeof body.limit === "number" && body.limit > 0) {
        maxLimit = Math.min(body.limit, 2000);
      }
    } catch {
      /* no body = nightly run */
    }
  }

  const runType = targetCurriculumId ? "manual" : "nightly";

  try {
    // ── Find curricula with unaudited questions ──
    let query = sb
      .from("minicheck_questions")
      .select("curriculum_id")
      .eq("status", "approved")
      .is("last_audited_at", null)
      .order("curriculum_id");

    if (targetCurriculumId) {
      query = query.eq("curriculum_id", targetCurriculumId);
    }

    const { data: currRows } = await query.limit(1000);
    const curriculumIds = [...new Set((currRows || []).map((r: any) => r.curriculum_id))];

    if (curriculumIds.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, message: "No unaudited questions found", audited: 0 }),
        { headers },
      );
    }

    console.log(
      `[minicheck-audit] ${runType} run: ${curriculumIds.length} curricula, auth=${auth.source}`,
    );

    const runResults: any[] = [];
    let totalChecked = 0;
    let totalErrors = 0;
    let totalFixed = 0;
    let totalSkippedBatches = 0;

    for (const currId of curriculumIds) {
      if (totalChecked >= maxLimit) break;

      const remaining = maxLimit - totalChecked;
      const fetchLimit = Math.min(remaining, MAX_QUESTIONS_PER_RUN);

      // Fetch unaudited questions
      const { data: questions, error: fetchErr } = await sb
        .from("minicheck_questions")
        .select("id, question_text, options, correct_answer, explanation, difficulty")
        .eq("curriculum_id", currId)
        .eq("status", "approved")
        .is("last_audited_at", null)
        .order("id", { ascending: true })
        .limit(fetchLimit);

      if (fetchErr || !questions?.length) continue;

      // ── Concurrency lock (P1) ──
      const logId = await acquireRunLock(sb, currId, runType, questions.length);
      if (!logId) {
        console.log(`[minicheck-audit] Skipping ${currId}: locked by another run`);
        continue;
      }

      const allErrors: AuditError[] = [];
      let okCount = 0;
      let batchErrors = 0;
      let logStatus: AuditLogStatus = "completed";

      // ── Process in batches ──
      for (let i = 0; i < questions.length; i += BATCH_SIZE) {
        const batch = questions.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        const { results, aiError } = await callAIValidated(batch, lovableApiKey);

        if (aiError) {
          // P0: do NOT mark as audited on AI error — mark as pending_retry
          batchErrors++;
          totalSkippedBatches++;
          const batchIds = batch.map((q: any) => q.id);
          await sb
            .from("minicheck_questions")
            .update({ audit_status: "pending_retry" })
            .in("id", batchIds);

          console.warn(`[minicheck-audit] ${currId} B${batchNum}: AI error, marked pending_retry`);
        } else {
          // Successfully processed — split into matched and unmatched
          const processedIds = new Set(results.map((r) => r.id));

          for (const r of results) {
            if (r.status === "error") {
              const orig = batch.find((q: any) => q.id === r.id);
              allErrors.push({ ...r, old_answer: orig?.correct_answer });
            } else {
              okCount++;
            }
          }

          // Mark successfully checked questions
          const checkedIds = batch
            .filter((q: any) => processedIds.has(q.id))
            .map((q: any) => q.id);
          if (checkedIds.length > 0) {
            await sb
              .from("minicheck_questions")
              .update({
                last_audited_at: new Date().toISOString(),
                audit_status: "checked",
              })
              .in("id", checkedIds);
          }

          // Questions not in AI response: mark pending_retry
          const missedIds = batch
            .filter((q: any) => !processedIds.has(q.id))
            .map((q: any) => q.id);
          if (missedIds.length > 0) {
            await sb
              .from("minicheck_questions")
              .update({ audit_status: "pending_retry" })
              .in("id", missedIds);
          }

          console.log(
            `[minicheck-audit] ${currId} B${batchNum}: ${results.length}/${batch.length} validated, ${results.filter((r) => r.status === "error").length} errors`,
          );
        }

        // Rate limit
        if (i + BATCH_SIZE < questions.length) {
          await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
        }
      }

      // ── Auto-fix verified errors (P0: bounds already validated above) ──
      let fixedCount = 0;
      for (const err of allErrors) {
        // Only fix if AI suggested a different answer
        if (err.correct_answer !== err.old_answer) {
          const { error: updateErr } = await sb
            .from("minicheck_questions")
            .update({
              correct_answer: err.correct_answer,
              audit_status: "fixed",
              last_audited_at: new Date().toISOString(),
            })
            .eq("id", err.id);

          if (!updateErr) {
            fixedCount++;
          } else {
            console.error(`[minicheck-audit] Fix failed for ${err.id}: ${updateErr.message}`);
          }
        }
      }

      // ── Determine log status (P1: differentiated states) ──
      if (batchErrors > 0 && batchErrors === Math.ceil(questions.length / BATCH_SIZE)) {
        logStatus = "failed";
      } else if (batchErrors > 0) {
        logStatus = "completed_with_errors";
      }

      await sb
        .from("minicheck_audit_log")
        .update({
          questions_checked: okCount + allErrors.length,
          errors_found: allErrors.length,
          errors_fixed: fixedCount,
          error_details: allErrors,
          status: logStatus,
          completed_at: new Date().toISOString(),
        })
        .eq("id", logId);

      totalChecked += okCount + allErrors.length;
      totalErrors += allErrors.length;
      totalFixed += fixedCount;

      runResults.push({
        curriculum_id: currId,
        checked: okCount + allErrors.length,
        errors_found: allErrors.length,
        errors_fixed: fixedCount,
        skipped_batches: batchErrors,
        log_status: logStatus,
      });
    }

    console.log(
      `[minicheck-audit] DONE: ${totalChecked} checked, ${totalErrors} errors, ${totalFixed} fixed, ${totalSkippedBatches} skipped batches`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        total_checked: totalChecked,
        total_errors: totalErrors,
        total_fixed: totalFixed,
        total_skipped_batches: totalSkippedBatches,
        curricula: runResults,
      }),
      { headers },
    );
  } catch (e) {
    console.error(`[minicheck-audit] Fatal error:`, e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Audit failed" }),
      { status: 500, headers },
    );
  }
});
