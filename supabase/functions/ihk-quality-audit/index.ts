// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, AITool } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";

const AUDIT_TOOL: AITool = {
  type: "function",
  function: {
    name: "submit_lesson_audit",
    description: "Bewerte eine Lektion aus Sicht eines IHK-Prüfers mit verschärften Qualitätskriterien.",
    parameters: {
      type: "object",
      properties: {
        fachliche_korrektheit: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            has_betrieblicher_bezug: { type: "boolean" },
            has_ihk_wording: { type: "boolean" },
            issues: { type: "array", items: { type: "string" } },
            verdict: { type: "string" }
          },
          required: ["score", "has_betrieblicher_bezug", "has_ihk_wording", "issues", "verdict"]
        },
        didaktische_qualitaet: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            bloom_level_achieved: { type: "string", enum: ["erinnern", "verstehen", "anwenden", "analysieren", "evaluieren", "erschaffen"] },
            anwenden_is_decision_based: { type: "boolean" },
            has_gegenbeispiel: { type: "boolean" },
            issues: { type: "array", items: { type: "string" } },
            verdict: { type: "string" }
          },
          required: ["score", "bloom_level_achieved", "anwenden_is_decision_based", "has_gegenbeispiel", "issues", "verdict"]
        },
        pruefungsrelevanz: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            ihk_alignment: { type: "string", enum: ["hoch", "mittel", "niedrig", "nicht_relevant"] },
            has_pruefungsbezug_block: { type: "boolean" },
            has_typische_ihk_formulierung: { type: "boolean" },
            has_fehlannahme: { type: "boolean" },
            issues: { type: "array", items: { type: "string" } },
            verdict: { type: "string" }
          },
          required: ["score", "ihk_alignment", "has_pruefungsbezug_block", "has_typische_ihk_formulierung", "has_fehlannahme", "issues", "verdict"]
        },
        minicheck_qualitaet: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            distraktoren_plausibel: { type: "boolean" },
            has_abwaegungsfrage: { type: "boolean" },
            erklaerungen_begruenden_falsch: { type: "boolean" },
            issues: { type: "array", items: { type: "string" } },
            verdict: { type: "string" }
          },
          required: ["score", "distraktoren_plausibel", "has_abwaegungsfrage", "erklaerungen_begruenden_falsch", "issues", "verdict"]
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
        gewichtungs_einordnung: { type: "string", enum: ["sehr_pruefungsrelevant", "haeufige_fehlerquelle", "ergaenzendes_wissen"] },
        overall_verdict: { type: "string" },
        critical_issues: { type: "array", items: { type: "string" } },
        recommendations: { type: "array", items: { type: "string" } },
        verbesserungspotenzial: {
          type: "object",
          properties: {
            pruefungsbezug_ergaenzen: { type: "boolean" },
            anwenden_umformulieren: { type: "boolean" },
            minicheck_verbessern: { type: "boolean" },
            betriebsbezug_ergaenzen: { type: "boolean" },
            gegenbeispiel_ergaenzen: { type: "boolean" }
          },
          required: ["pruefungsbezug_ergaenzen", "anwenden_umformulieren", "minicheck_verbessern", "betriebsbezug_ergaenzen", "gegenbeispiel_ergaenzen"]
        }
      },
      required: ["fachliche_korrektheit", "didaktische_qualitaet", "pruefungsrelevanz", "minicheck_qualitaet", "formale_qualitaet", "gewichtungs_einordnung", "overall_verdict", "critical_issues", "recommendations", "verbesserungspotenzial"]
    }
  }
};

