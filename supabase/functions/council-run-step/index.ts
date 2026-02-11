import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * council-run-step – Full Deliberative Loop (single invocation)
 *
 * Runs propose → critique → (revise → critique)* → vote → verdict → publish
 * for ONE lesson-step. Called by job-runner with job_type = "council_run_step".
 *
 * Payload: { course_id, lesson_id, step_key, curriculum_id, max_rounds? }
 */

const MAX_ROUNDS_DEFAULT = 3;

interface StepPayload {
  course_id: string;
  lesson_id: string;
  step_key: string;
  curriculum_id: string;
  max_rounds?: number;
  _job_id?: string;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const body = await req.json();
    const p: StepPayload = {
      course_id: body.course_id || body.courseId,
      lesson_id: body.lesson_id || body.lessonId,
      step_key: body.step_key || body.stepKey,
      curriculum_id: body.curriculum_id || body.curriculumId,
      max_rounds: body.max_rounds ?? body.maxRounds ?? MAX_ROUNDS_DEFAULT,
      _job_id: body._job_id,
    };

    if (!p.curriculum_id) {
      return new Response(JSON.stringify({ error: "SSOT_VIOLATION: Missing curriculum_id" }), { status: 400, headers });
    }
    if (!p.course_id || !p.lesson_id || !p.step_key) {
      return new Response(JSON.stringify({ error: "INVALID_PAYLOAD: Missing course_id, lesson_id, or step_key" }), { status: 400, headers });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, key);

    const result = await runCouncilLoop(db, p);

    return new Response(JSON.stringify({ success: true, ...result }), { headers });
  } catch (e) {
    console.error("[council-run-step] Fatal:", e);
    return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 500, headers });
  }
});

// ─── Main Deliberative Loop ────────────────────────────────────────────────

async function runCouncilLoop(db: ReturnType<typeof createClient>, p: StepPayload) {
  const maxRounds = p.max_rounds ?? MAX_ROUNDS_DEFAULT;
  const lessonCtx = await fetchLessonContext(db, p.lesson_id);

  // Phase 1: PROPOSE (GPT-4.1)
  let versionId = await propose(db, p, lessonCtx);
  let round = 1;
  let finalDecision: "approved" | "revise" | "rejected" = "revise";

  while (round <= maxRounds) {
    console.log(`[council] Round ${round}/${maxRounds} for ${p.step_key} lesson=${p.lesson_id.slice(0, 8)}`);

    // Phase 2: CRITIQUE (Claude Sonnet 4)
    const critique = await critique_step(db, versionId, lessonCtx, p.step_key);

    // Phase 3: VOTE & VERDICT
    const verdict = await voteAndVerdict(db, versionId, critique);
    finalDecision = verdict.finalDecision;

    if (finalDecision === "approved") {
      // Phase 4: PUBLISH
      await publishVersion(db, versionId, p);
      return { version_id: versionId, decision: "approved", rounds: round, score: critique.overall_score };
    }

    if (finalDecision === "rejected" || round >= maxRounds) {
      await db.from("content_versions").update({ status: finalDecision }).eq("id", versionId);
      return { version_id: versionId, decision: finalDecision, rounds: round, score: critique.overall_score };
    }

    // Phase 5: REVISE (GPT-4.1 incorporates critique)
    versionId = await revise(db, p, versionId, critique, lessonCtx, round + 1);
    round++;
  }

  return { version_id: versionId, decision: finalDecision, rounds: round };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

interface LessonContext {
  title: string;
  content: string;
  learning_objectives: string;
}

async function fetchLessonContext(db: ReturnType<typeof createClient>, lessonId: string): Promise<LessonContext> {
  const { data, error } = await db
    .from("lessons")
    .select("title, content, learning_objectives")
    .eq("id", lessonId)
    .single();
  if (error || !data) throw new Error(`Lesson ${lessonId} not found`);
  return {
    title: data.title || "",
    content: (data.content || "").substring(0, 3000),
    learning_objectives: data.learning_objectives || "",
  };
}

// ─── PROPOSE ───────────────────────────────────────────────────────────────

async function propose(
  db: ReturnType<typeof createClient>,
  p: StepPayload,
  ctx: LessonContext,
): Promise<string> {
  const { content } = await callAIJSON({
    provider: "openai",
    model: "gpt-4.1",
    temperature: 0.7,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content: `Du bist ein didaktischer IHK-Prüfungsexperte. Erstelle strukturierten Lerninhalt.
Antworte NUR als valides JSON:
{
  "html": "<p>...</p>",
  "objectives": ["..."],
  "exam_relevance": [{"topic":"...", "why":"..."}],
  "examples": [{"case":"...", "solution":"..."}],
  "common_mistakes": ["..."],
  "minicheck_blueprint": [{"type":"mcq","question":"...","choices":["..."],"answer":["..."],"rationale":"..."}]
}`,
      },
      {
        role: "user",
        content: `Lesson: ${ctx.title}
Step: ${p.step_key}
Lernziele: ${ctx.learning_objectives}
Bisheriger Inhalt (Kontext): ${ctx.content}

Erstelle hochwertigen, IHK-prüfungsrelevanten Content für diesen Step.`,
      },
    ],
  });

  const contentJson = safeParse(content, { html: content, objectives: [] });

  const { data: ver, error } = await db
    .from("content_versions")
    .insert({
      course_id: p.course_id,
      lesson_id: p.lesson_id,
      step_key: p.step_key,
      content_json: contentJson,
      created_by_agent: "gpt-4.1",
      created_by_job_id: p._job_id || null,
      status: "under_review",
      council_round: 1,
    })
    .select("id")
    .single();

  if (error) throw error;

  await db.from("council_messages").insert({
    content_version_id: ver!.id,
    agent_name: "gpt-4.1",
    message_type: "proposal",
    message_json: contentJson,
  });

  return ver!.id;
}

