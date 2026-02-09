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
    description: "Bewerte eine Lektion aus Sicht eines IHK-Prüfers mit verschärften Qualitätskriterien.",
    parameters: {
      type: "object",
      properties: {
        fachliche_korrektheit: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            has_betrieblicher_bezug: { type: "boolean", description: "Enthält konkreten betrieblichen/praxisbezug" },
            has_ihk_wording: { type: "boolean", description: "Verwendet IHK-konforme Fachterminologie" },
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
            anwenden_is_decision_based: { type: "boolean", description: "Anwenden-Phase enthält Entscheidungsfragen statt reiner Beschreibung" },
            has_gegenbeispiel: { type: "boolean", description: "Verstehen-Phase enthält Gegenbeispiele" },
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
            has_pruefungsbezug_block: { type: "boolean", description: "Enthält expliziten IHK-Prüfungsbezug-Block (typische Frage, Falle, Prüfer-Fokus)" },
            has_typische_ihk_formulierung: { type: "boolean", description: "Mindestens 1 typische IHK-Fragestellung enthalten" },
            has_fehlannahme: { type: "boolean", description: "Mindestens 1 typische Fehlannahme/Prüfungsfalle benannt" },
            issues: { type: "array", items: { type: "string" } },
            verdict: { type: "string" }
          },
          required: ["score", "ihk_alignment", "has_pruefungsbezug_block", "has_typische_ihk_formulierung", "has_fehlannahme", "issues", "verdict"]
        },
        minicheck_qualitaet: {
          type: "object",
          properties: {
            score: { type: "integer", minimum: 0, maximum: 100 },
            distraktoren_plausibel: { type: "boolean", description: "Distraktoren sind nicht offensichtlich falsch" },
            has_abwaegungsfrage: { type: "boolean", description: "Mind. 1 Frage: 'Welche Aussage trifft am ehesten zu?'" },
            erklaerungen_begruenden_falsch: { type: "boolean", description: "Erklärungen sagen auch warum falsch, nicht nur warum richtig" },
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
        gewichtungs_einordnung: {
          type: "string",
          enum: ["sehr_pruefungsrelevant", "haeufige_fehlerquelle", "ergaenzendes_wissen"],
          description: "Empfohlene Gewichtungs-Markierung für diese Lesson"
        },
        overall_verdict: { type: "string" },
        critical_issues: { type: "array", items: { type: "string" } },
        recommendations: { type: "array", items: { type: "string" } },
        verbesserungspotenzial: {
          type: "object",
          description: "Konkrete Verbesserungsvorschläge für den AI-Verbesserungsagenten",
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
    minicheck_qualitaet: number;
    formale_qualitaet: number;
  };
  overall: number;
  issues: string[];
  critical: boolean;
  gewichtung: string;
  verbesserungspotenzial: Record<string, boolean>;
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
          minicheck_qualitaet: auditResult.minicheck_qualitaet?.score || 0,
          formale_qualitaet: auditResult.formale_qualitaet?.score || 0,
        };
        // Penalty system: missing critical elements cap the score
        let penaltyFactor = 1.0;
        const pr = auditResult.pruefungsrelevanz as Record<string, unknown> | undefined;
        if (pr && !pr.has_pruefungsbezug_block) penaltyFactor -= 0.10;
        const did = auditResult.didaktische_qualitaet as Record<string, unknown> | undefined;
        if (did && !did.anwenden_is_decision_based) penaltyFactor -= 0.05;
        const fach = auditResult.fachliche_korrektheit as Record<string, unknown> | undefined;
        if (fach && !fach.has_betrieblicher_bezug) penaltyFactor -= 0.05;

        const rawOverall = Math.round(
          scores.fachliche_korrektheit * 0.25 +
          scores.didaktische_qualitaet * 0.25 +
          scores.pruefungsrelevanz * 0.20 +
          scores.minicheck_qualitaet * 0.15 +
          scores.formale_qualitaet * 0.15
        );
        const overall = Math.max(0, Math.round(rawOverall * penaltyFactor));

        const verbesserung = (auditResult.verbesserungspotenzial || {}) as Record<string, boolean>;

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
          gewichtung: (auditResult.gewichtungs_einordnung as string) || 'ergaenzendes_wissen',
          verbesserungspotenzial: verbesserung,
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
      minicheck_qualitaet: avg(lessonAudits.map(a => a.scores.minicheck_qualitaet)),
      formale_qualitaet: avg(lessonAudits.map(a => a.scores.formale_qualitaet)),
      themengewichtung: weightingAudit?.score || 0,
    };

    const overallScore = Math.round(
      avgScores.fachliche_korrektheit * 0.25 +
      avgScores.didaktische_qualitaet * 0.25 +
      avgScores.pruefungsrelevanz * 0.20 +
      avgScores.minicheck_qualitaet * 0.10 +
      avgScores.themengewichtung * 0.10 +
      avgScores.formale_qualitaet * 0.10
    );

    // Count improvement needs across all lessons
    const improvementNeeds = {
      pruefungsbezug_ergaenzen: lessonAudits.filter(a => a.verbesserungspotenzial.pruefungsbezug_ergaenzen).length,
      anwenden_umformulieren: lessonAudits.filter(a => a.verbesserungspotenzial.anwenden_umformulieren).length,
      minicheck_verbessern: lessonAudits.filter(a => a.verbesserungspotenzial.minicheck_verbessern).length,
      betriebsbezug_ergaenzen: lessonAudits.filter(a => a.verbesserungspotenzial.betriebsbezug_ergaenzen).length,
      gegenbeispiel_ergaenzen: lessonAudits.filter(a => a.verbesserungspotenzial.gegenbeispiel_ergaenzen).length,
    };

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
      audit_type: 'ihk_pruefer_v2',
      overall_score: overallScore,
      overall_grade: grade,
      dimensions: { ...avgScores, improvement_needs: improvementNeeds },
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
        gewichtung: a.gewichtung,
        verbesserungspotenzial: a.verbesserungspotenzial,
        issues: a.issues.slice(0, 5),
      })),
      audited_by: 'ai-ihk-pruefer-v2',
      model_used: 'google/gemini-2.5-flash',
    };

    const { data: insertedAudit } = await supabase.from('course_quality_audits').insert(auditRecord).select('id').single();

    // ─── Write per-lesson audit results to lesson_quality_audits ───
    if (insertedAudit?.id && lessonAudits.length > 0) {
      const lessonAuditRows = lessonAudits.map(a => ({
        lesson_id: a.lessonId,
        course_audit_id: insertedAudit.id,
        audit_score: a.overall,
        dimension_scores: a.scores,
        failed_rules: Object.entries(a.verbesserungspotenzial).filter(([, v]) => v).map(([k]) => k),
        verbesserungspotenzial: a.verbesserungspotenzial,
      }));
      await supabase.from('lesson_quality_audits').insert(lessonAuditRows);

      // Write improvement suggestions for lessons needing work
      const suggestions = lessonAudits.flatMap(a =>
        Object.entries(a.verbesserungspotenzial)
          .filter(([, needed]) => needed)
          .map(([rule]) => ({
            lesson_id: a.lessonId,
            rule,
            suggested_change: { audit_score: a.overall, step: a.step, competency: a.competencyCode },
            applied: false,
          }))
      );
      if (suggestions.length > 0) {
        await supabase.from('lesson_improvement_suggestions').insert(suggestions);
      }
      console.log(`[IHK-Audit] Wrote ${lessonAuditRows.length} lesson audits, ${suggestions.length} suggestions`);
    }

    console.log(`[IHK-Audit] ✅ Complete: "${course.title}" → ${overallScore}/100 (${grade})`);

    return new Response(JSON.stringify({
      courseId,
      courseTitle: course.title,
      overallScore,
      grade,
      dimensions: avgScores,
      improvementNeeds,
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
        gewichtung: a.gewichtung,
        verbesserungspotenzial: a.verbesserungspotenzial,
      })),
      weightingAudit: weightingAudit || null,
      needsImprovement: overallScore < 92,
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
Du prüfst Lerninhalte für die IHK-Abschlussprüfung mit HÖCHSTEN Qualitätsansprüchen.

