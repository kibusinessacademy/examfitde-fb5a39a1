import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const BATCH_SIZE = 5;

// ── Elite 2.0: Exam Context Types ──────────────────────────────────
const ELITE_CONTEXT_TYPES = [
  "applied_case", "multi_step_case", "prioritization",
  "error_detection", "documentation_analysis", "legal_evaluation",
  "communication_scenario",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const body = await req.json().catch(() => ({}));
  const blueprintId = body.blueprint_id;
  const domainKey = body.domain_key;
  const topicKey = body.topic_key;
  const count = body.count || BATCH_SIZE;

  if (!blueprintId) return json({ error: "blueprint_id required" }, 400);

  try {
    // 1) Load blueprint
    const { data: bp, error: bpErr } = await sb
      .from("dom_blueprints")
      .select("*, cert_master:german_certification_master(name)")
      .eq("id", blueprintId)
      .single();
    if (bpErr || !bp) throw new Error(bpErr?.message || "Blueprint not found");

    // 2) Load domains with type mix
    let domainQuery = sb
      .from("dom_blueprint_domains")
      .select("*, part:dom_blueprint_parts!inner(blueprint_id, part_name), type_mix:dom_blueprint_type_mix(*)")
      .eq("part.blueprint_id", blueprintId);

    if (domainKey) domainQuery = domainQuery.eq("domain_key", domainKey);

    const { data: domains, error: domErr } = await domainQuery;
    if (domErr) throw domErr;
    if (!domains?.length) return json({ error: "No domains found" }, 404);

    // 3) Load topics
    const domainIds = domains.map((d: any) => d.id);
    let topicQuery = sb
      .from("dom_blueprint_topics")
      .select("*")
      .in("domain_id", domainIds);
    if (topicKey) topicQuery = topicQuery.eq("topic_key", topicKey);

    const { data: topics } = await topicQuery;

    // 4) Load coverage
    const { data: coverage } = await sb
      .from("dom_blueprint_coverage")
      .select("*")
      .eq("blueprint_id", blueprintId);

    const coverageMap = new Map((coverage || []).map((c: any) => [c.domain_id, c]));

    // 5) Generate per domain
    const certName = (bp as any).cert_master?.name || "Zertifizierung";
    const results: any[] = [];
    let totalGenerated = 0;

    for (const domain of domains as any[]) {
      const cov = coverageMap.get(domain.id);
      const actual = cov?.questions_actual || 0;
      const target = domain.question_target;
      const remaining = Math.max(0, target - actual);

      if (remaining === 0) {
        results.push({ domain: domain.domain_key, status: "complete", actual, target });
        continue;
      }

      const batchCount = Math.min(count, remaining);

      const typeMix = (domain.type_mix || [])
        .map((t: any) => `${t.share_pct}% ${t.qtype.replace('_', ' ')}`)
        .join(", ");

      const domainTopics = (topics || [])
        .filter((t: any) => t.domain_id === domain.id)
        .map((t: any) => t.topic_name);

      const diffMix = bp.difficulty_mix || { easy: 0.10, medium: 0.45, hard: 0.35, very_hard: 0.10 };

      // ── Elite 2.0: Enhanced prompt with exam context types ────────
      const contextTypeList = ELITE_CONTEXT_TYPES.join(", ");

      const systemPrompt = `Du bist ein Experte für die IHK-Prüfung "${certName}".
Du erstellst prüfungsrealistische Fragen für den Bereich "${domain.domain_name}" (${domain.part?.part_name}).

QUALITÄTSREGELN:
- Jede Frage MUSS prüfungsrelevant und praxisnah sein
- Keine Füll- oder Trivialfragen
- Schwierigkeitsverteilung: ${Math.round(diffMix.easy * 100)}% leicht, ${Math.round(diffMix.medium * 100)}% mittel, ${Math.round(diffMix.hard * 100)}% schwer
- Fragetyp-Mix: ${typeMix || "80% MC, 20% Transfer"}
- Bei Rechenaufgaben: realistische Zahlen, korrekte Lösungswege
- Bei Fallanalysen: konkrete Unternehmenssituationen
- Plausible Distraktoren (keine offensichtlich falschen Antworten)
- Jede Frage hat 4 Antwortoptionen, genau 1 korrekt
- Ausführliche Erklärung pro Frage

ELITE-ANFORDERUNGEN (Prüfungsnähe 2.0):
- Maximal 20% der Fragen dürfen "isolated_knowledge" sein
- Mindestens 30% müssen "multi_step_case" oder "applied_case" sein
- Jede schwere Frage MUSS einen exam_context_type ≠ "isolated_knowledge" haben
- Jede Frage braucht mindestens 2 typische Fehler (typical_errors)
- Erlaubte exam_context_type: ${contextTypeList}
- Bloom-Level muss korrekt zugeordnet werden (remember, understand, apply, analyze)

THEMENABDECKUNG (aus Rahmenplan):
${domainTopics.length > 0 ? domainTopics.map((t: string) => `- ${t}`).join("\n") : "Alle Kernthemen des Bereichs"}

Antworte NUR mit einem JSON-Array:
[{
  "question_text": "...",
  "options": ["A","B","C","D"],
  "correct_answer": 0,
  "explanation": "...",
  "difficulty": "easy|medium|hard",
  "topic": "...",
  "question_type": "mc_single|calculation|case_study|scenario|transfer",
  "exam_context_type": "isolated_knowledge|applied_case|multi_step_case|prioritization|error_detection|documentation_analysis|legal_evaluation|communication_scenario",
  "bloom_level": "remember|understand|apply|analyze",
  "typical_errors": ["Fehler 1", "Fehler 2"],
  "exam_relevance_score": 1-5
}]`;

      const userPrompt = `Erstelle exakt ${batchCount} hochwertige Prüfungsfragen für "${domain.domain_name}".
Beachte die Schwierigkeitsverteilung und den Fragetyp-Mix.
Rechenanteil: ${domain.calc_share_pct}%, Transferanteil: ${domain.transfer_share_pct}%.
WICHTIG: Maximal 1 von ${batchCount} Fragen darf "isolated_knowledge" sein. Der Rest muss praxisnah und fallorientiert sein.`;

      // 7) Call AI
      const aiResp = await fetch(`${SUPABASE_URL}/functions/v1/ai-tutor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          _direct_ai_call: true,
          provider: "openai",
          model: "gpt-5",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          response_format: { type: "json_object" },
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        results.push({ domain: domain.domain_key, status: "ai_error", error: errText.slice(0, 200) });
        continue;
      }

      const aiData = await aiResp.json();
      const content = aiData.content || aiData.choices?.[0]?.message?.content || "";

      let questions: any[];
      try {
        const parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        questions = Array.isArray(parsed) ? parsed : parsed.questions || [];
      } catch {
        results.push({ domain: domain.domain_key, status: "parse_error", raw: content.slice(0, 200) });
        continue;
      }

      // 8) Store questions with Elite 2.0 metadata
      const inserts = questions.map((q: any) => ({
        question_text: q.question_text,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        difficulty: q.difficulty || "medium",
        ai_generated: true,
        status: "draft",
        metadata: {
          dom_blueprint_id: blueprintId,
          domain_key: domain.domain_key,
          topic: q.topic || null,
          question_type: q.question_type || "mc_single",
          cert_name: certName,
          // ── Elite 2.0 metadata ──
          exam_context_type: q.exam_context_type || "applied_case",
          bloom_level: q.bloom_level || "understand",
          typical_errors: q.typical_errors || [],
          exam_relevance_score: q.exam_relevance_score || 3,
        },
      }));

      totalGenerated += inserts.length;

      // 9) Update coverage
      await sb
        .from("dom_blueprint_coverage")
        .update({ questions_actual: actual + inserts.length, updated_at: new Date().toISOString() })
        .eq("blueprint_id", blueprintId)
        .eq("domain_id", domain.id);

      // Elite stats for this domain
      const eliteCount = inserts.filter(q => q.metadata.exam_context_type !== "isolated_knowledge").length;

      results.push({
        domain: domain.domain_key,
        status: "generated",
        count: inserts.length,
        actual: actual + inserts.length,
        target,
        coverage_pct: Math.round(((actual + inserts.length) / target) * 100),
        elite_ratio: Math.round((eliteCount / inserts.length) * 100),
      });
    }

    // 10) Overall coverage
    const { data: updatedCoverage } = await sb
      .from("dom_blueprint_coverage")
      .select("questions_target, questions_actual")
      .eq("blueprint_id", blueprintId);

    const totalTarget = (updatedCoverage || []).reduce((s: number, c: any) => s + c.questions_target, 0);
    const totalActual = (updatedCoverage || []).reduce((s: number, c: any) => s + c.questions_actual, 0);
    const overallCoverage = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

    console.log(`[DomSeeder] Blueprint ${blueprintId.slice(0, 8)}: +${totalGenerated} questions, total=${totalActual}/${totalTarget} (${overallCoverage}%)`);

    return json({
      ok: true,
      generated: totalGenerated,
      total_actual: totalActual,
      total_target: totalTarget,
      coverage_pct: overallCoverage,
      domains: results,
      needs_more: totalActual < totalTarget,
    });
  } catch (e: unknown) {
    console.error(`[DomSeeder] Error: ${(e as Error)?.message}`);
    return json({ ok: false, error: (e as Error)?.message || String(e) }, 500);
  }
});
