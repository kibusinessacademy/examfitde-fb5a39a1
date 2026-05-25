// Berufs-KI Workflow Runner — BK-Act-1b (Edge Hardening Completion)
// SSOT: fn_workflow_tier_check (fail-closed) BEFORE every AI call.
// Plus: Cost Guard, Abuse Guard, Retry Guard, full audit lifecycle.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const MAX_INPUT_CHARS = 8000;

// --- Cost Guard caps (server-side, per tier) -----------------------------
const COST_CAPS = {
  free:     { promptCharMax: 12_000, maxOutputTokens: 800,  estPromptTokenMax: 3_500 },
  pro:      { promptCharMax: 32_000, maxOutputTokens: 2_500, estPromptTokenMax: 9_000 },
  business: { promptCharMax: 64_000, maxOutputTokens: 4_000, estPromptTokenMax: 18_000 },
} as const;

// Abuse Guard: burst + identical re-submit windows
const ABUSE_BURST_WINDOW_S = 60;
const ABUSE_BURST_MAX_RUNS = 12;
const RETRY_GUARD_WINDOW_S = 10;

function sanitize(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return s.length > MAX_INPUT_CHARS ? s.slice(0, MAX_INPUT_CHARS) + "\n[…gekürzt]" : s;
}
function interpolate(tpl: string, inputs: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => sanitize(inputs[key]));
}
function estimateTokens(text: string): number {
  // Cheap heuristic: ~4 chars/token
  return Math.ceil((text?.length ?? 0) / 4);
}
function costBucket(estPromptTokens: number, tier: string): string {
  if (estPromptTokens < 1_000) return "xs";
  if (estPromptTokens < 3_000) return "s";
  if (estPromptTokens < 8_000) return "m";
  if (estPromptTokens < 16_000) return "l";
  return "xl";
}
async function djb2Hex(s: string): Promise<string> {
  // Stable short hash (no crypto needed) for identical-resubmit detection
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

type Json = Record<string, unknown>;

async function emitAudit(admin: ReturnType<typeof createClient>, actionType: string, payload: Json, status = "success", error?: string) {
  try {
    await admin.rpc("fn_emit_audit", {
      _action_type: actionType,
      _target_type: "berufs_ki_workflow",
      _target_id: String(payload.workflow_id ?? "unknown"),
      _result_status: status,
      _payload: payload,
      _trigger_source: "edge:berufs-ki-run",
      _error_message: error ?? null,
    });
  } catch (e) {
    console.error("[berufs-ki-run] audit emit failed", actionType, e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "auth_required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "auth_invalid" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    const body = (await req.json().catch(() => ({}))) as {
      slug?: string;
      inputs?: Record<string, unknown>;
      beruf_slug?: string;
      source_run_id?: string | null;
      follow_up_of?: string | null;
    };
    const { slug, inputs, beruf_slug } = body;

    if (!slug || typeof slug !== "string") {
      return new Response(JSON.stringify({ error: "slug_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 1) Resolve workflow (fail-closed on unknown slug) ----------------
    const { data: wf, error: wfErr } = await admin
      .from("berufs_ki_workflow_definitions")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();

    if (wfErr || !wf) {
      await emitAudit(admin, "workflow_tier_blocked", {
        workflow_id: null,
        workflow_slug: slug,
        workflow_tier: "unknown",
        blocked_reason: "workflow_not_found",
        tier_actual: "unknown",
        tier_required: "unknown",
        runs_today: 0,
        daily_limit: 0,
        entitlement_snapshot: {},
        user_id: userId,
      }, "blocked");
      return new Response(JSON.stringify({ error: "workflow_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 2) SSOT Tier-Gate (fail-closed) ----------------------------------
    const { data: gateRaw, error: gateErr } = await admin.rpc("fn_workflow_tier_check", {
      _user_id: userId,
      _workflow_id: wf.id,
    });
    const gate = (gateRaw ?? {}) as Json;
    const tierRequired = String(gate.tier_required ?? wf.tier_required ?? "free");
    const tierActual = String(gate.tier_actual ?? "free");
    const dailyLimit = Number(gate.daily_limit ?? 0);
    const runsToday = Number(gate.runs_today ?? 0);
    const entitlementSnapshot = (gate.entitlement_snapshot ?? {
      tier_actual: tierActual, tier_required: tierRequired,
      runs_today: runsToday, daily_limit: dailyLimit,
      export_allowed: gate.export_allowed ?? false,
    }) as Json;

    if (gateErr || gate.allowed !== true) {
      const reason = String(gate.reason ?? (gateErr ? "tier_check_error" : "tier_check_failed"));
      await admin.from("berufs_ki_workflow_runs").insert({
        workflow_id: wf.id,
        user_id: userId,
        beruf_slug: beruf_slug ?? null,
        inputs: inputs ?? {},
        status: "blocked",
        error_reason: reason,
        tier_at_run: tierRequired,
      });
      await emitAudit(admin, "workflow_tier_blocked", {
        workflow_id: wf.id,
        workflow_slug: wf.slug,
        workflow_tier: tierRequired,
        blocked_reason: reason,
        tier_actual: tierActual,
        tier_required: tierRequired,
        runs_today: runsToday,
        daily_limit: dailyLimit,
        entitlement_snapshot: entitlementSnapshot,
        user_id: userId,
      }, "blocked");
      return new Response(
        JSON.stringify({
          error: "entitlement_required",
          reason,
          tier_required: tierRequired,
          tier_actual: tierActual,
          runs_today: runsToday,
          daily_limit: dailyLimit,
          message:
            reason === "daily_limit_reached"
              ? `Tageslimit von ${dailyLimit} erreicht. Upgrade hebt das Limit auf.`
              : tierRequired === "free"
                ? "Workflow gerade nicht verfügbar."
                : `Dieser Workflow benötigt ${tierRequired === "business" ? "Business-Zugang" : "einen aktiven Pro-Zugang"}.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- 3) Input validation ---------------------------------------------
    const fields = (wf.input_schema?.fields ?? []) as Array<{ key: string; required?: boolean; label?: string }>;
    const missingFields = fields.filter((f) => f.required && !sanitize((inputs ?? {})[f.key]).trim());
    if (missingFields.length) {
      return new Response(
        JSON.stringify({
          error: "missing_inputs",
          missing: missingFields.map((f) => ({ key: f.key, label: f.label })),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userPrompt = interpolate(wf.user_prompt_template, inputs ?? {});
    const systemPrompt: string = wf.system_prompt ?? "";
    const model = wf.model_recommendation || "google/gemini-2.5-pro";
    const promptChars = userPrompt.length + systemPrompt.length;
    const estPromptTokens = estimateTokens(userPrompt) + estimateTokens(systemPrompt);
    const caps = (COST_CAPS as Record<string, typeof COST_CAPS.free>)[tierActual] ?? COST_CAPS.free;
    const estCostBucket = costBucket(estPromptTokens, tierActual);

    // --- 4) Cost Guard (fail-closed) -------------------------------------
    if (promptChars > caps.promptCharMax || estPromptTokens > caps.estPromptTokenMax) {
      const reason = promptChars > caps.promptCharMax ? "prompt_chars_exceeded" : "estimated_tokens_exceeded";
      await admin.from("berufs_ki_workflow_runs").insert({
        workflow_id: wf.id,
        user_id: userId,
        beruf_slug: beruf_slug ?? null,
        inputs: inputs ?? {},
        status: "blocked",
        error_reason: `cost_guard:${reason}`,
        tier_at_run: tierActual,
      });
      await emitAudit(admin, "workflow_cost_guard_blocked", {
        workflow_id: wf.id,
        workflow_slug: wf.slug,
        workflow_tier: tierActual,
        blocked_reason: reason,
        estimated_prompt_tokens: estPromptTokens,
        prompt_chars: promptChars,
        caps,
        user_id: userId,
      }, "blocked");
      return new Response(
        JSON.stringify({
          error: "cost_guard_blocked",
          reason,
          message: "Eingabe zu groß für deinen aktuellen Tarif — bitte Eingabe kürzen oder Tarif upgraden.",
        }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- 5) Abuse + Retry Guard ------------------------------------------
    const inputsHash = await djb2Hex(JSON.stringify({ s: slug, i: inputs ?? {} }));
    const burstSince = new Date(Date.now() - ABUSE_BURST_WINDOW_S * 1000).toISOString();
    const { count: burstCount } = await admin
      .from("berufs_ki_workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", burstSince);

    if ((burstCount ?? 0) >= ABUSE_BURST_MAX_RUNS) {
      await emitAudit(admin, "workflow_abuse_guard_blocked", {
        workflow_id: wf.id,
        workflow_slug: wf.slug,
        workflow_tier: tierActual,
        blocked_reason: "burst_limit",
        window_seconds: ABUSE_BURST_WINDOW_S,
        recent_run_count: burstCount,
        user_id: userId,
      }, "blocked");
      return new Response(
        JSON.stringify({ error: "abuse_guard_blocked", reason: "burst_limit", message: "Zu viele Anfragen — bitte einen Moment warten." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const retrySince = new Date(Date.now() - RETRY_GUARD_WINDOW_S * 1000).toISOString();
    const { count: retryCount } = await admin
      .from("berufs_ki_workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("workflow_id", wf.id)
      .gte("created_at", retrySince);

    if ((retryCount ?? 0) >= 1) {
      await emitAudit(admin, "workflow_abuse_guard_blocked", {
        workflow_id: wf.id,
        workflow_slug: wf.slug,
        workflow_tier: tierActual,
        blocked_reason: "identical_resubmit",
        window_seconds: RETRY_GUARD_WINDOW_S,
        recent_run_count: retryCount,
        inputs_hash: inputsHash,
        user_id: userId,
      }, "blocked");
      return new Response(
        JSON.stringify({ error: "abuse_guard_blocked", reason: "identical_resubmit", message: "Gleicher Workflow gerade ausgeführt — bitte Ergebnis abwarten." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- 6) GRANTED: audit + AI call -------------------------------------
    await emitAudit(admin, "workflow_run_granted", {
      workflow_id: wf.id,
      workflow_slug: wf.slug,
      workflow_tier: tierActual,
      usage_bucket: estCostBucket,
      ai_model: model,
      runs_today: runsToday,
      daily_limit: dailyLimit,
      entitlement_snapshot: entitlementSnapshot,
      user_id: userId,
    });

    await emitAudit(admin, "workflow_ai_call_attempted", {
      workflow_id: wf.id,
      workflow_slug: wf.slug,
      workflow_tier: tierActual,
      ai_model: model,
      estimated_prompt_tokens: estPromptTokens,
      estimated_cost_bucket: estCostBucket,
      user_id: userId,
    });

    const t0 = Date.now();
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: caps.maxOutputTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (aiResp.status === 429 || aiResp.status === 402 || !aiResp.ok) {
      const txt = await aiResp.text().catch(() => "");
      const errReason = aiResp.status === 429 ? "gateway_429" : aiResp.status === 402 ? "gateway_402" : `gateway_${aiResp.status}`;
      const status = aiResp.status === 429 ? "rate_limited" : aiResp.status === 402 ? "blocked" : "error";
      await admin.from("berufs_ki_workflow_runs").insert({
        workflow_id: wf.id,
        user_id: userId,
        beruf_slug: beruf_slug ?? null,
        inputs: inputs ?? {},
        status,
        error_reason: errReason,
        model_used: model,
        tier_at_run: tierActual,
      });
      await emitAudit(admin, "workflow_ai_call_completed", {
        workflow_id: wf.id,
        workflow_slug: wf.slug,
        workflow_tier: tierActual,
        ai_model: model,
        tokens_in: 0, tokens_out: 0,
        latency_ms: Date.now() - t0,
        estimated_cost_bucket: estCostBucket,
        error_reason: errReason,
        user_id: userId,
      }, status === "error" ? "error" : "blocked", txt.slice(0, 500));
      const httpStatus = aiResp.status === 429 ? 429 : aiResp.status === 402 ? 402 : 502;
      const message = aiResp.status === 429
        ? "Bitte gleich nochmal versuchen — Berufs-KI ist gerade stark ausgelastet."
        : aiResp.status === 402
          ? "Berufs-KI Kontingent aufgebraucht. Bitte Workspace aufladen."
          : "AI-Gateway-Fehler.";
      return new Response(JSON.stringify({ error: errReason, message }), {
        status: httpStatus,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const output_text: string = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage ?? {};
    const latency_ms = Date.now() - t0;

    // Output-Contract Guard
    const expectedSections: string[] = Array.isArray(wf.output_schema?.sections)
      ? wf.output_schema.sections
      : [];
    const detected: string[] = [];
    const missing: string[] = [];
    if (expectedSections.length > 0 && output_text) {
      const lc = output_text.toLowerCase();
      for (const sec of expectedSections) {
        const variants = [sec.toLowerCase(), sec.replace(/_/g, " ").toLowerCase(), sec.replace(/_/g, "-").toLowerCase()];
        if (variants.some((v) => lc.includes(v))) detected.push(sec);
        else missing.push(sec);
      }
    }
    const coverage_pct =
      expectedSections.length > 0
        ? Math.round((detected.length / expectedSections.length) * 1000) / 10
        : null;
    const completion_status =
      !output_text || output_text.trim().length < 40
        ? "empty"
        : expectedSections.length === 0
          ? "unknown"
          : missing.length === 0
            ? "complete"
            : "partial";
    const lengthSignal = Math.min(1, output_text.length / 1500);
    const quality_score =
      expectedSections.length > 0
        ? Number((((detected.length / expectedSections.length) * 0.7) + lengthSignal * 0.3).toFixed(3))
        : Number(lengthSignal.toFixed(3));

    const { data: runRow } = await admin
      .from("berufs_ki_workflow_runs")
      .insert({
        workflow_id: wf.id,
        user_id: userId,
        beruf_slug: beruf_slug ?? null,
        inputs: inputs ?? {},
        output_text,
        model_used: model,
        tokens_in: usage?.prompt_tokens ?? null,
        tokens_out: usage?.completion_tokens ?? null,
        latency_ms,
        status: "ok",
        tier_at_run: tierActual,
        output_sections_detected: detected,
        output_sections_missing: missing,
        sections_coverage_pct: coverage_pct,
        completion_status,
        quality_score,
        definition_version_at_run: wf.version ?? 1,
        source_run_id: body.source_run_id ?? null,
        follow_up_of: body.follow_up_of ?? null,
      })
      .select("id")
      .maybeSingle();

    await emitAudit(admin, "workflow_ai_call_completed", {
      workflow_id: wf.id,
      workflow_slug: wf.slug,
      workflow_tier: tierActual,
      ai_model: model,
      tokens_in: usage?.prompt_tokens ?? 0,
      tokens_out: usage?.completion_tokens ?? 0,
      latency_ms,
      estimated_cost_bucket: estCostBucket,
      run_id: runRow?.id ?? null,
      user_id: userId,
    });

    return new Response(
      JSON.stringify({
        run_id: runRow?.id,
        workflow: { slug: wf.slug, title: wf.title, output_schema: wf.output_schema },
        output_text,
        model_used: model,
        latency_ms,
        tier_actual: tierActual,
        runs_today: runsToday + 1,
        daily_limit: dailyLimit,
        quality: { coverage_pct, completion_status, sections_detected: detected, sections_missing: missing, quality_score },
        version_at_run: wf.version ?? 1,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[berufs-ki-run] fatal", e);
    return new Response(
      JSON.stringify({ error: "fatal", message: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
