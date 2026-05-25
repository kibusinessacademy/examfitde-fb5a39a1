// Berufs-KI Workflow Runner — Phase 1
// Auth: requires JWT. Resolves workflow by slug, interpolates user_prompt_template
// with sanitized inputs, calls Lovable AI Gateway, audits run.
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
const DAILY_RUN_LIMIT_FREE = 10;

function sanitize(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return s.length > MAX_INPUT_CHARS ? s.slice(0, MAX_INPUT_CHARS) + "\n[…gekürzt]" : s;
}

function interpolate(tpl: string, inputs: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => sanitize(inputs[key]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "auth_required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
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

    const body = await req.json().catch(() => ({}));
    const { slug, inputs, beruf_slug } = body as {
      slug?: string;
      inputs?: Record<string, unknown>;
      beruf_slug?: string;
    };

    if (!slug || typeof slug !== "string") {
      return new Response(JSON.stringify({ error: "slug_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load workflow
    const { data: wf, error: wfErr } = await admin
      .from("berufs_ki_workflow_definitions")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();

    if (wfErr || !wf) {
      return new Response(JSON.stringify({ error: "workflow_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tier / entitlement gate (free=allow, pro/business=check grants)
    const { data: gate, error: gateErr } = await admin.rpc("berufs_ki_user_can_run", {
      p_user_id: userId,
      p_workflow_id: wf.id,
    });
    const gateRow = Array.isArray(gate) ? gate[0] : gate;
    const tierAtRun = gateRow?.tier_required ?? wf.tier_required ?? "free";

    if (gateErr || !gateRow?.allowed) {
      await admin.from("berufs_ki_workflow_runs").insert({
        workflow_id: wf.id,
        user_id: userId,
        beruf_slug: beruf_slug ?? null,
        inputs: inputs ?? {},
        status: "blocked",
        error_reason: gateRow?.reason ?? "entitlement_check_failed",
        tier_at_run: tierAtRun,
      });
      return new Response(
        JSON.stringify({
          error: "entitlement_required",
          reason: gateRow?.reason ?? "entitlement_check_failed",
          tier_required: tierAtRun,
          message:
            tierAtRun === "free"
              ? "Workflow gerade nicht verfügbar."
              : `Dieser Workflow benötigt ${tierAtRun === "business" ? "Business-Zugang" : "einen aktiven Pro-Zugang"}.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Daily rate limit (free tier only)
    if (tierAtRun === "free") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: runsToday } = await admin
        .from("berufs_ki_workflow_runs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", since)
        .eq("status", "ok");

      if ((runsToday ?? 0) >= DAILY_RUN_LIMIT_FREE) {
        await admin.from("berufs_ki_workflow_runs").insert({
          workflow_id: wf.id,
          user_id: userId,
          beruf_slug: beruf_slug ?? null,
          inputs: inputs ?? {},
          status: "rate_limited",
          error_reason: `daily_limit_${DAILY_RUN_LIMIT_FREE}`,
          tier_at_run: tierAtRun,
        });
        return new Response(
          JSON.stringify({
            error: "rate_limited",
            message: `Tageslimit von ${DAILY_RUN_LIMIT_FREE} Workflows erreicht. Pro/Business hebt das Limit auf.`,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }


    // Validate required fields
    const fields = (wf.input_schema?.fields ?? []) as Array<{ key: string; required?: boolean; label?: string }>;
    const missing = fields.filter((f) => f.required && !sanitize((inputs ?? {})[f.key]).trim());
    if (missing.length) {
      return new Response(
        JSON.stringify({
          error: "missing_inputs",
          missing: missing.map((f) => ({ key: f.key, label: f.label })),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userPrompt = interpolate(wf.user_prompt_template, inputs ?? {});
    const model = wf.model_recommendation || "google/gemini-2.5-pro";

    const t0 = Date.now();
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: wf.system_prompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (aiResp.status === 429) {
      await admin.from("berufs_ki_workflow_runs").insert({
        workflow_id: wf.id,
        user_id: userId,
        beruf_slug: beruf_slug ?? null,
        inputs: inputs ?? {},
        status: "rate_limited",
        error_reason: "gateway_429",
        model_used: model,
      });
      return new Response(
        JSON.stringify({ error: "rate_limited", message: "Bitte gleich nochmal versuchen — Berufs-KI ist gerade stark ausgelastet." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (aiResp.status === 402) {
      await admin.from("berufs_ki_workflow_runs").insert({
        workflow_id: wf.id,
        user_id: userId,
        beruf_slug: beruf_slug ?? null,
        inputs: inputs ?? {},
        status: "blocked",
        error_reason: "gateway_402",
        model_used: model,
      });
      return new Response(
        JSON.stringify({ error: "payment_required", message: "Berufs-KI Kontingent aufgebraucht. Bitte Workspace aufladen." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("[berufs-ki-run] gateway error", aiResp.status, txt);
      await admin.from("berufs_ki_workflow_runs").insert({
        workflow_id: wf.id,
        user_id: userId,
        beruf_slug: beruf_slug ?? null,
        inputs: inputs ?? {},
        status: "error",
        error_reason: `gateway_${aiResp.status}`,
        model_used: model,
      });
      return new Response(JSON.stringify({ error: "gateway_error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const output_text: string = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage ?? {};
    const latency_ms = Date.now() - t0;

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
        tier_at_run: "free",
      })
      .select("id")
      .maybeSingle();

    return new Response(
      JSON.stringify({
        run_id: runRow?.id,
        workflow: { slug: wf.slug, title: wf.title, output_schema: wf.output_schema },
        output_text,
        model_used: model,
        latency_ms,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[berufs-ki-run] fatal", e);
    return new Response(
      JSON.stringify({ error: "fatal", message: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
