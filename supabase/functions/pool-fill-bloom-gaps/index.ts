import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
// C7 cleanup (2026-05-20): callAIJSON import removed — function uses Lovable AI Gateway
// directly (LOVABLE_API_KEY) per Patch D.2. The import was dead and tripped Phase 2
// gateway-bypass guards. NO direct GOOGLE_AI_API_KEY usage remains.
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { enqueueJob } from "../_shared/enqueue.ts";
import { MAX_QUESTIONS_PER_PACKAGE } from "../_shared/exam-pool-limits.ts";

/**
 * pool-fill-bloom-gaps — Targeted Bloom/Difficulty/Competency gap-fill worker
 *
 * Uses the SSOT RPC `get_exam_pool_gap_report` to identify exactly which
 * Bloom levels, difficulty tiers, and competencies are underrepresented,
 * then generates targeted questions to close those gaps.
 *
 * Key design decisions:
 * - Idempotent: skips gaps already filled since last report
 * - Elite-conformant: enforces SSOT target distribution
 * - Budget-guarded: max MAX_QUESTIONS_PER_RUN per invocation
 * - Post-fill: kicks validate_exam_pool step to continue pipeline
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ── Config ──
// Patch A (P0 loop-breaker): keep function-wall < 45s worker timeout.
// Patch B (P0 structural): worker is acked at 202 within ms; AI runs in
// EdgeRuntime.waitUntil and the edge function finalizes the job itself.
// AI budget tightened from 38s → 28s so background never runs forever.
// Patch C: shrink plan + tokens so fast models complete reliably <20s.
const MAX_QUESTIONS_PER_RUN = 6;         // Patch C: 12 → 6 (smaller plan, faster wall)
const MAX_AI_TOKENS = 3500;              // Patch C: 5000 → 3500 (cut wall further)
const MIN_BATCH_SIZE = 3;                // Patch C: 5 → 3 (aligned with new run size)
const MAX_COMPETENCY_GAPS = 3;           // Patch C: 6 → 3 (smaller plan = faster)
const IDEMPOTENCY_WINDOW_MIN = 10;       // skip re-runs per package within 10min

// ── Bloom → Difficulty mapping (SSOT-aligned) ──
const BLOOM_DIFFICULTY_MAP: Record<string, string> = {
  remember: "easy",
  understand: "medium",
  apply: "medium",
  analyze: "hard",
  evaluate: "very_hard",
};

// ── Context types by bloom (for prompt diversity) ──
const CONTEXT_TYPES: Record<string, string[]> = {
  remember: ["isolated_knowledge", "applied_case"],
  understand: ["applied_case", "error_detection"],
  apply: ["applied_case", "multi_step_case", "documentation_analysis"],
  analyze: ["multi_step_case", "error_detection", "legal_evaluation"],
  evaluate: ["legal_evaluation", "prioritization", "multi_step_case"],
};

function pickContext(bloom: string, index: number): string {
  const pool = CONTEXT_TYPES[bloom] || CONTEXT_TYPES["apply"];
  return pool[index % pool.length];
}

interface GapEntry {
  key: string;
  gap: number;
}

interface CompGapEntry {
  competency_id: string;
  approved_count: number;
  gap: number;
}

interface RunOutcome {
  kind: "completed" | "skipped" | "failed";
  body: Record<string, unknown>;
  error?: string;
}

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

async function finalizeJob(
  sb: ReturnType<typeof createClient>,
  jobId: string | null,
  outcome: RunOutcome,
) {
  if (!jobId) return;
  const now = new Date().toISOString();
  if (outcome.kind === "failed") {
    // Patch E: prefer terminal_code (AI_PROVIDER_*) over generic POOL_FILL_BACKGROUND_FAILED
    const terminalCode = (outcome.body?.terminal_code as string | undefined) || null;
    const failureClass = (outcome.body?.failure_class as string | undefined) || null;
    const payloadSignature = (outcome.body?.payload_signature as string | undefined) || null;
    const lastErrorCode = terminalCode || "POOL_FILL_BACKGROUND_FAILED";
    // merge into existing meta without losing producer fields
    const { data: existing } = await sb.from("job_queue").select("meta").eq("id", jobId).maybeSingle();
    const mergedMeta = {
      ...(existing?.meta as Record<string, unknown> ?? {}),
      terminal_code: terminalCode,
      failure_class: failureClass,
      payload_signature: payloadSignature,
      patch: "E",
      finalized_at: now,
    };
    await sb.from("job_queue").update({
      status: "failed",
      last_error: (outcome.error || "POOL_FILL_BACKGROUND_FAILED").slice(0, 2000),
      last_error_code: lastErrorCode,
      meta: mergedMeta,
      completed_at: now,
      updated_at: now,
      locked_at: null,
      locked_by: null,
    }).eq("id", jobId);
  } else {
    // completed for both real success AND idempotent skip (recent_fill_skipped, no gap, etc.)
    await sb.from("job_queue").update({
      status: "completed",
      result: outcome.body,
      completed_at: now,
      updated_at: now,
      locked_at: null,
      locked_by: null,
      last_error: null,
    }).eq("id", jobId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const curriculumId = payload.curriculum_id as string;
  const packageId = payload.package_id as string | undefined;
  const jobId = (payload.job_id as string | undefined) ?? null;

  if (!curriculumId) return json({ error: "curriculum_id required" }, 400);

  // ── Patch B: 202 early-ack + background finalize ──
  // Worker (content-runner) sees background_mode=true and parks the job as
  // 'processing' without setting completed/failed. We finalize ourselves.
  if (jobId && typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil((async () => {
      try {
        const outcome = await runWork(sb, curriculumId, packageId, jobId);
        await finalizeJob(sb, jobId, outcome);
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        console.error("[bloom-gap-fill][bg] fatal:", msg);
        await finalizeJob(sb, jobId, { kind: "failed", body: { ok: false, error: msg }, error: msg });
      }
    })());
    return json({
      accepted: true,
      job_id: jobId,
      background_mode: true,
      background_complete: false,
      mode: "background",
    }, 202);
  }

  // Fallback: synchronous mode (no jobId or no EdgeRuntime — e.g. local tests)
  try {
    const outcome = await runWork(sb, curriculumId, packageId, jobId);
    if (outcome.kind === "failed") return json(outcome.body, 500);
    return json(outcome.body, 200);
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.error("[bloom-gap-fill] Fatal error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});

async function runWork(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  packageId: string | undefined,
  _jobId: string | null,
): Promise<RunOutcome> {
    // ── SSOT Budget Guard: check pool size before generating ──
    const { count: currentPoolSize } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .neq("status", "rejected");

    const currentCount = currentPoolSize ?? 0;
    const globalBudget = Math.max(0, MAX_QUESTIONS_PER_PACKAGE - currentCount);
    if (globalBudget <= 0) {
      console.log(`[bloom-gap-fill] SSOT HARD CAP reached: ${currentCount} >= ${MAX_QUESTIONS_PER_PACKAGE} — skipping`);
      return { kind: "completed", body: { ok: true, message: "pool_cap_reached", pool_size: currentCount, cap: MAX_QUESTIONS_PER_PACKAGE } };
    }

    // ── 1. Fetch gap report (returns single JSONB object, NOT a table) ──
    const { data: report, error: gapErr } = await sb.rpc(
      "get_exam_pool_gap_report",
      { p_curriculum_id: curriculumId },
    );

    if (gapErr) {
      console.error("[bloom-gap-fill] RPC error:", gapErr.message);
      return { kind: "failed", body: { ok: false, error: gapErr.message }, error: gapErr.message };
    }

    if (!report || typeof report !== "object") {
      console.log("[bloom-gap-fill] No report data returned");
      return { kind: "completed", body: { ok: true, message: "no_report", generated: 0 } };
    }

    // Parse JSONB object format: bloom_gaps: {"remember": 5, ...}, difficulty_gaps: {...}, competency_gaps: [...]
    const bloomGapsObj = (report as Record<string, unknown>).bloom_gaps as Record<string, number> || {};
    const diffGapsObj = (report as Record<string, unknown>).difficulty_gaps as Record<string, number> || {};
    const compGapsArr = (report as Record<string, unknown>).competency_gaps as Array<{ competency_id: string; approved_count: number }> || [];

    const bloomGaps: GapEntry[] = Object.entries(bloomGapsObj)
      .filter(([_, gap]) => gap > 0)
      .map(([key, gap]) => ({ key, gap }));

    const diffGaps: GapEntry[] = Object.entries(diffGapsObj)
      .filter(([_, gap]) => gap > 0)
      .map(([key, gap]) => ({ key, gap }));

    const compGaps: CompGapEntry[] = compGapsArr
      .map((c) => ({ competency_id: c.competency_id, approved_count: c.approved_count, gap: Math.max(0, 3 - c.approved_count) }))
      .filter((c) => c.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, MAX_COMPETENCY_GAPS);

    const totalGap = bloomGaps.reduce((s, g) => s + g.gap, 0)
      + diffGaps.reduce((s, g) => s + g.gap, 0)
      + compGaps.reduce((s, g) => s + g.gap, 0);

    if (totalGap === 0) {
      console.log("[bloom-gap-fill] No gaps found — all targets met");
      return { kind: "completed", body: { ok: true, message: "all_targets_met", generated: 0 } };
    }

    console.log(
      `[bloom-gap-fill] Gaps found: ${bloomGaps.length} bloom, ${diffGaps.length} difficulty, ${compGaps.length} competency (total=${totalGap})`,
    );

    // ── Idempotency Window (Patch A): per-package, 10min ──
    // Avoids double-inserts from worker false-failure retries (worker_wall < function_wall).
    const bloomSig = bloomGaps.map((g) => `${g.key}:${g.gap}`).sort().join(",");
    const diffSig = diffGaps.map((g) => `${g.key}:${g.gap}`).sort().join(",");
    const compSig = compGaps.map((c) => c.competency_id).sort().join(",");
    const gapSignature = `b[${bloomSig}]|d[${diffSig}]|c[${compSig}]`;
    const idempotencyKey = packageId
      ? `pool_fill:${packageId}:${gapSignature}`
      : `pool_fill:cur:${curriculumId}:${gapSignature}`;

    // Patch A.2: Idempotency-Source = exam_questions direkt (nicht auto_heal_log).
    // Grund: Worker-Wall-Kill mid-run hinterlässt KEIN Audit, aber sehr wohl Inserts.
    // → Wir messen die Wahrheit aus exam_questions: wie viele ai_generated rows
    //   wurden für diese curriculum_id in den letzten N Minuten geschrieben.
    const sinceIso = new Date(Date.now() - IDEMPOTENCY_WINDOW_MIN * 60_000).toISOString();
    const { count: recentInserts } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("ai_generated", true)
      .gte("created_at", sinceIso);

    const recentN = recentInserts ?? 0;
    if (recentN >= MIN_BATCH_SIZE) {
      const cooldownUntilIso = new Date(Date.now() + IDEMPOTENCY_WINDOW_MIN * 60_000).toISOString();
      console.log(`[bloom-gap-fill] Idempotency-skip: ${recentN} ai_generated inserts in last ${IDEMPOTENCY_WINDOW_MIN}min for curriculum ${curriculumId.slice(0, 8)} — recent_fill_skipped (cooldown_until=${cooldownUntilIso})`);
      await sb.from("auto_heal_log").insert({
        action_type: "pool_fill_bloom_gaps_recent_fill_skipped",
        target_type: "course_package",
        target_id: packageId ?? null,
        result_status: "skipped",
        result_detail: `recent_inserts_${recentN}_within_${IDEMPOTENCY_WINDOW_MIN}min`,
        metadata: {
          idempotency_key: idempotencyKey,
          gap_signature: gapSignature,
          curriculum_id: curriculumId,
          source: "exam_questions",
          recent_inserts: recentN,
          window_minutes: IDEMPOTENCY_WINDOW_MIN,
          cooldown_reason: "recent_ai_inserts_within_window",
          cooldown_source: "pool_fill_bloom_gaps:exam_questions_lookback",
          cooldown_until: cooldownUntilIso,
        },
      });
      return {
        kind: "completed",
        body: {
          ok: true,
          message: "recent_fill_skipped",
          idempotency_key: idempotencyKey,
          recent_inserts: recentN,
          window_minutes: IDEMPOTENCY_WINDOW_MIN,
          cooldown_until: cooldownUntilIso,
          generated: 0,
        },
      };
    }

    // Pre-Audit BEFORE AI call — so a mid-run worker kill still leaves a fingerprint.
    if (packageId) {
      await sb.from("auto_heal_log").insert({
        action_type: "pool_fill_bloom_gaps_attempt_started",
        target_type: "course_package",
        target_id: packageId,
        result_status: "in_progress",
        result_detail: `attempt_planned_max_${MAX_QUESTIONS_PER_RUN}`,
        metadata: {
          idempotency_key: idempotencyKey,
          gap_signature: gapSignature,
          curriculum_id: curriculumId,
          recent_inserts_observed: recentN,
          window_minutes: IDEMPOTENCY_WINDOW_MIN,
        },
      });
    }


    // ── 2. Build generation plan ──
    // Priority: competency gaps first (most impactful), then bloom gaps
    interface GenTarget {
      bloom: string;
      difficulty: string;
      competency_id?: string;
      competency_title?: string;
      count: number;
    }

    const plan: GenTarget[] = [];
    let remaining = Math.min(MAX_QUESTIONS_PER_RUN, globalBudget); // SSOT: clamp to pool budget

    // 2a. Competency gaps — generate with the most needed bloom level
    for (const comp of compGaps) {
      if (remaining <= 0) break;
      const count = Math.min(comp.gap, 5, remaining);
      const topBloom = bloomGaps.length > 0 ? bloomGaps[0].key : "apply";
      plan.push({
        bloom: topBloom,
        difficulty: BLOOM_DIFFICULTY_MAP[topBloom] || "medium",
        competency_id: comp.competency_id,
        count,
      });
      remaining -= count;
    }

    // 2b. Bloom gaps — generate without specific competency
    for (const bg of bloomGaps) {
      if (remaining <= 0) break;
      const count = Math.min(bg.gap, 8, remaining);
      if (count < 2) continue; // skip trivial gaps
      plan.push({
        bloom: bg.key,
        difficulty: BLOOM_DIFFICULTY_MAP[bg.key] || "medium",
        count,
      });
      remaining -= count;
    }

    // 2c. Difficulty gaps (if still budget left)
    for (const dg of diffGaps) {
      if (remaining <= 0) break;
      const count = Math.min(dg.gap, 6, remaining);
      if (count < 2) continue;
      // Pick a matching bloom for this difficulty
      const bloomForDiff: Record<string, string> = {
        easy: "remember",
        medium: "understand",
        hard: "analyze",
        very_hard: "evaluate",
      };
      plan.push({
        bloom: bloomForDiff[dg.key] || "apply",
        difficulty: dg.key,
        count,
      });
      remaining -= count;
    }

    const totalPlanned = plan.reduce((s, p) => s + p.count, 0);
    if (totalPlanned < MIN_BATCH_SIZE) {
      console.log(`[bloom-gap-fill] Plan too small (${totalPlanned}) — skipping`);
      return { kind: "completed", body: { ok: true, message: "gap_too_small", planned: totalPlanned } };
    }

    console.log(`[bloom-gap-fill] Plan: ${plan.length} targets, ${totalPlanned} questions`);

    // ── 3. Resolve profession context ──
    const { data: curriculum } = await sb
      .from("curricula")
      .select("title, beruf_id")
      .eq("id", curriculumId)
      .maybeSingle();

    let professionContext = curriculum?.title || "Ausbildungsberuf";
    if (curriculum?.beruf_id) {
      try {
        const prof = await resolveProfession(sb, { curriculumId });
        professionContext = prof.professionName;
      } catch { /* fallback */ }
    }

    // ── 4. Resolve competency titles for prompt context ──
    const compIds = plan.filter((p) => p.competency_id).map((p) => p.competency_id!);
    if (compIds.length > 0) {
      const { data: comps } = await sb
        .from("competencies")
        .select("id, title")
        .in("id", compIds);
      const compMap = new Map((comps || []).map((c: { id: string; title: string }) => [c.id, c.title]));
      for (const p of plan) {
        if (p.competency_id) {
          p.competency_title = compMap.get(p.competency_id) || undefined;
        }
      }
    }

    // ── 5. Generate questions via Lovable AI Gateway ──
    // Patch D.2: Direct Lovable AI Gateway (https://ai.gateway.lovable.dev) statt
    // callAIJSON. Grund: callAIJSON erwartet GOOGLE_AI_API_KEY direkt — der Secret
    // ist nicht gesetzt. Lovable AI Gateway nutzt LOVABLE_API_KEY für alle Provider.
    // Direct Gateway-Test bewies: gemini-2.5-flash-lite ~5s, gemini-2.5-flash ~8s.
    const GEMINI_ONLY_CHAIN = [
      "google/gemini-2.5-flash-lite", // primary, ~5s
      "google/gemini-2.5-flash",      // fallback, ~8s
    ];
    const policyChain = await getModelChainAsync("exam_questions");
    const modelChain = GEMINI_ONLY_CHAIN; // Patch D: Gemini-only via Lovable Gateway
    const allQuestions: Array<Record<string, unknown>> = [];

    // Group plan into a single prompt for efficiency
    const questionsSpec = plan.flatMap((target, tIdx) =>
      Array.from({ length: target.count }, (_, i) => ({
        index: allQuestions.length + tIdx * 10 + i + 1,
        cognitive_level: target.bloom,
        difficulty: target.difficulty,
        competency: target.competency_title || null,
        competency_id: target.competency_id || null,
        context_type: pickContext(target.bloom, i),
      })),
    );

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für "${professionContext}".
Erstelle exakt ${questionsSpec.length} Multiple-Choice-Prüfungsfragen.

