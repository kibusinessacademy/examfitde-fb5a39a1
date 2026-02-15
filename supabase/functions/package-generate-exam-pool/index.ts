import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { calculateHybridTargetFromDefaults } from "../_shared/hybridExamTarget.ts";
import type { HybridTargetResult } from "../_shared/hybridExamTarget.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { checkContamination } from "../_shared/contamination-guard.ts";

/**
 * DOMINANZ-ENGINE v2: IHK-Prüfungsstandard
 * 
 * Harte Vorgaben:
 * - Schwierigkeit: 5% easy, 35% medium, 45% hard, 15% very_hard
 * - Fragearten: 25% MC-Single, 20% MC-Multiple, 20% Rechenaufgaben, 25% Fallstudien, 10% Transfer
 * - Duplikat-Kontrolle: Hash-basiert + semantic check
 * - Keine unaufgelösten {variable}-Platzhalter
 * - Keine generischen Fragen ohne Kontext
 */

const CHUNK_SIZE = 10;
const AI_CHUNK_SIZE = 4; // Sweet spot: fast throughput without 504 timeouts
const AI_QUESTIONS_PER_BLUEPRINT = 35;

// ─── Dominanz-Engine v3: Dynamic distributions from Hybrid Target ────────────

// Defaults (overridden by Hybrid Engine at runtime)
let DIFFICULTY_DISTRIBUTION: Record<string, number> = {
  easy: 0.05,
  medium: 0.35,
  hard: 0.45,
  very_hard: 0.15,
};

let QUESTION_TYPE_MIX: Record<string, number> = {
  mc_single: 0.25,
  mc_multiple: 0.20,
  calculation: 0.20,
  case_study: 0.25,
  transfer: 0.10,
};

type DifficultyKey = string;
type QuestionTypeKey = string;

function getDifficultyForIndex(index: number, total: number): DifficultyKey {
  const ratio = index / total;
  if (ratio < DIFFICULTY_DISTRIBUTION.easy) return "easy";
  if (ratio < DIFFICULTY_DISTRIBUTION.easy + DIFFICULTY_DISTRIBUTION.medium) return "medium";
  if (ratio < 1 - DIFFICULTY_DISTRIBUTION.very_hard) return "hard";
  return "very_hard";
}

function getQuestionTypeForIndex(index: number, total: number): QuestionTypeKey {
  const ratio = index / total;
  if (ratio < QUESTION_TYPE_MIX.mc_single) return "mc_single";
  if (ratio < QUESTION_TYPE_MIX.mc_single + QUESTION_TYPE_MIX.mc_multiple) return "mc_multiple";
  if (ratio < QUESTION_TYPE_MIX.mc_single + QUESTION_TYPE_MIX.mc_multiple + QUESTION_TYPE_MIX.calculation) return "calculation";
  if (ratio < 1 - QUESTION_TYPE_MIX.transfer) return "case_study";
  return "transfer";
}

// Dynamic ship target
function getShipTarget(examTarget: number): number {
  if (examTarget <= 600) return 500;
  if (examTarget <= 800) return 700;
  if (examTarget <= 1000) return 850;
  return 1000;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ─── Provider Routing: OpenAI primary, Anthropic fallback ─────────────
// DeepSeek is excluded from exam-pool generation (too volatile for complex blueprints)

const EXAM_PROVIDER_CHAIN: { provider: AIProvider; model: string }[] = [
  { provider: "openai", model: "gpt-4o-mini" },      // Turbo: fastest bulk JSON, lowest latency
  { provider: "openai", model: "gpt-4.1" },           // Escalation: harder cases
  { provider: "anthropic", model: "claude-sonnet-4-20250514" }, // Fallback: quality repair
];

function pickProvider(exclude: string[] = []): { provider: AIProvider; model: string } {
  for (const entry of EXAM_PROVIDER_CHAIN) {
    if (exclude.includes(entry.provider) || exclude.includes(`${entry.provider}:${entry.model}`)) continue;
    // Skip providers without API keys
    const keyEnv = entry.provider === "openai" ? "OPENAI_API_KEY"
      : entry.provider === "anthropic" ? "ANTHROPIC_API_KEY" : null;
    if (keyEnv && !Deno.env.get(keyEnv)) continue;
    return entry;
  }
  // Absolute fallback
  return EXAM_PROVIDER_CHAIN[0];
}

async function markRateLimited(sb: ReturnType<typeof createClient>, provider: string, err: string) {
  try {
    await sb.rpc("mark_provider_rate_limited", {
      p_provider: provider,
      p_cooldown_seconds: 90,
      p_error: err,
    });
  } catch { /* non-blocking */ }
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data, error } = await sb
    .from("package_steps")
    .select("status")
    .eq("package_id", packageId)
    .eq("step_key", stepKey)
    .maybeSingle();
  if (error) throw error;
  return data?.status === "done";
}