// ─── CRITIQUE ──────────────────────────────────────────────────────────────

interface CritiqueResult {
  overall_score: number;
  scores: Record<string, number>;
  issues: Array<{ severity: string; type: string; text: string }>;
  required_fixes: Array<{ fix: string; acceptance_criteria: string }>;
  verdict_recommendation: string;
  summary: string;
}

async function critique_step(
  db: ReturnType<typeof createClient>,
  versionId: string,
  ctx: LessonContext,
  stepKey: string,
): Promise<CritiqueResult> {
  const { data: ver } = await db
    .from("content_versions")
    .select("content_json")
    .eq("id", versionId)
    .single();

  const contentStr = JSON.stringify(ver?.content_json || {}).substring(0, 6000);

  const { content } = await callAIJSON({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    temperature: 0.3,
    max_tokens: 2048,
    messages: [
      {
        role: "system",
        content: `Du bist ein strenger IHK-Prüfer und didaktischer QA-Kritiker.
Bewerte den Content und antworte NUR als valides JSON:
{
  "decision": "approved|revise|rejected",
  "confidence": 0.82,
  "scores": { "accuracy": 0-100, "didactics": 0-100, "exam_relevance": 0-100, "completeness": 0-100 },
  "overall_score": 0-100,
  "issues": [{"severity":"critical|major|minor","type":"factual_risk|didactic_gap|missing_exam_ref|hallucination","text":"..."}],
  "required_fixes": [{"fix":"...","acceptance_criteria":"..."}],
  "summary": "..."
}`,
      },
      {
        role: "user",
        content: `Lesson: ${ctx.title}\nStep: ${stepKey}\n\nContent zur Bewertung:\n${contentStr}`,
      },
    ],
  });

  const critique = safeParse(content, {
    overall_score: 0,
    scores: {},
    issues: [],
    required_fixes: [],
    verdict_recommendation: "revise",
    summary: "Parse error",
  }) as CritiqueResult;

  critique.verdict_recommendation = critique.verdict_recommendation || (critique as Record<string, unknown>).decision as string || "revise";

  await db.from("council_messages").insert({
    content_version_id: versionId,
    agent_name: "claude-sonnet-4",
    message_type: "critique",
    message_json: critique,
  });

  await db.from("content_versions").update({ quality_score: critique.overall_score }).eq("id", versionId);

  return critique;
}

// ─── VOTE & VERDICT ────────────────────────────────────────────────────────

interface VerdictResult {
  finalDecision: "approved" | "revise" | "rejected";
  consensusScore: number;
}

