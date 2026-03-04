import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAI } from "../_shared/ai-client.ts";
import { getModelAsync } from "../_shared/model-routing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Models resolved dynamically per-request
async function resolveModels() {
  const p = await getModelAsync("council_proposer");
  const v = await getModelAsync("council_validator");
  return { pm: p.model, vm: v.model, pl: p.model, vl: v.model };
}

/* ── Types ── */
interface BlueprintPayload { entityType: "blueprint"; blueprintId: string; round?: number; maxRounds?: number }
interface QuestionsPayload { entityType: "questions"; blueprintId: string; round?: number; maxRounds?: number }
interface MinicheckPayload { entityType: "minicheck"; courseId: string; lessonId: string; round?: number; maxRounds?: number }
type Payload = BlueprintPayload | QuestionsPayload | MinicheckPayload;

type SB = ReturnType<typeof createClient>;

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();
    const { pm: PROPOSER_MODEL, vm: VALIDATOR_MODEL, pl: PROPOSER_LABEL, vl: VALIDATOR_LABEL } = await resolveModels();

    const payload: Payload = body.payload ?? body;
    const jobType: string = body._job_type ?? body.action ?? "";

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
async function runBlueprintCouncil(sb: SB, p: BlueprintPayload) {
  const round = p.round ?? 1;
  const maxRounds = p.maxRounds ?? 3;

  const { data: bp, error: bpErr } = await sb
    .from("question_blueprints")
    .select("*, competencies(title), learning_fields(title)")
    .eq("id", p.blueprintId)
    .single();
  if (bpErr) throw bpErr;

  const context = JSON.stringify({
    name: bp.name, template: bp.question_template,
    canonical: bp.canonical_statement, cognitive_level: bp.cognitive_level,
    knowledge_type: bp.knowledge_type, exam_relevance: bp.exam_relevance,
    competency: bp.competencies?.title, learning_field: bp.learning_fields?.title,
  }).slice(0, 6000);

  // 1) PROPOSE
  const proposal = await callLLM(sb, {
    model: PROPOSER_MODEL,
    system: `Du bist Assessment Council (Autor). Analysiere und verbessere Exam-Blueprints für IHK-Prüfungen.
Output STRICT JSON: { "improved_template": "...", "improved_canonical": "...", "distractor_strategy": "...", "exam_alignment_notes": "...", "quality_score": 0-100 }
Regeln: Nur SSOT-basiert. Keine Erfindungen. Prüfungsrelevanz und Distraktoren-Qualität maximieren.`,
    user: `Prüfe und verbessere diesen Blueprint (Runde ${round}/${maxRounds}):\n${context}`,
  });

  const versionId = await insertVersion(sb, {
    entity_type: "blueprint", entity_id: p.blueprintId,
    course_id: bp.curriculum_id, step_key: "assessment:blueprint",
    content_json: proposal, created_by_agent: PROPOSER_LABEL,
    status: "under_review", council_round: round,
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

  const finalStatus = decision.finalDecision === "rejected" ? "rejected" : "revise";
  await sb.from("content_versions").update({ status: finalStatus }).eq("id", versionId);
  return { ok: true, versionId, decision, entity: "blueprint" };
}

// ─── QUESTIONS COUNCIL (Phase 2: Batch Critique + Duplicate/Leakage) ─────
async function runQuestionsCouncil(sb: SB, p: QuestionsPayload) {
  const round = p.round ?? 1;
  const maxRounds = p.maxRounds ?? 3;

  // Gate: blueprint must be approved
  const { data: bp, error: bpErr } = await sb
    .from("question_blueprints")
    .select("id, status, name, question_template, canonical_statement, curriculum_id, learning_field_id, competency_id")
    .eq("id", p.blueprintId)
    .single();
  if (bpErr) throw bpErr;
  if (bp.status !== "approved") {
    return { ok: false, error: `Blueprint not approved (status=${bp.status})`, entity: "questions" };
  }

  // Get questions for this blueprint that need review
  const { data: questions } = await sb
    .from("exam_questions")
    .select("id, question_text, options, correct_answer, explanation, difficulty, status, normalized_hash")
    .eq("blueprint_id", p.blueprintId)
    .in("status", ["draft", "review", "under_review", "proposed"])
    .limit(30);

  if (!questions || questions.length === 0) {
    return { ok: false, error: "No questions pending review for this blueprint", entity: "questions" };
  }

  // Check for internal duplicates (same normalized_hash within batch)
  const hashMap = new Map<string, string[]>();
  for (const q of questions) {
    if (q.normalized_hash) {
      const existing = hashMap.get(q.normalized_hash) || [];
      existing.push(q.id);
      hashMap.set(q.normalized_hash, existing);
    }
  }
  const internalDuplicates = Array.from(hashMap.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ hash, question_ids: ids }));

  const questionsContext = JSON.stringify(
    questions.map(q => ({
      id: q.id, text: q.question_text, options: q.options,
      correct: q.correct_answer, explanation: q.explanation,
      difficulty: q.difficulty,
    }))
  ).slice(0, 8000);

  // 1) PROPOSE review
  const proposal = await callLLM(sb, {
    model: PROPOSER_MODEL,
    system: `Du bist Assessment Council (Fragen-Autor). Prüfe Exam Questions auf IHK-Qualität.
Output STRICT JSON: { "reviewed_questions": [{ "id": "...", "quality_score": 0-100, "issues": [...], "improved_text": "...", "improved_options": [...], "improved_explanation": "..." }], "batch_quality": 0-100, "duplicate_flags": [{"id":"...","reason":"..."}], "leakage_flags": [{"id":"...","reason":"..."}] }
Regeln: Distraktoren dürfen Antwort nicht verraten. Keine trivialen Optionen. Erklärung muss Lerneffekt haben. Duplizierte Fragen markieren.`,
    user: `Blueprint: ${bp.name}\nTemplate: ${bp.question_template}\nBekannte interne Duplikate: ${JSON.stringify(internalDuplicates)}\nFragen zum Review:\n${questionsContext}`,
  });

  const versionId = await insertVersion(sb, {
    entity_type: "questions_batch", entity_id: p.blueprintId,
    course_id: bp.curriculum_id, step_key: "assessment:questions",
    content_json: { proposal, internal_duplicates: internalDuplicates, question_ids: questions.map(q => q.id) },
    created_by_agent: PROPOSER_LABEL,
    status: "under_review", council_round: round,
  });

  await logMessage(sb, versionId, PROPOSER_LABEL, "proposal", proposal);

  // 2) CRITIQUE with duplicate + leakage detection
  const critique = await callLLM(sb, {
    model: VALIDATOR_MODEL,
    system: `Du bist Assessment Council (Fragen-Validator). Prüfe Exam Questions kritisch.
Output STRICT JSON: {
  "decision": "approved"|"revise"|"rejected",
  "issues": [{"question_id":"...","severity":"high"|"medium"|"low","type":"leakage"|"trivial_distractor"|"duplicate"|"factual_error"|"ambiguous","text":"..."}],
  "approved_ids": ["..."],
  "rejected_ids": ["..."],
  "required_fixes": [...],
  "leakage_detected": boolean,
  "duplicate_detected": boolean,
  "rationale": "..."
}
Hard Veto bei: Leakage (Antwort in Frage/Optionen verraten), triviale Distraktoren, faktisch falsche Erklärung. Einzelne schlechte Fragen ablehnen, aber Batch kann trotzdem approved werden wenn Mehrheit gut ist.`,
    user: `Kritisiere diese Fragen:\nBlueprint: ${bp.name}\nVorschlag: ${JSON.stringify(proposal).slice(0, 6000)}\nInterne Duplikate (Hash): ${JSON.stringify(internalDuplicates)}`,
  });

  await logMessage(sb, versionId, VALIDATOR_LABEL, "critique", critique);

  const decision = computeDecision(critique);
  await writeVerdict(sb, versionId, decision);

  // Collect bad IDs from critique
  const rejectedIds = new Set<string>([
    ...((critique?.rejected_ids as string[]) ?? []),
    ...((critique?.issues as Array<{question_id: string; severity: string; type: string}>) ?? [])
      .filter(i => i.severity === "high" || i.type === "leakage" || i.type === "duplicate")
      .map(i => i.question_id)
      .filter(Boolean),
    // Also reject hash-duplicate extras (keep first, reject rest)
    ...internalDuplicates.flatMap(d => d.question_ids.slice(1)),
  ]);

  const approvedIds = questions.map(q => q.id).filter(id => !rejectedIds.has(id));

  if (decision.finalDecision === "approved" || (approvedIds.length > 0 && decision.finalDecision !== "rejected")) {
    // Approve good questions
    if (approvedIds.length > 0) {
      await sb.from("exam_questions")
        .update({ status: "approved", approved_version_id: versionId, reviewed_at: new Date().toISOString() })
        .in("id", approvedIds);
    }
    // Reject bad questions
    const badList = Array.from(rejectedIds).filter(Boolean);
    if (badList.length > 0) {
      await sb.from("exam_questions")
        .update({ status: "rejected", reviewed_at: new Date().toISOString() })
        .in("id", badList);
    }

    await sb.from("content_versions").update({ status: "approved" }).eq("id", versionId);
    return {
      ok: true, versionId, decision, entity: "questions",
      approved_count: approvedIds.length, rejected_count: badList.length,
      internal_duplicates_found: internalDuplicates.length,
    };
  }

  if (decision.finalDecision === "revise" && round < maxRounds) {
    return { ok: true, versionId, decision, entity: "questions", nextRound: round + 1 };
  }

  // Full reject
  await sb.from("exam_questions")
    .update({ status: decision.finalDecision === "rejected" ? "rejected" : "revise" })
    .in("id", questions.map(q => q.id));
  await sb.from("content_versions").update({ status: decision.finalDecision === "rejected" ? "rejected" : "revise" }).eq("id", versionId);
  return { ok: true, versionId, decision, entity: "questions" };
}