// ─── Dominanz AI-Prompts ──────────────────────────────────────────────────────

interface BlueprintInfo {
  id: string;
  curriculum_id: string;
  learning_field_id: string | null;
  competency_id: string | null;
  name: string;
  canonical_statement: string;
  cognitive_level: string;
  question_template: string;
}

function buildDominanzPrompt(
  bp: BlueprintInfo,
  difficulty: DifficultyKey,
  questionType: QuestionTypeKey,
  count: number,
  lfTitle: string,
  compTitle: string,
  compDesc: string,
  professionName: string,
  depthTopics: string[],
): { system: string; user: string } {
  const difficultyLabels: Record<DifficultyKey, string> = {
    easy: "leicht (Grundlagenwissen, direkte Zuordnung)",
    medium: "mittel (Anwendung, einfache Berechnung, Vergleich)",
    hard: "schwer (Fallanalyse, mehrstufige Berechnung, Rechtsanwendung)",
    very_hard: "sehr schwer (komplexe Fallstudie, Transferleistung, strategische Entscheidung)",
  };

  const typeInstructions: Record<QuestionTypeKey, string> = {
    mc_single: `Multiple-Choice mit EINER korrekten Antwort.
- 4 Antwortmöglichkeiten
- Distraktoren müssen typische Fehler/Irrtümer abbilden (nicht offensichtlich falsch)
- Konkreter Praxiskontext aus dem Berufsalltag (${professionName})`,
    mc_multiple: `Multiple-Choice mit MEHREREN korrekten Antworten (2-3 von 5).
- 5 Antwortmöglichkeiten, 2-3 korrekt
- correct_answer ist ein Array der korrekten Indizes [0,2,4]
- Distraktoren: plausibel aber falsch`,
    calculation: `Rechenaufgabe mit konkreten Zahlen.
- Realistische Werte (Preise, Rabatte, Steuersätze, Zinsen)
- Lösungsweg in der Erklärung Schritt für Schritt
- Berufstypische Berechnungen für ${professionName}
- Antworten als konkrete Zahlenwerte
- KEINE Platzhalter wie {variable} — alle Zahlen einsetzen!`,
    case_study: `Situationsbasierte Fallstudie.
- Konkreter Fall aus dem Berufsalltag (${professionName}) beschreiben (Name, Situation, Zahlen)
- Frage bezieht sich auf Handlungsempfehlung, Rechtslage oder Berechnung
- Alle 4 Antworten müssen plausibel sein
- Erklärung mit Paragraphen-/Gesetzesreferenz wenn anwendbar`,
    transfer: `Transferfrage: Wissen auf neue Situation anwenden.
- Unbekannte aber realistische Situation beschreiben
- Erfordert Kombination aus mehreren Wissensgebieten
- Tiefe Erklärung warum die Antwort korrekt ist`,
  };

  const depthBlock = depthTopics.length > 0
    ? `\n\nCURRICULUM-TIEFE (Unterthemen aus dem Rahmenplan – nutze diese als fachliche Grundlage):
${depthTopics.map(t => `- ${t}`).join("\n")}`
    : "";

  const system = `Du bist ein IHK-Prüfungsexperte für ${professionName}. Du erstellst prüfungsrelevante Fragen auf ${difficultyLabels[difficulty]}-Niveau.

ABSOLUTE REGELN:
1. KEINE Platzhalter wie {variable}, {amount}, {akteur} — ALLE Werte konkret einsetzen!
2. Jede Frage muss einen konkreten Praxis-Kontext haben (Namen, Zahlen, Situationen)
3. Erklärungen müssen fachlich korrekt und ausführlich sein
4. Distraktoren bilden echte Irrtümer ab, nicht offensichtlichen Unsinn
5. Sprache: Fachsprachlich korrekt, B2-Niveau, IHK-Prüfungsstil
6. Jede Frage MUSS einzigartig sein — keine Variationen derselben Grundfrage

FRAGENTYP: ${typeInstructions[questionType]}

Antworte NUR mit einem JSON-Array:
[{
  "question_text": "Komplette Frage mit konkretem Kontext",
  "options": ["A", "B", "C", "D"],
  "correct_answer": 0,
  "explanation": "Ausführliche Erklärung mit Fachbegriffen",
  "difficulty": "${difficulty}",
  "question_type": "${questionType}",
  "tags": ["relevante", "themen-tags"]
}]

${questionType === "mc_multiple" ? 'Bei mc_multiple: "options" hat 5 Einträge, "correct_answer" ist ein Array z.B. [0,2,4]' : ""}
${questionType === "calculation" ? 'Bei Rechenaufgaben: "calculation_steps" als zusätzliches Feld mit Schritt-für-Schritt-Lösung' : ""}${depthBlock}`;

  const user = `Erstelle ${count} EINZIGARTIGE ${difficultyLabels[difficulty]} Prüfungsfragen für den Beruf "${professionName}".

Lernfeld: ${lfTitle}
Thema: ${compTitle}
Beschreibung: ${compDesc}
Blueprint-Kontext: ${bp.canonical_statement}

WICHTIG: 
- Jede Frage braucht einen KONKRETEN Fall mit realistischem Praxisbezug für ${professionName}
- Keine generischen Fragen wie "Was ist...?" ohne Kontext
- Bei Berechnungen: Alle Zahlen einsetzen, Lösungsweg zeigen
- Berufsspezifisch für ${professionName}`;

  return { system, user };
}

