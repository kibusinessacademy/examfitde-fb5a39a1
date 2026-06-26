// Berufs-KI Phase 4B — AI Precheck Engine
// Analyzes a community submission for duplicate risk, governance risk, quality.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return j({ error: "unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return j({ error: "ai_not_configured" }, 500);

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return j({ error: "unauthorized" }, 401);

    const body = await req.json();
    const submissionId: string | undefined = body.submission_id;
    if (!submissionId) return j({ error: "submission_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SR);
    const { data: sub, error: subErr } = await admin
      .from("berufs_ki_workflow_submissions")
      .select("*")
      .eq("id", submissionId)
      .maybeSingle();
    if (subErr || !sub) return j({ error: "submission not found" }, 404);
    if (sub.submitted_by !== u.user.id) {
      // also allow admins
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
      if (!roles?.some((r: any) => r.role === "admin")) return j({ error: "forbidden" }, 403);
    }

    // Pull existing definitions in same category for duplicate hint
    const { data: existing } = await admin
      .from("berufs_ki_workflow_definitions")
      .select("id, slug, title, description, category")
      .eq("category", sub.category)
      .eq("is_active", true)
      .limit(40);

    const sysPrompt = `Du bist Governance-Reviewer für ein berufsbezogenes AI-Workflow-Betriebssystem.
Bewerte eine Community-Einsendung strikt nach: Duplikat-Risiko, Governance-Risiko, Qualität.
Antworte NUR via Tool-Call.`;

    const userPrompt = JSON.stringify({
      submission: {
        title: sub.title,
        goal: sub.goal,
        beruf_slug: sub.beruf_slug,
        category: sub.category,
        steps: sub.workflow_steps,
        risks: sub.risks,
        proposed_inputs: sub.proposed_inputs,
        proposed_outputs: sub.proposed_outputs,
      },
      existing_workflows: (existing ?? []).map((x: any) => ({
        id: x.id,
        slug: x.slug,
        title: x.title,
        description: x.description,
      })),
    });

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_precheck",
              description: "Bewertung der Einsendung",
              parameters: {
                type: "object",
                properties: {
                  duplicate_score: { type: "number", description: "0-100 wie ähnlich zu existing" },
                  governance_score: { type: "number", description: "0-100 je höher desto sauberer" },
                  quality_score: { type: "number", description: "0-100" },
                  suggested_category: { type: "string" },
                  risk_flags: { type: "array", items: { type: "string" } },
                  merge_candidate_ids: { type: "array", items: { type: "string" } },
                  recommendation: { type: "string", enum: ["auto_review", "needs_changes", "likely_reject", "merge"] },
                  rationale: { type: "string" },
                },
                required: ["duplicate_score", "governance_score", "quality_score", "recommendation", "rationale"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_precheck" } },
      }),
    });

    if (aiResp.status === 429) return j({ error: "rate_limited" }, 429);
    if (aiResp.status === 402) return j({ error: "credits_exhausted" }, 402);
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("ai err", aiResp.status, t);
      return j({ error: "ai_error" }, 500);
    }

    const data = await aiResp.json();
    const tc = data?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any = {};
    try {
      parsed = JSON.parse(tc?.function?.arguments ?? "{}");
    } catch (e) {
      console.error("parse fail", e);
    }

    const newStatus = parsed.recommendation === "likely_reject" || parsed.governance_score < 30
      ? "needs_changes"
      : "pending_review";

    await admin
      .from("berufs_ki_workflow_submissions")
      .update({
        precheck: parsed,
        precheck_at: new Date().toISOString(),
        duplicate_score: parsed.duplicate_score ?? null,
        governance_score: parsed.governance_score ?? null,
        quality_score: parsed.quality_score ?? null,
        merge_candidate_ids: Array.isArray(parsed.merge_candidate_ids) ? parsed.merge_candidate_ids : null,
        status: newStatus,
      })
      .eq("id", submissionId);

    return j({ ok: true, precheck: parsed, status: newStatus });
  } catch (e) {
    console.error(e);
    return j({ error: "internal_error", code: "ERR_SERVER" }, 500);
  }
});

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
