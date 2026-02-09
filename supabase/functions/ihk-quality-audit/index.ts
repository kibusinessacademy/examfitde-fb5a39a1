import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * IHK-Prüfer Quality Audit
 * 
 * AI-powered audit that evaluates course content from the perspective of an
 * IHK Ausbildungsleiter / Prüfungsausschuss-Mitglied.
 * 
 * Dimensions:
 * 1. Fachliche Korrektheit (30%) – content accuracy, terminology
 * 2. Didaktische Qualität (25%) – pedagogical approach, Bloom's taxonomy
 * 3. Prüfungsrelevanz (20%) – IHK exam alignment, competency coverage
 * 4. Themengewichtung (15%) – balanced topic distribution per Rahmenlehrplan
 * 5. Formale Qualität (10%) – structure, length, formatting
 */

const AUDIT_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_lesson_audit",
    description: "Bewerte eine Lektion aus Sicht eines IHK-Prüfers.",
    parameters: {
      type: "object",
      properties: {
        fachliche_korrektheit: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            issues: { type: "array", items: { type: "string" } },
            verdict: { type: "string" }
          },
          required: ["score", "issues", "verdict"]
        },
        didaktische_qualitaet: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            bloom_level_achieved: { type: "string", enum: ["erinnern", "verstehen", "anwenden", "analysieren", "evaluieren", "erschaffen"] },
            issues: { type: "array", items: { type: "string" } },
            verdict: { type: "string" }
          },
          required: ["score", "bloom_level_achieved", "issues", "verdict"]
        },
        pruefungsrelevanz: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            ihk_alignment: { type: "string", enum: ["hoch", "mittel", "niedrig", "nicht_relevant"] },
            issues: { type: "array", items: { type: "string" } },
            verdict: { type: "string" }
          },
          required: ["score", "ihk_alignment", "issues", "verdict"]
        },
        formale_qualitaet: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            issues: { type: "array", items: { type: "string" } },
            verdict: { type: "string" }
          },
          required: ["score", "issues", "verdict"]
        },
        overall_verdict: { type: "string" },
        critical_issues: { type: "array", items: { type: "string" } },
        recommendations: { type: "array", items: { type: "string" } }
      },
      required: ["fachliche_korrektheit", "didaktische_qualitaet", "pruefungsrelevanz", "formale_qualitaet", "overall_verdict", "critical_issues", "recommendations"]
    }
  }
};

const WEIGHTING_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_weighting_audit",
    description: "Bewerte die Themengewichtung des gesamten Kurses gemäß Rahmenlehrplan.",
    parameters: {
      type: "object",
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        lernfeld_balance: {
          type: "array",
          items: {
            type: "object",
            properties: {
              lernfeld: { type: "string" },
              expected_weight_percent: { type: "number" },
              actual_weight_percent: { type: "number" },
              deviation: { type: "string", enum: ["ok", "untergewichtet", "uebergewichtet"] },
              comment: { type: "string" }
            },
            required: ["lernfeld", "expected_weight_percent", "actual_weight_percent", "deviation", "comment"]
          }
        },
        critical_gaps: { type: "array", items: { type: "string" } },
        recommendations: { type: "array", items: { type: "string" } },
        overall_verdict: { type: "string" }
      },
      required: ["score", "lernfeld_balance", "critical_gaps", "recommendations", "overall_verdict"]
    }
  }
};

interface LessonAuditResult {
  lessonId: string;
  lessonTitle: string;
  step: string;
  competencyCode: string;
  module: string;
  scores: {
    fachliche_korrektheit: number;
    didaktische_qualitaet: number;
    pruefungsrelevanz: number;
    formale_qualitaet: number;
  };
  overall: number;
  issues: string[];
  critical: boolean;
  fullAudit: Record<string, unknown>;
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const body = await req.json().catch(() => ({}));
    const { courseId, sampleSize = 10 } = body;

    if (!courseId) {
      return new Response(JSON.stringify({ error: "courseId required" }), { status: 400, headers: jsonHeaders });
    }

