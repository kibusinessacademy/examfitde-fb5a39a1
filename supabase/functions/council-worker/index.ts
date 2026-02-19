import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModelAsync } from "../_shared/model-routing.ts";

/**
 * Council Worker v2 – Deliberative Architecture
 *
 * Handles job_types:
 *   council_propose_step   → GPT-5.2 generates content proposal
 *   council_critique_step  → Claude critiques/validates
 *   council_revise_step    → GPT-5.2 revises based on critique
 *   council_vote_and_verdict → Both agents vote, verdict is written
 *   council_publish_step   → Publishes approved version to lesson
 *   council_recompute_course_ready → Recomputes publish gate
 */

const STEP_KEYS = [
  "step_1_introduction",
  "step_2_understanding",
  "step_3_application",
  "step_4_repetition",
  "step_5_minicheck",
] as const;

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const body = await req.json();
    const { action, job_id, payload } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Validate SSOT
    if (!payload?.curriculum_id) {
      return new Response(
        JSON.stringify({ error: "SSOT_VIOLATION: Missing curriculum_id" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const result = await dispatch(db, action, payload, job_id);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: jsonHeaders,
    });
  } catch (e) {
    console.error("[council-worker] error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: jsonHeaders }
    );
  }
});

async function dispatch(
  db: ReturnType<typeof createClient>,
  action: string,
  payload: Record<string, unknown>,
  jobId?: string
) {
  switch (action) {
    case "council_propose_step":
      return proposeStep(db, payload, jobId);
    case "council_critique_step":
      return critiqueStep(db, payload);
    case "council_revise_step":
      return reviseStep(db, payload, jobId);
    case "council_vote_and_verdict":
      return voteAndVerdict(db, payload);
    case "council_publish_step":
      return publishStep(db, payload);
    case "council_recompute_course_ready":
      return recomputeReady(db, payload);
    default:
      throw new Error(`Unknown council action: ${action}`);
  }
}

// ─── 1. Propose Step (GPT-5.2) ──────────────────────────────────────────────

