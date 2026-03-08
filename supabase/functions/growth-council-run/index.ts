import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Payload = { limit?: number; daysInactive?: number };

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "run_growth_council";
    const payload: Payload = body.payload ?? body;

    if (action !== "run_growth_council") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), { status: 400, headers });
    }

    const limit = Math.min(Number(payload.limit ?? 50), 200);
    const daysInactive = Math.max(Number(payload.daysInactive ?? 14), 3);
    const cutoff = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000).toISOString();

    const cand = await sb.rpc("growth_user_candidates", { p_cutoff: cutoff, p_limit: limit });
    if (cand.error) throw cand.error;

    let actionsCreated = 0;

    for (const u of cand.data ?? []) {
      const signals = {
        last_accessed_at: u.last_accessed_at,
        last_progress_at: u.last_progress_at,
        days_inactive: u.days_inactive,
        lessons_completed: u.lessons_completed,
      };

      const score = scoreHeuristic(signals);
      const label = score >= 0.7 ? "high" : score >= 0.4 ? "med" : "low";

      await upsertRisk(sb, u.user_id, score, label, signals);

      if (label !== "low") {
        const actionPlan = await proposeActionLLM(signals);

        const ins = await sb.from("growth_actions").insert({
          action_type: "in_app_nudge",
          target_user_id: u.user_id,
          title: actionPlan.title ?? "Kurz zurück ins Training",
          payload_json: actionPlan.payload ?? {},
          rationale_json: { signals, score, label, model: "lovable/openai/gpt-5.2" },
          status: "proposed",
          dedupe_key: `inactive_${Math.min(30, Math.max(7, Number(signals.days_inactive ?? 0)))}d`,
          cooldown_until: null,
        });

        if (!ins.error) actionsCreated++;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      processed: (cand.data ?? []).length,
      actionsCreated,
      cutoff,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[growth-council-run] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

function scoreHeuristic(s: { days_inactive?: number; lessons_completed?: number }) {
  const d = Number(s.days_inactive ?? 0);
  const completed = Number(s.lessons_completed ?? 0);

  let base =
    d >= 30 ? 0.9 :
    d >= 14 ? 0.7 :
    d >= 7 ? 0.5 : 0.2;

  if (completed >= 10) base -= 0.1;
  if (completed >= 30) base -= 0.1;

  return Math.max(0, Math.min(1, base));
}

async function upsertRisk(
  sb: ReturnType<typeof createClient>,
  userId: string,
  score: number,
  label: string,
  signals: Record<string, unknown>,
) {
  const ex = await sb.from("growth_risk_scores").select("id").eq("user_id", userId).maybeSingle();
  if (ex.error) return;

  if (ex.data?.id) {
    await sb.from("growth_risk_scores").update({
      score, label, signals_json: signals, computed_at: new Date().toISOString(),
    }).eq("id", ex.data.id);
    return;
  }

  await sb.from("growth_risk_scores").insert({
    user_id: userId, score, label, signals_json: signals,
  });
}

async function proposeActionLLM(signals: Record<string, unknown>) {
  try {
    const result = await callAIJSON({
      provider: "lovable",
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `Du bist ExamFit Growth Council.
Regeln:
- Keine erfundenen Ursachen. Nutze nur die Signals.
- Output STRICT JSON:
{"title":"...","payload":{"message":"...","cta":"Prüfung starten","tips":["..."]}}`,
        },
        { role: "user", content: JSON.stringify({ signals }).slice(0, 6000) },
      ],
      temperature: 0.3,
    });

    const raw = (result.content ?? "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(raw);
  } catch {
    return {
      title: "Kurz zurück ins Training",
      payload: {
        message: "Starte heute eine Lesson + MiniCheck (10 Minuten).",
        cta: "Prüfung starten",
        tips: ["Eine Lesson öffnen", "MiniCheck machen", "Schwäche markieren"],
      },
    };
  }
}