async function voteAndVerdict(
  db: ReturnType<typeof createClient>,
  versionId: string,
  critique: CritiqueResult,
): Promise<VerdictResult> {
  const score = critique.overall_score || 0;
  const validatorVote = normalizeDecision(critique.verdict_recommendation);
  const generatorVote: "approved" | "revise" | "rejected" =
    score >= 80 ? "approved" : score >= 50 ? "revise" : "rejected";

  // Insert votes
  await db.from("council_votes").upsert(
    [
      { content_version_id: versionId, agent_name: "gpt-4.1", vote: generatorVote, confidence: score / 100, rationale: `Score ${score}` },
      { content_version_id: versionId, agent_name: "claude-sonnet-4", vote: validatorVote, confidence: critique.confidence || score / 100, rationale: critique.summary },
    ],
    { onConflict: "content_version_id,agent_name" },
  );

  // Claude has veto power
  let finalDecision: "approved" | "revise" | "rejected";
  if (validatorVote === "rejected") finalDecision = "rejected";
  else if (validatorVote === "approved" && generatorVote === "approved") finalDecision = "approved";
  else finalDecision = "revise";

  const consensusScore = generatorVote === validatorVote ? 1.0 : 0.5;

  await db.from("council_verdicts").upsert(
    {
      content_version_id: versionId,
      final_decision: finalDecision,
      consensus_score: consensusScore,
      required_fixes: finalDecision !== "approved" ? critique.required_fixes : null,
      decided_by: "council",
    },
    { onConflict: "content_version_id" },
  );

  // Log verdict message
  await db.from("council_messages").insert({
    content_version_id: versionId,
    agent_name: "council",
    message_type: "verdict",
    message_json: {
      decision: finalDecision,
      generator_vote: generatorVote,
      validator_vote: validatorVote,
      consensus_score: consensusScore,
      quality_score: score,
    },
  });

  return { finalDecision, consensusScore };
}

// ─── REVISE ────────────────────────────────────────────────────────────────

async function revise(
  db: ReturnType<typeof createClient>,
  p: StepPayload,
  parentVersionId: string,
  critique: CritiqueResult,
  ctx: LessonContext,
  round: number,
): Promise<string> {
  const { data: parent } = await db
    .from("content_versions")
    .select("content_json")
    .eq("id", parentVersionId)
    .single();

  const { content } = await callAIJSON({
    provider: "openai",
    model: "gpt-4.1",
    temperature: 0.5,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content: `Du bist ein didaktischer IHK-Experte. Überarbeite den Content basierend auf dem Validator-Feedback.
Behalte Stärken bei, behebe ALLE Issues. Antworte als JSON (gleiches Schema wie zuvor).`,
      },
      {
        role: "user",
        content: `Lesson: ${ctx.title}
Step: ${p.step_key}

Original Content:
${JSON.stringify(parent?.content_json || {}).substring(0, 3000)}

Kritik des Validators:
Issues: ${JSON.stringify(critique.issues)}
Required Fixes: ${JSON.stringify(critique.required_fixes)}
Summary: ${critique.summary}

Überarbeite den Content und behebe alle genannten Probleme.`,
      },
    ],
  });

  const revisedJson = safeParse(content, { html: content });

  // Mark parent as "revise"
  await db.from("content_versions").update({ status: "revise" }).eq("id", parentVersionId);

  const { data: newVer, error } = await db
    .from("content_versions")
    .insert({
      course_id: p.course_id,
      lesson_id: p.lesson_id,
      step_key: p.step_key,
      content_json: revisedJson,
      created_by_agent: "gpt-4.1",
      created_by_job_id: p._job_id || null,
      status: "under_review",
      council_round: round,
      parent_version_id: parentVersionId,
    })
    .select("id")
    .single();

  if (error) throw error;

  await db.from("council_messages").insert({
    content_version_id: newVer!.id,
    agent_name: "gpt-4.1",
    message_type: "revision",
    message_json: {
      parent_version: parentVersionId,
      round,
      addressed_issues: critique.issues.map((i) => i.text),
    },
  });

  return newVer!.id;
}

// ─── PUBLISH ───────────────────────────────────────────────────────────────

async function publishVersion(db: ReturnType<typeof createClient>, versionId: string, p: StepPayload) {
  await db.from("content_versions").update({ status: "approved" }).eq("id", versionId);

  const { error } = await db.rpc("publish_approved_version", {
    p_lesson_id: p.lesson_id,
    p_step_key: p.step_key,
    p_version_id: versionId,
  });
  if (error) {
    console.error("[council-run-step] publish_approved_version failed:", error.message);
    // Non-fatal: version is approved but publish pointer failed
  }

  // Recompute course readiness
  const { error: readyErr } = await db.rpc("recompute_course_publish_readiness", {
    p_course_id: p.course_id,
  });
  if (readyErr) console.error("[council-run-step] recompute readiness failed:", readyErr.message);
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function safeParse(text: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = jsonMatch ? jsonMatch[1].trim() : text.trim();
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeDecision(d: unknown): "approved" | "revise" | "rejected" {
  const s = String(d).toLowerCase();
  if (s === "approved" || s === "approve") return "approved";
  if (s === "rejected" || s === "reject") return "rejected";
  return "revise";
}