REGELN:
- Jede Frage hat exakt 4 Antwortmöglichkeiten (A-D), genau 1 korrekt
- Praxisnah: Situationsaufgaben mit konkreten Szenarien, Namen, Zahlen
- KEINE "Was ist die Definition von..." Fragen bei apply/analyze/evaluate
- Erklärung MUSS enthalten: Warum richtig + warum jede falsche Antwort falsch ist
- Distraktoren müssen PLAUSIBEL sein (typische Azubi-Fehler)
- min. 2 typical_errors pro Frage

COGNITIVE LEVELS (Bloom):
- remember: Faktenwissen direkt abrufbar
- understand: Zusammenhänge erklären
- apply: Wissen auf neue Situation anwenden
- analyze: Fehler finden, Ursachen ermitteln
- evaluate: Bewerten, Priorisieren, Entscheiden

FRAGEN-SPEZIFIKATION:
${questionsSpec.map((s, i) => `Frage ${i + 1}: cognitive=${s.cognitive_level}, difficulty=${s.difficulty}, context=${s.context_type}${s.competency ? `, Kompetenz="${s.competency}"` : ""}`).join("\n")}

Antworte NUR als JSON:
{
  "questions": [
    {
      "question_text": "...",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": 0,
      "explanation": "...",
      "difficulty": "easy|medium|hard|very_hard",
      "cognitive_level": "remember|understand|apply|analyze|evaluate",
      "typical_errors": ["Fehler 1", "Fehler 2"],
      "spec_index": 0
    }
  ]
}`;

    let aiQuestions: Array<Record<string, unknown>> = [];
    let aiError: string | null = null;
    let modelUsed: string | null = null;
    const aiStart = Date.now();

    // Patch A.3: Per-model wall-time cap (22s) + tolerant JSON repair.
    // Worker-Wall = 45s. With 4 models in chain, a single hung model used to burn
    // 30–60s on "Could not parse" loops. We hard-cap per attempt and budget total <40s.
    // Patch B: tighter budget — background mode means worker no longer races us,
    // but we still cap so the function returns quickly enough to finalize.
    const PER_MODEL_TIMEOUT_MS = 18_000;
    const TOTAL_AI_BUDGET_MS = 28_000;

    function repairJsonString(raw: string): Record<string, unknown> | null {
      let s = raw;
      s = s.replace(/^```(?:json)?\s*\n?/im, "").replace(/\n?```\s*$/im, "").trim();
      if (!s.startsWith("{") && !s.startsWith("[")) {
        const m = s.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
        if (m) s = m[1];
      }
      // Pass 1: direct parse
      try { return JSON.parse(s); } catch { /* try repair */ }
      // Pass 2: trim trailing junk after last balanced brace
      const lastBrace = s.lastIndexOf("}");
      if (lastBrace > 0) {
        try { return JSON.parse(s.slice(0, lastBrace + 1)); } catch { /* try */ }
        // Pass 3: close an unterminated questions[] array
        try { return JSON.parse(s.slice(0, lastBrace + 1) + "]}"); } catch { /* try */ }
      }
      // Pass 4: extract last fully-closed top-level object containing "questions"
      const m = s.match(/\{[^{}]*"questions"\s*:\s*\[[\s\S]*?\}\s*\]\s*\}/);
      if (m) {
        try { return JSON.parse(m[0]); } catch { /* give up */ }
      }
      return null;
    }

    // Patch D: terminale 4xx-Codes brechen die ganze Chain ab (kein silent loop).
    const TERMINAL_4XX_PATTERNS: Array<{ re: RegExp; code: string }> = [
      { re: /max_tokens.*not supported|max_completion_tokens/i, code: "AI_PROVIDER_UNSUPPORTED_PARAM" },
      { re: /\b401\b|unauthor|invalid api key|authentication/i, code: "AI_PROVIDER_AUTH_ERROR" },
      { re: /\b400\b|bad request|invalid_request_error/i, code: "AI_PROVIDER_BAD_REQUEST" },
      { re: /\b403\b|forbidden/i, code: "AI_PROVIDER_AUTH_ERROR" },
    ];
    function classifyTerminal4xx(msg: string): string | null {
      for (const p of TERMINAL_4XX_PATTERNS) if (p.re.test(msg)) return p.code;
      return null;
    }

    const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
    const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_KEY) {
      return { kind: "failed", body: { ok: false, error: "LOVABLE_API_KEY not configured", terminal_code: "AI_PROVIDER_AUTH_ERROR" }, error: "LOVABLE_API_KEY not configured" };
    }

    let terminalErrorCode: string | null = null;
    for (const model of modelChain) {
      const elapsed = Date.now() - aiStart;
      if (elapsed > TOTAL_AI_BUDGET_MS) {
        console.warn(`[bloom-gap-fill] AI total budget exhausted (${elapsed}ms) — stopping fallback chain`);
        aiError = `total_ai_budget_exhausted_${elapsed}ms`;
        break;
      }
      const callStart = Date.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), PER_MODEL_TIMEOUT_MS);
        let resp: Response;
        try {
          resp = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${LOVABLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Generiere jetzt die ${questionsSpec.length} Prüfungsfragen.` },
              ],
              temperature: 0.7,
              max_tokens: MAX_AI_TOKENS,
            }),
            signal: ctrl.signal,
          });
        } finally { clearTimeout(to); }

        if (resp.status === 429) {
          terminalErrorCode = "AI_PROVIDER_RATE_LIMIT";
          aiError = `gateway_429_rate_limit`;
          console.error(`[bloom-gap-fill] TERMINAL ${terminalErrorCode} on ${model} — aborting chain`);
          break;
        }
        if (resp.status === 402) {
          terminalErrorCode = "AI_PROVIDER_PAYMENT_REQUIRED";
          aiError = `gateway_402_payment_required`;
          console.error(`[bloom-gap-fill] TERMINAL ${terminalErrorCode} on ${model} — aborting chain`);
          break;
        }
        if (resp.status >= 400 && resp.status < 500) {
          const txt = (await resp.text()).slice(0, 500);
          terminalErrorCode = "AI_PROVIDER_BAD_REQUEST";
          aiError = `gateway_${resp.status}: ${txt}`;
          console.error(`[bloom-gap-fill] TERMINAL ${terminalErrorCode} ${resp.status} on ${model} — aborting chain: ${txt}`);
          break;
        }
        if (!resp.ok) {
          aiError = `gateway_${resp.status}`;
          console.error(`[bloom-gap-fill] AI error ${resp.status} on ${model} — trying next`);
          continue;
        }

        const json = await resp.json();
        const content: string = json?.choices?.[0]?.message?.content ?? "";
        const parsed = repairJsonString(content);
        if (!parsed) {
          aiError = `parse_failed_${model}_${Date.now() - callStart}ms`;
          console.error(`[bloom-gap-fill] Parse failed on ${model} (${Date.now() - callStart}ms) — trying next`);
          continue;
        }

        aiQuestions = Array.isArray(parsed)
          ? parsed as Array<Record<string, unknown>>
          : (parsed.questions as Array<Record<string, unknown>>) || [];
        if (aiQuestions.length > 0) {
          modelUsed = model;
          break;
        }
      } catch (e) {
        const msg = (e as Error)?.name === "AbortError"
          ? `per_model_timeout_${PER_MODEL_TIMEOUT_MS}ms`
          : ((e as Error).message || String(e));
        aiError = msg;
        console.error(`[bloom-gap-fill] AI exception on ${model}: ${msg} (${Date.now() - callStart}ms)`);
      }
    }
    const aiWallMs = Date.now() - aiStart;

    if (aiQuestions.length === 0) {
      const finalErr = terminalErrorCode || aiError || "ai_failed";
      // Patch E: payload signature = sha-like compact hash of model chain + spec sizes for fast forensic grep
      const sigBase = `${modelChain.join('|')}::tokens=${MAX_AI_TOKENS}::q=${questionsSpec.length}::wall=${aiWallMs}`;
      let payloadSignature = sigBase;
      try {
        const buf = new TextEncoder().encode(sigBase);
        const hash = await crypto.subtle.digest("SHA-1", buf);
        payloadSignature = Array.from(new Uint8Array(hash)).slice(0, 8).map(b => b.toString(16).padStart(2,'0')).join('');
      } catch { /* keep raw */ }
      const failureClass = terminalErrorCode
        ? "TERMINAL_4XX"
        : (aiError?.startsWith("total_ai_budget_exhausted") ? "TIMEOUT_BUDGET" : (aiError?.startsWith("per_model_timeout") ? "TIMEOUT_PER_MODEL" : "PARSE_OR_OTHER"));
      console.error("[bloom-gap-fill] All AI models failed:", finalErr, "class=", failureClass, "sig=", payloadSignature);
      return {
        kind: "failed",
        body: {
          ok: false,
          error: finalErr,
          terminal_code: terminalErrorCode,
          failure_class: failureClass,
          payload_signature: payloadSignature,
          ai_wall_ms: aiWallMs,
          model_chain_order: modelChain,
        },
        error: finalErr,
      };
    }

    // ── 6. Build DB inserts ──
    const inserts = aiQuestions.slice(0, questionsSpec.length).map((q, i) => {
      const spec = questionsSpec[i] || questionsSpec[0];
      let typicalErrors = Array.isArray(q.typical_errors)
        ? (q.typical_errors as string[]).filter(Boolean).map(String)
        : [];
      if (typicalErrors.length < 2) {
        typicalErrors = ["Falsche Priorisierung", "Unvollständige Begründung"];
      }

      return {
        curriculum_id: curriculumId,
        competency_id: spec.competency_id || null,
        question_text: (q.question_text as string) || `Frage ${i + 1}`,
        options: Array.isArray(q.options) ? q.options : ["A)", "B)", "C)", "D)"],
        correct_answer: typeof q.correct_answer === "number" ? q.correct_answer : 0,
        explanation: (q.explanation as string) || "",
        difficulty: (q.difficulty as string) || spec.difficulty,
        cognitive_level: (q.cognitive_level as string) || spec.cognitive_level,
        question_type: "concept",
        qc_status: "pending",
        ai_generated: true,
        status: "draft",
        trap_tags: typicalErrors,
        typical_errors: typicalErrors.length > 0 ? typicalErrors : null,
        scenario_type: spec.context_type || null,
      };
    });

    const { error: insErr } = await sb.from("exam_questions").insert(inserts);
    if (insErr) {
      console.error("[bloom-gap-fill] DB insert error:", insErr.message);
      return { kind: "failed", body: { ok: false, error: insErr.message }, error: insErr.message };
    }

    console.log(`[bloom-gap-fill] Inserted ${inserts.length} questions`);

    // ── Audit successful capped run (Patch A.3: extended forensics) ──
    if (packageId) {
      await sb.from("auto_heal_log").insert({
        action_type: "pool_fill_bloom_gaps_capped_run",
        target_type: "course_package",
        target_id: packageId,
        result_status: "ok",
        result_detail: `inserted_${inserts.length}_cap_${MAX_QUESTIONS_PER_RUN}`,
        metadata: {
          idempotency_key: idempotencyKey,
          idempotency_source: "exam_questions",
          gap_signature: gapSignature,
          curriculum_id: curriculumId,
          recent_inserts_observed: recentN,
          window_minutes: IDEMPOTENCY_WINDOW_MIN,
          inserted: inserts.length,
          plan_targets: plan.length,
          // Patch C forensics
          questions_planned: questionsSpec.length,
          questions_inserted: inserts.length,
          model_used: modelUsed,
          model_chain_order: modelChain,
          policy_chain_order: policyChain.map((m: { model: string }) => m.model),
          ai_wall_ms: aiWallMs,
          budget_ms: TOTAL_AI_BUDGET_MS,
          per_model_timeout_ms: PER_MODEL_TIMEOUT_MS,
          max_ai_tokens: MAX_AI_TOKENS,
          patch: "D",
        },
      });
    }


    // ── 7. Post-fill: kick validate_exam_pool ──
    const pkgFilter = packageId
      ? sb.from("course_packages").select("id").eq("id", packageId).eq("status", "building")
      : sb.from("course_packages").select("id").eq("curriculum_id", curriculumId).eq("status", "building").limit(5);

    const { data: pkgs } = await pkgFilter;
    for (const pkg of pkgs || []) {
      await sb
        .from("package_steps")
        .update({
          status: "queued",
          attempts: 0,
          job_id: null,
          runner_id: null,
          started_at: null,
          last_error: `Bloom-gap-fill: inserted ${inserts.length} targeted questions`,
        })
        .eq("package_id", (pkg as { id: string }).id)
        .eq("step_key", "validate_exam_pool")
        .in("status", ["failed", "queued", "enqueued"]);

      console.log(`[bloom-gap-fill] Kicked validate_exam_pool for package ${((pkg as { id: string }).id).slice(0, 8)}`);
    }

    return {
      kind: "completed",
      body: {
        ok: true,
        generated: inserts.length,
        model_used: modelUsed,
        ai_wall_ms: aiWallMs,
        recent_inserts_observed: recentN,
        plan_summary: {
          bloom_targets: bloomGaps.map((g) => ({ bloom: g.key, gap: g.gap })),
          difficulty_targets: diffGaps.map((g) => ({ difficulty: g.key, gap: g.gap })),
          competency_targets: compGaps.length,
        },
      },
    };
}