async function generateDominanzQuestions(
  sb: ReturnType<typeof createClient>,
  bp: BlueprintInfo,
  count: number,
  difficulty: DifficultyKey,
  questionType: QuestionTypeKey,
  existingHashes: Set<string>,
  professionName: string,
): Promise<number> {
  let compTitle = bp.name;
  let compDesc = bp.canonical_statement;
  let lfTitle = "";
  let depthTopics: string[] = [];

  if (bp.competency_id) {
    const { data: comp } = await sb
      .from("competencies")
      .select("title, description")
      .eq("id", bp.competency_id)
      .maybeSingle();
    if (comp) { compTitle = comp.title || compTitle; compDesc = comp.description || compDesc; }
  }
  if (bp.learning_field_id) {
    const { data: lf } = await sb
      .from("learning_fields")
      .select("title")
      .eq("id", bp.learning_field_id)
      .maybeSingle();
    if (lf) lfTitle = lf.title || "";

    // Load curriculum depth topics for this learning field
    try {
      const { data: parentTopics } = await sb
        .from("curriculum_topics")
        .select("id, title")
        .eq("curriculum_id", bp.curriculum_id)
        .is("parent_topic_id", null)
        .ilike("title", `%${lfTitle.split(":")[0]?.trim() || lfTitle}%`)
        .limit(3);

      if (parentTopics && parentTopics.length > 0) {
        const parentIds = parentTopics.map(t => t.id);
        const { data: subtopics } = await sb
          .from("curriculum_topics")
          .select("title, difficulty_level")
          .in("parent_topic_id", parentIds)
          .limit(20);

        if (subtopics) {
          depthTopics = subtopics.map(s =>
            `${s.title}${s.difficulty_level ? ` (${s.difficulty_level})` : ""}`
          );
        }
      }
    } catch (e) {
      console.log(`[ExamPool-Dominanz] Depth load failed: ${(e as Error).message}`);
    }
  }

  const { system, user } = buildDominanzPrompt(bp, difficulty, questionType, count, lfTitle, compTitle, compDesc, professionName, depthTopics);

  // Route: OpenAI primary → Anthropic fallback (DeepSeek/Google excluded)
  const sbRef = (globalThis as any).__examPoolSb;
  let exclude: string[] = [];
  let result: { content: string } | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const { provider, model } = pickProvider(exclude);

    try {
      result = await callAIJSON({
        provider,
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.85,
        max_tokens: count <= 2 ? 4096 : 8192, // Tight tokens for small batches
      });
      break; // success
    } catch (e: unknown) {
      const errMsg = (e as Error)?.message || String(e);
      const isRate = errMsg.includes("Rate limit") || errMsg.includes("429") || errMsg.includes("409") || errMsg.includes("rate_limited");
      const isTimeout = errMsg.includes("timed out") || errMsg.includes("TimeoutError") || errMsg.includes("AbortError");
      const shouldFailover = isRate || isTimeout;

      if (shouldFailover) {
        console.log(`[ExamPool-Dominanz] ${isTimeout ? "Timeout" : "Rate limited"} on ${provider}/${model}, attempt ${attempt}/3, failing over...`);
        if (sbRef) await markRateLimited(sbRef, provider, errMsg);
        exclude.push(`${provider}:${model}`); // Exclude specific model, not whole provider
        continue;
      }

      console.log(`[ExamPool-Dominanz] AI error (${provider}/${model}): ${errMsg}`);
      return 0;
    }
  }

  if (!result) {
    throw new Error("ALL_PROVIDERS_EXHAUSTED");
  }

  const rawContent = result.content || "";
  if (!rawContent) return 0;

  let questions: Array<{
    question_text: string;
    options: string[];
    correct_answer: number | number[];
    explanation: string;
    difficulty: string;
    question_type?: string;
    tags?: string[];
    calculation_steps?: string;
  }>;
  try {
    const clean = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    questions = JSON.parse(clean);
    if (!Array.isArray(questions)) return 0;
  } catch {
    console.log(`[ExamPool-Dominanz] JSON parse failed for BP ${bp.id.slice(0, 8)}`);
    return 0;
  }

  // ── Contamination Guard: block foreign-industry keywords via shared guard ──

  let saved = 0;
  for (const q of questions) {
    if (!q.question_text || !Array.isArray(q.options) || q.options.length < 4) continue;

    // Reject questions with unresolved placeholders
    if (/\{[a-z_]+\}/i.test(q.question_text)) {
      console.log(`[ExamPool-Dominanz] REJECTED: unresolved placeholder in "${q.question_text.slice(0, 60)}"`);
      continue;
    }

    // CONTAMINATION GUARD: Block foreign-industry content
    const contam = checkContamination(q.question_text + " " + (q.explanation || ""), professionName);
    if (contam.isContaminated) {
      console.log(`[ExamPool-Dominanz] CONTAMINATION BLOCKED: ${contam.detectedIndustry} terms [${contam.matchedTerms.join(",")}] in question for "${professionName}": "${q.question_text.slice(0, 60)}"`);
      continue;
    }

    // Simple hash-based dedup
    const hash = simpleHash(q.question_text);
    if (existingHashes.has(hash)) {
      console.log(`[ExamPool-Dominanz] REJECTED: duplicate hash`);
      continue;
    }
    existingHashes.add(hash);

    const { error } = await sb.from("exam_questions").insert({
      curriculum_id: bp.curriculum_id,
      learning_field_id: bp.learning_field_id,
      competency_id: bp.competency_id,
      blueprint_id: bp.id,
      question_text: q.question_text,
      options: q.options,
      correct_answer: Array.isArray(q.correct_answer) ? q.correct_answer[0] : (q.correct_answer ?? 0),
      explanation: q.explanation || "",
      difficulty: q.difficulty || difficulty,
      ai_generated: true,
      status: "draft",
    });
    if (error) {
      // Idempotency: skip duplicates silently
      if (error.code === "23505") {
        console.log(`[ExamPool-Dominanz] Duplicate question skipped`);
      } else {
        console.log(`[ExamPool-Dominanz] Insert error: ${error.message}`);
      }
    } else {
      saved++;
    }
  }
  return saved;
}

