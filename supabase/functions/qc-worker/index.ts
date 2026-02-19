import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * QC Worker – 5-Gate Quality Control
 *
 * Gates:
 *   A) MiniCheck Parser   – Extract questions from HTML → minicheck_questions
 *   B) Dedup Gate         – Exactly 1 lesson per step per competency, quarantine rest
 *   C) Sort Order Fix     – Deterministic sort: (comp.sort_order * 10) + step_index
 *   D) Exam Block Inject  – Standardized IHK exam reference block per competency
 *   E) Weight Tags        – Tag lessons by curriculum weight
 *
 * Call: POST { courseId, gates?: string[] }
 *   gates defaults to ["minicheck","dedup","sort","exam_block","weight"]
 */

const STEP_ORDER: Record<string, number> = {
  einstieg: 0, verstehen: 1, anwenden: 2, wiederholen: 3, mini_check: 4,
};
const VALID_STEPS = Object.keys(STEP_ORDER);

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { courseId, gates } = await req.json();
    if (!courseId) return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers });

    const activeGates: string[] = gates || ["minicheck", "dedup", "sort", "exam_block", "weight", "difficulty"];
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Create QC run record
    const { data: run } = await admin.from("qc_run_results").insert({
      course_id: courseId, run_type: "full", status: "running", stats: {}, issues: [], fixes_applied: [],
    }).select("id").single();
    const runId = run?.id;

    const allIssues: any[] = [];
    const allFixes: any[] = [];
    const stats: Record<string, any> = {};

    // Load course data
    const { data: modules } = await admin.from("modules")
      .select("id, title, sort_order, learning_field_id, learning_field_code")
      .eq("course_id", courseId).order("sort_order");

    const moduleIds = (modules || []).map((m: any) => m.id);
    if (moduleIds.length === 0) {
      return new Response(JSON.stringify({ error: "No modules found" }), { status: 404, headers });
    }

    const { data: lessons } = await admin.from("lessons")
      .select("id, title, module_id, competency_id, step, content, sort_order, qc_status, quarantine_status, minicheck_parsed, exam_block, weight_tag")
      .in("module_id", moduleIds).order("sort_order");
    const allLessons = lessons || [];

    // Load curriculum data for weight tags
    const { data: course } = await admin.from("courses")
      .select("curriculum_id").eq("id", courseId).single();
    const curriculumId = course?.curriculum_id;

    let learningFields: any[] = [];
    let competencies: any[] = [];
    if (curriculumId) {
      const { data: lfs } = await admin.from("learning_fields")
        .select("id, title, weight_percent, code, sort_order")
        .eq("curriculum_id", curriculumId);
      learningFields = lfs || [];
      const lfIds = learningFields.map((lf: any) => lf.id);
      if (lfIds.length > 0) {
        const { data: comps } = await admin.from("competencies")
          .select("id, title, code, learning_field_id, sort_order")
          .in("learning_field_id", lfIds);
        competencies = comps || [];
      }
    }

    // ============ GATE A: MiniCheck Parser ============
    if (activeGates.includes("minicheck")) {
      const result = await gateMiniCheckParser(admin, allLessons);
      stats.minicheck = result.stats;
      allIssues.push(...result.issues);
      allFixes.push(...result.fixes);
    }

    // ============ GATE B: Dedup ============
    if (activeGates.includes("dedup")) {
      const result = await gateDeduplicate(admin, allLessons);
      stats.dedup = result.stats;
      allIssues.push(...result.issues);
      allFixes.push(...result.fixes);
    }

    // ============ GATE C: Sort Order Fix ============
    if (activeGates.includes("sort")) {
      const result = await gateSortOrder(admin, allLessons, competencies);
      stats.sort = result.stats;
      allFixes.push(...result.fixes);
    }

    // ============ GATE D: Exam Block ============
    if (activeGates.includes("exam_block")) {
      const result = await gateExamBlock(admin, allLessons, competencies);
      stats.exam_block = result.stats;
      allIssues.push(...result.issues);
      allFixes.push(...result.fixes);
    }

    // ============ GATE E: Weight Tags ============
    if (activeGates.includes("weight")) {
      const result = await gateWeightTags(admin, allLessons, competencies, learningFields);
      stats.weight = result.stats;
      allFixes.push(...result.fixes);
    }

    // ============ GATE F: Difficulty Distribution ============
    if (activeGates.includes("difficulty")) {
      const result = await gateDifficulty(admin, allLessons);
      stats.difficulty = result.stats;
      allIssues.push(...result.issues);
      allFixes.push(...result.fixes);
    }

    // Update QC run
    if (runId) {
      await admin.from("qc_run_results").update({
        status: "completed", completed_at: new Date().toISOString(),
        stats, issues: allIssues, fixes_applied: allFixes,
      }).eq("id", runId);
    }

    console.log(`[QC-Worker] Course ${courseId.slice(0, 8)}: gates=${activeGates.join(",")}, issues=${allIssues.length}, fixes=${allFixes.length}`);

    return new Response(JSON.stringify({
      success: true, courseId, runId,
      gatesExecuted: activeGates,
      issueCount: allIssues.length,
      fixCount: allFixes.length,
      stats, issues: allIssues,
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[QC-Worker] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
});

// ===================== GATE A: MiniCheck Parser =====================
async function gateMiniCheckParser(admin: any, lessons: any[]) {
  const issues: any[] = [];
  const fixes: any[] = [];
  let parsed = 0, skipped = 0, failed = 0;

  const miniCheckLessons = lessons.filter((l: any) => l.step === "mini_check" && !l.minicheck_parsed);

  for (const lesson of miniCheckLessons) {
    const html = lesson.content?.html || "";
    if (!html || html.length < 50) { skipped++; continue; }

    const questions = extractQuestionsFromHTML(html);
    if (questions.length === 0) {
      issues.push({ gate: "minicheck", severity: "warning", lessonId: lesson.id, title: lesson.title, message: "MiniCheck HTML vorhanden, aber keine Fragen extrahierbar" });
      failed++;
      continue;
    }

    // Insert into minicheck_questions
    const rows = questions.map((q: any, idx: number) => ({
      lesson_id: lesson.id,
      question_text: q.question,
      options: q.options,
      correct_answer: q.correctIndex,
      explanation: q.explanation || null,
      difficulty: "medium",
      competency_id: lesson.competency_id || null,
      sort_order: idx,
    }));

    // Delete old entries first
    await admin.from("minicheck_questions").delete().eq("lesson_id", lesson.id);
    const { error } = await admin.from("minicheck_questions").insert(rows);

    if (error) {
      issues.push({ gate: "minicheck", severity: "critical", lessonId: lesson.id, message: `Insert failed: ${error.message}` });
      failed++;
    } else {
      await admin.from("lessons").update({ minicheck_parsed: true }).eq("id", lesson.id);
      fixes.push({ gate: "minicheck", lessonId: lesson.id, action: "parsed", questionCount: questions.length });
      parsed++;
    }
  }

  return { stats: { total: miniCheckLessons.length, parsed, skipped, failed }, issues, fixes };
}

function extractQuestionsFromHTML(html: string): any[] {
  const questions: any[] = [];

  // Pattern 1: Numbered questions with lettered options (a) b) c) d))
  const qBlocks = html.split(/(?:<(?:p|div|h[3-6])[^>]*>)?\s*(?:Frage\s*\d+|(?:^|\n)\s*\d+[\.\)]\s)/i);

  if (qBlocks.length <= 1) {
    // Pattern 2: Try bold question pattern
    const boldPattern = /<strong>(.*?)<\/strong>/g;
    const potentialQuestions: string[] = [];
    let match;
    while ((match = boldPattern.exec(html)) !== null) {
      const text = stripHTML(match[1]).trim();
      if (text.endsWith("?") && text.length > 20) potentialQuestions.push(text);
    }

    // For each question, try to find options after it
    for (const q of potentialQuestions) {
      const qIdx = html.indexOf(q);
      const afterQ = html.slice(qIdx + q.length, qIdx + q.length + 2000);
      const opts = extractOptions(afterQ);
      if (opts.options.length >= 3) {
        questions.push({ question: q, options: opts.options, correctIndex: opts.correctIndex, explanation: opts.explanation });
      }
    }
  } else {
    for (let i = 1; i < qBlocks.length; i++) {
      const block = qBlocks[i];
      // Extract question text (first line/sentence)
      const lines = stripHTML(block).split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      let questionText = lines[0];
      if (!questionText.endsWith("?")) questionText += "?";

      const opts = extractOptions(block);
      if (opts.options.length >= 3) {
        questions.push({ question: questionText, options: opts.options, correctIndex: opts.correctIndex, explanation: opts.explanation });
      }
    }
  }

  return questions.slice(0, 5); // Max 5 per minicheck
}

