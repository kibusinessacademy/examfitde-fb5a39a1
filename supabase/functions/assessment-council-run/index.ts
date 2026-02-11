import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAI } from "../_shared/ai-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/* ── Model config (SSOT) ── */
const PROPOSER_MODEL = "openai/gpt-4.1";
const VALIDATOR_MODEL = "anthropic/claude-sonnet-4-20250514";
const PROPOSER_LABEL = "gpt-4.1";
const VALIDATOR_LABEL = "claude-sonnet-4";

/* ── Types ── */
interface BlueprintPayload { entityType: "blueprint"; blueprintId: string; round?: number; maxRounds?: number }
interface QuestionsPayload { entityType: "questions"; blueprintId: string; round?: number; maxRounds?: number }
interface MinicheckPayload { entityType: "minicheck"; courseId: string; lessonId: string; round?: number; maxRounds?: number }
type Payload = BlueprintPayload | QuestionsPayload | MinicheckPayload;

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();

    // Support both direct payload and {action, payload} envelope
    const payload: Payload = body.payload ?? body;
    const jobType: string = body._job_type ?? body.action ?? "";

    // Route by entity type or job type
    const entityType = payload.entityType ?? deriveEntityType(jobType);
    if (!entityType) {
      return new Response(JSON.stringify({ error: "Missing entityType or valid _job_type" }), { status: 400, headers });
    }

    let result: Record<string, unknown>;
    switch (entityType) {
      case "blueprint":
        result = await runBlueprintCouncil(sb, payload as BlueprintPayload);
        break;
      case "questions":
        result = await runQuestionsCouncil(sb, payload as QuestionsPayload);
        break;
      case "minicheck":
        result = await runMinicheckCouncil(sb, payload as MinicheckPayload);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown entityType: ${entityType}` }), { status: 400, headers });
    }

    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[AssessmentCouncil] Error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

/* ── Helpers ── */

function deriveEntityType(jobType: string): string | null {
  if (jobType.includes("blueprint")) return "blueprint";
  if (jobType.includes("questions") || jobType.includes("question")) return "questions";
  if (jobType.includes("minicheck")) return "minicheck";
  return null;
}

// ─── BLUEPRINT COUNCIL ───────────────────────────────────────────
async function runBlueprintCouncil(sb: ReturnType<typeof createClient>, p: BlueprintPayload) {
  const round = p.round ?? 1;
  const maxRounds = p.maxRounds ?? 3;

  const { data: bp, error: bpErr } = await sb
    .from("question_blueprints")
    .select("*, competencies(title), learning_fields(title)")
    .eq("id", p.blueprintId)
    .single();
  if (bpErr) throw bpErr;

  // SSOT context
  const context = JSON.stringify({
    name: bp.name,
    template: bp.question_template,
    canonical: bp.canonical_statement,
    cognitive_level: bp.cognitive_level,
    knowledge_type: bp.knowledge_type,
    exam_relevance: bp.exam_relevance,
    competency: bp.competencies?.title,
    learning_field: bp.learning_fields?.title,
  }).slice(0, 6000);

  // 1) PROPOSE
  const proposal = await callLLM(sb, {
    model: PROPOSER_MODEL,
    system: `Du bist Assessment Council (Autor). Analysiere und verbessere Exam-Blueprints für IHK-Prüfungen.
Output STRICT JSON: { "improved_template": "...", "improved_canonical": "...", "distractor_strategy": "...", "exam_alignment_notes": "...", "quality_score": 0-100 }
Regeln: Nur SSOT-basiert. Keine Erfindungen. Prüfungsrelevanz und Distraktoren-Qualität maximieren.`,
    user: `Prüfe und verbessere diesen Blueprint (Runde ${round}/${maxRounds}):\n${context}`,
  });

  // Create content_version
  const versionId = await insertVersion(sb, {
    entity_type: "blueprint",
    entity_id: p.blueprintId,
    course_id: bp.curriculum_id,
    step_key: "assessment:blueprint",
    content_json: proposal,
    created_by_agent: PROPOSER_LABEL,
    status: "under_review",
    council_round: round,
  });

  await logMessage(sb, versionId, PROPOSER_LABEL, "proposal", proposal);

  // 2) CRITIQUE
  const critique = await callLLM(sb, {
    model: VALIDATOR_MODEL,
    system: `Du bist Assessment Council (Validator). Prüfe Blueprint-Vorschläge kritisch.
Output STRICT JSON: { "decision": "approved"|"revise"|"rejected", "issues": [{"severity":"high"|"medium"|"low","text":"..."}], "required_fixes": [...], "duplicate_risk": 0-100, "leakage_risk": 0-100, "distractor_quality": 0-100, "rationale": "..." }
Hard Veto bei: leakage_risk > 70, distractor_quality < 30, falsche Taxonomie-Stufe.`,
    user: `Kritisiere diesen Blueprint-Vorschlag:\nOriginal: ${context}\nVorschlag: ${JSON.stringify(proposal).slice(0, 5000)}`,
  });

  await logMessage(sb, versionId, VALIDATOR_LABEL, "critique", critique);

  // 3) DECISION
  const decision = computeDecision(critique);
  await writeVerdict(sb, versionId, decision);

  if (decision.finalDecision === "approved") {
    await sb.from("content_versions").update({ status: "approved" }).eq("id", versionId);
    await sb.rpc("approve_blueprint_version", { p_blueprint_id: p.blueprintId, p_version_id: versionId });
    return { ok: true, versionId, decision, entity: "blueprint" };
  }

  if (decision.finalDecision === "revise" && round < maxRounds) {
    return { ok: true, versionId, decision, entity: "blueprint", nextRound: round + 1 };
  }

  // Rejected or max rounds
  const finalStatus = decision.finalDecision === "rejected" ? "rejected" : "revise";
  await sb.from("content_versions").update({ status: finalStatus }).eq("id", versionId);
  return { ok: true, versionId, decision, entity: "blueprint" };
}

// ─── QUESTIONS COUNCIL ───────────────────────────────────────────
async function runQuestionsCouncil(sb: ReturnType<typeof createClient>, p: QuestionsPayload) {
  const round = p.round ?? 1;
  const maxRounds = p.maxRounds ?? 3;

  // Gate: blueprint must be approved
  const { data: bp, error: bpErr } = await sb
    .from("question_blueprints")
    .select("id, status, name, question_template, canonical_statement, curriculum_id")
    .eq("id", p.blueprintId)
    .single();
  if (bpErr) throw bpErr;
  if (bp.status !== "approved") {
    return { ok: false, error: `Blueprint not approved (status=${bp.status})`, entity: "questions" };
  }

  // Get existing draft questions for this blueprint
  const { data: questions } = await sb
    .from("exam_questions")
    .select("id, question_text, options, correct_answer, explanation, difficulty, status")
    .eq("blueprint_id", p.blueprintId)
    .in("status", ["draft", "review"])
    .limit(20);

  const questionsContext = JSON.stringify(questions ?? []).slice(0, 5000);

  // 1) PROPOSE improvements
  const proposal = await callLLM(sb, {
    model: PROPOSER_MODEL,
    system: `Du bist Assessment Council (Fragen-Autor). Prüfe Exam Questions auf IHK-Qualität.
Output STRICT JSON: { "reviewed_questions": [{ "id": "...", "quality_score": 0-100, "issues": [...], "improved_text": "...", "improved_options": [...], "improved_explanation": "..." }], "batch_quality": 0-100 }
Regeln: Distraktoren dürfen Antwort nicht verraten. Keine trivialen Optionen. Erklärung muss Lerneffekt haben.`,
    user: `Blueprint: ${bp.name}\nTemplate: ${bp.question_template}\nFragen zum Review:\n${questionsContext}`,
  });

  const versionId = await insertVersion(sb, {
    entity_type: "questions",
    entity_id: p.blueprintId,
    course_id: bp.curriculum_id,
    step_key: "assessment:questions",
    content_json: proposal,
    created_by_agent: PROPOSER_LABEL,
    status: "under_review",
    council_round: round,
  });

  await logMessage(sb, versionId, PROPOSER_LABEL, "proposal", proposal);

  // 2) CRITIQUE
  const critique = await callLLM(sb, {
    model: VALIDATOR_MODEL,
    system: `Du bist Assessment Council (Fragen-Validator). Prüfe Exam Questions kritisch.
Output STRICT JSON: { "decision": "approved"|"revise"|"rejected", "issues": [...], "required_fixes": [...], "leakage_detected": boolean, "duplicate_hashes": [...], "rationale": "..." }
Hard Veto bei: Leakage (Antwort in Frage verraten), triviale Distraktoren, faktisch falsche Erklärung.`,
    user: `Kritisiere diese Fragen-Review:\nBlueprint: ${bp.name}\nVorschlag: ${JSON.stringify(proposal).slice(0, 5000)}`,
  });

  await logMessage(sb, versionId, VALIDATOR_LABEL, "critique", critique);

  const decision = computeDecision(critique);
  await writeVerdict(sb, versionId, decision);

  if (decision.finalDecision === "approved") {
    await sb.from("content_versions").update({ status: "approved" }).eq("id", versionId);
    // Mark reviewed questions as approved
    const qIds = (questions ?? []).map((q: { id: string }) => q.id);
    if (qIds.length > 0) {
      await sb.from("exam_questions")
        .update({ status: "approved", approved_version_id: versionId, reviewed_at: new Date().toISOString() })
        .in("id", qIds);
    }
    return { ok: true, versionId, decision, entity: "questions", approvedCount: qIds.length };
  }

  if (decision.finalDecision === "revise" && round < maxRounds) {
    return { ok: true, versionId, decision, entity: "questions", nextRound: round + 1 };
  }

  await sb.from("content_versions").update({ status: decision.finalDecision === "rejected" ? "rejected" : "revise" }).eq("id", versionId);
  return { ok: true, versionId, decision, entity: "questions" };
}

// ─── MINICHECK COUNCIL ───────────────────────────────────────────
async function runMinicheckCouncil(sb: ReturnType<typeof createClient>, p: MinicheckPayload) {
  const round = p.round ?? 1;
  const maxRounds = p.maxRounds ?? 3;

  // Ensure minicheck_set exists
  let { data: mcSet } = await sb.from("minicheck_sets").select("id").eq("lesson_id", p.lessonId).maybeSingle();
  if (!mcSet) {
    const { data: ins, error: insErr } = await sb
      .from("minicheck_sets")
      .insert({ course_id: p.courseId, lesson_id: p.lessonId })
      .select("id")
      .single();
    if (insErr) throw insErr;
    mcSet = ins;
  }
  const setId = mcSet!.id as string;

  // Get approved exam questions for this course to sample from
  const { data: approvedQs } = await sb
    .from("exam_questions")
    .select("id, question_text, difficulty, competency_id")
    .eq("curriculum_id", p.courseId)
    .eq("status", "approved")
    .limit(50);

  if (!approvedQs || approvedQs.length < 5) {
    return { ok: false, error: `Not enough approved questions (${approvedQs?.length ?? 0}/5 minimum)`, entity: "minicheck" };
  }

  // 1) PROPOSE: AI selects 5 questions with balanced coverage
  const proposal = await callLLM(sb, {
    model: PROPOSER_MODEL,
    system: `Du bist Assessment Council (MiniCheck-Assembler). Wähle 5 Fragen für einen Lesson-MiniCheck.
Output STRICT JSON: { "selected_question_ids": ["..."], "selection_rationale": "...", "difficulty_balance": { "easy": N, "medium": N, "hard": N }, "competency_coverage": [...] }
Regeln: Ausgewogene Schwierigkeit. Keine Duplikate. Kompetenz-Abdeckung maximieren.`,
    user: `Wähle 5 Fragen aus ${approvedQs.length} verfügbaren:\n${JSON.stringify(approvedQs.map(q => ({ id: q.id, text: q.question_text?.slice(0, 100), difficulty: q.difficulty }))).slice(0, 5000)}`,
  });

  const versionId = await insertVersion(sb, {
    entity_type: "minicheck",
    entity_id: setId,
    course_id: p.courseId,
    step_key: "assessment:minicheck",
    content_json: proposal,
    created_by_agent: PROPOSER_LABEL,
    status: "under_review",
    council_round: round,
  });

  await logMessage(sb, versionId, PROPOSER_LABEL, "proposal", proposal);

  // 2) CRITIQUE
  const critique = await callLLM(sb, {
    model: VALIDATOR_MODEL,
    system: `Du bist Assessment Council (MiniCheck-Validator). Prüfe MiniCheck-Zusammenstellung.
Output STRICT JSON: { "decision": "approved"|"revise"|"rejected", "issues": [...], "required_fixes": [...], "coverage_adequate": boolean, "difficulty_balanced": boolean, "rationale": "..." }
Rejected wenn: weniger als 5 Fragen, keine Schwierigkeits-Balance, Kompetenz-Lücken.`,
    user: `Kritisiere MiniCheck-Vorschlag:\n${JSON.stringify(proposal).slice(0, 5000)}`,
  });

  await logMessage(sb, versionId, VALIDATOR_LABEL, "critique", critique);

  const decision = computeDecision(critique);
  await writeVerdict(sb, versionId, decision);

  if (decision.finalDecision === "approved") {
    await sb.from("content_versions").update({ status: "approved" }).eq("id", versionId);

    // Insert minicheck items (DB trigger guards non-approved questions)
    const selectedIds: string[] = proposal?.selected_question_ids ?? [];
    if (selectedIds.length >= 5) {
      // Clear old items
      await sb.from("minicheck_set_items").delete().eq("minicheck_set_id", setId);
      // Insert new
      const items = selectedIds.map((qId: string, idx: number) => ({
        minicheck_set_id: setId,
        exam_question_id: qId,
        position: idx + 1,
      }));
      const { error: itemErr } = await sb.from("minicheck_set_items").insert(items);
      if (itemErr) throw itemErr;

      await sb.rpc("approve_minicheck_set_version", {
        p_minicheck_set_id: setId,
        p_version_id: versionId,
        p_min_questions: 5,
      });
    }

    return { ok: true, versionId, decision, entity: "minicheck", setId };
  }

  if (decision.finalDecision === "revise" && round < maxRounds) {
    return { ok: true, versionId, decision, entity: "minicheck", nextRound: round + 1 };
  }

  await sb.from("content_versions").update({ status: decision.finalDecision === "rejected" ? "rejected" : "revise" }).eq("id", versionId);
  return { ok: true, versionId, decision, entity: "minicheck" };
}

// ─── Shared helpers ──────────────────────────────────────────────

async function callLLM(
  sb: ReturnType<typeof createClient>,
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
    console.error(`[AssessmentCouncil] LLM error (${opts.model}):`, e);
    return { decision: "revise", issues: [{ severity: "high", text: `LLM call failed: ${e}` }] };
  }
}

async function insertVersion(
  sb: ReturnType<typeof createClient>,
  row: Record<string, unknown>
): Promise<string> {
  const { data, error } = await sb
    .from("content_versions")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function logMessage(
  sb: ReturnType<typeof createClient>,
  versionId: string,
  agent: string,
  type: string,
  content: Record<string, unknown>
) {
  await sb.from("council_messages").insert({
    content_version_id: versionId,
    agent_name: agent,
    message_type: type,
    message_json: content,
  });
}

async function writeVerdict(
  sb: ReturnType<typeof createClient>,
  versionId: string,
  decision: ReturnType<typeof computeDecision>
) {
  await sb.from("council_votes").upsert({
    content_version_id: versionId,
    agent_name: VALIDATOR_LABEL,
    vote: decision.validatorVote,
    confidence: decision.validatorConfidence,
    rationale: decision.rationale,
  });
  await sb.from("council_votes").upsert({
    content_version_id: versionId,
    agent_name: PROPOSER_LABEL,
    vote: "revise",
    confidence: 0.7,
    rationale: "self-check",
  });
  await sb.from("council_verdicts").insert({
    content_version_id: versionId,
    final_decision: decision.finalDecision,
    consensus_score: decision.consensusScore,
    required_fixes: decision.requiredFixes,
    decided_by: "assessment-council",
  });
}

function computeDecision(critique: Record<string, unknown>) {
  const vote = (critique?.decision as string) ?? "revise";
  if (vote === "rejected" || critique?.leakage_detected === true) {
    return {
      finalDecision: "rejected" as const,
      validatorVote: "rejected" as const,
      validatorConfidence: 0.95,
      consensusScore: 0.15,
      rationale: (critique?.rationale as string) ?? "Hard veto by validator",
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