    // Get course + curriculum info
    const { data: course } = await supabase
      .from('courses').select('id, title, curriculum_id, curricula(title)').eq('id', courseId).single();
    if (!course) throw new Error(`Course ${courseId} not found`);

    // Get all modules with lesson counts for weighting analysis
    const { data: modules } = await supabase
      .from('modules').select('id, title, sort_order').eq('course_id', courseId).order('sort_order');

    // Get a stratified sample of lessons (proportional per module)
    const { data: allLessons } = await supabase
      .from('lessons')
      .select('id, title, step, content, competency_id, module_id, modules!inner(title, course_id, sort_order)')
      .eq('modules.course_id', courseId);

    if (!allLessons || allLessons.length === 0) {
      return new Response(JSON.stringify({ error: "No lessons found" }), { status: 404, headers: jsonHeaders });
    }

    // Stratified sampling: pick lessons proportionally from each module
    const byModule = new Map<string, typeof allLessons>();
    for (const l of allLessons) {
      const mId = l.module_id;
      if (!byModule.has(mId)) byModule.set(mId, []);
      byModule.get(mId)!.push(l);
    }

    const sample: typeof allLessons = [];
    const totalLessons = allLessons.length;
    for (const [, moduleLessons] of byModule) {
      const proportion = Math.max(1, Math.round((moduleLessons.length / totalLessons) * sampleSize));
      // Shuffle and pick
      const shuffled = moduleLessons.sort(() => Math.random() - 0.5);
      sample.push(...shuffled.slice(0, proportion));
    }

    // Limit to sampleSize
    const finalSample = sample.slice(0, sampleSize);
    console.log(`[IHK-Audit] Auditing ${finalSample.length} of ${totalLessons} lessons for "${course.title}"`);

    // Get competencies for context
    const compIds = [...new Set(finalSample.map(l => l.competency_id).filter(Boolean))];
    const { data: competencies } = await supabase
      .from('competencies').select('id, code, title, taxonomy_level').in('id', compIds);
    const compMap = new Map((competencies || []).map(c => [c.id, c]));

    // ─── Audit each sampled lesson ───
    const lessonAudits: LessonAuditResult[] = [];

