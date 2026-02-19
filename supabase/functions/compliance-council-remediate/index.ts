import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModelAsync } from "../_shared/model-routing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Models resolved dynamically per-request
async function resolveModels() {
  const p = await getModelAsync("council_proposer");
  const v = await getModelAsync("council_validator");
  return { pp: p.provider as any, pm: p.model, vp: v.provider as any, vm: v.model };
}

type Decision = "approved" | "revise" | "rejected";

interface Finding {
  id: string;
  area: string;
  severity: string;
  title: string;
  description: string;
  evidence_json: Record<string, unknown>;
  remediation_json: Record<string, unknown> | null;
}

/**
 * Council 6 Phase 2: Deliberative Remediation
 *
 * For each open finding:
 * 1. Propose remediation (GPT)
 * 2. Validate / veto (Claude)
 * 3. Verdict → approved creates admin_patch_plans entry
 */
Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const payload = body.payload ?? body;
    const limit = Math.min(Number(payload.limit ?? 10), 25);
    const { pp: PROPOSER_PROVIDER, pm: PROPOSER_MODEL, vp: VALIDATOR_PROVIDER, vm: VALIDATOR_MODEL } = await resolveModels();
    const PROPOSER_LABEL = PROPOSER_MODEL;
    const VALIDATOR_LABEL = VALIDATOR_MODEL;

    // Load open findings without existing remediation
    const { data: findings, error: fErr } = await sb
      .from("compliance_findings")
      .select("id, area, severity, title, description, evidence_json, remediation_json")
      .eq("status", "open")
      .is("patch_plan_id", null)
      .order("severity", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (fErr) throw fErr;
    if (!findings?.length) {
      return new Response(JSON.stringify({ ok: true, message: "No open findings to remediate", processed: 0 }), { status: 200, headers });
    }

    console.log(`[ComplianceRemediate] Processing ${findings.length} findings`);
    const results: Array<{ findingId: string; decision: Decision; patchPlanId?: string; versionId?: string }> = [];

    for (const finding of findings as Finding[]) {
      try {
        // 1) PROPOSE remediation plan
        const proposalResult = await callAIJSON({
          provider: PROPOSER_PROVIDER,
          model: PROPOSER_MODEL,
          messages: [
            {
              role: "system",
              content: `Du bist Compliance Council Autor (${PROPOSER_LABEL}). Erstelle einen Remediation-Plan.
Output STRICT JSON:
{
  "summary": "...",
  "risk": "...",
  "steps": [{"type":"sql|code|config|process","title":"...","details":"..."}],
  "patches": [{"kind":"sql|file","target":"...","content":"..."}],
  "test_plan": ["..."],
  "rollback_plan": ["..."]
}
Beachte: DSGVO, EU AI Act Art. 12/14, AZAV § 178-180 SGB III, ISO 29993.`,
            },
            { role: "user", content: JSON.stringify(finding).slice(0, 10000) },
          ],
          temperature: 0.3,
        });

        const proposalRaw = proposalResult.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        let proposal: Record<string, unknown>;
        try { proposal = JSON.parse(proposalRaw); } catch { proposal = { summary: proposalRaw, steps: [], patches: [] }; }

        // 2) Create content_version for audit trail
        const { data: version, error: vErr } = await sb
          .from("content_versions")
          .insert({
            entity_type: "compliance_finding",
            entity_id: finding.id,
            created_by_agent: PROPOSER_LABEL,
            status: "under_review",
            content_json: proposal,
            council_round: 1,
          })
          .select("id")
          .single();

        if (vErr) throw vErr;
        const versionId = version.id;

        // Log proposal message
        await sb.from("council_messages").insert({
          content_version_id: versionId,
          agent_name: PROPOSER_LABEL,
          message_type: "proposal",
          message_json: proposal,
        });

        // 3) VALIDATE remediation (Claude)
        const critiqueResult = await callAIJSON({
          provider: VALIDATOR_PROVIDER,
          model: VALIDATOR_MODEL,
          messages: [
            {
              role: "system",
              content: `Du bist Compliance Council Validator (${VALIDATOR_LABEL}). Prüfe den Remediation-Plan.
Output STRICT JSON:
{
  "decision": "approved|revise|rejected",
  "issues": [{"severity":"low|medium|high|critical","text":"..."}],
  "required_fixes": [{"fix":"..."}],
  "side_effect_risks": ["..."],
  "evidence_alignment": "pass|fail"
}
Reject wenn: Evidence nicht passt, Patches riskant/unvollständig, oder DSGVO-Verstoß nicht adressiert.`,
            },
            { role: "user", content: JSON.stringify({ finding, proposal }).slice(0, 12000) },
          ],
          temperature: 0.2,
        });

        const critiqueRaw = critiqueResult.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        let critique: Record<string, unknown>;
        try { critique = JSON.parse(critiqueRaw); } catch { critique = { decision: "revise", issues: [{ text: "parse error" }] }; }

        // Log critique message
        await sb.from("council_messages").insert({
          content_version_id: versionId,
          agent_name: VALIDATOR_LABEL,
          message_type: "critique",
          message_json: critique,
        });

        // 4) Compute verdict
        const decision = computeDecision(critique);

        // Write votes + verdict
        await writeVerdict(sb, versionId, decision, critique);

        // 5) Handle outcome
        if (decision === "approved") {
          await sb.from("content_versions").update({ status: "approved" }).eq("id", versionId);

          // Attach remediation to finding
          await sb.rpc("attach_finding_remediation", {
            p_finding_id: finding.id,
            p_remediation: proposal,
            p_council_version_id: versionId,
          });

          // Create patch plan (Tech Council compatible)
          const patches = Array.isArray(proposal?.patches) ? proposal.patches : [];
          const { data: patchPlanId, error: ppErr } = await sb.rpc("create_patch_plan_from_finding", {
            p_finding_id: finding.id,
            p_title: `[Compliance] ${finding.title}`,
            p_severity: finding.severity,
            p_patches: patches,
            p_council_version_id: versionId,
          });
          if (ppErr) throw ppErr;

          results.push({ findingId: finding.id, decision, patchPlanId, versionId });
        } else {
          const newStatus = decision === "rejected" ? "rejected" : "revise";
          await sb.from("content_versions").update({ status: newStatus }).eq("id", versionId);
          results.push({ findingId: finding.id, decision, versionId });
        }

        console.log(`[ComplianceRemediate] Finding ${finding.id.slice(0, 8)} → ${decision}`);
      } catch (findingErr) {
        const msg = findingErr instanceof Error ? findingErr.message : String(findingErr);
        console.warn(`[ComplianceRemediate] Error on finding ${finding.id.slice(0, 8)}: ${msg}`);
        results.push({ findingId: finding.id, decision: "revise" });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ComplianceRemediate] Fatal:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

/* ── Helpers ── */

function computeDecision(critique: Record<string, unknown>): Decision {
  if (critique.evidence_alignment === "fail") return "rejected";
  const d = String(critique.decision ?? "revise");
  if (d === "rejected") return "rejected";
  if (d === "approved") return "approved";
  return "revise";
}

async function writeVerdict(
  sb: ReturnType<typeof createClient>,
  versionId: string,
  decision: Decision,
  critique: Record<string, unknown>
) {
  const issues = Array.isArray(critique.issues) ? critique.issues : [];
  const rationale = issues.map((i: Record<string, unknown>) => String(i.text ?? "")).slice(0, 5).join("; ");

  await sb.from("council_votes").insert([
    {
      content_version_id: versionId,
      agent_name: PROPOSER_LABEL,
      vote: "approved",
      confidence: 0.7,
      rationale: "self-check: proposal submitted",
    },
    {
      content_version_id: versionId,
      agent_name: VALIDATOR_LABEL,
      vote: decision,
      confidence: decision === "approved" ? 0.85 : 0.6,
      rationale: rationale || "no issues noted",
    },
  ]);

  await sb.from("council_verdicts").insert({
    content_version_id: versionId,
    final_decision: decision,
    consensus_score: decision === "approved" ? 0.9 : decision === "rejected" ? 0.2 : 0.5,
    required_fixes: critique.required_fixes ?? null,
    decided_by: "compliance_council",
  });
}
