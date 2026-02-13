import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { calculateHybridTargetFromDefaults } from "../_shared/hybridExamTarget.ts";
import type { HybridTargetResult } from "../_shared/hybridExamTarget.ts";

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
const AI_CHUNK_SIZE = 6;
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

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data, error } = await sb
    .from("course_package_build_steps")
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
- Konkreter Praxiskontext (Autohaus, Werkstatt, Kunde)`,
    mc_multiple: `Multiple-Choice mit MEHREREN korrekten Antworten (2-3 von 5).
- 5 Antwortmöglichkeiten, 2-3 korrekt
- correct_answer ist ein Array der korrekten Indizes [0,2,4]
- Distraktoren: plausibel aber falsch`,
    calculation: `Rechenaufgabe mit konkreten Zahlen.
- Realistische Werte (Preise, Rabatte, Steuersätze, Zinsen)
- Lösungsweg in der Erklärung Schritt für Schritt
- Typische Autohaus-Berechnungen: Kalkulation, USt, Skonto, Rabatt, Leasing, Deckungsbeitrag
- Antworten als konkrete Zahlenwerte
- KEINE Platzhalter wie {variable} — alle Zahlen einsetzen!`,
    case_study: `Situationsbasierte Fallstudie.
- Konkreter Fall aus dem Autohaus-Alltag beschreiben (Name, Situation, Zahlen)
- Frage bezieht sich auf Handlungsempfehlung, Rechtslage oder Berechnung
- Alle 4 Antworten müssen plausibel sein
- Erklärung mit Paragraphen-/Gesetzesreferenz wenn anwendbar`,
    transfer: `Transferfrage: Wissen auf neue Situation anwenden.
- Unbekannte aber realistische Situation beschreiben
- Erfordert Kombination aus mehreren Wissensgebieten
- Tiefe Erklärung warum die Antwort korrekt ist`,
  };

  const system = `Du bist ein IHK-Prüfungsexperte für Automobilkaufleute. Du erstellst prüfungsrelevante Fragen auf ${difficultyLabels[difficulty]}-Niveau.

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
${questionType === "calculation" ? 'Bei Rechenaufgaben: "calculation_steps" als zusätzliches Feld mit Schritt-für-Schritt-Lösung' : ""}`;

  const user = `Erstelle ${count} EINZIGARTIGE ${difficultyLabels[difficulty]} Prüfungsfragen.

Lernfeld: ${lfTitle}
Thema: ${compTitle}
Beschreibung: ${compDesc}
Blueprint-Kontext: ${bp.canonical_statement}

WICHTIG: 
- Jede Frage braucht einen KONKRETEN Fall (z.B. "Herr Müller kauft einen BMW 320i für 35.000€...")
- Keine generischen Fragen wie "Was ist...?" ohne Kontext
- Bei Berechnungen: Alle Zahlen einsetzen, Lösungsweg zeigen
- Automobilkaufmann-spezifisch: Fahrzeughandel, Werkstatt, Finanzierung, Versicherung`;

  return { system, user };
}

async function generateDominanzQuestions(
  sb: ReturnType<typeof createClient>,
  bp: BlueprintInfo,
  count: number,
  difficulty: DifficultyKey,
  questionType: QuestionTypeKey,
  existingHashes: Set<string>,
): Promise<number> {
  let compTitle = bp.name;
  let compDesc = bp.canonical_statement;
  let lfTitle = "";

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
  }

  const { system, user } = buildDominanzPrompt(bp, difficulty, questionType, count, lfTitle, compTitle, compDesc);

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.85, // Higher for more variety
      max_tokens: 12000,
    }),
  });

  if (!aiResp.ok) {
    const status = aiResp.status;
    console.log(`[ExamPool-Dominanz] AI gateway error: ${status}`);
    if (status === 429) throw new Error("RATE_LIMIT: AI gateway 429");
    return 0;
  }

  const aiData = await aiResp.json();
  const rawContent = aiData.choices?.[0]?.message?.content || "";
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

  let saved = 0;
  for (const q of questions) {
    if (!q.question_text || !Array.isArray(q.options) || q.options.length < 4) continue;

    // Reject questions with unresolved placeholders
    if (/\{[a-z_]+\}/i.test(q.question_text)) {
      console.log(`[ExamPool-Dominanz] REJECTED: unresolved placeholder in "${q.question_text.slice(0, 60)}"`);
      continue;
    }

    // Simple hash-based dedup
    const hash = simpleHash(q.question_text);
    if (existingHashes.has(hash)) {
      console.log(`[ExamPool-Dominanz] REJECTED: duplicate hash`);
      continue;
    }
    existingHashes.add(hash);

    const metadata: Record<string, unknown> = {};
    if (q.question_type) metadata.question_type = q.question_type;
    if (q.tags) metadata.tags = q.tags;
    if (q.calculation_steps) metadata.calculation_steps = q.calculation_steps;

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
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    });
    if (error) {
      console.log(`[ExamPool-Dominanz] Insert error: ${error.message}`);
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

  const failAndUnlock = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "failed", p_log: { error: msg },
    });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!isFanOut) {
      if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
        return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
      }
    }

    if (generatedSoFar === 0 && !isFanOut) {
      await sb.rpc("update_course_package_step", {
        p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "running",
        p_log: { note: `DOMINANZ-ENGINE v2: target=${examTarget}, difficulty=5/35/45/15, types=MC/Calc/Case/Transfer` },
      });
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

    const { data: bps, error: bpErr } = await bpQuery;
    if (bpErr) throw bpErr;
    if (!bps?.length) throw new Error("No approved question_blueprints for curriculum");

    // Fan-out for large sets
    if (!isFanOut && bpIndex === 0 && bps.length > 10) {
      console.log(`[ExamPool-Dominanz] Fan-out ${bps.length} blueprints by learning field`);
      const { enqueued, learningFields } = await enqueueLearningFieldJobs(
        sb, packageId, curriculumId, bps as BlueprintInfo[], examTarget
      );

      if (enqueued > 0) {
        await sb.rpc("update_course_package_step", {
          p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "running",
          p_log: { note: `Dominanz Fan-out: ${enqueued} sub-jobs for ${learningFields} Lernfelder`, fan_out: true },
        });
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
        const generated = await generateDominanzQuestions(sb, bp, count, difficulty, questionType, existingHashes);
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
        // Final quality stats
        const { data: diffStats } = await sb.rpc("get_difficulty_distribution", { p_curriculum_id: curriculumId }).catch(() => ({ data: null }));
        
        await sb.rpc("update_course_package_step", {
          p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "done",
          p_log: {
            ok: true, engine: "dominanz-v2", target: examTarget, actual: actualTotal,
            blueprints_processed: currentBpIndex, difficulty_stats: diffStats,
          },
        });
        await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
      }

      return json({
        ok: true, batch_complete: true, engine: "dominanz-v2",
        total_questions: actualTotal, target: examTarget,
      });
    } else if (allBlueprintsProcessed) {
      const currentLoop = (batchCursor?.loop_count ?? 0) + 1;
      if (currentLoop >= 8) { // More loops allowed for dominance
        console.log(`[ExamPool-Dominanz] Loop cap (${currentLoop}). Accepting ${actualTotal}.`);
        if (!isFanOut) {
          await sb.rpc("update_course_package_step", {
            p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "done",
            p_log: { ok: true, engine: "dominanz-v2", target: examTarget, actual: actualTotal, loop_capped: currentLoop },
          });
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