    for (const lesson of finalSample) {
      const comp = compMap.get(lesson.competency_id) || { code: 'N/A', title: 'Unbekannt', taxonomy_level: 'anwenden' };
      const content = lesson.content as Record<string, unknown> | null;

      // Build content summary for the AI
      let contentSummary = '';
      if (lesson.step === 'mini_check') {
        const qs = content?.questions as Array<Record<string, unknown>> | undefined;
        contentSummary = qs
          ? qs.map((q, i) => `Frage ${i + 1}: ${q.question}\nOptionen: ${(q.options as string[])?.join(' | ')}\nKorrekt: Option ${q.correct_answer}\nErklärung: ${q.explanation}`).join('\n\n')
          : 'Keine Fragen vorhanden';
      } else {
        contentSummary = (content?.html as string) || 'Kein Inhalt';
      }
      const objectives = (content?.objectives as string[]) || [];

      const auditResult = await auditLesson(API_KEY, {
        title: lesson.title,
        step: lesson.step,
        competencyCode: comp.code,
        competencyTitle: comp.title,
        taxonomyLevel: comp.taxonomy_level || 'anwenden',
        moduleName: (lesson.modules as Record<string, unknown>)?.title as string || '',
        contentSummary,
        objectives,
      });

      if (auditResult) {
        const scores = {
          fachliche_korrektheit: auditResult.fachliche_korrektheit?.score || 0,
          didaktische_qualitaet: auditResult.didaktische_qualitaet?.score || 0,
          pruefungsrelevanz: auditResult.pruefungsrelevanz?.score || 0,
          formale_qualitaet: auditResult.formale_qualitaet?.score || 0,
        };
        const overall = Math.round(
          scores.fachliche_korrektheit * 0.30 +
          scores.didaktische_qualitaet * 0.25 +
          scores.pruefungsrelevanz * 0.20 +
          scores.formale_qualitaet * 0.10
        );
        // Note: weighting (15%) is assessed at course level, not lesson level

        lessonAudits.push({
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          step: lesson.step,
          competencyCode: comp.code,
          module: (lesson.modules as Record<string, unknown>)?.title as string || '',
          scores,
          overall,
          issues: [
            ...(auditResult.critical_issues || []),
            ...(auditResult.recommendations || []),
          ],
          critical: (auditResult.critical_issues || []).length > 0,
          fullAudit: auditResult,
        });
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 1000));
    }

    // ─── Course-level weighting audit ───
    const moduleOverview = (modules || []).map(m => {
      const mLessons = allLessons.filter(l => l.module_id === m.id);
      return { title: m.title, lessonCount: mLessons.length, percent: Math.round((mLessons.length / totalLessons) * 100) };
    });

    const weightingAudit = await auditWeighting(API_KEY, {
      courseTitle: course.title,
      curriculumTitle: (course.curricula as Record<string, unknown>)?.title as string || '',
      modules: moduleOverview,
      totalLessons,
    });

    // ─── Aggregate scores ───
    const avgScores = {
      fachliche_korrektheit: avg(lessonAudits.map(a => a.scores.fachliche_korrektheit)),
      didaktische_qualitaet: avg(lessonAudits.map(a => a.scores.didaktische_qualitaet)),
      pruefungsrelevanz: avg(lessonAudits.map(a => a.scores.pruefungsrelevanz)),
      formale_qualitaet: avg(lessonAudits.map(a => a.scores.formale_qualitaet)),
      themengewichtung: weightingAudit?.score || 0,
    };

    const overallScore = Math.round(
      avgScores.fachliche_korrektheit * 0.30 +
      avgScores.didaktische_qualitaet * 0.25 +
      avgScores.pruefungsrelevanz * 0.20 +
      avgScores.themengewichtung * 0.15 +
      avgScores.formale_qualitaet * 0.10
    );

    const grade = overallScore >= 92 ? 'sehr gut'
      : overallScore >= 81 ? 'gut'
      : overallScore >= 67 ? 'befriedigend'
      : overallScore >= 50 ? 'ausreichend'
      : overallScore >= 30 ? 'mangelhaft'
      : 'ungenügend';

    const allCritical = lessonAudits.flatMap(a => (a.fullAudit.critical_issues as string[]) || []);
    const allRecs = [
      ...lessonAudits.flatMap(a => (a.fullAudit.recommendations as string[]) || []),
      ...(weightingAudit?.recommendations || []),
    ];
    // Deduplicate
    const uniqueRecs = [...new Set(allRecs)];

    // ─── Persist audit result ───
    const auditRecord = {
      course_id: courseId,
      audit_type: 'ihk_pruefer',
      overall_score: overallScore,
      overall_grade: grade,
      dimensions: avgScores,
      recommendations: uniqueRecs.slice(0, 20),
      critical_issues: [...new Set(allCritical)].slice(0, 15),
      lesson_audits: lessonAudits.map(a => ({
        lessonId: a.lessonId,
        title: a.lessonTitle,
        step: a.step,
        competency: a.competencyCode,
        module: a.module,
        scores: a.scores,
        overall: a.overall,
        critical: a.critical,
        issues: a.issues.slice(0, 5),
      })),
      audited_by: 'ai-ihk-pruefer',
      model_used: 'google/gemini-2.5-flash',
    };

    await supabase.from('course_quality_audits').insert(auditRecord);

    console.log(`[IHK-Audit] ✅ Complete: "${course.title}" → ${overallScore}/100 (${grade})`);

    return new Response(JSON.stringify({
      courseId,
      courseTitle: course.title,
      overallScore,
      grade,
      dimensions: avgScores,
      sampleSize: finalSample.length,
      totalLessons,
      criticalIssues: [...new Set(allCritical)],
      recommendations: uniqueRecs.slice(0, 15),
      lessonSummary: lessonAudits.map(a => ({
        title: a.lessonTitle,
        step: a.step,
        competency: a.competencyCode,
        overall: a.overall,
        critical: a.critical,
      })),
      weightingAudit: weightingAudit || null,
    }), { headers: jsonHeaders });

  } catch (error) {
    console.error("[IHK-Audit] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" } }
    );
  }
});

