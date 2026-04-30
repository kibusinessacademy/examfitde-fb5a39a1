// Synthetic Cohort Runner — orchestriert Persona-Walks über alle published Pakete.
// Modus: heuristic_with_llm_gate (Default). LLM nur bei flagged_for_llm_review.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface StartBody {
  package_ids?: string[];
  persona_keys?: string[];
  mode?: "heuristic_only" | "heuristic_with_llm_gate" | "llm_full";
  max_llm_calls?: number; // Cost-Cap
  run_id?: string; // wenn gesetzt: kein neuer Run, nur LLM-Review für package_ids im existierenden Run
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "missing_auth" }, 401);
    }

    // User-Client für RPC-Calls (RLS + has_role greift)
    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin-Client (Service-Role) nur für interne Reads, falls nötig
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body: StartBody = await req.json().catch(() => ({}));
    const mode = body.mode ?? "heuristic_with_llm_gate";
    const maxLlmCalls = body.max_llm_calls ?? 10;

    let runId: string;
    const isRetargetedLlm = !!body.run_id && Array.isArray(body.package_ids) && body.package_ids.length > 0;

    if (isRetargetedLlm) {
      runId = body.run_id!;
      console.log(`[synth] Retargeted LLM-Review on existing run=${runId} for ${body.package_ids!.length} pkgs`);
    } else {
      const { data: runIdData, error: startErr } = await userClient.rpc("synth_start_run", {
        p_package_ids: body.package_ids ?? null,
        p_persona_keys: body.persona_keys ?? null,
        p_mode: mode,
      });
      if (startErr) throw startErr;
      runId = runIdData as string;
      console.log(`[synth] Run started: ${runId} (mode=${mode})`);
    }

    // 2) Run-Header lesen — bei retarget: nur die übergebenen pkgs nutzen
    let pkgIds: string[];
    if (isRetargetedLlm) {
      pkgIds = body.package_ids!;
    } else {
      const { data: runRow, error: runErr } = await admin
        .from("synth_cohort_runs")
        .select("package_ids")
        .eq("id", runId)
        .single();
      if (runErr) throw runErr;
      pkgIds = (runRow?.package_ids as string[]) ?? [];
    }
    console.log(`[synth] Processing ${pkgIds.length} packages`);

    // 3) Heuristik nur wenn KEIN retarget (sonst sind Sessions schon da)
    let llmCalls = 0;
    const llmTargets: Array<{ pkg: string; flagged: boolean }> = [];

    if (!isRetargetedLlm) {
      for (const pkgId of pkgIds) {
        const { data: hRes, error: hErr } = await userClient.rpc("synth_run_heuristic", {
          p_run_id: runId,
          p_package_id: pkgId,
        });
        if (hErr) {
          console.error(`[synth] Heuristik-Fehler pkg=${pkgId}:`, hErr.message);
          continue;
        }
        const flagged = (hRes as { flagged_for_llm_review?: boolean })?.flagged_for_llm_review;
        llmTargets.push({ pkg: pkgId, flagged: !!flagged });
      }
    } else {
      // Bei retarget: alle übergebenen pkgs als "flagged" behandeln (Admin hat bewusst getriggert)
      for (const pkgId of pkgIds) llmTargets.push({ pkg: pkgId, flagged: true });
    }

    // 4) LLM-Reviewer für geflaggte Pakete
    if (mode !== "heuristic_only" && LOVABLE_API_KEY) {
      const flaggedPkgs = llmTargets.filter((t) => t.flagged).slice(0, maxLlmCalls);
      console.log(`[synth] LLM review for ${flaggedPkgs.length} flagged packages`);

      for (const { pkg } of flaggedPkgs) {
        try {
          await runLlmReview(admin, runId, pkg);
          llmCalls++;
        } catch (e) {
          console.error(`[synth] LLM review failed pkg=${pkg}:`, (e as Error).message);
        }
      }

      await admin
        .from("synth_cohort_runs")
        .update({ llm_calls: llmCalls })
        .eq("id", runId);
    }

    // 5) Run finalisieren — bei retarget NICHT (Run ist schon completed; nur llm_calls aktualisieren)
    let avgScore: number | undefined;
    if (!isRetargetedLlm) {
      const { data: finRes, error: finErr } = await userClient.rpc("synth_finalize_run", {
        p_run_id: runId,
      });
      if (finErr) throw finErr;
      avgScore = (finRes as { avg_didactic_score?: number })?.avg_didactic_score;
    }

    return json({
      ok: true,
      run_id: runId,
      packages_processed: pkgIds.length,
      llm_calls: llmCalls,
      avg_didactic_score: avgScore,
    });
  } catch (e) {
    console.error("[synth] Error:", e);
    return json({ error: (e as Error).message ?? "unknown" }, 500);
  }
});

