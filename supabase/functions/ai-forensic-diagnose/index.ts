// AI Forensic Diagnose — per-Paket on-demand Tiefenanalyse via Lovable AI Gateway.
// POST { package_id } → { diagnosis, recommended_actions[], severity, summary }
// Sammelt vollen Forensik-Bundle (steps, jobs, heal_log, guard_reason),
// schickt an gemini-2.5-pro mit struktur-output via tool calling.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const package_id: string | undefined = body.package_id;
    if (!package_id || !/^[0-9a-f-]{36}$/i.test(package_id)) {
      return json({ error: "package_id (uuid) required" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const [pkg, steps, jobs, log] = await Promise.all([
      sb.from("course_packages").select("id,package_key,title,status,feature_flags,created_at,updated_at").eq("id", package_id).maybeSingle(),
      sb.from("package_steps").select("step_key,status,attempt,last_error,started_at,completed_at").eq("package_id", package_id).order("step_key"),
      sb.from("job_queue").select("id,job_type,status,attempts,last_error,enqueue_source,created_at").eq("package_id", package_id).order("created_at", { ascending: false }).limit(25),
      sb.from("auto_heal_log").select("action_type,result_status,details,created_at").eq("target_id", package_id).order("created_at", { ascending: false }).limit(15),
    ]);

    if (!pkg.data) return json({ error: "package not found" }, 404);

    const bundle = {
      package: pkg.data,
      steps: steps.data ?? [],
      recent_jobs: jobs.data ?? [],
      recent_heal_log: log.data ?? [],
    };

    const systemPrompt = `Du bist ein Senior-SRE für eine LMS-Pipeline (ExamFit).
Du analysierst ein einzelnes Course-Package im Detail. Diagnostiziere präzise:
- Ist es stuck? Wo? (welcher step_key, welche attempt-zahl)
- Ist es Bronze-locked? Tail-step deferred? DAG-Backlog?
- Welche konkrete Heal-Aktion ist empfohlen?
Antworte ausschließlich via tool call "diagnose".`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Forensik-Bundle:\n```json\n" + JSON.stringify(bundle, null, 2) + "\n```" },
        ],
        tools: [{
          type: "function",
          function: {
            name: "diagnose",
            description: "Forensik-Diagnose des Pakets",
            parameters: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["info", "warn", "error", "critical"] },
                summary: { type: "string", description: "1-2 Sätze: Was ist das Kernproblem?" },
                root_cause: { type: "string", description: "Technische Wurzel-Ursache mit step_key/job_type Bezug" },
                recommended_actions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string", description: "z.B. retry_step, bronze_repair, bulk_promote, manual_review" },
                      target: { type: "string", description: "step_key oder job_id" },
                      rationale: { type: "string" },
                    },
                    required: ["action", "rationale"],
                  },
                },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["severity", "summary", "root_cause", "recommended_actions", "confidence"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "diagnose" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return json({ error: "Rate limit, später erneut versuchen" }, 429);
      if (aiResp.status === 402) return json({ error: "Lovable-AI Credits aufgebraucht" }, 402);
      return json({ error: "AI gateway error", status: aiResp.status, body: await aiResp.text() }, 500);
    }

    const aiJson = await aiResp.json();
    const tool = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!tool) return json({ error: "AI returned no tool call", raw: aiJson }, 502);

    const diagnosis = JSON.parse(tool.function.arguments);

    // Persist
    await sb.from("auto_heal_log").insert({
      action_type: "ai_forensic_diagnosis",
      target_type: "package",
      target_id: package_id,
      result_status: "ok",
      details: { diagnosis, model: "google/gemini-2.5-pro", bundle_size: { steps: bundle.steps.length, jobs: bundle.recent_jobs.length } },
    });

    return json({ ok: true, package_id, diagnosis });
  } catch (e) {
    console.error("ai-forensic-diagnose error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

function json(b: any, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