VERSCHÄRFTE Bewertungskriterien (IHK-sehr-gut-Standard):

1. Fachliche Korrektheit:
   - Begriffe MÜSSEN prüfungskonform definiert sein (IHK-Wording, kein Marketing)
   - Kein "man", "oft", "häufig" ohne Kontext
   - Mindestens 1 konkreter betrieblicher Bezug (Ausbildungsbetrieb, Praxisfall)
   - Prüferfrage: "Kann ein Azubi damit im Betrieb argumentieren?"

2. Didaktische Qualität:
   - Einstieg = konkretes Szenario, KEINE Theorie
   - Verstehen = Definition + Beispiel + GEGENBEISPIEL
   - Anwenden = ENTSCHEIDUNG, nicht Beschreibung ("Was würdest du tun? Warum?")
   - Wenn Anwenden nur erklärt → DURCHGEFALLEN
   - Wiederholen = prüfungsnahe Zusammenfassung, nicht Inhaltswiederholung

3. Prüfungsrelevanz (KRITISCHER HEBEL):
   - Jede Lesson MUSS einen expliziten IHK-Prüfungsbezug-Block enthalten:
     • "So fragt die IHK das Thema ab"
     • "Häufige Prüfungsfalle"
     • "Worauf Prüfer achten"
   - Ohne diesen Block → maximal "gut", NIE "sehr gut"

4. MiniCheck-Qualität:
   - Distraktoren MÜSSEN plausibel sein (nicht offensichtlich falsch)
   - Mind. 1 Frage: "Welche Aussage trifft am ehesten zu?"
   - Erklärungen MÜSSEN sagen warum falsch, nicht nur warum richtig

5. Formale Qualität: Struktur, Länge, Formatierung

Sei STRENG. Ein "sehr gut" gibt es nur bei EXZELLENTER Qualität.
Nenne konkrete Probleme mit Zitat aus dem Inhalt.
Identifiziere gezielt Verbesserungspotenzial für den AI-Verbesserungsagenten.`;

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
