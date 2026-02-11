import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Payload = {
  mode?: "users" | "enterprise";
  limit?: number;
  daysInactive?: number;
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "run_growth_council";
    const payload: Payload = body.payload ?? body;

    if (action !== "run_growth_council") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), { status: 400, headers });
    }

    const mode = payload.mode ?? "users";
    const limit = Math.min(Number(payload.limit ?? 50), 200);
    const daysInactive = Math.max(Number(payload.daysInactive ?? 14), 3);

    if (mode === "users") {
      const res = await runUserMode(sb, { limit, daysInactive });
      return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers });
    }

    const res = await runEnterpriseMode(sb, { limit });
    return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[growth-council-run] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

// ---- User Mode: churn risk scoring + nudge proposals ----

async function runUserMode(sb: ReturnType<typeof createClient>, opts: { limit: number; daysInactive: number }) {
  const cutoff = new Date(Date.now() - opts.daysInactive * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await sb.rpc("growth_user_candidates", {
    p_cutoff: cutoff,
    p_limit: opts.limit,
  });
  if (error) throw error;

  const rows = (candidates ?? []) as Array<{
    user_id: string;
    last_activity_at: string | null;
    days_inactive: number;
    entitlement_count: number;
  }>;
  const created: string[] = [];

  for (const u of rows) {
    const signals = {
      last_activity_at: u.last_activity_at,
      days_inactive: u.days_inactive,
      entitlement_count: u.entitlement_count,
    };

    const score = scoreHeuristic(signals);
    const label = score >= 0.7 ? "high" : score >= 0.4 ? "med" : "low";

    await upsertRisk(sb, {
      user_id: u.user_id,
      enterprise_account_id: null,
      score,
      label,
      signals,
    });

    // Only propose actions for med/high risk
    if (label !== "low") {
      const action = await proposeActionLLM({ scope: "user", signals, user_id: u.user_id });

      const ins = await sb.from("growth_actions").insert({
        action_type: "in_app_nudge",
        target_user_id: u.user_id,
        title: action.title ?? "Weiterlernen – kurzer Plan",
        payload_json: action.payload ?? {},
        rationale_json: { signals, model: "deepseek" },
        status: "proposed",
      }).select("id").single();

      if (!ins.error) created.push(ins.data.id);
    }
  }

  return { processed: rows.length, actions_created: created.length };
}

// ---- Enterprise Mode: seat adoption scoring ----

async function runEnterpriseMode(sb: ReturnType<typeof createClient>, opts: { limit: number }) {
  const { data: accounts, error } = await sb.rpc("growth_enterprise_candidates", {
    p_limit: opts.limit,
  });
  if (error) throw error;

  const rows = (accounts ?? []) as Array<{
    enterprise_account_id: string;
    seats_total: number;
    seats_claimed: number;
    adoption_rate: number;
  }>;
  const created: string[] = [];

  for (const a of rows) {
    const signals = {
      seats_total: a.seats_total,
      seats_claimed: a.seats_claimed,
      adoption_rate: a.adoption_rate,
    };

    const score = signals.adoption_rate < 0.4 ? 0.8 : signals.adoption_rate < 0.6 ? 0.5 : 0.2;
    const label = score >= 0.7 ? "high" : score >= 0.4 ? "med" : "low";

    await upsertRisk(sb, {
      user_id: null,
      enterprise_account_id: a.enterprise_account_id,
      score,
      label,
      signals,
    });

    if (label !== "low") {
      const action = await proposeActionLLM({
        scope: "enterprise",
        signals,
        enterprise_account_id: a.enterprise_account_id,
      });

      const ins = await sb.from("growth_actions").insert({
        action_type: "b2b_admin_nudge",
        enterprise_account_id: a.enterprise_account_id,
        title: action.title ?? "Lizenznutzung steigern – 3 konkrete Schritte",
        payload_json: action.payload ?? {},
        rationale_json: { signals, model: "deepseek" },
        status: "proposed",
      }).select("id").single();

      if (!ins.error) created.push(ins.data.id);
    }
  }

  return { processed: rows.length, actions_created: created.length };
}

// ---- Deterministic scoring (no hallucination) ----

function scoreHeuristic(signals: { days_inactive?: number; entitlement_count?: number }) {
  const d = Number(signals.days_inactive ?? 0);
  const e = Number(signals.entitlement_count ?? 0);
  if (e <= 0) return 0.1;
  if (d >= 30) return 0.9;
  if (d >= 14) return 0.7;
  if (d >= 7) return 0.5;
  return 0.2;
}

// ---- Risk score upsert (handles null-key unique constraint) ----

async function upsertRisk(
  sb: ReturnType<typeof createClient>,
  r: { user_id: string | null; enterprise_account_id: string | null; score: number; label: string; signals: Record<string, unknown> }
) {
  let query = sb.from("growth_risk_scores").select("id");
  if (r.user_id) query = query.eq("user_id", r.user_id);
  else query = query.is("user_id", null);
  if (r.enterprise_account_id) query = query.eq("enterprise_account_id", r.enterprise_account_id);
  else query = query.is("enterprise_account_id", null);

  const existing = await query.maybeSingle();
  if (existing.error) return;

  if (existing.data?.id) {
    await sb.from("growth_risk_scores").update({
      score: r.score,
      label: r.label,
      signals_json: r.signals,
      computed_at: new Date().toISOString(),
    }).eq("id", existing.data.id);
  } else {
    await sb.from("growth_risk_scores").insert({
      user_id: r.user_id,
      enterprise_account_id: r.enterprise_account_id,
      score: r.score,
      label: r.label,
      signals_json: r.signals,
    });
  }
}

// ---- LLM action proposal (cost-efficient, grounded in signals only) ----

async function proposeActionLLM(input: Record<string, unknown>) {
  try {
    const result = await callAIJSON({
      provider: "deepseek",
      messages: [
        {
          role: "system",
          content: `Du bist Growth Council (ExamFit). Erzeuge eine kurze, hilfreiche Maßnahme.
Regeln:
- KEINE erfundenen Gründe. Nutze nur die gelieferten Signals.
- Output STRICT JSON: {"title": "...", "payload": {"message": "...", "cta": "...", "tips": ["..."]}}`,
        },
        { role: "user", content: JSON.stringify(input).slice(0, 8000) },
      ],
      temperature: 0.3,
    });

    const raw = (result.content ?? "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(raw);
  } catch {
    return {
      title: "Weiterlernen – kurzer Plan",
      payload: {
        message: "Mach heute 10 Minuten MiniCheck.",
        cta: "Prüfung starten",
        tips: ["Starte mit einer Lesson", "MiniCheck machen", "Schwächen markieren"],
      },
    };
  }
}