function extractOptions(html: string): { options: string[], correctIndex: number, explanation: string } {
  const options: string[] = [];
  let correctIndex = 0;
  let explanation = "";

  // Try: a) ... b) ... c) ... d) ...
  const optPattern = /[a-d]\)\s*([^<\n]+)/gi;
  let match;
  while ((match = optPattern.exec(html)) !== null) {
    options.push(match[1].trim());
  }

  // Try: <li> items
  if (options.length < 3) {
    options.length = 0;
    const liPattern = /<li[^>]*>(.*?)<\/li>/gi;
    while ((match = liPattern.exec(html)) !== null) {
      const text = stripHTML(match[1]).trim();
      if (text.length > 5 && text.length < 300) options.push(text);
    }
  }

  // Detect correct answer (✓, ✅, richtig, korrekt)
  const correctMarkers = ["✓", "✅", "richtig", "korrekt", "correct", "★"];
  for (let i = 0; i < options.length; i++) {
    for (const marker of correctMarkers) {
      if (options[i].toLowerCase().includes(marker)) {
        correctIndex = i;
        options[i] = options[i].replace(new RegExp(`[${marker}]`, "gi"), "").trim();
        break;
      }
    }
  }

  // Extract explanation
  const explPattern = /(?:Erklärung|Begründung|Warum|Lösung)[:\s]*(.*?)(?:<\/|$)/i;
  const explMatch = explPattern.exec(html);
  if (explMatch) explanation = stripHTML(explMatch[1]).trim().slice(0, 500);

  return { options: options.slice(0, 4), correctIndex, explanation };
}

