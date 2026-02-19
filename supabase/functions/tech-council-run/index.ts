import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModelAsync } from "../_shared/model-routing.ts";

/**
 * Tech Council – Deliberative Security & Infrastructure Governance
 * 
 * Actions:
 *   scan_rls        – Audit RLS policies for risky patterns
 *   scan_edge       – Check edge function deployment & env status
 *   scan_queue      – Analyze job queue health (stuck/failed ratio)
 *   propose_patch   – GPT proposes a patch plan for a finding
 *   validate_patch  – Claude validates/vetoes the patch
 */

// Models resolved dynamically per-request via model-routing
async function resolveModels() {
  const p = await getModelAsync("council_proposer");
  const v = await getModelAsync("council_validator");
  return {
    proposerProvider: p.provider as any,
    proposerModel: p.model,
    validatorProvider: v.provider as any,
    validatorModel: v.model,
  };
}

interface Finding {
  title: string;
  severity: string;
  description: string;
  affected_entity: string;
  evidence: Record<string, unknown>;
}

function parseJsonArray(text: string): Finding[] {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : [];
  }
}

function parseJsonObj(text: string): Record<string, unknown> {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

async function logRecommendation(
  supabase: ReturnType<typeof createClient>,
  title: string,
  source: string,
  details: string,
  entityType?: string,
  entityId?: string
) {
  await supabase.from("council_recommendations").insert({
    council_id: "tech",
    title,
    source,
    details,
    entity_type: entityType || null,
    entity_id: entityId || null,
    impact: "high",
    risk: "medium",
    status: "open",
  });
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { action, findingId, patchPlanId } = body;

    const { proposerProvider, proposerModel, validatorProvider, validatorModel } = await resolveModels();

    switch (action) {
      // ─── SCAN: RLS AUDIT ────────────────────────────────────────────────
      case "scan_rls": {
        try {
          const aiResult = await callAIJSON({
            provider: proposerProvider,
            model: proposerModel,
            messages: [
              {
                role: "system",
                content: `Du bist ein Supabase-Security-Auditor. Analysiere typische Sicherheitsrisiken und generiere Findings.
Antworte NUR als JSON-Array: [{"title":"...","severity":"low|medium|high|critical","description":"...","affected_entity":"table_name","evidence":{"issue":"...","recommendation":"..."}}]`
              },
              {
                role: "user",
                content: `Prüfe typische Supabase-Sicherheitsprobleme:
1. Tabellen ohne RLS
2. Policies mit 'true' als Bedingung für anon/public
3. Sensible Spalten (password, token, secret) ohne Zugriffsbeschränkung
4. SELECT-Policies die zu viele Daten exponieren
5. Fehlende DELETE/UPDATE Policies

Bekannte sensible Tabellen: profiles, companies, purchases, exam_answers, ai_tutor_logs
Generiere 3-5 realistische Findings.`
              }
            ],
            temperature: 0.3,
            max_tokens: 2000,
          });

          const findings = parseJsonArray(aiResult.content);
          let created = 0;
          for (const f of findings) {
            const { error } = await supabase.from("tech_council_findings").insert({
              scan_type: "rls_audit",
              severity: f.severity || "medium",
              title: f.title,
              description: f.description,
              affected_entity: f.affected_entity,
              evidence: f.evidence || {},
            });
            if (!error) created++;
          }

          await logRecommendation(supabase, `RLS Scan: ${created} Findings`, proposerModel, JSON.stringify({ findings_count: created }).slice(0, 500), "scan", "rls_audit");

          return new Response(JSON.stringify({ action: "scan_rls", findings_created: created }), { headers: jsonHeaders });
        } catch (e) {
          console.error("[TechCouncil] scan_rls LLM error:", e);
          return new Response(JSON.stringify({
            action: "scan_rls",
            findings_created: 0,
            warning: "LLM nicht verfügbar (fehlender API Key oder Gateway). Bitte OPENAI_API_KEY/ANTHROPIC_API_KEY prüfen.",
            error: String((e as Error)?.message ?? e),
          }), { headers: jsonHeaders });
        }
      }

      // ─── SCAN: QUEUE HEALTH ─────────────────────────────────────────────
      case "scan_queue": {
        const { data: queueStats } = await supabase
          .from("job_queue")
          .select("status, job_type, last_error, attempts, max_attempts")
          .in("status", ["failed", "processing"])
          .order("created_at", { ascending: false })
          .limit(100);

        const failedJobs = (queueStats || []).filter((j: { status: string }) => j.status === "failed");
        const stuckJobs = (queueStats || []).filter((j: { status: string }) => j.status === "processing");

        const errorPatterns: Record<string, number> = {};
        for (const j of failedJobs) {
          const err = ((j as Record<string, unknown>).last_error as string) || "unknown";
          const key = err.slice(0, 80);
          errorPatterns[key] = (errorPatterns[key] || 0) + 1;
        }

        const findings: Finding[] = [];
        if (stuckJobs.length > 5) {
          findings.push({
            title: `${stuckJobs.length} Jobs im Status 'processing' hängen`,
            severity: stuckJobs.length > 20 ? "critical" : "high",
            description: "Jobs im processing-Status können auf Lock-Timeouts oder Worker-Crashes hindeuten.",
            affected_entity: "job_queue",
            evidence: { stuck_count: stuckJobs.length, job_types: [...new Set(stuckJobs.map((j: { job_type: string }) => j.job_type))] },
          });
        }
        if (failedJobs.length > 10) {
          findings.push({
            title: `${failedJobs.length} fehlgeschlagene Jobs`,
            severity: failedJobs.length > 50 ? "critical" : "high",
            description: "Hohe Fehlerrate in der Job-Queue.",
            affected_entity: "job_queue",
            evidence: { failed_count: failedJobs.length, top_errors: errorPatterns },
          });
        }

        let created = 0;
        for (const f of findings) {
          const { error } = await supabase.from("tech_council_findings").insert({
            scan_type: "queue_health", severity: f.severity, title: f.title,
            description: f.description, affected_entity: f.affected_entity, evidence: f.evidence,
          });
          if (!error) created++;
        }

        await logRecommendation(supabase, `Queue Scan: ${failedJobs.length} failed, ${stuckJobs.length} stuck`, "system", JSON.stringify({ errorPatterns }).slice(0, 500), "scan", "queue_health");

        return new Response(JSON.stringify({ action: "scan_queue", findings_created: created, stats: { failed: failedJobs.length, stuck: stuckJobs.length } }), { headers: jsonHeaders });
      }

      // ─── SCAN: EDGE FUNCTIONS ───────────────────────────────────────────
      case "scan_edge": {
        try {
          const aiResult = await callAIJSON({
            provider: proposerProvider,
            model: proposerModel,
            messages: [
              {
                role: "system",
                content: `Du bist ein Edge-Function Security Auditor. Antworte als JSON-Array: [{"title":"...","severity":"...","description":"...","affected_entity":"function_name","evidence":{...}}]`
              },
              {
                role: "user",
                content: `Prüfe Edge Functions:
- verify_jwt=false für: bibb-seeding, generate-questions, create-checkout, oral-exam, etc.
- Fehlende Rate Limits auf öffentlichen Endpoints
- CORS: Wildcard Origins
Generiere 2-4 Findings.`
              }
            ],
            temperature: 0.3,
            max_tokens: 2000,
          });

          const findings = parseJsonArray(aiResult.content);
          let created = 0;
          for (const f of findings) {
            const { error } = await supabase.from("tech_council_findings").insert({
              scan_type: "edge_function_audit", severity: f.severity || "medium",
              title: f.title, description: f.description,
              affected_entity: f.affected_entity, evidence: f.evidence || {},
            });
            if (!error) created++;
          }

          await logRecommendation(supabase, `Edge Scan: ${created} Findings`, proposerModel, `${created} edge function issues found`, "scan", "edge_function_audit");

          return new Response(JSON.stringify({ action: "scan_edge", findings_created: created }), { headers: jsonHeaders });
        } catch (e) {
          console.error("[TechCouncil] scan_edge LLM error:", e);
          return new Response(JSON.stringify({
            action: "scan_edge",
            findings_created: 0,
            warning: "LLM nicht verfügbar (fehlender API Key oder Gateway). Bitte OPENAI_API_KEY/ANTHROPIC_API_KEY prüfen.",
            error: String((e as Error)?.message ?? e),
          }), { headers: jsonHeaders });
        }
      }

      // ─── PROPOSE PATCH ──────────────────────────────────────────────────
      case "propose_patch": {
        if (!findingId) return new Response(JSON.stringify({ error: "findingId required" }), { status: 400, headers: jsonHeaders });

        const { data: finding } = await supabase.from("tech_council_findings").select("*").eq("id", findingId).single();
        if (!finding) return new Response(JSON.stringify({ error: "Finding not found" }), { status: 404, headers: jsonHeaders });

        const proposal = await callAIJSON({
          provider: proposerProvider,
          model: proposerModel,
          messages: [
            {
              role: "system",
              content: `Du bist ein Supabase-Security-Engineer. Erstelle einen Patch-Plan.
Antworte als JSON: {"title":"Patch: ...","patches":[{"type":"sql|code","path":"optional","content":"...","description":"..."}],"reasoning":"..."}`
            },
            {
              role: "user",
              content: `Finding: ${finding.title}\nSeverity: ${finding.severity}\nDescription: ${finding.description}\nEvidence: ${JSON.stringify(finding.evidence)}\nAffected: ${finding.affected_entity}`
            }
          ],
          temperature: 0.3,
          max_tokens: 3000,
        });

        const plan = parseJsonObj(proposal.content) as { title?: string; patches?: unknown[]; reasoning?: string };

        const { data: saved } = await supabase.from("admin_patch_plans").insert({
          finding_id: findingId,
          title: (plan.title as string) || `Patch: ${finding.title}`,
          severity: finding.severity,
          affected_area: finding.scan_type === "rls_audit" ? "rls" : finding.scan_type === "edge_function_audit" ? "edge" : finding.scan_type === "queue_health" ? "queue" : "db",
          patches_json: plan.patches || [],
          proposer_model: proposerModel,
          proposer_reasoning: (plan.reasoning as string) || "",
          status: "proposed",
        }).select("id").single();

        await supabase.from("tech_council_findings").update({ status: "in_review" }).eq("id", findingId);
        await logRecommendation(supabase, `Patch proposed: ${plan.title || finding.title}`, proposerModel, (plan.reasoning as string) || "", "patch", saved?.id || "");

        return new Response(JSON.stringify({ action: "propose_patch", patch_plan_id: saved?.id, finding_id: findingId }), { headers: jsonHeaders });
      }

      // ─── VALIDATE PATCH (Claude Hard Veto) ──────────────────────────────
      case "validate_patch": {
        const targetId = patchPlanId || findingId;
        if (!targetId) return new Response(JSON.stringify({ error: "patchPlanId required" }), { status: 400, headers: jsonHeaders });

        const { data: plan } = await supabase.from("admin_patch_plans").select("*").eq("id", targetId).single();
        if (!plan) return new Response(JSON.stringify({ error: "Patch plan not found" }), { status: 404, headers: jsonHeaders });

        const validation = await callAIJSON({
          provider: validatorProvider,
          model: validatorModel,
          messages: [
            {
              role: "system",
              content: `Du bist ein Security-Validator. Prüfe den Patch-Plan kritisch.
Antworte als JSON: {"decision":"approved|rejected|revise","confidence":0.0-1.0,"issues":["..."],"reasoning":"..."}`
            },
            {
              role: "user",
              content: `Plan: ${plan.title}\nSeverity: ${plan.severity}\nArea: ${plan.affected_area}\nProposer: ${plan.proposer_reasoning}\nPatches: ${JSON.stringify(plan.patches_json)}`
            }
          ],
          temperature: 0.2,
          max_tokens: 2000,
        });

        const verdict = parseJsonObj(validation.content) as { decision?: string; confidence?: number; reasoning?: string };

        // HARD VETO
        const finalStatus = verdict.decision === "rejected" ? "rejected"
          : verdict.decision === "approved" ? "approved" : "proposed";

        await supabase.from("admin_patch_plans").update({
          validator_model: validatorModel,
          validator_reasoning: (verdict.reasoning as string) || "",
          status: finalStatus,
          ...(finalStatus === "approved" ? { approved_at: new Date().toISOString() } : {}),
        }).eq("id", targetId);

        if (finalStatus === "rejected" && plan.finding_id) {
          await supabase.from("tech_council_findings").update({ status: "dismissed" }).eq("id", plan.finding_id);
        }

        await logRecommendation(supabase, `Verdict: ${verdict.decision} for ${plan.title}`, validatorModel, (verdict.reasoning as string) || "", "verdict", targetId);

        return new Response(JSON.stringify({
          action: "validate_patch", patch_plan_id: targetId,
          decision: verdict.decision, final_status: finalStatus,
          confidence: verdict.confidence,
        }), { headers: jsonHeaders });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: jsonHeaders });
    }
  } catch (error) {
    console.error("[TechCouncil] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" } }
    );
  }
});
