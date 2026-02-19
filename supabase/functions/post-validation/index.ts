import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// IHK-specific terms that should appear in exam-prep content
const IHK_KEYWORDS = [
  "prüfung", "ihk", "abschlussprüfung", "zwischenprüfung",
  "handlungsfeld", "kompetenz", "lernfeld", "fachgespräch",
  "prüfungsvorbereitung", "berufsbildungsgesetz", "ausbildungsordnung",
  "prüfungsrelevant", "bewertungskriterien", "situationsaufgabe",
];

interface ValidationFinding {
  type: string;
  lessonId?: string;
  title?: string;
  detail: string;
  autoFixed: boolean;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { courseId } = await req.json();
    if (!courseId) {
      return new Response(JSON.stringify({ error: "Missing courseId" }), { status: 400, headers });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Load course modules & lessons
    const { data: modules } = await admin.from("modules").select("id").eq("course_id", courseId);
    const moduleIds = (modules || []).map((m: { id: string }) => m.id);

    if (moduleIds.length === 0) {
      return new Response(JSON.stringify({ error: "No modules found" }), { status: 404, headers });
    }

    const { data: lessons } = await admin.from("lessons")
      .select("id, title, module_id, competency_id, step_type, content, learning_objectives")
      .in("module_id", moduleIds);

    const allLessons = lessons || [];
    const results: Record<string, { findings: ValidationFinding[]; autoFixed: number; manualReview: number }> = {
      dedup: { findings: [], autoFixed: 0, manualReview: 0 },
      missing_steps: { findings: [], autoFixed: 0, manualReview: 0 },
      ihk_terms: { findings: [], autoFixed: 0, manualReview: 0 },
      consistency: { findings: [], autoFixed: 0, manualReview: 0 },
    };

    // --- 1) DEDUP: Find exact title duplicates ---
    const titleMap = new Map<string, Array<{ id: string; title: string }>>();
    for (const l of allLessons) {
      const lesson = l as { id: string; title: string };
      const norm = lesson.title.toLowerCase().trim();
      if (!titleMap.has(norm)) titleMap.set(norm, []);
      titleMap.get(norm)!.push(lesson);
    }

    for (const [title, dupes] of titleMap) {
      if (dupes.length > 1) {
        results.dedup.findings.push({
          type: "duplicate_title",
          detail: `"${title}" erscheint ${dupes.length}x`,
          lessonId: dupes[1].id,
          title: dupes[1].title,
          autoFixed: false,
        });
        results.dedup.manualReview += dupes.length - 1;
      }
    }

    // --- 2) MISSING STEPS: Each competency should have 5 steps ---
    const REQUIRED_STEPS = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"];
    const competencySteps = new Map<string, Set<string>>();

    for (const l of allLessons) {
      const lesson = l as { competency_id: string | null; step_type: string | null };
      if (!lesson.competency_id || !lesson.step_type) continue;
      if (!competencySteps.has(lesson.competency_id)) {
        competencySteps.set(lesson.competency_id, new Set());
      }
      competencySteps.get(lesson.competency_id)!.add(lesson.step_type);
    }

    for (const [compId, steps] of competencySteps) {
      const missing = REQUIRED_STEPS.filter(s => !steps.has(s));
      if (missing.length > 0) {
        results.missing_steps.findings.push({
          type: "missing_didactic_step",
          detail: `Kompetenz ${compId.slice(0, 8)}: fehlende Schritte: ${missing.join(", ")}`,
          autoFixed: false,
        });
        results.missing_steps.manualReview += missing.length;
      }
    }

    // --- 3) IHK TERMS: Check for exam-relevant terminology ---
    for (const l of allLessons) {
      const lesson = l as { id: string; title: string; content: string | null; step_type: string | null };
      // Only check 'anwenden' and 'wiederholen' steps
      if (!["anwenden", "wiederholen"].includes(lesson.step_type || "")) continue;

      const text = ((lesson.content || "") + " " + (lesson.title || "")).toLowerCase();
      const foundTerms = IHK_KEYWORDS.filter(kw => text.includes(kw));

      if (foundTerms.length < 2) {
        results.ihk_terms.findings.push({
          type: "low_ihk_relevance",
          lessonId: lesson.id,
          title: lesson.title,
          detail: `Nur ${foundTerms.length} IHK-Begriffe in Praxis-Step (empfohlen: ≥2)`,
          autoFixed: false,
        });
        results.ihk_terms.manualReview++;
      }
    }

    // --- 4) CONSISTENCY: Learning objectives present ---
    for (const l of allLessons) {
      const lesson = l as { id: string; title: string; learning_objectives: string[] | null; step_type: string | null };
      if (lesson.step_type === "einstieg" && (!lesson.learning_objectives || lesson.learning_objectives.length === 0)) {
        results.consistency.findings.push({
          type: "missing_learning_objectives",
          lessonId: lesson.id,
          title: lesson.title,
          detail: "Einstieg-Lektion ohne Lernziele",
          autoFixed: false,
        });
        results.consistency.manualReview++;
      }
    }

    // --- Save results to DB ---
    for (const [valType, data] of Object.entries(results)) {
      await admin.from("post_validation_results").insert({
        course_id: courseId,
        validation_type: valType,
        status: "completed",
        findings: data.findings,
        auto_fixed: data.autoFixed,
        manual_review: data.manualReview,
        completed_at: new Date().toISOString(),
      });
    }

    const totalFindings = Object.values(results).reduce((sum, r) => sum + r.findings.length, 0);
    const totalManual = Object.values(results).reduce((sum, r) => sum + r.manualReview, 0);

    console.log(`[PostValidation] Course ${courseId.slice(0, 8)}: ${totalFindings} findings, ${totalManual} manual review`);

    return new Response(JSON.stringify({
      success: true,
      courseId,
      totalFindings,
      totalManualReview: totalManual,
      results: Object.fromEntries(
        Object.entries(results).map(([k, v]) => [k, { count: v.findings.length, manualReview: v.manualReview }])
      ),
    }), { status: 200, headers });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[PostValidation] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
  }
});