function stripHTML(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// ===================== GATE B: Dedup =====================
async function gateDeduplicate(admin: any, lessons: any[]) {
  const issues: any[] = [];
  const fixes: any[] = [];
  let quarantined = 0;

  // Group by competency_id + step
  const groups = new Map<string, any[]>();
  for (const l of lessons) {
    if (!l.competency_id || !l.step) continue;
    if (l.quarantine_status === "quarantined") continue; // already quarantined
    const key = `${l.competency_id}::${l.step}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }

  for (const [key, group] of groups) {
    if (group.length <= 1) continue;

    // Keep the one with most content, quarantine the rest
    const sorted = group.sort((a: any, b: any) => {
      const aLen = (a.content?.html || "").length;
      const bLen = (b.content?.html || "").length;
      return bLen - aLen; // longest first
    });

    const keeper = sorted[0];
    const dupes = sorted.slice(1);

    issues.push({
      gate: "dedup", severity: "warning", code: "DUPLICATE_STEP",
      competencyId: keeper.competency_id, step: keeper.step,
      keeperId: keeper.id, duplicateCount: dupes.length,
      message: `${key}: ${group.length} Lektionen → 1 behalten, ${dupes.length} quarantäne`,
    });

    const dupeIds = dupes.map((d: any) => d.id);
    if (dupeIds.length > 0) {
      await admin.from("lessons").update({
        quarantine_status: "quarantined",
        quarantine_reason: `Duplikat von ${keeper.id} (QC-Worker Dedup Gate)`,
        quarantined_at: new Date().toISOString(),
        qc_status: "quarantined",
      }).in("id", dupeIds);

      quarantined += dupeIds.length;
      fixes.push({ gate: "dedup", action: "quarantined", keeperId: keeper.id, quarantinedIds: dupeIds });
    }
  }

  // Count remaining active lessons per step
  const stepCounts: Record<string, number> = {};
  for (const l of lessons) {
    if (l.quarantine_status === "quarantined") continue;
    const s = l.step || "unknown";
    stepCounts[s] = (stepCounts[s] || 0) + 1;
  }

  return { stats: { totalDuplicates: quarantined, stepDistribution: stepCounts }, issues, fixes };
}

// ===================== GATE C: Sort Order Fix =====================
async function gateSortOrder(admin: any, lessons: any[], competencies: any[]) {
  const fixes: any[] = [];
  let fixed = 0;

  const compMap = new Map(competencies.map((c: any) => [c.id, c]));

  for (const lesson of lessons) {
    if (lesson.quarantine_status === "quarantined") continue;
    if (!lesson.competency_id || !lesson.step) continue;

    const comp = compMap.get(lesson.competency_id);
    const compSort = comp?.sort_order ?? 0;
    const stepIdx = STEP_ORDER[lesson.step] ?? 0;
    const correctSort = compSort * 10 + stepIdx;

    if (lesson.sort_order !== correctSort) {
      await admin.from("lessons").update({ sort_order: correctSort }).eq("id", lesson.id);
      fixes.push({ gate: "sort", lessonId: lesson.id, oldSort: lesson.sort_order, newSort: correctSort });
      fixed++;
    }
  }

  return { stats: { fixed, total: lessons.length }, issues: [], fixes };
}

// ===================== GATE D: Exam Block (IHK-Prüfungsniveau) =====================
async function gateExamBlock(admin: any, lessons: any[], competencies: any[]) {
  const issues: any[] = [];
  const fixes: any[] = [];
  let injected = 0;

  const compMap = new Map(competencies.map((c: any) => [c.id, c]));

  // Inject exam_block on ALL non-quarantined lessons (not just anwenden/wiederholen)
  const eligibleLessons = lessons.filter((l: any) =>
    !l.exam_block && l.quarantine_status !== "quarantined" && l.competency_id
  );

  for (const lesson of eligibleLessons) {
    const comp = compMap.get(lesson.competency_id);
    if (!comp) continue;

    const step = lesson.step || "verstehen";
    const examBlock = buildExamBlock(comp, step);

    await admin.from("lessons").update({ exam_block: examBlock }).eq("id", lesson.id);
    fixes.push({ gate: "exam_block", lessonId: lesson.id, competency: comp.code, step });
    injected++;
  }

  // Report competencies with no exam block at all
  const compWithExam = new Set(
    lessons.filter((l: any) => l.exam_block && l.quarantine_status !== "quarantined")
      .map((l: any) => l.competency_id)
  );
  for (const comp of competencies) {
    if (!compWithExam.has(comp.id)) {
      issues.push({
        gate: "exam_block", severity: "warning", code: "NO_EXAM_BLOCK",
        competencyId: comp.id, competency: `${comp.code}: ${comp.title}`,
        message: `Kompetenz "${comp.code}" hat keinen Prüfungsbezug-Block`,
      });
    }
  }

  return { stats: { injected, competenciesWithoutBlock: competencies.length - compWithExam.size }, issues, fixes };
}

function buildExamBlock(comp: any, step: string): Record<string, unknown> {
  const base = {
    ihk_fragestellung: `So fragt die IHK zu "${comp.title}" (${comp.code})`,
    typische_fallen: [
      `Verwechslung von Fachbegriffen im Bereich ${comp.title}`,
      "Oberflächliche Antwort ohne konkreten Praxisbezug",
      "Fehlende Struktur in der Argumentation (Einleitung→Kern→Fazit fehlt)",
      "Verwendung von Alltagssprache statt IHK-Fachterminologie",
    ],
    bewertungskriterien: [
      "Fachlich korrekte Begriffe verwenden (IHK-Terminologie)",
      "Mindestens ein konkretes Praxisbeispiel aus dem Berufsalltag nennen",
      "Strukturierte Antwort: Einleitung → Kernaussage → Begründung → Fazit",
      "Rechtliche Grundlagen korrekt benennen (wenn zutreffend)",
    ],
    pruefer_hinweis: `Prüfer achten besonders auf den korrekten Gebrauch der Fachsprache und die Fähigkeit, theoretisches Wissen auf praktische Situationen zu übertragen.`,
    difficulty_level: step === "einstieg" ? "easy" : step === "anwenden" ? "hard" : "medium",
    taxonomy_level: comp.taxonomy_level || (step === "einstieg" ? "remember" : step === "verstehen" ? "understand" : step === "anwenden" ? "apply" : "analyze"),
  };

  // Step-specific enrichment
  if (step === "anwenden" || step === "wiederholen") {
    return {
      ...base,
      ihk_frageformat: "Situationsaufgabe mit Entscheidungsbedarf",
      beispiel_pruefungsfrage: `Beschreiben Sie anhand eines konkreten Beispiels aus Ihrem Berufsalltag, wie Sie "${comp.title}" in der Praxis umsetzen. Begründen Sie Ihr Vorgehen fachlich.`,
      bewertungsschema: {
        fachliche_korrektheit: "40%",
        praxisbezug: "30%",
        argumentation: "20%",
        fachsprache: "10%",
      },
      haeufige_fehler: [
        "Allgemeine Aussagen ohne konkreten Bezug zur Kompetenz",
        "Fehlende Begründung für gewähltes Vorgehen",
        "Verwechslung mit ähnlichen Fachgebieten",
      ],
    };
  }

  return base;
}

// ===================== GATE E: Weight Tags =====================
async function gateWeightTags(admin: any, lessons: any[], competencies: any[], learningFields: any[]) {
  const fixes: any[] = [];
  let tagged = 0;

  const lfMap = new Map(learningFields.map((lf: any) => [lf.id, lf]));
  const compMap = new Map(competencies.map((c: any) => [c.id, c]));

  for (const lesson of lessons) {
    if (lesson.weight_tag || lesson.quarantine_status === "quarantined") continue;
    if (!lesson.competency_id) continue;

    const comp = compMap.get(lesson.competency_id);
    if (!comp) continue;

    const lf = lfMap.get(comp.learning_field_id);
    const weight = lf?.weight_percent ?? 0;

    let tag: string;
    if (weight >= 15) tag = "high";
    else if (weight >= 8) tag = "mid";
    else tag = "low";

    await admin.from("lessons").update({ weight_tag: tag }).eq("id", lesson.id);
    fixes.push({ gate: "weight", lessonId: lesson.id, tag, weight });
    tagged++;
  }

  return { stats: { tagged, total: lessons.length }, issues: [], fixes };
}

// ===================== GATE F: Difficulty Distribution =====================
async function gateDifficulty(admin: any, lessons: any[]) {
  const issues: any[] = [];
  const fixes: any[] = [];
  let tagged = 0;

  // Assign difficulty based on step if not already set
  const STEP_DIFFICULTY: Record<string, string> = {
    einstieg: "easy",
    verstehen: "medium",
    anwenden: "hard",
    wiederholen: "medium",
    mini_check: "medium",
  };

  for (const lesson of lessons) {
    if (lesson.quarantine_status === "quarantined") continue;
    
    const content = lesson.content as any;
    const currentDifficulty = content?.difficulty_level || lesson.exam_block?.difficulty_level;
    
    if (!currentDifficulty && lesson.step) {
      const difficulty = STEP_DIFFICULTY[lesson.step] || "medium";
      const examBlock = lesson.exam_block || {};
      examBlock.difficulty_level = difficulty;
      
      await admin.from("lessons").update({ exam_block: examBlock }).eq("id", lesson.id);
      fixes.push({ gate: "difficulty", lessonId: lesson.id, difficulty });
      tagged++;
    }
  }

  // Check overall distribution
  const activeLessons = lessons.filter((l: any) => l.quarantine_status !== "quarantined");
  const distribution = { easy: 0, medium: 0, hard: 0 };
  for (const l of activeLessons) {
    const d = (l.exam_block?.difficulty_level || l.content?.difficulty_level || "medium") as string;
    if (d in distribution) distribution[d as keyof typeof distribution]++;
  }

  const total = activeLessons.length;
  const easyPct = total > 0 ? Math.round((distribution.easy / total) * 100) : 0;
  const mediumPct = total > 0 ? Math.round((distribution.medium / total) * 100) : 0;
  const hardPct = total > 0 ? Math.round((distribution.hard / total) * 100) : 0;

  // IHK target: ~30% easy, ~50% medium, ~20% hard
  if (hardPct < 10) {
    issues.push({
      gate: "difficulty", severity: "warning", code: "LOW_HARD_RATIO",
      message: `Nur ${hardPct}% schwere Inhalte (Ziel: ~20%). Mehr Analyse-/Entscheidungsaufgaben nötig.`,
    });
  }
  if (easyPct > 50) {
    issues.push({
      gate: "difficulty", severity: "warning", code: "HIGH_EASY_RATIO",
      message: `${easyPct}% leichte Inhalte (Ziel: ~30%). Schwierigkeit erhöhen.`,
    });
  }

  return {
    stats: { tagged, distribution, percentages: { easy: easyPct, medium: mediumPct, hard: hardPct } },
    issues,
    fixes,
  };
}