// ─── AI audit for a single lesson ───

async function auditLesson(apiKey: string, ctx: {
  title: string; step: string; competencyCode: string; competencyTitle: string;
  taxonomyLevel: string; moduleName: string; contentSummary: string; objectives: string[];
}): Promise<Record<string, unknown> | null> {
  const systemPrompt = `Du bist ein erfahrener IHK-Prüfungsausschuss-Vorsitzender und Ausbildungsleiter mit 20+ Jahren Erfahrung. 
Du prüfst Lerninhalte für die IHK-Abschlussprüfung mit höchsten Qualitätsansprüchen.

Bewertungskriterien:
- Fachliche Korrektheit: Sind alle Fakten, Definitionen, Prozesse korrekt? Stimmt die Fachterminologie?
- Didaktische Qualität: Passt die Methodik zum Lernziel? Wird die richtige Bloom-Stufe erreicht? Gibt es Aktivierung, Vertiefung, Transfer?
- Prüfungsrelevanz: Bereitet der Inhalt gezielt auf die IHK-Prüfung vor? Werden typische Prüfungsformate berücksichtigt?
- Formale Qualität: Ist der Inhalt gut strukturiert, ausreichend lang, frei von Platzhaltern?

Sei streng aber fair. Ein "sehr gut" gibt es nur bei exzellenter Qualität.
Nenne konkrete Probleme mit Zitat aus dem Inhalt.`;

  const userPrompt = `Prüfe diese Lektion:

**Modul:** ${ctx.moduleName}
**Lektion:** ${ctx.title}
**Step:** ${ctx.step}
**Kompetenz:** ${ctx.competencyCode} – ${ctx.competencyTitle}
**Taxonomiestufe (Soll):** ${ctx.taxonomyLevel}
**Lernziele:** ${ctx.objectives.length > 0 ? ctx.objectives.join('; ') : 'Keine definiert'}

**Inhalt:**
${ctx.contentSummary.slice(0, 4000)}`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [AUDIT_TOOL],
        tool_choice: { type: "function", function: { name: "submit_lesson_audit" } },
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      console.error(`[IHK-Audit] AI error ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    return JSON.parse(args);
  } catch (e) {
    console.error(`[IHK-Audit] Lesson audit error:`, e);
    return null;
  }
}

// ─── Course-level weighting audit ───

async function auditWeighting(apiKey: string, ctx: {
  courseTitle: string; curriculumTitle: string;
  modules: { title: string; lessonCount: number; percent: number }[];
  totalLessons: number;
}): Promise<Record<string, unknown> | null> {
  const moduleList = ctx.modules.map(m => `- ${m.title}: ${m.lessonCount} Lessons (${m.percent}%)`).join('\n');

  const prompt = `Du bist IHK-Prüfungsausschuss-Vorsitzender. Bewerte die Themengewichtung dieses Kurses.

**Kurs:** ${ctx.courseTitle}
**Rahmenlehrplan:** ${ctx.curriculumTitle}
**Gesamt-Lessons:** ${ctx.totalLessons}

**Module (Lernfelder):**
${moduleList}

Prüfe:
1. Sind alle Lernfelder angemessen gewichtet gemäß KMK-Rahmenlehrplan?
2. Gibt es Lernfelder mit zu vielen/wenigen Lessons?
3. Entspricht die Verteilung den IHK-Prüfungsanforderungen (AP1 + AP2)?
4. Werden prüfungsrelevante Schwerpunkte ausreichend berücksichtigt?`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "Du bist ein erfahrener IHK-Prüfungsausschuss-Vorsitzender. Bewerte die Themengewichtung streng nach Rahmenlehrplan." },
          { role: "user", content: prompt },
        ],
        tools: [WEIGHTING_TOOL],
        tool_choice: { type: "function", function: { name: "submit_weighting_audit" } },
        temperature: 0.3,
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    return args ? JSON.parse(args) : null;
  } catch {
    return null;
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}