const WEIGHTING_TOOL: AITool = {
  type: "function",
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

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const { courseId, sampleSize = 10 } = body;

    if (!courseId) return new Response(JSON.stringify({ error: "courseId required" }), { status: 400, headers: jsonHeaders });

    const { data: course } = await supabase.from('courses').select('id, title, curriculum_id, curricula(title)').eq('id', courseId).single();
    if (!course) throw new Error(`Course ${courseId} not found`);

    const { data: modules } = await supabase.from('modules').select('id, title, sort_order').eq('course_id', courseId).order('sort_order');
    const { data: allLessons } = await supabase.from('lessons').select('id, title, step, content, competency_id, module_id, modules!inner(title, course_id, sort_order)').eq('modules.course_id', courseId);

    if (!allLessons || allLessons.length === 0) return new Response(JSON.stringify({ error: "No lessons found" }), { status: 404, headers: jsonHeaders });

    // Stratified sampling
    const byModule = new Map<string, typeof allLessons>();
    for (const l of allLessons) {
      if (!byModule.has(l.module_id)) byModule.set(l.module_id, []);
      byModule.get(l.module_id)!.push(l);
    }
    const sample: typeof allLessons = [];
    const totalLessons = allLessons.length;
    for (const [, moduleLessons] of byModule) {
      const proportion = Math.max(1, Math.round((moduleLessons.length / totalLessons) * sampleSize));
      const shuffled = moduleLessons.sort(() => Math.random() - 0.5);
      sample.push(...shuffled.slice(0, proportion));
    }
    const finalSample = sample.slice(0, sampleSize);

    const compIds = [...new Set(finalSample.map(l => l.competency_id).filter(Boolean))];
    const { data: competencies } = await supabase.from('competencies').select('id, code, title, taxonomy_level').in('id', compIds);
    const compMap = new Map((competencies || []).map(c => [c.id, c]));

    const lessonAudits: any[] = [];
    for (const lesson of finalSample) {
      const comp = compMap.get(lesson.competency_id) || { code: 'N/A', title: 'Unbekannt', taxonomy_level: 'anwenden' };
      const content = lesson.content as Record<string, unknown> | null;
      let contentSummary = '';
      if (lesson.step === 'mini_check') {
        const qs = content?.questions as Array<Record<string, unknown>> | undefined;
        contentSummary = qs ? qs.map((q, i) => `Frage ${i + 1}: ${q.question}`).join('\n') : 'Keine Fragen vorhanden';
      } else {
        contentSummary = (content?.html as string) || 'Kein Inhalt';
      }
      const objectives = (content?.objectives as string[]) || [];

      const auditResult = await auditLesson({
        title: lesson.title, step: lesson.step, competencyCode: comp.code, competencyTitle: comp.title,
        taxonomyLevel: comp.taxonomy_level || 'anwenden', moduleName: (lesson.modules as any)?.title || '', contentSummary, objectives
      });

      if (auditResult) {
        const scores = {
          fachliche_korrektheit: auditResult.fachliche_korrektheit?.score || 0,
          didaktische_qualitaet: auditResult.didaktische_qualitaet?.score || 0,
          pruefungsrelevanz: auditResult.pruefungsrelevanz?.score || 0,
          minicheck_qualitaet: auditResult.minicheck_qualitaet?.score || 0,
          formale_qualitaet: auditResult.formale_qualitaet?.score || 0,
        };
        const rawOverall = Math.round(scores.fachliche_korrektheit * 0.25 + scores.didaktische_qualitaet * 0.25 + scores.pruefungsrelevanz * 0.20 + scores.minicheck_qualitaet * 0.15 + scores.formale_qualitaet * 0.15);
        lessonAudits.push({
          lessonId: lesson.id, lessonTitle: lesson.title, step: lesson.step, competencyCode: comp.code, module: (lesson.modules as any)?.title || '',
          scores, overall: rawOverall, issues: [...(auditResult.critical_issues || []), ...(auditResult.recommendations || [])],
          critical: (auditResult.critical_issues || []).length > 0, gewichtung: auditResult.gewichtungs_einordnung,
          verbesserungspotenzial: auditResult.verbesserungspotenzial, fullAudit: auditResult
        });
      }
    }

    const moduleOverview = (modules || []).map(m => {
      const mLessons = allLessons.filter(l => l.module_id === m.id);
      return { title: m.title, lessonCount: mLessons.length, percent: Math.round((mLessons.length / totalLessons) * 100) };
    });

    const weightingAudit = await auditWeighting({ courseTitle: course.title, curriculumTitle: (course.curricula as any)?.title || '', modules: moduleOverview, totalLessons });

    // Aggregate and persist results
    const avg = (nums: number[]) => nums.length === 0 ? 0 : Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
    const avgScores = {
      fachliche_korrektheit: avg(lessonAudits.map(a => a.scores.fachliche_korrektheit)),
      didaktische_qualitaet: avg(lessonAudits.map(a => a.scores.didaktische_qualitaet)),
      pruefungsrelevanz: avg(lessonAudits.map(a => a.scores.pruefungsrelevanz)),
      minicheck_qualitaet: avg(lessonAudits.map(a => a.scores.minicheck_qualitaet)),
      formale_qualitaet: avg(lessonAudits.map(a => a.scores.formale_qualitaet)),
      themengewichtung: weightingAudit?.score || 0,
    };
    const overallScore = Math.round(avgScores.fachliche_korrektheit * 0.25 + avgScores.didaktische_qualitaet * 0.25 + avgScores.pruefungsrelevanz * 0.20 + avgScores.themengewichtung * 0.10 + avgScores.formale_qualitaet * 0.10);
    
    // Insert audit record (omitted for brevity, same as original but logic flow fixed)
    const { data: insertedAudit } = await supabase.from('course_quality_audits').insert({
      course_id: courseId, audit_type: 'ihk_pruefer_v2', overall_score: overallScore, overall_grade: overallScore >= 92 ? 'sehr gut' : overallScore >= 81 ? 'gut' : 'befriedigend',
      dimensions: avgScores, recommendations: weightingAudit?.recommendations || [], critical_issues: [], lesson_audits: lessonAudits,
      audited_by: 'ai-ihk-pruefer-v2', model_used: getModel("quality_audit").model
    }).select('id').single();

    if (insertedAudit?.id && lessonAudits.length > 0) {
      await supabase.from('lesson_quality_audits').insert(lessonAudits.map(a => ({
        lesson_id: a.lessonId, course_audit_id: insertedAudit.id, audit_score: a.overall, dimension_scores: a.scores, failed_rules: Object.entries(a.verbesserungspotenzial).filter(([, v]) => v).map(([k]) => k), verbesserungspotenzial: a.verbesserungspotenzial
      })));
    }

    return new Response(JSON.stringify({ courseId, overallScore, dimensions: avgScores }), { headers: jsonHeaders });

  } catch (error) {
    console.error("[IHK-Audit] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function auditLesson(ctx: any) {
  const routed = getModel("quality_audit");
  try {
    const result = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: "system", content: "Du bist ein erfahrener IHK-Prüfungsausschuss-Vorsitzender. Prüfe Lerninhalte." },
        { role: "user", content: `Prüfe diese Lektion:\nModul: ${ctx.moduleName}\nLektion: ${ctx.title}\nInhalt: ${ctx.contentSummary.slice(0, 4000)}` },
      ],
      tools: [AUDIT_TOOL],
      tool_choice: { type: "function", function: { name: "submit_lesson_audit" } },
      temperature: 0.3,
    });
    const args = result.toolCalls?.[0]?.function?.arguments;
    return args ? JSON.parse(args) : null;
  } catch { return null; }
}

async function auditWeighting(ctx: any) {
  const routed = getModel("quality_audit");
  try {
    const result = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: "system", content: "Du bist ein erfahrener IHK-Prüfungsausschuss-Vorsitzender. Bewerte die Themengewichtung." },
        { role: "user", content: `Kurs: ${ctx.courseTitle}\nModule:\n${ctx.modules.map((m: any) => `- ${m.title}: ${m.lessonCount} Lessons`).join('\n')}` },
      ],
      tools: [WEIGHTING_TOOL],
      tool_choice: { type: "function", function: { name: "submit_weighting_audit" } },
      temperature: 0.3,
    });
    const args = result.toolCalls?.[0]?.function?.arguments;
    return args ? JSON.parse(args) : null;
  } catch { return null; }
}