// ============================================================
// LLM-Reviewer: holt 3 schwächste Lessons des Pakets, lässt sie bewerten
// ============================================================
async function runLlmReview(admin: ReturnType<typeof createClient>, runId: string, packageId: string) {
  // Hole package + course + ein paar Lessons als Sample
  const { data: pkg } = await admin
    .from("course_packages")
    .select("id, title, course_id")
    .eq("id", packageId)
    .single();
  if (!pkg) return;

  // Hole 3 Lessons (1 Einstieg, 1 Anwenden, 1 Mini-Check) als Sample
  const sample = await Promise.all(
    ["einstieg", "anwenden", "mini_check"].map(async (step) => {
      const { data } = await admin
        .from("lessons")
        .select("id, title, content, step_type, learning_objectives, modules!inner(course_id)")
        .eq("modules.course_id", pkg.course_id)
        .eq("step_type", step)
        .limit(1)
        .maybeSingle();
      return data;
    })
  );
  const lessons = sample.filter(Boolean);
  if (lessons.length === 0) return;

  const prompt = `Du bist ein Senior Learning Consultant für IHK-Prüfungsvorbereitung.

Bewerte die didaktische Qualität dieser Lesson-Sequenz (Einstieg → Anwenden → Mini-Check) für das Paket "${pkg.title}".

Lessons:
${lessons.map((l) => `[${l!.step_type}] ${l!.title}\n${(l!.content ?? "").slice(0, 600)}`).join("\n\n---\n\n")}

Bewerte auf einer Skala 0-100 und nenne die 1-3 wichtigsten Schwachstellen.`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Du bist ein präziser Reviewer. Antworte ausschließlich mit dem Tool-Call." },
        { role: "user", content: prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "submit_review",
            description: "Bewertung der didaktischen Sequenz",
            parameters: {
              type: "object",
              properties: {
                didactic_score: { type: "number", minimum: 0, maximum: 100 },
                coherence_score: { type: "number", minimum: 0, maximum: 100 },
                ihk_relevance: { type: "number", minimum: 0, maximum: 100 },
                weaknesses: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      severity: { type: "string", enum: ["info", "warn", "critical"] },
                      title: { type: "string" },
                      detail: { type: "string" },
                      suggested_fix: { type: "string" },
                    },
                    required: ["severity", "title", "detail", "suggested_fix"],
                  },
                  maxItems: 5,
                },
              },
              required: ["didactic_score", "coherence_score", "ihk_relevance", "weaknesses"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "submit_review" } },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error(`[synth-llm] Gateway error ${resp.status}: ${t.slice(0, 200)}`);
    return;
  }

  const j = await resp.json();
  const toolCall = j.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    console.warn(`[synth-llm] No tool call returned for pkg=${packageId}`);
    return;
  }
  const review = JSON.parse(toolCall.function.arguments);

  // Findings persistieren
  const findings = (review.weaknesses ?? []).map((w: {
    severity: string;
    title: string;
    detail: string;
    suggested_fix: string;
  }) => ({
    run_id: runId,
    package_id: packageId,
    finding_type: "llm_didactic_review",
    severity: w.severity,
    detected_by: "llm",
    detail: `${w.title}: ${w.detail}`,
    evidence: {
      didactic_score: review.didactic_score,
      coherence_score: review.coherence_score,
      ihk_relevance: review.ihk_relevance,
      sampled_lessons: lessons.map((l) => l!.id),
    },
    suggested_fix: w.suggested_fix,
  }));

  if (findings.length > 0) {
    await admin.from("synth_didactic_findings").insert(findings);
    await admin
      .from("synth_session_results")
      .update({ llm_reviewed: true })
      .eq("run_id", runId)
      .eq("package_id", packageId);
  }

  console.log(`[synth-llm] pkg=${packageId} score=${review.didactic_score} weaknesses=${findings.length}`);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
