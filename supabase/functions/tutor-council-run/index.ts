import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAI } from "../_shared/ai-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/* ── Model config (SSOT) ── */
// NOTE: Update to openai/gpt-5.2 + anthropic/opus-4.6 when available in router
const PROPOSER_MODEL = "openai/gpt-4.1";
const VALIDATOR_MODEL = "anthropic/claude-sonnet-4-20250514";
const PROPOSER_LABEL = "gpt-4.1"; // governance label: reflects actual model used
const VALIDATOR_LABEL = "claude-sonnet-4"; // governance label: reflects actual model used

/* ── Types ── */
type SB = ReturnType<typeof createClient>;

interface AssetPayload {
  assetId: string;
  round?: number;
  maxRounds?: number;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();

    const payload: AssetPayload = body.payload ?? body;
    if (!payload.assetId) {
      return new Response(JSON.stringify({ error: "Missing assetId" }), { status: 400, headers });
    }

    const result = await runTutorAssetCouncil(sb, payload);
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[TutorCouncil] Error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

/* ── Main Council Pipeline ── */

async function runTutorAssetCouncil(sb: SB, p: AssetPayload) {
  const round = p.round ?? 1;
  const maxRounds = p.maxRounds ?? 3;

  // Load asset
  const { data: asset, error: aErr } = await sb
    .from("tutor_assets")
    .select("id, asset_type, scope_type, scope_id, title, locale, is_published")
    .eq("id", p.assetId)
    .single();
  if (aErr) throw aErr;

  // Load SSOT context based on scope
  const ssot = await loadTutorSSOT(sb, asset);

  // 1) PROPOSE
  const proposal = await callLLM(sb, {
    model: PROPOSER_MODEL,
    system: buildProposerSystem(asset),
    user: buildProposerPrompt(asset, ssot, round, maxRounds),
  });

  const versionId = await insertVersion(sb, {
    entity_type: "tutor_asset",
    entity_id: asset.id,
    content_json: proposal,
    created_by_agent: PROPOSER_LABEL,
    status: "under_review",
    council_round: round,
  });

  await logMessage(sb, versionId, PROPOSER_LABEL, "proposal", proposal);

  // 2) CRITIQUE
  const critique = await callLLM(sb, {
    model: VALIDATOR_MODEL,
    system: buildValidatorSystem(asset),
    user: buildValidatorPrompt(asset, ssot, proposal),
  });

  await logMessage(sb, versionId, VALIDATOR_LABEL, "critique", critique);

  // 3) DECISION
  const decision = computeDecision(critique);
  await writeVerdict(sb, versionId, decision);

  if (decision.finalDecision === "approved") {
    await sb.from("content_versions").update({ status: "approved" }).eq("id", versionId);

    const { error: pubErr } = await sb.rpc("publish_tutor_asset", {
      p_asset_id: asset.id,
      p_version_id: versionId,
    });
    if (pubErr) throw pubErr;

    return { ok: true, versionId, decision, entity: "tutor_asset", assetType: asset.asset_type };
  }

  if (decision.finalDecision === "revise" && round < maxRounds) {
    return { ok: true, versionId, decision, entity: "tutor_asset", nextRound: round + 1 };
  }

  const finalStatus = decision.finalDecision === "rejected" ? "rejected" : "revise";
  await sb.from("content_versions").update({ status: finalStatus }).eq("id", versionId);
  return { ok: true, versionId, decision, entity: "tutor_asset" };
}

/* ── SSOT Context Loader ── */

async function loadTutorSSOT(sb: SB, asset: Record<string, unknown>) {
  const refs: Record<string, unknown>[] = [];
  const scopeType = asset.scope_type as string;
  const scopeId = asset.scope_id as string | null;

  if (!scopeId) return { scope: asset, refs };

  if (scopeType === "competency") {
    const { data } = await sb
      .from("competencies")
      .select("id, title, code, description, taxonomy_level")
      .eq("id", scopeId)
      .single();
    if (data) refs.push({ type: "competency", ...data });
  }

  if (scopeType === "lesson") {
    const { data } = await sb
      .from("lessons")
      .select("id, title, step, competency_id, course_id")
      .eq("id", scopeId)
      .single();
    if (data) {
      refs.push({ type: "lesson", ...data });
      // Also load linked competency
      if (data.competency_id) {
        const { data: comp } = await sb
          .from("competencies")
          .select("id, title, code, taxonomy_level")
          .eq("id", data.competency_id)
          .single();
        if (comp) refs.push({ type: "competency", ...comp });
      }
    }
  }

  if (scopeType === "course") {
    const { data } = await sb
      .from("courses")
      .select("id, title, certification_name, status")
      .eq("id", scopeId)
      .single();
    if (data) refs.push({ type: "course", ...data });
  }

  // Load approved blueprints for context (exam prompts need these)
  if (scopeType === "competency" || scopeType === "course") {
    const bpQuery = scopeType === "competency"
      ? sb.from("question_blueprints").select("id, name, question_template, canonical_statement").eq("competency_id", scopeId).eq("status", "approved").limit(5)
      : sb.from("question_blueprints").select("id, name, question_template, canonical_statement").eq("status", "approved").limit(10);
    const { data: bps } = await bpQuery;
    if (bps) refs.push(...bps.map((bp: Record<string, unknown>) => ({ type: "blueprint", ...bp })));
  }

  return { scope: asset, refs };
}

/* ── System Prompts ── */

function buildProposerSystem(asset: Record<string, unknown>) {
  const type = asset.asset_type as string;
  const base = `Du bist Tutor Council (Autor). Output STRICT JSON. Keine Erfindungen. Alle Inhalte müssen auf SSOT-Daten basieren und source_refs mit IDs enthalten.`;

  const typeInstructions: Record<string, string> = {
    tutor_template: `Erstelle ein didaktisches Tutor-Template für Erklärungen/Coaching.
Output: { "template_text": "...", "didactic_approach": "...", "source_refs": ["id1","id2"], "target_level": "...", "key_concepts": [...], "quality_score": 0-100 }`,
    oral_exam_prompt: `Erstelle eine mündliche Prüfungsfrage mit Erwartungshorizont.
Output: { "question": "...", "expected_structure": [...], "follow_up_questions": [...], "rubric_hooks": [...], "source_refs": ["id1","id2"], "difficulty": "...", "quality_score": 0-100 }`,
    oral_exam_rubric: `Erstelle ein Bewertungsraster für mündliche Prüfungen.
Output: { "criteria": [{"name":"...","weight":N,"levels":[{"score":N,"description":"..."}]}], "total_points": N, "pass_threshold": N, "source_refs": ["id1"], "quality_score": 0-100 }`,
    feedback_template: `Erstelle ein Feedback-Template für MiniCheck/Simulationsergebnisse.
Output: { "feedback_structure": [...], "encouragement_patterns": [...], "weakness_identification": "...", "next_steps_template": "...", "source_refs": ["id1"], "quality_score": 0-100 }`,
  };

  return `${base}\n${typeInstructions[type] ?? ""}`;
}

function buildProposerPrompt(asset: Record<string, unknown>, ssot: Record<string, unknown>, round: number, maxRounds: number) {
  return `Erstelle/Verbessere ${asset.asset_type} "${asset.title}" (Runde ${round}/${maxRounds}).
Scope: ${asset.scope_type}
Sprache: ${asset.locale}

SSOT-Kontext:
${JSON.stringify(ssot.refs).slice(0, 6000)}`;
}

function buildValidatorSystem(asset: Record<string, unknown>) {
  return `Du bist Tutor Council (Validator). Prüfe Tutor-Artefakte kritisch.
Output STRICT JSON: {
  "decision": "approved"|"revise"|"rejected",
  "issues": [{"severity":"high"|"medium"|"low","type":"...","text":"..."}],
  "required_fixes": [...],
  "ssot_citation_check": {"pass": boolean, "missing_refs": [...]},
  "hallucination_risk": "low"|"medium"|"high",
  "didactic_quality": 0-100,
  "rationale": "..."
}
Hard Veto bei: ssot_citation_check.pass=false, hallucination_risk=high, factual errors.
Asset-Typ: ${asset.asset_type}`;
}

function buildValidatorPrompt(asset: Record<string, unknown>, ssot: Record<string, unknown>, proposal: Record<string, unknown>) {
  return `Kritisiere diesen Tutor-Artefakt-Vorschlag:
Asset: ${JSON.stringify({ type: asset.asset_type, title: asset.title, scope: asset.scope_type }).slice(0, 500)}
SSOT-Kontext: ${JSON.stringify(ssot.refs).slice(0, 4000)}
Vorschlag: ${JSON.stringify(proposal).slice(0, 5000)}`;
}

/* ── Decision Logic ── */

function computeDecision(critique: Record<string, unknown>) {
  const vote = (critique?.decision as string) ?? "revise";
  const citationCheck = critique?.ssot_citation_check as Record<string, unknown> | undefined;
  const hallucinationRisk = critique?.hallucination_risk as string | undefined;

  // Hard veto: missing SSOT refs or high hallucination risk
  if (citationCheck?.pass === false || hallucinationRisk === "high" || vote === "rejected") {
    return {
      finalDecision: "rejected" as const,
      validatorVote: "rejected" as const,
      validatorConfidence: 0.95,
      consensusScore: 0.15,
      rationale: (critique?.rationale as string) ?? "Hard veto: SSOT citation failed or high hallucination risk",
      requiredFixes: critique?.required_fixes ?? null,
    };
  }

  if (vote === "approved") {
    return {
      finalDecision: "approved" as const,
      validatorVote: "approved" as const,
      validatorConfidence: 0.9,
      consensusScore: 0.9,
      rationale: (critique?.rationale as string) ?? "Approved",
      requiredFixes: null,
    };
  }

  return {
    finalDecision: "revise" as const,
    validatorVote: "revise" as const,
    validatorConfidence: 0.7,
    consensusScore: 0.55,
    rationale: (critique?.rationale as string) ?? "Needs revision",
    requiredFixes: critique?.required_fixes ?? null,
  };
}

/* ── Shared DB helpers ── */

async function callLLM(
  _sb: SB,
  opts: { model: string; system: string; user: string }
): Promise<Record<string, unknown>> {
  try {
    const result = await callAI({
      provider: opts.model.startsWith("anthropic") ? "anthropic" : "openai",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    if (result.content) {
      const clean = result.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(clean);
    }
    return { raw: "no content" };
  } catch (e) {
    console.error(`[TutorCouncil] LLM error (${opts.model}):`, e);
    return { decision: "revise", issues: [{ severity: "high", text: `LLM call failed: ${e}` }] };
  }
}

async function insertVersion(sb: SB, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await sb.from("content_versions").insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function logMessage(sb: SB, versionId: string, agent: string, type: string, content: Record<string, unknown>) {
  await sb.from("council_messages").insert({
    content_version_id: versionId, agent_name: agent,
    message_type: type, message_json: content,
  });
}

async function writeVerdict(sb: SB, versionId: string, decision: ReturnType<typeof computeDecision>) {
  await sb.from("council_votes").upsert({
    content_version_id: versionId, agent_name: VALIDATOR_LABEL,
    vote: decision.validatorVote, confidence: decision.validatorConfidence,
    rationale: decision.rationale,
  });
  await sb.from("council_votes").upsert({
    content_version_id: versionId, agent_name: PROPOSER_LABEL,
    vote: "revise", confidence: 0.7, rationale: "self-check",
  });
  await sb.from("council_verdicts").insert({
    content_version_id: versionId, final_decision: decision.finalDecision,
    consensus_score: decision.consensusScore, required_fixes: decision.requiredFixes,
    decided_by: "tutor-council",
  });
}