// ─── MINICHECK COUNCIL (Phase 2: Weighted Assemble → Critique → Approve) ──
async function runMinicheckCouncil(sb: SB, p: MinicheckPayload) {
  const round = p.round ?? 1;
  const maxRounds = p.maxRounds ?? 3;

  // 1) Assemble weighted using RPC (pulls only approved questions via view)
  const { data: setId, error: asmErr } = await sb.rpc("assemble_minicheck_weighted", {
    p_lesson_id: p.lessonId,
    p_course_id: p.courseId,
    p_questions: 5,
  });
  if (asmErr) throw asmErr;

  if (!setId) {
    return { ok: false, error: "Assemble returned no set (possibly no approved questions)", entity: "minicheck" };
  }

  // Load assembled items
  const { data: items, error: itemsErr } = await sb
    .from("minicheck_set_items")
    .select("position, exam_question_id, exam_questions(question_text, options, correct_answer, difficulty, competency_id)")
    .eq("minicheck_set_id", setId)
    .order("position", { ascending: true });
  if (itemsErr) throw itemsErr;

  if (!items || items.length < 5) {
    return {
      ok: false, entity: "minicheck", setId,
      error: `Not enough approved questions assembled (${items?.length ?? 0}/5 minimum). Need more approved questions first.`,
    };
  }

  // 2) PROPOSE: validate selection coherence
  const proposal = await callLLM(sb, {
    model: PROPOSER_MODEL,
    system: `Du bist Assessment Council (MiniCheck-Assembler). Prüfe ob 5 gewählte Fragen einen guten MiniCheck ergeben.
Output STRICT JSON: { "selection_quality": 0-100, "difficulty_balance": {"easy":N,"medium":N,"hard":N}, "competency_coverage": [...], "improvement_notes": "..." }
Regeln: Ausgewogene Schwierigkeit. Kompetenz-Abdeckung maximieren. Keine zwei fast identische Fragen.`,
    user: `MiniCheck-Fragen:\n${JSON.stringify(items.map(i => ({
      pos: i.position,
      text: (i.exam_questions as Record<string, unknown>)?.question_text,
      difficulty: (i.exam_questions as Record<string, unknown>)?.difficulty,
      competency: (i.exam_questions as Record<string, unknown>)?.competency_id,
    }))).slice(0, 5000)}`,
  });

  const versionId = await insertVersion(sb, {
    entity_type: "minicheck_set", entity_id: setId,
    course_id: p.courseId, step_key: "assessment:minicheck",
    content_json: { minicheck_set_id: setId, item_count: items.length, proposal },
    created_by_agent: PROPOSER_LABEL,
    status: "under_review", council_round: round,
  });

  await logMessage(sb, versionId, PROPOSER_LABEL, "proposal", proposal);

  // 3) CRITIQUE
  const critique = await callLLM(sb, {
    model: VALIDATOR_MODEL,
    system: `Du bist Assessment Council (MiniCheck-Validator). Prüfe MiniCheck-Zusammenstellung.
Output STRICT JSON: { "decision": "approved"|"revise"|"rejected", "issues": [...], "required_fixes": [...], "coverage_adequate": boolean, "difficulty_balanced": boolean, "rationale": "..." }
Rejected wenn: weniger als 5 Fragen, keine Schwierigkeits-Balance, Kompetenz-Lücken, identische Fragen.`,
    user: `Kritisiere MiniCheck-Vorschlag:\n${JSON.stringify(proposal).slice(0, 5000)}\nFragen: ${JSON.stringify(items.map(i => ({
      text: (i.exam_questions as Record<string, unknown>)?.question_text,
      difficulty: (i.exam_questions as Record<string, unknown>)?.difficulty,
    }))).slice(0, 3000)}`,
  });

  await logMessage(sb, versionId, VALIDATOR_LABEL, "critique", critique);

  const decision = computeDecision(critique);
  await writeVerdict(sb, versionId, decision);

  if (decision.finalDecision === "approved") {
    await sb.from("content_versions").update({ status: "approved" }).eq("id", versionId);

    const { error: approveErr } = await sb.rpc("approve_minicheck_set_version", {
      p_minicheck_set_id: setId,
      p_version_id: versionId,
      p_min_questions: 5,
    });
    if (approveErr) throw approveErr;

    return { ok: true, versionId, decision, entity: "minicheck", setId };
  }

  if (decision.finalDecision === "revise" && round < maxRounds) {
    return { ok: true, versionId, decision, entity: "minicheck", nextRound: round + 1, setId };
  }

  await sb.from("content_versions").update({ status: decision.finalDecision === "rejected" ? "rejected" : "revise" }).eq("id", versionId);
  return { ok: true, versionId, decision, entity: "minicheck", setId };
}

// ─── Shared helpers ──────────────────────────────────────────────

async function callLLM(
  _sb: SB,
  opts: { model: string; system: string; user: string }
): Promise<Record<string, unknown>> {
  try {
    const provider = opts.model.includes("/") ? "lovable" : opts.model.startsWith("google") ? "google" : "openai";
    const result = await callAI({
      provider,
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
    decided_by: "assessment-council",
  });
}

function computeDecision(critique: Record<string, unknown>) {
  const vote = (critique?.decision as string) ?? "revise";
  const hasLeakage = critique?.leakage_detected === true;
  const leakageRisk = typeof critique?.leakage_risk === "number" ? critique.leakage_risk as number : 0;

  if (vote === "rejected" || hasLeakage || leakageRisk > 70) {
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