function simpleHash(text: string): string {
  let hash = 5381;
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

// ─── Stufe 2: Fan-out by learning field ────────────────────────────────────────

async function enqueueLearningFieldJobs(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  curriculumId: string,
  bps: BlueprintInfo[],
  examTarget: number,
): Promise<{ enqueued: number; learningFields: number }> {
  const lfGroups = new Map<string, BlueprintInfo[]>();
  for (const bp of bps) {
    const lfId = bp.learning_field_id || "unknown";
    if (!lfGroups.has(lfId)) lfGroups.set(lfId, []);
    lfGroups.get(lfId)!.push(bp);
  }

  const perLf = Math.ceil(examTarget / lfGroups.size);
  const nowIso = new Date().toISOString();
  const jobs = [];

  for (const [lfId, lfBps] of lfGroups) {
    jobs.push({
      job_type: "package_generate_exam_pool",
      status: "pending",
      attempts: 0,
      max_attempts: 25,
      run_after: nowIso,
      payload: {
        package_id: packageId,
        curriculum_id: curriculumId,
        learning_field_filter: lfId,
        lf_target: perLf,
        blueprint_ids: lfBps.map(b => b.id),
        options: { exam_target: examTarget },
        _fan_out: true,
      },
    });
  }

  if (jobs.length > 0) {
    const { error } = await sb.from("job_queue").insert(jobs);
    if (error) {
      console.log(`[ExamPool-Dominanz] Fan-out enqueue error: ${error.message}`);
      return { enqueued: 0, learningFields: lfGroups.size };
    }
  }

  return { enqueued: jobs.length, learningFields: lfGroups.size };
}

async function allFanOutSubJobsDone(
  sb: ReturnType<typeof createClient>,
  packageId: string,
): Promise<boolean> {
  const { count } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_type", "package_generate_exam_pool")
    .in("status", ["pending", "processing"])
    .contains("payload", { package_id: packageId, _fan_out: true });
  return (count ?? 0) === 0;
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const examTarget = Number(p.options?.exam_target ?? 1000);
  const shipTarget = Number(p.options?.ship_target ?? getShipTarget(examTarget));
  const isFanOut = p._fan_out === true;
  const blueprintIds: string[] | null = p.blueprint_ids || null;

  // Store sb reference for rate-limit tracking
  (globalThis as any).__examPoolSb = sb;
  console.log(`[ExamPool-Dominanz] Provider routing: OpenAI primary → Anthropic fallback (DeepSeek excluded)`);
  const lfTarget = p.lf_target || examTarget;

  // Apply dynamic distributions from Hybrid Target Engine (if provided)
  if (p.options?.difficulty_distribution) {
    DIFFICULTY_DISTRIBUTION = p.options.difficulty_distribution;
    console.log(`[ExamPool-Dominanz] Using dynamic difficulty: ${JSON.stringify(DIFFICULTY_DISTRIBUTION)}`);
  }
  if (p.options?.question_type_mix) {
    QUESTION_TYPE_MIX = p.options.question_type_mix;
    console.log(`[ExamPool-Dominanz] Using dynamic type mix: ${JSON.stringify(QUESTION_TYPE_MIX)}`);
  }

  const batchCursor = p._batch_cursor || p.batch_cursor || null;
  const generatedSoFar = batchCursor?.generated ?? 0;
  const bpIndex = batchCursor?.blueprint_index ?? 0;

  if (!packageId || !curriculumId) return json({ error: "Missing package_id or curriculum_id" }, 400);

  // Heartbeat helper — non-critical, pipeline-runner manages heartbeats
  const heartbeat = async () => {
    // Legacy heartbeat removed — pipeline-runner handles lease renewal
  };

  // pipeline-runner handles step_start/step_done/step_fail.
  // Do NOT set package status here — let the runner manage it.
  const failAndUnlock = async (_msg: string) => {
    // No-op: pipeline-runner handles failure state
  };

  try {
    if (!isFanOut) {
      if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
        // PREREQ not ready is a scheduling case, NOT an error.
        // Defer the job without burning attempts — the runner will re-process it later.
        const jobId = p.job_id || body.job_id;
        if (jobId) {
          await sb
            .from("job_queue")
            .update({
              status: "pending",
              run_after: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
              locked_at: null,
              locked_by: null,
              updated_at: new Date().toISOString(),
              // Do NOT increment attempts — this is not a real failure
            })
            .eq("id", jobId);
          console.log(`[ExamPool] PREREQ_NOT_DONE: scaffold — deferred job ${jobId} by 2min (no attempt burn)`);
          return json({ ok: true, delayed: true, reason: "PREREQ_NOT_DONE: scaffold_learning_course" });
        }
        // Fallback if no job_id available: return 409 for pipeline-runner to handle
        return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
      }
    }

    // Load profession name from SSOT — HARD GUARD (no fallback)
    const certificationId = p.certification_id || null;
    const professionResult = await resolveProfession(sb, { certificationId, curriculumId });
    const professionName = professionResult.professionName;
    console.log(`[ExamPool-Dominanz] Profession resolved: "${professionName}" (source: ${professionResult.source})`);

    if (generatedSoFar === 0 && !isFanOut) {
      console.log(`[ExamPool-Dominanz] Starting for "${professionName}": target=${examTarget}, difficulty=5/35/45/15, types=MC/Calc/Case/Transfer`);
    }

    // Get blueprints
    let bpQuery = sb
      .from("question_blueprints")
      .select("id, max_variations, curriculum_id, learning_field_id, competency_id, name, canonical_statement, cognitive_level, question_template")
      .eq("curriculum_id", curriculumId)
      .eq("status", "approved")
      .order("created_at", { ascending: true });

    if (blueprintIds && blueprintIds.length > 0) {
      bpQuery = bpQuery.in("id", blueprintIds);
    }

    let { data: bps, error: bpErr } = await bpQuery;
    if (bpErr) throw bpErr;

    if (!bps?.length) throw new Error("No approved question_blueprints for curriculum. Run auto_seed_exam_blueprints step first.");

    // Fan-out for large sets
    if (!isFanOut && bpIndex === 0 && bps.length > 10) {
      console.log(`[ExamPool-Dominanz] Fan-out ${bps.length} blueprints by learning field`);
      const { enqueued, learningFields } = await enqueueLearningFieldJobs(
        sb, packageId, curriculumId, bps as BlueprintInfo[], examTarget
      );

      if (enqueued > 0) {
        console.log(`[ExamPool-Dominanz] Fan-out: ${enqueued} sub-jobs for ${learningFields} Lernfelder`);
        return json({ ok: true, batch_complete: true, fan_out: true, sub_jobs: enqueued });
      }
    }

    // Load existing question hashes for dedup
    const { data: existingQs } = await sb
      .from("exam_questions")
      .select("question_text")
      .eq("curriculum_id", curriculumId)
      .limit(5000);
    
    const existingHashes = new Set<string>();
    if (existingQs) {
      for (const q of existingQs) {
        existingHashes.add(simpleHash(q.question_text));
      }
    }

    const effectiveTarget = isFanOut ? lfTarget : examTarget;
    const perBlueprint = Math.max(5, Math.ceil(effectiveTarget / bps.length));
    let questionsThisChunk = 0;
    let currentBpIndex = bpIndex;
    const errors: string[] = [];
    let bpsProcessed = 0;

    while (bpsProcessed < AI_CHUNK_SIZE && currentBpIndex < bps.length) {
      const bp = bps[currentBpIndex] as BlueprintInfo & { max_variations: number | null };
      
      // Heartbeat pipeline lock every blueprint iteration
      await heartbeat();

      // Distribute difficulty and question types across the chunk
      const questionsPerType = Math.max(1, Math.ceil(perBlueprint / 5));
      
      // Generate each type with appropriate difficulty
      const typeEntries = Object.entries(QUESTION_TYPE_MIX) as [QuestionTypeKey, number][];
      const diffEntries = Object.entries(DIFFICULTY_DISTRIBUTION) as [DifficultyKey, number][];
      
      // Pick difficulty and type based on global progress
      const globalProgress = (currentBpIndex * 5 + bpsProcessed) % (typeEntries.length * diffEntries.length);
      const typeIdx = globalProgress % typeEntries.length;
      const diffIdx = Math.floor(globalProgress / typeEntries.length) % diffEntries.length;
      
      const questionType = typeEntries[typeIdx][0];
      const difficulty = diffEntries[diffIdx][0];
      const count = Math.min(questionsPerType, AI_QUESTIONS_PER_BLUEPRINT);

      try {
        console.log(`[ExamPool-Dominanz] BP ${bp.id.slice(0, 8)} "${bp.name}": ${count}x ${questionType}/${difficulty}`);
        const generated = await generateDominanzQuestions(sb, bp, count, difficulty, questionType, existingHashes, professionName);
        questionsThisChunk += generated;
        console.log(`[ExamPool-Dominanz] BP ${bp.id.slice(0, 8)}: saved ${generated}/${count}`);
      } catch (e: unknown) {
        const errMsg = (e as Error)?.message || String(e);
        console.log(`[ExamPool-Dominanz] BP ${bp.id.slice(0, 8)} FAIL: ${errMsg}`);
        errors.push(`BP ${bp.id.slice(0, 8)}: ${errMsg}`);
      }
      currentBpIndex++;
      bpsProcessed++;
    }

    // Count actual questions
    const { count: totalQuestions } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId);

    const actualTotal = totalQuestions ?? 0;
    const allBlueprintsProcessed = currentBpIndex >= bps.length;
    const targetReached = actualTotal >= shipTarget;

    console.log(
      `[ExamPool-Dominanz] Package ${packageId.slice(0, 8)}: +${questionsThisChunk} this run, ` +
      `total=${actualTotal}/${examTarget}, BPs ${currentBpIndex}/${bps.length}${isFanOut ? ' (fan-out)' : ''}`
    );

    const progress = Math.min(55, Math.round(25 + (actualTotal / examTarget) * 30));
    await sb.from("course_packages").update({ build_progress: progress }).eq("id", packageId);

    if (targetReached) {
      const shouldMarkDone = !isFanOut || await allFanOutSubJobsDone(sb, packageId);
      if (shouldMarkDone) {
        let diffStats = null;
        try { const res = await sb.rpc("get_difficulty_distribution", { p_curriculum_id: curriculumId }); diffStats = res.data; } catch { /* ignore */ }
        console.log(`[ExamPool-Dominanz] Target reached: ${actualTotal}/${examTarget}, BPs=${currentBpIndex}`);
        await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
      }

      return json({
        ok: true, batch_complete: true, engine: "dominanz-v2",
        total_questions: actualTotal, target: examTarget,
      });
    } else if (allBlueprintsProcessed) {
      const currentLoop = (batchCursor?.loop_count ?? 0) + 1;
      if (currentLoop >= 8) {
        console.log(`[ExamPool-Dominanz] Loop cap (${currentLoop}). Accepting ${actualTotal}.`);
        if (!isFanOut) {
          await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
        }
        return json({ ok: true, batch_complete: true, total_questions: actualTotal, loop_capped: true });
      }

      console.log(`[ExamPool-Dominanz] Re-looping cycle ${currentLoop}: ${actualTotal}/${examTarget}`);
      return json({
        ok: true, batch_complete: false,
        batch_cursor: { generated: actualTotal, blueprint_index: 0, target: examTarget, blueprints_total: bps.length, loop_count: currentLoop },
      });
    } else {
      return json({
        ok: true, batch_complete: false,
        batch_cursor: { generated: actualTotal, blueprint_index: currentBpIndex, target: examTarget, blueprints_total: bps.length, loop_count: batchCursor?.loop_count ?? 0 },
      });
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.log(`[ExamPool-Dominanz] Fatal: ${msg}`);
    if (!isFanOut) await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
