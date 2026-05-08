// course-heal-plan-generate
// Generates a per-course adaptive heal plan via Lovable AI Gateway and persists it.
// Triggered: on package create OR after a step hard-fails (attempts >= 3).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

interface GenerateBody {
  package_id: string;
  trigger_reason: "initial" | "post_hard_fail" | "manual";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = (await req.json()) as GenerateBody;
    if (!body?.package_id) return json({ error: "package_id required" }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // Auth via shared contract (internal-secret | service-role bearer | admin JWT).
    const { assertAdmin } = await import("../_shared/edgeAuthContract.ts");
    const authR = await assertAdmin(req, "course-heal-plan-generate");
    if (!authR.ok) return json({ error: "unauthorized" }, authR.status);

    // Gather context
    const { data: pkg } = await sb
      .from("course_packages")
      .select("id,title,track,status,blocked_reason,last_error,created_at")
      .eq("id", body.package_id)
      .maybeSingle();
    if (!pkg) return json({ error: "package_not_found" }, 404);

    const { data: steps } = await sb
      .from("package_steps")
      .select("step_key,status,attempts,last_error,updated_at")
      .eq("package_id", body.package_id)
      .order("updated_at", { ascending: false })
      .limit(40);

    const { data: recentHeals } = await sb
      .from("auto_heal_log")
      .select("action_type,result_status,result_detail,created_at")
      .eq("target_id", body.package_id)
      .order("created_at", { ascending: false })
      .limit(20);

    const { count: hardFailCount } = await sb
      .from("package_steps")
      .select("step_key", { count: "exact", head: true })
      .eq("package_id", body.package_id)
      .gte("attempts", 3);

    if (!LOVABLE_API_KEY) return json({ error: "ai_gateway_not_configured" }, 500);

    const systemPrompt = `Du bist ein Pipeline-Healing-Stratege für E-Learning-Kurspakete. Du erstellst einen knappen, ausführbaren Heal-Plan basierend auf der Historie eines konkreten Pakets. Liefere ausschließlich strukturierte Daten via Tool-Call.`;

    const userPrompt = `Paket: ${pkg.title} (track=${pkg.track}, status=${pkg.status})
Blocked-Reason: ${pkg.blocked_reason ?? "—"}
Last-Error: ${pkg.last_error ?? "—"}
Hard-Fail-Steps: ${hardFailCount ?? 0}

Steps (Top 40 aktuell):
${(steps ?? []).map(s => `- ${s.step_key} [${s.status}] attempts=${s.attempts ?? 0} err=${(s.last_error ?? "").slice(0, 120)}`).join("\n")}

Recent Heal-Log (20):
${(recentHeals ?? []).map(h => `- ${h.action_type} [${h.result_status}] ${(h.result_detail ?? "").slice(0, 80)}`).join("\n")}

Erstelle einen paket-spezifischen Heal-Plan: priorisierte Schritte, je mit action + reason + erwartetem Outcome. Mögliche actions: soft_reentry, hard_heal, mark_content_gap, force_depublish_rebuild, change_provider, relax_constraints, escalate_to_human.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_course_heal_plan",
            description: "Submit a per-course adaptive heal plan",
            parameters: {
              type: "object",
              properties: {
                rationale: { type: "string", description: "1-3 sentence root-cause + strategy" },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                steps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string", enum: ["soft_reentry","hard_heal","mark_content_gap","force_depublish_rebuild","change_provider","relax_constraints","escalate_to_human"] },
                      target_step: { type: "string", description: "step_key e.g. generate_exam_pool" },
                      reason: { type: "string" },
                      expected_outcome: { type: "string" },
                      params: { type: "object", additionalProperties: true },
                    },
                    required: ["action","reason","expected_outcome"],
                    additionalProperties: false,
                  },
                  minItems: 1,
                  maxItems: 6,
                },
                permanent_fix_suggestion: { type: "string" },
              },
              required: ["rationale","confidence","steps"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_course_heal_plan" } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      if (aiResp.status === 429) return json({ error: "rate_limited", detail: txt }, 429);
      if (aiResp.status === 402) return json({ error: "ai_credits_exhausted", detail: txt }, 402);
      return json({ error: "ai_gateway_error", status: aiResp.status, detail: txt }, 500);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return json({ error: "no_tool_call_in_response", raw: aiData }, 500);
    const planArgs = JSON.parse(toolCall.function.arguments);

    // Deactivate old plans
    await sb.from("course_heal_plans").update({ is_active: false }).eq("package_id", body.package_id).eq("is_active", true);

    // Insert new plan
    const { data: inserted, error: insErr } = await sb
      .from("course_heal_plans")
      .insert({
        package_id: body.package_id,
        plan: planArgs,
        rationale: planArgs.rationale,
        confidence: planArgs.confidence,
        model_used: "google/gemini-2.5-flash",
        hard_fail_count_at_generation: hardFailCount ?? 0,
        trigger_reason: body.trigger_reason,
        is_active: true,
      })
      .select()
      .maybeSingle();

    if (insErr) return json({ error: "insert_failed", detail: insErr.message }, 500);

    await sb.from("auto_heal_log").insert({
      action_type: "course_heal_plan_generated",
      trigger_source: "course-heal-plan-generate",
      target_type: "course_package",
      target_id: body.package_id,
      result_status: "applied",
      result_detail: `${planArgs.steps?.length ?? 0} steps, confidence=${planArgs.confidence}`,
      metadata: { trigger_reason: body.trigger_reason, plan_id: inserted?.id, hard_fail_count: hardFailCount },
    });

    return json({ ok: true, plan_id: inserted?.id, plan: planArgs });
  } catch (e) {
    return json({ error: (e as Error).message ?? "unknown_error" }, 500);
  }
});