async function proposeStep(
  db: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  jobId?: string
) {
  const { lesson_id, step_key, course_id } = payload as {
    lesson_id: string;
    step_key: string;
    course_id: string;
  };

  if (!lesson_id || !step_key || !course_id) {
    throw new Error("Missing lesson_id, step_key, or course_id");
  }

  // Fetch lesson context
  const { data: lesson } = await db
    .from("lessons")
    .select("title, content, step")
    .eq("id", lesson_id)
    .single();

  if (!lesson) throw new Error(`Lesson ${lesson_id} not found`);

  const proposerModel = await getModelAsync("council_proposer");
  const { content: aiContent } = await callAIJSON({
    provider: proposerModel.provider,
    model: proposerModel.model,
    messages: [
      {
        role: "system",
        content: `Du bist ein didaktischer Experte für IHK-Prüfungsvorbereitung.
Erstelle hochwertigen Lerninhalt für den Step "${step_key}" der Lesson "${lesson.title}".
Antworte als JSON mit: { "html": "...", "objectives": [...], "key_concepts": [...], "examples": [...] }`,
      },
      {
        role: "user",
        content: `Lesson: ${lesson.title}\nStep: ${step_key}\nBisheriger Content: ${(lesson.content || "").substring(0, 2000)}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  });

  let contentJson: Record<string, unknown>;
  try {
    contentJson = JSON.parse(aiContent);
  } catch {
    contentJson = { html: aiContent, objectives: [], key_concepts: [], examples: [] };
  }

  const { data: version, error } = await db
    .from("content_versions")
    .insert({
      course_id,
      lesson_id,
      step_key,
      content_json: contentJson,
      created_by_agent: proposerModel.model,
      created_by_job_id: jobId || null,
      status: "proposed",
      council_round: 1,
    })
    .select("id")
    .single();

  if (error) throw error;

  // Log proposal message
  await db.from("council_messages").insert({
    content_version_id: version.id,
    agent_name: proposerModel.model,
    message_type: "proposal",
    message_json: {
      summary: `Proposal for ${step_key} of lesson "${lesson.title}"`,
      word_count: aiContent.length,
      has_examples: (contentJson.examples as unknown[])?.length > 0,
    },
  });

  return { version_id: version.id, step_key };
}

// ─── 2. Critique Step (Claude) ──────────────────────────────────────────────

async function critiqueStep(
  db: ReturnType<typeof createClient>,
  payload: Record<string, unknown>
) {
  const { version_id } = payload as { version_id: string };
  if (!version_id) throw new Error("Missing version_id");

  const { data: version } = await db
    .from("content_versions")
    .select("*")
    .eq("id", version_id)
    .single();

  if (!version) throw new Error(`Version ${version_id} not found`);

  // Update status
  await db
    .from("content_versions")
    .update({ status: "under_review" })
    .eq("id", version_id);

  const contentStr = JSON.stringify(version.content_json);

  const validatorModel = await getModelAsync("council_validator");
  const { content: critiqueContent } = await callAIJSON({
    provider: validatorModel.provider,
    model: validatorModel.model,
    messages: [
      {
        role: "system",
        content: `Du bist ein strenger Qualitätsvalidator für IHK-Prüfungsinhalte.
Bewerte den folgenden Content nach:
1. Fachliche Korrektheit (0-100)
2. Didaktische Qualität (0-100)
3. IHK-Prüfungsrelevanz (0-100)
4. Vollständigkeit (0-100)

Antworte als JSON:
{
  "scores": { "accuracy": N, "didactics": N, "exam_relevance": N, "completeness": N },
  "overall_score": N,
  "issues": [{ "severity": "critical|major|minor", "description": "..." }],
  "suggested_edits": ["..."],
  "verdict_recommendation": "approved|revise|rejected"
}`,
      },
      {
        role: "user",
        content: `Step: ${version.step_key}\nContent:\n${contentStr.substring(0, 6000)}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  });

  let critiqueJson: Record<string, unknown>;
  try {
    critiqueJson = JSON.parse(critiqueContent);
  } catch {
    critiqueJson = { overall_score: 0, issues: [], verdict_recommendation: "revise" };
  }

  // Store critique as council message
  await db.from("council_messages").insert({
    content_version_id: version_id,
    agent_name: validatorModel.model,
    message_type: "critique",
    message_json: critiqueJson,
  });

  // Update quality score
  const score = Number(critiqueJson.overall_score) || 0;
  await db
    .from("content_versions")
    .update({ quality_score: score })
    .eq("id", version_id);

  return { version_id, critique: critiqueJson };
}

// ─── 3. Revise Step (GPT-5.2 revises based on critique) ────────────────────

async function reviseStep(
  db: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  jobId?: string
) {
  const { version_id } = payload as { version_id: string };
  if (!version_id) throw new Error("Missing version_id");

  const { data: version } = await db
    .from("content_versions")
    .select("*")
    .eq("id", version_id)
    .single();

  if (!version) throw new Error(`Version ${version_id} not found`);

  // Get critique messages
  const { data: critiques } = await db
    .from("council_messages")
    .select("message_json")
    .eq("content_version_id", version_id)
    .eq("message_type", "critique")
    .order("created_at", { ascending: false })
    .limit(1);

  const latestCritique = critiques?.[0]?.message_json || {};

  const reviserModel = await getModelAsync("council_proposer");
  const { content: revisedContent } = await callAIJSON({
    provider: reviserModel.provider,
    model: reviserModel.model,
    messages: [
      {
        role: "system",
        content: `Du bist ein didaktischer Experte. Überarbeite den folgenden Content basierend auf dem Feedback des Validators.
Behalte die Stärken bei und behebe alle genannten Issues.
Antworte als JSON: { "html": "...", "objectives": [...], "key_concepts": [...], "examples": [...] }`,
      },
      {
        role: "user",
        content: `Original Content:\n${JSON.stringify(version.content_json).substring(0, 3000)}\n\nKritik:\n${JSON.stringify(latestCritique).substring(0, 2000)}`,
      },
    ],
    temperature: 0.5,
    max_tokens: 4096,
  });

  let revisedJson: Record<string, unknown>;
  try {
    revisedJson = JSON.parse(revisedContent);
  } catch {
    revisedJson = { html: revisedContent };
  }

  // Create new version as revision
  const { data: newVersion, error } = await db
    .from("content_versions")
    .insert({
      course_id: version.course_id,
      lesson_id: version.lesson_id,
      step_key: version.step_key,
      content_json: revisedJson,
      created_by_agent: "gpt-4.1",
      created_by_job_id: jobId || null,
      status: "proposed",
      council_round: (version.council_round || 1) + 1,
      parent_version_id: version_id,
    })
    .select("id")
    .single();

  if (error) throw error;

  // Mark old version as "revise"
  await db
    .from("content_versions")
    .update({ status: "revise" })
    .eq("id", version_id);

  // Log revision
  await db.from("council_messages").insert({
    content_version_id: newVersion.id,
    agent_name: "gpt-4.1",
    message_type: "revision",
    message_json: {
      parent_version: version_id,
      round: (version.council_round || 1) + 1,
      addressed_issues: (latestCritique as Record<string, unknown>).issues || [],
    },
  });

  return { new_version_id: newVersion.id, parent_version_id: version_id };
}

// ─── 4. Vote & Verdict ─────────────────────────────────────────────────────

async function voteAndVerdict(
  db: ReturnType<typeof createClient>,
  payload: Record<string, unknown>
) {
  const { version_id } = payload as { version_id: string };
  if (!version_id) throw new Error("Missing version_id");

  // Get all critiques for this version
  const { data: messages } = await db
    .from("council_messages")
    .select("agent_name, message_type, message_json")
    .eq("content_version_id", version_id)
    .order("created_at", { ascending: false });

  const latestCritique = messages?.find(
    (m: { message_type: string }) => m.message_type === "critique"
  );
  const critiqueData = (latestCritique?.message_json as Record<string, unknown>) || {};
  const score = Number(critiqueData.overall_score) || 0;
  const recommendation = String(critiqueData.verdict_recommendation || "revise");

  // GPT-5.2 vote (generator – tends to approve)
  const generatorVote = score >= 75 ? "approved" : score >= 50 ? "revise" : "rejected";
  // Claude vote (validator – stricter)
  const validatorVote = recommendation as "approved" | "revise" | "rejected";

  // Insert votes (upsert)
  await db.from("council_votes").upsert(
    [
      {
        content_version_id: version_id,
        agent_name: "gpt-4.1",
        vote: generatorVote,
        confidence: Math.min(1, score / 100),
        rationale: `Score ${score}, generator assessment`,
      },
      {
        content_version_id: version_id,
        agent_name: "claude-sonnet-4",
        vote: validatorVote,
        confidence: Math.min(1, score / 100),
        rationale: `Validator recommendation: ${recommendation}`,
      },
    ],
    { onConflict: "content_version_id,agent_name" }
  );

  // Determine final decision (validator has veto power)
  let finalDecision: "approved" | "revise" | "rejected";
  if (validatorVote === "rejected") {
    finalDecision = "rejected";
  } else if (validatorVote === "approved" && generatorVote === "approved") {
    finalDecision = "approved";
  } else {
    finalDecision = "revise";
  }

  const consensusScore =
    generatorVote === validatorVote ? 1.0 : 0.5;

  // Write verdict
  await db.from("council_verdicts").upsert(
    {
      content_version_id: version_id,
      final_decision: finalDecision,
      consensus_score: consensusScore,
      required_fixes:
        finalDecision !== "approved"
          ? (critiqueData.suggested_edits || null)
          : null,
      decided_by: "council",
    },
    { onConflict: "content_version_id" }
  );

  // Update version status
  await db
    .from("content_versions")
    .update({ status: finalDecision === "approved" ? "approved" : finalDecision })
    .eq("id", version_id);

  // Log verdict
  await db.from("council_messages").insert({
    content_version_id: version_id,
    agent_name: "council",
    message_type: "verdict",
    message_json: {
      decision: finalDecision,
      generator_vote: generatorVote,
      validator_vote: validatorVote,
      consensus_score: consensusScore,
      score,
    },
  });

  return { version_id, decision: finalDecision, consensus_score: consensusScore };
}

// ─── 5. Publish Step ────────────────────────────────────────────────────────

async function publishStep(
  db: ReturnType<typeof createClient>,
  payload: Record<string, unknown>
) {
  const { version_id } = payload as { version_id: string };
  if (!version_id) throw new Error("Missing version_id");

  const { data: version } = await db
    .from("content_versions")
    .select("lesson_id, step_key, status")
    .eq("id", version_id)
    .single();

  if (!version) throw new Error(`Version ${version_id} not found`);
  if (version.status !== "approved") {
    throw new Error(
      `Cannot publish version ${version_id}, status=${version.status} (must be approved)`
    );
  }

  // Use the DB function for hard gate
  const { error } = await db.rpc("publish_approved_version", {
    p_lesson_id: version.lesson_id,
    p_step_key: version.step_key,
    p_version_id: version_id,
  });

  if (error) throw error;

  return { published: true, version_id, step_key: version.step_key };
}

// ─── 6. Recompute Course Readiness ──────────────────────────────────────────

async function recomputeReady(
  db: ReturnType<typeof createClient>,
  payload: Record<string, unknown>
) {
  const { course_id } = payload as { course_id: string };
  if (!course_id) throw new Error("Missing course_id");

  const { error } = await db.rpc("recompute_course_publish_readiness", {
    p_course_id: course_id,
  });

  if (error) throw error;

  // Read back status
  const { data: course } = await db
    .from("courses")
    .select("is_ready_for_publish")
    .eq("id", course_id)
    .single();

  return {
    course_id,
    is_ready_for_publish: course?.is_ready_for_publish ?? false,
  };
}
